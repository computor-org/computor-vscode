import * as vscode from 'vscode';

/**
 * Shared base for tree data providers: owns the change emitter and the
 * standard refresh entry points so subclasses don't re-implement them.
 *
 * Subclasses that need to clear caches on refresh override `refresh()` and
 * call `super.refresh()` at the end. Anything provider-specific (getParent,
 * drag-and-drop, targeted refresh helpers) stays on the subclass and fires
 * through the protected emitter.
 */
export abstract class BaseTreeDataProvider<T> implements vscode.TreeDataProvider<T> {
  protected readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<T | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  /** Refresh the entire tree. */
  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  /** Refresh a single element (and its subtree). */
  refreshItem(item: T): void {
    this.onDidChangeTreeDataEmitter.fire(item);
  }

  abstract getTreeItem(element: T): vscode.TreeItem | Thenable<vscode.TreeItem>;
  abstract getChildren(element?: T): vscode.ProviderResult<T[]>;
}
