import * as vscode from 'vscode';
import * as path from 'path';
import { copyToClipboard } from './clipboard';

/**
 * Reveal a file or folder for the user: the OS file manager on desktop, the
 * workbench Explorer under code-server/web, where `revealFileInOS` is not
 * registered and would reject with "command 'revealFileInOS' not found"
 * (computor-org/issues#332). Prefer this over calling `revealFileInOS`
 * directly anywhere in the extension.
 */
export async function revealUri(uri: vscode.Uri): Promise<void> {
  if (vscode.env.uiKind !== vscode.UIKind.Web) {
    await vscode.commands.executeCommand('revealFileInOS', uri);
    return;
  }

  // The workbench Explorer can only reveal what it shows, i.e. paths inside a
  // workspace folder; for anything else the path on the clipboard is the best
  // the browser sandbox allows. (`vscode.openFolder` is not a fallback — it
  // replaces the workspace and reloads the window.)
  if (isInsideWorkspace(uri)) {
    await vscode.commands.executeCommand('revealInExplorer', uri);
    return;
  }

  await copyToClipboard(
    uri.fsPath,
    'Path',
    `Cannot open the system file manager in the browser. Path copied to clipboard: ${uri.fsPath}`
  );
}

function isInsideWorkspace(uri: vscode.Uri): boolean {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.some((folder) => {
    const root = folder.uri.fsPath;
    return uri.fsPath === root || uri.fsPath.startsWith(root + path.sep);
  });
}
