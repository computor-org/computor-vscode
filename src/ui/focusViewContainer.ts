import * as vscode from 'vscode';
import { getTreeHandle } from './treeRegistry';
import { ViewContainer, viewsForContainer } from './viewContainers';

/** How long to keep trying before giving up. */
const DEFAULT_ATTEMPTS = 10;
const DEFAULT_DELAY_MS = 50;

/**
 * Open an activity-bar container, waiting until it is actually there.
 *
 * Every Computor container is `when`-gated on a `computor.*.show` context key.
 * `setContext` resolving only means the key reached the context service — the
 * workbench re-evaluates `when` clauses later, and until it does the container
 * is not on screen and `workbench.view.extension.*` either does not exist yet
 * or opens nothing. Firing the focus command on the line after flipping the key
 * therefore did nothing at all, silently, because the caller logged the failure
 * to the console and moved on.
 *
 * That it ever worked was an accident: validateGitEnvironment() used to sit
 * between initializeViews and the focus and gave the workbench time to catch
 * up. 5524ab9 moved it earlier and the post-login focus quietly died. So don't
 * lean on an unrelated await — retry until a tree view in the container reports
 * itself visible, which is the only authoritative "it worked" signal there is.
 */
export async function focusViewContainer(
  container: ViewContainer,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<boolean> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const viewIds = viewsForContainer(container.id);

  // Nothing to observe: a container with no registered tree view can't be
  // confirmed, so run the command once and report whether it survived.
  if (viewIds.length === 0) {
    try {
      await vscode.commands.executeCommand(container.focusCommand);
      return true;
    } catch {
      return false;
    }
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await vscode.commands.executeCommand(container.focusCommand);
    } catch {
      // The container is not registered yet — that is exactly what we retry for.
    }

    if (isAnyViewVisible(viewIds)) {
      return true;
    }

    if (attempt < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return isAnyViewVisible(viewIds);
}

function isAnyViewVisible(viewIds: readonly string[]): boolean {
  return viewIds.some(id => getTreeHandle(id)?.view.visible === true);
}
