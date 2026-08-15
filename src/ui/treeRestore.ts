import * as vscode from 'vscode';

/**
 * Putting the selection back where the user left it.
 *
 * `TreeView.reveal` is the only way to select a node from code, and it is a
 * silent no-op unless the provider implements `getParent` — which only two of
 * the nine providers did. Rather than add one to each by hand, the provider
 * handed to `createTreeView` is wrapped: children come back through
 * `getChildren`, so who their parent is can simply be recorded as they pass.
 * The provider object itself is untouched, so every command that holds a
 * reference to it keeps working.
 *
 * The wrapper also indexes items by id, because what gets persisted is an id
 * and what `reveal` needs is the element instance.
 */
export interface TrackedTree<T> {
  /** Give this to createTreeView, not the original. */
  readonly provider: vscode.TreeDataProvider<T>;
  /** The element currently carrying this id, if it has been rendered. */
  find(id: string): T | undefined;
  /** Fires after each batch of children is produced. */
  readonly onDidProduceItems: vscode.Event<void>;
  dispose(): void;
}

/** A tree element's stable id, when it has one. */
export function treeItemId(element: unknown): string | undefined {
  const id = (element as vscode.TreeItem | undefined)?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export function trackTree<T>(inner: vscode.TreeDataProvider<T>): TrackedTree<T> {
  // Weak, so remembering parents cannot keep a discarded tree alive.
  const parents = new WeakMap<object, T | undefined>();
  const byId = new Map<string, T>();
  const produced = new vscode.EventEmitter<void>();

  const provider: vscode.TreeDataProvider<T> = {
    get onDidChangeTreeData() {
      return inner.onDidChangeTreeData;
    },
    getTreeItem: (element: T) => inner.getTreeItem(element),
    getChildren: async (element?: T) => {
      const children = await inner.getChildren(element);
      if (children) {
        for (const child of children) {
          if (child && typeof child === 'object') {
            parents.set(child as object, element);
          }
          const id = treeItemId(child);
          if (id) {
            byId.set(id, child);
          }
        }
        produced.fire();
      }
      return children;
    },
    // A provider that already knows its own parents keeps answering for
    // itself; the recorded map is only the fallback.
    getParent: (element: T) => {
      if (inner.getParent) {
        return inner.getParent(element);
      }
      return element && typeof element === 'object'
        ? parents.get(element as object)
        : undefined;
    }
  };

  if (inner.resolveTreeItem) {
    provider.resolveTreeItem = (item, element, token) =>
      inner.resolveTreeItem!(item, element, token);
  }

  return {
    provider,
    find: (id: string) => byId.get(id),
    onDidProduceItems: produced.event,
    dispose: () => {
      produced.dispose();
      byId.clear();
    }
  };
}

/**
 * True while a restore is driving the selection.
 *
 * Selecting a node has consequences: the student tree opens its test results,
 * the tutor tree checks out that member's repository. Replaying those on every
 * reopen would turn startup into a series of clones and progress popups — slow
 * on a desktop, unusable in a browser tab. The selection handlers consult this
 * and do the highlight without the side effects.
 */
let restoring = false;

export function isRestoringSelection(): boolean {
  return restoring;
}

/** How long after a reveal its selection event may still arrive. */
const SUPPRESS_WINDOW_MS = 1500;

/**
 * Run a programmatic reveal with selection side effects standing down.
 *
 * Same contract as a restore: the guards in the selection handlers consult
 * `isRestoringSelection()`, so a reveal wrapped here highlights the node
 * without setting off the checkout / result-fetch machinery a user click
 * would. The flag outlives `fn` by the usual suppress window, because the
 * selection event lands after the reveal resolves.
 */
export async function suppressSelectionSideEffects(fn: () => Promise<void>): Promise<void> {
  restoring = true;
  try {
    await fn();
  } finally {
    setTimeout(() => {
      restoring = false;
    }, SUPPRESS_WINDOW_MS);
  }
}

/** How long to keep waiting for the remembered node to be rendered. */
const RESTORE_TIMEOUT_MS = 30000;

/**
 * Select the remembered node once it appears, then stop looking.
 *
 * The node usually shows up on the first render, because expansion is restored
 * first — but a tree that loads its levels lazily can take a few rounds, hence
 * waiting on item batches rather than trying once.
 */
export function restoreSelection<T>(
  treeView: vscode.TreeView<T>,
  tracked: TrackedTree<T>,
  itemId: string,
  disposables: vscode.Disposable[]
): void {
  let done = false;

  const finish = (): void => {
    if (done) {
      return;
    }
    done = true;
    clearTimeout(timeout);
    subscription.dispose();
  };

  const attempt = async (): Promise<void> => {
    if (done) {
      return;
    }
    const element = tracked.find(itemId);
    if (!element) {
      return;
    }
    finish();
    restoring = true;
    try {
      // focus stays where it is: reopening a workspace should not steal the
      // cursor out of the editor.
      await treeView.reveal(element, { select: true, focus: false, expand: false });
    } catch (error) {
      console.warn('[TreeRestore] Could not reveal the remembered selection:', error);
    } finally {
      setTimeout(() => {
        restoring = false;
      }, SUPPRESS_WINDOW_MS);
    }
  };

  const subscription = tracked.onDidProduceItems(() => void attempt());
  const timeout = setTimeout(finish, RESTORE_TIMEOUT_MS);
  disposables.push({ dispose: finish });

  void attempt();
}
