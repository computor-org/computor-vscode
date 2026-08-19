import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { DocumentsCommands } from '../../src/commands/DocumentsCommands';
import { DocumentsFileItem } from '../../src/ui/tree/lecturer-documents/DocumentsTreeItems';
import { OPEN_FILE_COMMAND } from '../../src/ui/editorLayout';
import type { DocumentEntry, DocumentScope } from '../../src/services/DocumentsCacheService';

/**
 * Clicking a PDF in the Documents tree used to fail outright — "File seems to
 * be binary and cannot be opened as text" — and a PNG opened in a text editor
 * showing its bytes. Both because the handler called `showTextDocument`, which
 * can only ever produce a text editor: editor associations, and with them the
 * Computor image preview, apply to the `vscode.open` command alone.
 *
 * So what this pins is not the editor that appears — that is VS Code's
 * decision, correctly — but that the extension stops making it.
 */

const scope: DocumentScope = { scope: 'course_family', scopeId: 'family-1' };

let mirror: string;

function mirrored(relativePath: string): string {
  return path.join(mirror, relativePath);
}

function fileItem(relativePath: string, extra?: Partial<DocumentEntry>): DocumentsFileItem {
  const entry: DocumentEntry = {
    name: relativePath.split('/').pop()!,
    relativePath,
    type: 'file',
    state: 'synced',
    local: { absPath: mirrored(relativePath), size: 10, mtimeMs: 0 },
    ...extra
  } as DocumentEntry;
  return new DocumentsFileItem(scope, entry);
}

describe('Documents tree: opening a document', () => {
  let executed: Array<{ command: string; args: any[] }>;
  let pulled: string[];
  let commands: DocumentsCommands;
  let realExecuteCommand: any;

  beforeEach(() => {
    mirror = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-docs-'));
    executed = [];
    pulled = [];
    realExecuteCommand = (vscode.commands as any).executeCommand;
    (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
      executed.push({ command, args });
    };

    const api = {
      downloadDocument: async (_s: string, _id: string | null, relativePath: string) => {
        pulled.push(relativePath);
        return Buffer.from('bytes');
      },
      listDocuments: async () => []
    };
    const tree = {
      invalidateDirectory: () => {},
      cache: {
        writePulled: async (_scope: DocumentScope, relativePath: string, bytes: Buffer) => {
          const target = mirrored(relativePath);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, bytes);
        },
        resolveLocalPath: (_scope: DocumentScope, relativePath: string) => mirrored(relativePath)
      }
    };
    commands = new DocumentsCommands(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      api as any,
      tree as any
    );
  });

  afterEach(() => {
    // Put the stub back: it is shared with every other spec file.
    (vscode.commands as any).executeCommand = realExecuteCommand;
    fs.rmSync(mirror, { recursive: true, force: true });
  });

  it('opens a local document through computor.openFile, not as text', async () => {
    await (commands as any).openFile(fileItem('lecture/PiP_02.pdf'));

    expect(executed).to.have.lengthOf(1);
    expect(executed[0]!.command).to.equal(OPEN_FILE_COMMAND);
    expect(executed[0]!.args[0].fsPath).to.equal(mirrored('lecture/PiP_02.pdf'));
  });

  it('does not pin the tab on a single click', async () => {
    // The handler used to hardcode preview: false, so every first click pinned
    // a tab — unlike every other Computor tree (computor-org/issues#319).
    await (commands as any).openFile(fileItem('matlab/publish/anonymous_01.png'));

    expect(executed[0]!.args[1]).to.equal(undefined);
  });

  it('pulls a remote-only document to the mirror first, then opens that', async () => {
    const item = fileItem('lecture/PiP_01.pdf', { state: 'remote-only', local: undefined });

    await (commands as any).openFile(item);

    expect(pulled).to.deep.equal(['lecture/PiP_01.pdf']);
    expect(executed[0]!.command).to.equal(OPEN_FILE_COMMAND);
    expect(executed[0]!.args[0].fsPath).to.equal(mirrored('lecture/PiP_01.pdf'));
  });

  it('ignores anything that is not a file row', async () => {
    await (commands as any).openFile({ label: 'a folder' });

    expect(executed).to.be.empty;
  });
});
