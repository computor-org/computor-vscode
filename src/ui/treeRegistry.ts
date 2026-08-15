import type * as vscode from 'vscode';
import type { TrackedTree } from './treeRestore';

/**
 * The TreeView + TrackedTree pair behind each registered view.
 *
 * `registerTreeView` wraps every provider in a TrackedTree (for getParent and
 * the id index) and creates the TreeView — but until now it kept both to
 * itself, so no feature outside the registration site could ever call
 * `reveal`. Cross-view navigation (the inbox's jump-to-assignment) needs
 * exactly that: look up another view's handle, materialise the target node,
 * reveal it.
 */
export interface TreeHandle<T = unknown> {
  view: vscode.TreeView<T>;
  tracked: TrackedTree<T>;
}

const handles = new Map<string, TreeHandle>();

export function registerTreeHandle(viewId: string, handle: TreeHandle): void {
  handles.set(viewId, handle);
}

export function getTreeHandle(viewId: string): TreeHandle | undefined {
  return handles.get(viewId);
}

/** Test hook — the map is module-global. */
export function clearTreeHandles(): void {
  handles.clear();
}
