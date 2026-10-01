import * as vscode from 'vscode';
import * as path from 'path';
import { AssistantContent, courseAssistantBridge } from './CourseAssistantBridge';

type LocatedContent = AssistantContent & { directory?: string | null };
const selectionListeners = new Set<() => Promise<void>>();
export async function refreshCourseAssistantSelection(): Promise<void> {
  await Promise.all(Array.from(selectionListeners, refresh => refresh()));
}
export function contentForFile(file: string, root: string, contents: LocatedContent[]): LocatedContent | undefined {
  const inside = (candidate: string, parent: string) => {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };
  if (!inside(file, root)) return undefined;
  return contents.filter(content => {
    if (!content.directory) return false;
    const directory = path.resolve(root, content.directory);
    return inside(directory, root) && inside(file, directory);
  }).sort((a, b) => (b.directory?.length ?? 0) - (a.directory?.length ?? 0))[0];
}

export function registerCourseAssistantTracking(context: vscode.ExtensionContext, options: {
  courseId(): string | undefined;
  repositoryRoot(courseId: string): Promise<string | undefined>;
  contents(courseId: string): Promise<LocatedContent[]>;
  detail(id: string): Promise<AssistantContent | undefined>;
}): void {
  let generation = 0;
  async function sync(editor?: vscode.TextEditor): Promise<void> {
    const current = ++generation;
    const courseId = options.courseId();
    if (!courseId) { courseAssistantBridge.clear(); return; }
    await courseAssistantBridge.apply({ id: 'loading', course_id: courseId,
      assistant_policy: { action_mode: 'ask', completion: 'off', independent_check: true } });
    if (!editor || editor.document.uri.scheme !== 'file') return;
    const epoch = courseAssistantBridge.epoch;
    try {
      const root = await options.repositoryRoot(courseId);
      if (current !== generation || options.courseId() !== courseId || !root) return;
      const contents = await options.contents(courseId);
      if (current !== generation || options.courseId() !== courseId) return;
      const selected = contentForFile(editor.document.uri.fsPath, root, contents);
      if (!selected) return;
      const detail = await options.detail(selected.id);
      if (current !== generation || options.courseId() !== courseId || !detail || courseAssistantBridge.epoch !== epoch) return;
      await courseAssistantBridge.apply(detail);
    } catch {
      // Keep the loading policy disabled on failure; never infer permission
      // from an unavailable backend or carry another assignment's context.
    }
  }
  const refresh = () => sync(vscode.window.activeTextEditor);
  selectionListeners.add(refresh);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => { void sync(editor); }),
    { dispose: () => { selectionListeners.delete(refresh); ++generation; courseAssistantBridge.clear(); } },
  );
  void sync(vscode.window.activeTextEditor);
}
