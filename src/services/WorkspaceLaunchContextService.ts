import type * as vscode from 'vscode';

export interface WorkspaceLaunchContext {
  course_id: string;
  request_id: string;
  expires_at: string;
}

export function workspaceLaunchIdentity(env: NodeJS.ProcessEnv = process.env): { owner: string; name: string } | undefined {
  const owner = env.COMPUTOR_WORKSPACE_OWNER?.trim();
  const name = env.COMPUTOR_WORKSPACE_NAME?.trim();
  return owner && name ? { owner, name } : undefined;
}

export function validWorkspaceLaunchContext(value: WorkspaceLaunchContext | null, now = Date.now()): value is WorkspaceLaunchContext {
  return Boolean(value && typeof value.course_id === 'string' && value.course_id.trim()
    && typeof value.request_id === 'string' && value.request_id.trim()
    && typeof value.expires_at === 'string' && Date.parse(value.expires_at) > now);
}

interface LaunchContextOptions {
  fetchContext(): Promise<WorkspaceLaunchContext | null>;
  openCourse(courseId: string): Promise<boolean>;
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
      await this.options.openCourse(launch.course_id);
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
