import * as vscode from 'vscode';
import type { CourseContentStudentList } from '../types/generated';
import type { TreeHandle } from '../ui/treeRegistry';
import { findInTree } from '../ui/tree/chat/chatJump';

export interface WorkspaceLaunchContext {
  /** Absent when the workspace was opened without a course: the launch then carries only the reading language. */
  course_id?: string | null;
  course_content_id?: string | null;
  request_id: string;
  expires_at: string;
  ui_language?: 'de' | 'en' | null;
}

interface LaunchContentRow extends vscode.TreeItem {
  courseContent?: CourseContentStudentList;
  contentType?: { course_content_kind_id?: string };
  node?: { courseContent?: CourseContentStudentList; contentType?: { course_content_kind_id?: string } };
}

export function workspaceLaunchContent(item: unknown): CourseContentStudentList | undefined {
  const row = item as LaunchContentRow | undefined;
  return row?.courseContent ?? row?.node?.courseContent;
}

export function workspaceLaunchContentKind(item: unknown): string | undefined {
  const row = item as LaunchContentRow | undefined;
  return workspaceLaunchContent(row)?.course_content_kind_id
    ?? row?.contentType?.course_content_kind_id ?? row?.node?.contentType?.course_content_kind_id;
}

/** Resolve the existing native row, without walking assignment files or another course. */
export function findWorkspaceLaunchTarget(tracked: TreeHandle['tracked'], courseId: string, contentId: string): Promise<unknown | undefined> {
  return findInTree(tracked, candidate => {
    const content = workspaceLaunchContent(candidate);
    const kind = workspaceLaunchContentKind(candidate);
    return content?.id === contentId && (!content.course_id || content.course_id === courseId)
      && content.visible_effective !== false && (kind === 'assignment' || kind === 'unit');
  }, candidate => {
    const id = typeof candidate.id === 'string' ? candidate.id : '';
    if (id.startsWith('course-')) return id === `course-${courseId}`;
    return candidate.collapsibleState !== vscode.TreeItemCollapsibleState.None
      && workspaceLaunchContentKind(candidate) !== 'assignment';
  });
}

export function workspaceLaunchIdentity(env: NodeJS.ProcessEnv = process.env): { owner: string; name: string } | undefined {
  const owner = env.COMPUTOR_WORKSPACE_OWNER?.trim();
  const name = env.COMPUTOR_WORKSPACE_NAME?.trim();
  return owner && name ? { owner, name } : undefined;
}

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

/** A current launch, with or without a course. */
function currentLaunch(value: WorkspaceLaunchContext | null, now: number): value is WorkspaceLaunchContext {
  return Boolean(value
    && (absent(value.course_id) ? absent(value.course_content_id) : nonBlank(value.course_id))
    && (absent(value.course_content_id) || nonBlank(value.course_content_id))
    && nonBlank(value.request_id)
    && typeof value.expires_at === 'string' && Date.parse(value.expires_at) > now
    && (absent(value.ui_language) || value.ui_language === 'de' || value.ui_language === 'en'));
}

/** A current launch that names a course to open. */
export function validWorkspaceLaunchContext(
  value: WorkspaceLaunchContext | null, now = Date.now()
): value is WorkspaceLaunchContext & { course_id: string } {
  return currentLaunch(value, now) && nonBlank(value.course_id);
}

/** The reading language a current launch carries, also when it names no course. */
export function workspaceLaunchLanguage(value: WorkspaceLaunchContext | null, now = Date.now()): 'de' | 'en' | undefined {
  return currentLaunch(value, now) ? value.ui_language ?? undefined : undefined;
}

interface LaunchContextOptions {
  fetchContext(): Promise<WorkspaceLaunchContext | null>;
  openCourse(courseId: string, courseContentId?: string | null): Promise<boolean>;
  onLaunch?(): Promise<void>;
  now?: () => number;
  intervalMs?: number;
}

/** A launch is an intent, not a permanent selection: consume it once per editor. */
export class WorkspaceLaunchContextService implements vscode.Disposable {
  private readonly handled = new Set<string>();
  private readonly failures = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private disposed = false;

  constructor(private readonly options: LaunchContextOptions) {}

  start(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => { void this.poll(); }, this.options.intervalMs ?? 3000);
    void this.poll();
  }

  async poll(): Promise<void> {
    if (this.polling || this.disposed) return;
    this.polling = true;
    let requestId: string | undefined;
    try {
      const launch = await this.options.fetchContext();
      if (this.disposed || !validWorkspaceLaunchContext(launch, this.options.now?.() ?? Date.now())
        || this.handled.has(launch.request_id)) return;
      requestId = launch.request_id;
      await this.options.onLaunch?.();
      if (this.disposed) return;
      await this.options.openCourse(launch.course_id, launch.course_content_id);
      // false means permanently unavailable. A thrown transient error retries.
      this.handled.add(requestId);
      this.failures.delete(requestId);
    } catch (error) {
      if (requestId) {
        const attempts = (this.failures.get(requestId) ?? 0) + 1;
        this.failures.set(requestId, attempts);
        if (attempts >= 5) this.handled.add(requestId);
      }
      console.warn('[WorkspaceLaunchContext] Could not apply workspace launch:', error);
    } finally {
      this.polling = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
