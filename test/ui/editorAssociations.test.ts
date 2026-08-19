import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { configurationOverrides, UIKind } from '../helpers/vscode-stub';
import { ensureEditorAssociations } from '../../src/ui/editorAssociations';

/**
 * The Computor image preview is contributed at "option" priority, so it opens
 * nothing until `workbench.editorAssociations` names it — and the templates
 * that write that setting only ever ran for provisioned student workspaces. A
 * lecturer in the browser was left with the built-in editor that cannot render
 * under code-server (computor-org/issues#282).
 *
 * These tests pin the three things that keep the fix from becoming its own
 * annoyance: it stays out of desktop VS Code, out of folders that are not
 * ours, and out of a choice the user already made.
 */

const IMAGE_PATTERN = '*.{png,jpg,jpe,jpeg,gif,bmp,ico,webp,avif,svg}';

let workspaceRoot: string;
let written: Array<{ key: string; value: any; target: number }>;
let inspectResult: any;
let globalStateStore: Record<string, any>;
let context: vscode.ExtensionContext;

function stubContext(): vscode.ExtensionContext {
  return {
    globalState: {
      get: (key: string) => globalStateStore[key],
      update: async (key: string, value: any) => { globalStateStore[key] = value; }
    }
  } as unknown as vscode.ExtensionContext;
}

describe('ensureEditorAssociations', () => {
  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-assoc-'));
    fs.writeFileSync(path.join(workspaceRoot, '.computor'), '');
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];

    written = [];
    inspectResult = undefined;
    globalStateStore = {};
    context = stubContext();

    (vscode.env as any).uiKind = UIKind.Web;
    configurationOverrides['workbench'] = {
      get: (_key: string, defaultValue?: any) => defaultValue,
      has: () => false,
      inspect: () => inspectResult,
      update: async (key: string, value: any, target: number) => {
        written.push({ key, value, target });
      }
    };
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    (vscode.workspace as any).workspaceFolders = undefined;
    (vscode.env as any).uiKind = UIKind.Desktop;
    delete configurationOverrides['workbench'];
  });

  it('points images at the Computor preview in the browser', async () => {
    await ensureEditorAssociations(context);

    expect(written).to.have.lengthOf(1);
    expect(written[0]!.key).to.equal('editorAssociations');
    expect(written[0]!.value).to.deep.equal({ [IMAGE_PATTERN]: 'computor.imagePreview' });
    expect(written[0]!.target).to.equal(vscode.ConfigurationTarget.Workspace);
  });

  it('leaves desktop VS Code alone, where the built-in editor works', async () => {
    (vscode.env as any).uiKind = UIKind.Desktop;

    await ensureEditorAssociations(context);

    expect(written).to.be.empty;
  });

  it('does not write settings into a folder that is not a Computor workspace', async () => {
    fs.rmSync(path.join(workspaceRoot, '.computor'));

    await ensureEditorAssociations(context);

    expect(written).to.be.empty;
  });

  it('does nothing without a workspace', async () => {
    (vscode.workspace as any).workspaceFolders = undefined;

    await ensureEditorAssociations(context);

    expect(written).to.be.empty;
  });

  it('keeps associations the workspace already holds for other file types', async () => {
    inspectResult = { workspaceValue: { '*.ipynb': 'jupyter-notebook' } };

    await ensureEditorAssociations(context);

    expect(written[0]!.value).to.deep.equal({
      '*.ipynb': 'jupyter-notebook',
      [IMAGE_PATTERN]: 'computor.imagePreview'
    });
  });

  it('never overrules a choice the user made about images', async () => {
    // Any pattern covering an image counts — not only the one we would write.
    inspectResult = { workspaceValue: { '*.png': 'default' } };

    await ensureEditorAssociations(context);

    expect(written).to.be.empty;
  });

  it('respects an image association held in the user settings', async () => {
    inspectResult = { globalValue: { '*.{png,jpg}': 'imagePreview.previewEditor' } };

    await ensureEditorAssociations(context);

    expect(written).to.be.empty;
  });

  it('writes once, so deleting the setting again is not undone', async () => {
    await ensureEditorAssociations(context);
    await ensureEditorAssociations(context);

    expect(written).to.have.lengthOf(1);
  });

  it('marks nothing applied when the settings write fails, so it can retry', async () => {
    configurationOverrides['workbench'].update = async () => {
      throw new Error('settings.json is read-only');
    };

    await ensureEditorAssociations(context);
    expect(globalStateStore).to.deep.equal({});

    // A later activation, with a workspace it can write to, still succeeds.
    configurationOverrides['workbench'].update = async (key: string, value: any, target: number) => {
      written.push({ key, value, target });
    };
    await ensureEditorAssociations(context);
    expect(written).to.have.lengthOf(1);
  });
});
