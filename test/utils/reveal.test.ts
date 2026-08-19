import { expect } from 'chai';
import * as vscode from 'vscode';

import { UIKind } from '../helpers/vscode-stub';
import { revealUri } from '../../src/utils/reveal';

/**
 * `revealFileInOS` exists only in desktop VS Code; under code-server the raw
 * call rejects with "command 'revealFileInOS' not found", which students saw
 * verbatim (computor-org/issues#332). These tests pin the three behaviors of
 * the shared wrapper: desktop stays on the OS file manager, web falls back to
 * the workbench Explorer, and web targets outside the workspace degrade to a
 * copied path instead of an error.
 */
describe('revealUri', () => {
  let executed: Array<{ command: string; args: any[] }>;
  let clipboard: string[];
  let infos: string[];
  let originalExecute: any;
  let originalWrite: any;
  let originalInfo: any;
  let originalUiKind: number;
  let originalFolders: any;

  beforeEach(() => {
    executed = [];
    clipboard = [];
    infos = [];
    originalExecute = (vscode.commands as any).executeCommand;
    originalWrite = (vscode.env as any).clipboard.writeText;
    originalInfo = (vscode.window as any).showInformationMessage;
    originalUiKind = (vscode.env as any).uiKind;
    originalFolders = (vscode.workspace as any).workspaceFolders;
    (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
      executed.push({ command, args });
    };
    (vscode.env as any).clipboard.writeText = async (text: string) => {
      clipboard.push(text);
    };
    (vscode.window as any).showInformationMessage = async (message: string) => {
      infos.push(message);
      return undefined;
    };
  });

  afterEach(() => {
    (vscode.commands as any).executeCommand = originalExecute;
    (vscode.env as any).clipboard.writeText = originalWrite;
    (vscode.window as any).showInformationMessage = originalInfo;
    (vscode.env as any).uiKind = originalUiKind;
    (vscode.workspace as any).workspaceFolders = originalFolders;
  });

  it('reveals in the OS file manager on desktop', async () => {
    (vscode.env as any).uiKind = UIKind.Desktop;
    const uri = vscode.Uri.file('/anywhere/file.txt');

    await revealUri(uri);

    expect(executed).to.deep.equal([{ command: 'revealFileInOS', args: [uri] }]);
    expect(clipboard).to.be.empty;
  });

  it('reveals in the workbench Explorer on web for workspace files', async () => {
    (vscode.env as any).uiKind = UIKind.Web;
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/ws' } }];
    const uri = vscode.Uri.file('/ws/student/abc/main.m');

    await revealUri(uri);

    expect(executed).to.deep.equal([{ command: 'revealInExplorer', args: [uri] }]);
    expect(clipboard).to.be.empty;
  });

  it('treats the workspace root itself as inside the workspace', async () => {
    (vscode.env as any).uiKind = UIKind.Web;
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/ws' } }];

    await revealUri(vscode.Uri.file('/ws'));

    expect(executed.map((e) => e.command)).to.deep.equal(['revealInExplorer']);
  });

  it('does not treat a sibling with a shared path prefix as inside the workspace', async () => {
    (vscode.env as any).uiKind = UIKind.Web;
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/ws' } }];

    await revealUri(vscode.Uri.file('/ws-backup/file.txt'));

    expect(executed).to.be.empty;
    expect(clipboard).to.deep.equal(['/ws-backup/file.txt']);
  });

  it('copies the path on web when the target is outside every workspace folder', async () => {
    (vscode.env as any).uiKind = UIKind.Web;
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/ws' } }];

    await revealUri(vscode.Uri.file('/home/user/Downloads/export.zip'));

    expect(executed).to.be.empty;
    expect(clipboard).to.deep.equal(['/home/user/Downloads/export.zip']);
    expect(infos).to.have.lengthOf(1);
    expect(infos[0]).to.include('/home/user/Downloads/export.zip');
  });

  it('copies the path on web when no workspace is open', async () => {
    (vscode.env as any).uiKind = UIKind.Web;
    (vscode.workspace as any).workspaceFolders = undefined;

    await revealUri(vscode.Uri.file('/tmp/file.txt'));

    expect(executed).to.be.empty;
    expect(clipboard).to.deep.equal(['/tmp/file.txt']);
  });
});
