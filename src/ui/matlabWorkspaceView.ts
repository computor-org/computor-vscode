import * as vscode from 'vscode';
import { notify } from '../utils/notify';

/**
 * Helping the MATLAB workspace browser out of the primary side bar.
 *
 * MATLAB's variable browser is a view the MathWorks extension contributes to
 * its own activity-bar container, so opening it replaces the Computor tree and
 * the file explorer — you cannot watch your variables and your assignment at
 * the same time (computor-org/issues#327). Its natural home is the secondary
 * side bar, next to where figures and artifacts open.
 *
 * We cannot put it there for the student. An extension may only place the
 * containers it declares itself; there is no API for relocating another
 * extension's view, `workbench.action.moveViewToAuxiliarySideBar` does not
 * exist (VS Code 1.123 offers only the interactive `moveFocusedView`), and in
 * code-server the workbench layout lives in the browser's IndexedDB rather
 * than in any file the workspace image could seed.
 *
 * What is left is to make the manual move short and findable: focus the view,
 * then open the picker with it already selected.
 */

const MATLAB_EXTENSION_ID = 'MathWorks.language-matlab';
/** Contributed by the MATLAB extension as `workspaceBrowserSidebarView`. */
const MATLAB_WORKSPACE_VIEW = 'workspaceBrowserSidebarView';

export function isMatlabExtensionInstalled(): boolean {
  return vscode.extensions.getExtension(MATLAB_EXTENSION_ID) !== undefined;
}

export function registerMatlabWorkspaceView(context: vscode.ExtensionContext): void {
  // Gates the command's palette and menu entries: on a Python workspace there
  // is no MATLAB extension and the command would do nothing.
  const evaluateAvailability = () => {
    const installed = isMatlabExtensionInstalled();
    // Logged so "why is the command not offered?" can be answered from the
    // Developer Tools instead of by guessing (#327).
    console.log(
      `[MatlabWorkspaceView] ${MATLAB_EXTENSION_ID} ${installed ? 'found' : 'not found'}; ` +
      `computor.matlabExtensionAvailable = ${installed}`
    );
    void vscode.commands.executeCommand(
      'setContext',
      'computor.matlabExtensionAvailable',
      installed
    );
  };
  evaluateAvailability();
  // Set once was not enough: an extension installed or enabled after
  // activation left the gate closed forever (#327).
  context.subscriptions.push(vscode.extensions.onDidChange(evaluateAvailability));

  context.subscriptions.push(
    vscode.commands.registerCommand('computor.matlab.moveWorkspaceView', async () => {
      if (!isMatlabExtensionInstalled()) {
        notify.info('The MATLAB extension is not installed in this workspace.');
        return;
      }
      try {
        await vscode.commands.executeCommand(`${MATLAB_WORKSPACE_VIEW}.focus`);
        notify.info(
          'Pick "Secondary Side Bar" to keep the MATLAB workspace visible next to your files and figures.'
        );
        await vscode.commands.executeCommand('workbench.action.moveFocusedView');
      } catch (error) {
        console.warn('[MatlabWorkspaceView] Could not open the view mover:', error);
        notify.warning(
          'Could not open the view mover. Drag the WORKSPACE section to the right edge of the window instead.'
        );
      }
    })
  );
}
