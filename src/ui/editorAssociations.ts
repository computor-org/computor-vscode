import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Point image files at the Computor image preview, but only where the built-in
 * one is broken.
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
 * that Firefox and older Safari never consult (computor-org/issues#282).
 *
 * It is written once per workspace and never overwrites an association the
 * user already holds, because "the extension keeps putting a setting back"
 * is worse than a preview someone chose for themselves.
 */

/** Kept in step with the `customEditors` selector in package.json. */
const IMAGE_PATTERN = '*.{png,jpg,jpe,jpeg,gif,bmp,ico,webp,avif,svg}';

const IMAGE_VIEWER = 'computor.imagePreview';

/** The extensions that pattern covers, for spotting a choice already made. */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpe', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif', 'svg'];

const APPLIED_KEY_PREFIX = 'computor.editorAssociations.applied:';

/** The marker that says a folder is a Computor workspace. */
const COMPUTOR_MARKER = '.computor';

/**
 * Whether the user has already said something about how images open — under
 * any pattern, not just ours. `*.png` and `*.{png,jpg}` are both opinions, and
 * neither is ours to overrule.
 */
function alreadyAssociatesImages(associations: Record<string, string>): boolean {
  return Object.keys(associations).some(pattern => {
    const lowered = pattern.toLowerCase();
    return IMAGE_EXTENSIONS.some(ext => lowered.includes(ext));
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

  if (!alreadyAssociatesImages(held)) {
    try {
      await config.update(
        'editorAssociations',
        { ...workspaceValue, [IMAGE_PATTERN]: IMAGE_VIEWER },
        vscode.ConfigurationTarget.Workspace
      );
    } catch (err) {
      // A read-only or absent .vscode/ is not worth a notification; leave the
      // flag unset so the next activation can try again.
      console.warn('[computor] Could not set the image editor association:', err);
      return;
    }
  }

  await context.globalState.update(appliedKey, true);
}
