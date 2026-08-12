import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Which editor group a thing belongs in.
 *
 * A Computor workspace has a two-column shape: the tree on the left, the file
 * you are editing in the first group, and everything you are *looking at while*
 * editing — figures, the README, an image — in the second. Students rely on it,
 * because a plot appearing must not push their code off screen.
 *
 * Nothing used to say so. Every file-open site passed no column at all, which
 * means "the active group", and the auxiliary surfaces asked for
 * `ViewColumn.Beside`, which means "one to the right of the active group".
 * Both are relative, so the layout drifted as soon as focus moved: click a
 * figure, then open a file from the tree, and the file landed on top of the
 * figure (computor-org/issues#286). `Beside` computed while the figure had
 * focus was worse still — it opened a third group.
 *
 * So the columns are absolute here, and every open site goes through this
 * module. The rule is about the *surface*, not only the file: a markdown
 * preview is auxiliary because it is a preview, while a .md file opened to be
 * edited is source like any other.
 */

/** Files being edited. The first group right of the tree. */
export const SOURCE_COLUMN = vscode.ViewColumn.One;

/** Figures, previews, images — things you look at while editing. */
export const AUX_COLUMN = vscode.ViewColumn.Two;

/**
 * Make sure the auxiliary group exists before a webview panel opens into it.
 *
 * VS Code quietly discards a webview panel's requested column when there is
 * exactly one editor group and it is empty (MainThreadWebviewPanels
 * getTargetGroupFromShowOptions), so a README or the Figures panel opened
 * before any source file landed in group 1 — and stayed there. Text documents
 * do not need this: their open path creates missing groups on its own.
 *
 * setEditorLayout keeps the currently active group active, so this does not
 * steal focus; the guard leaves any richer user layout alone.
 */
export async function ensureAuxColumn(): Promise<void> {
  // Optional chaining: hosts without the tabGroups API (tests) just skip.
  const groupCount = vscode.window.tabGroups?.all?.length ?? 2;
  if (groupCount >= 2) {
    return;
  }
  await vscode.commands.executeCommand('vscode.setEditorLayout', {
    orientation: 0,
    groups: [{}, {}]
  });
}

/**
 * Images are figures. A student's plot arrives as a PNG, and the workspace
 * templates map these extensions to the `computor.imagePreview` editor via
 * `workbench.editorAssociations`, so opening one is the same gesture as
 * opening the Figures panel and belongs in the same place.
 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.jpe', '.gif', '.bmp', '.ico', '.webp', '.avif', '.svg'
]);

/** The group a file belongs in, from its path. */
export function columnFor(uri: vscode.Uri | string): vscode.ViewColumn {
  const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
  return IMAGE_EXTENSIONS.has(path.extname(fsPath).toLowerCase()) ? AUX_COLUMN : SOURCE_COLUMN;
}

/** Show options for a file, with its column filled in. */
export function showOptions(
  uri: vscode.Uri | string,
  extra?: vscode.TextDocumentShowOptions
): vscode.TextDocumentShowOptions {
  return { ...extra, viewColumn: columnFor(uri) };
}

/**
 * Open a file in the group it belongs in.
 *
 * Routed through the `vscode.open` command rather than `showTextDocument` so
 * that editor associations still apply — an image has to reach the Computor
 * image preview, which is the only one that renders under code-server in
 * Safari and Firefox (computor-org/issues#282).
 *
 * `preview` is deliberately left alone unless a caller asks: `vscode.open`
 * follows the user's `workbench.editor.enablePreview` setting, and forcing it
 * would pin a tab for every file clicked in the tree.
 */
export async function openFile(
  uri: vscode.Uri | string,
  extra?: vscode.TextDocumentShowOptions
): Promise<void> {
  const target = typeof uri === 'string' ? vscode.Uri.file(uri) : uri;
  await vscode.commands.executeCommand('vscode.open', target, showOptions(target, extra));
}

/** The command tree items bind to, so a click lands in the right group. */
export const OPEN_FILE_COMMAND = 'computor.openFile';

export function registerEditorLayout(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      OPEN_FILE_COMMAND,
      async (uri: vscode.Uri | string, extra?: vscode.TextDocumentShowOptions) => {
        await openFile(uri, extra);
      }
    )
  );
}

/** A tree item's `command`, for a file that should open in its own group. */
export function openFileCommand(uri: vscode.Uri | string, title = 'Open File'): vscode.Command {
  return { command: OPEN_FILE_COMMAND, title, arguments: [uri] };
}
