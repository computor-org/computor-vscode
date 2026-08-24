import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Point images, PDFs and HTML documents at the Computor viewers, but only where
 * the built-in handling fails the user.
 *
 * `computor.imagePreview` is contributed at `priority: "option"` on purpose:
 * on a lecturer's desktop VS Code the built-in image editor works, and works
 * better, so nothing should displace it (see panels/ImagePreviewPanel.ts). An
 * "option" editor only ever opens a file when `workbench.editorAssociations`
 * names it, and that setting is written by the workspace templates — which run
 * for provisioned student workspaces and for nobody else. A lecturer working
 * in the browser therefore had the broken editor and no way to reach the
 * working one: the templates never touched their workspace, and raising the
 * contribution's priority would have changed every desktop too.
 *
 * So the association is written here instead, under the one condition that
 * makes it necessary — `UIKind.Web`, i.e. code-server, where the built-in
 * editor's picture, stylesheet and script all arrive through a service worker
 * that Firefox and older Safari never consult (computor-org/issues#282). PDF
 * and HTML have no built-in viewer at all, so in the browser they simply could
 * not be looked at (computor-org/issues#361).
 *
 * It is written once per workspace and never overwrites an association the
 * user already holds, because "the extension keeps putting a setting back"
 * is worse than a preview someone chose for themselves.
 */

/**
 * Each family: the glob written into `workbench.editorAssociations`, the viewer
 * it points at, and the extensions it covers so an association the user already
 * holds can be spotted. Kept in step with the `customEditors` selectors in
 * package.json.
 *
 * PDF and HTML joined images for the Documents tree: a lecturer could not look
 * at either without downloading it first (computor-org/issues#361).
 */
const VIEWER_FAMILIES: ReadonlyArray<{
  pattern: string;
  viewer: string;
  extensions: readonly string[];
}> = [
  {
    pattern: '*.{png,jpg,jpe,jpeg,gif,bmp,ico,webp,avif,svg}',
    viewer: 'computor.imagePreview',
    extensions: ['png', 'jpg', 'jpe', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif', 'svg']
  },
  {
    pattern: '*.pdf',
    viewer: 'computor.pdfPreview',
    extensions: ['pdf']
  },
  {
    // Not `.htm`: it is rare here, and someone who opens one usually wants the
    // source. `.html` is what gets published as a document.
    pattern: '*.html',
    viewer: 'computor.htmlPreview',
    extensions: ['html']
  }
];

const APPLIED_KEY_PREFIX = 'computor.editorAssociations.applied:';

/** The marker that says a folder is a Computor workspace. */
const COMPUTOR_MARKER = '.computor';

/**
 * Whether the user has already said something about how this family opens —
 * under any pattern, not just ours. `*.png` and `*.{png,jpg}` are both
 * opinions, and neither is ours to overrule. Each family is judged on its own,
 * so an image association a user chose does not suppress the PDF one.
 */
function alreadyAssociates(
  associations: Record<string, string>,
  extensions: readonly string[]
): boolean {
  return Object.keys(associations).some(pattern => {
    const lowered = pattern.toLowerCase();
    return extensions.some(ext => lowered.includes(ext));
  });
}

export async function ensureEditorAssociations(context: vscode.ExtensionContext): Promise<void> {
  // Desktop VS Code keeps the built-in editor; only the browser needs ours.
  if (vscode.env.uiKind !== vscode.UIKind.Web) {
    return;
  }

  // Never write settings into a folder that is not ours. The `.computor`
  // marker is the same test extension.ts and WorkspaceStructureManager use.
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root || !fs.existsSync(path.join(root, COMPUTOR_MARKER))) {
    return;
  }

  const appliedKey = `${APPLIED_KEY_PREFIX}${root}`;
  if (context.globalState.get<boolean>(appliedKey)) {
    return;
  }

  const config = vscode.workspace.getConfiguration('workbench');
  const inspected = config.inspect<Record<string, string>>('editorAssociations');
  const workspaceValue = inspected?.workspaceValue ?? {};
  // A global association counts as an opinion even though we write per
  // workspace — the user still sees its effect here.
  const held = { ...(inspected?.globalValue ?? {}), ...workspaceValue };

  const additions: Record<string, string> = {};
  for (const family of VIEWER_FAMILIES) {
    if (!alreadyAssociates(held, family.extensions)) {
      additions[family.pattern] = family.viewer;
    }
  }

  if (Object.keys(additions).length > 0) {
    try {
      await config.update(
        'editorAssociations',
        { ...workspaceValue, ...additions },
        vscode.ConfigurationTarget.Workspace
      );
    } catch (err) {
      // A read-only or absent .vscode/ is not worth a notification; leave the
      // flag unset so the next activation can try again.
      console.warn('[computor] Could not set the editor associations:', err);
      return;
    }
  }

  await context.globalState.update(appliedKey, true);
}
