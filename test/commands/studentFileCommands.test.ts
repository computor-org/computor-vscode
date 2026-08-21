import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { StudentFileCommands } from '../../src/commands/StudentFileCommands';

/**
 * End-to-end-ish cover for the student filesystem commands: the handlers are
 * driven through the real command registrations against a real temp repo, with
 * only the VS Code prompts stubbed. The parts worth pinning are the ones with
 * no obvious right answer — where a "New File" lands when invoked on a file
 * row, what Duplicate names things, and how Paste resolves a collision.
 */

type Handler = (...args: any[]) => any;

let repoRoot: string;
let handlers: Map<string, Handler>;
let refreshed: any[];

// Stubbed prompt answers, set per test.
let inputAnswer: string | undefined;
let warningAnswer: string | undefined;
let clipboardText: string | undefined;
/** Set to make the clipboard write silently not stick, as browsers do. */
let clipboardRefuses: boolean;
let manualCopyOffered: string | undefined;
let quickPickLabel: string | undefined;
let quickPickChoices: string[];
let validationError: string | undefined;
let contextKeys: Record<string, any>;

const original: Record<string, any> = {};

function fsItem(relPath: string, isDirectory: boolean, parent?: any) {
  return {
    uri: vscode.Uri.file(path.join(repoRoot, relPath)),
    type: isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
    repoRoot,
    parent,
    name: path.basename(relPath)
  };
}

/** Stands in for a cloned-assignment row, which exposes getRepositoryPath. */
function assignmentItem(dir = repoRoot) {
  return { getRepositoryPath: () => dir };
}

/** All the per-test setup, called INSIDE the describe. Declared at module
 *  scope these become Mocha ROOT hooks, and this file patches five vscode
 *  globals — they would then be patched for every spec in the suite. */
function useCommandHarness(): void {
  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'student-cmd-'));
    handlers = new Map();
    refreshed = [];
    inputAnswer = undefined;
    warningAnswer = undefined;
    clipboardText = undefined;
    clipboardRefuses = false;
    manualCopyOffered = undefined;
    quickPickLabel = undefined;
    quickPickChoices = [];
    validationError = undefined;
    contextKeys = {};

    original.registerCommand = vscode.commands.registerCommand;
    original.executeCommand = vscode.commands.executeCommand;
    original.showInputBox = vscode.window.showInputBox;
    original.showWarningMessage = vscode.window.showWarningMessage;
    original.showInformationMessage = vscode.window.showInformationMessage;
    original.showQuickPick = vscode.window.showQuickPick;
    original.writeText = vscode.env.clipboard.writeText;
    original.readText = vscode.env.clipboard.readText;

    (vscode.commands as any).registerCommand = (id: string, handler: Handler) => {
      handlers.set(id, handler);
      return { dispose() {} };
    };
    (vscode.commands as any).executeCommand = async (cmd: string, ...args: any[]) => {
      if (cmd === 'setContext') { contextKeys[args[0]] = args[1]; }
      return undefined;
    };
    (vscode.window as any).showInformationMessage = async () => undefined;
    (vscode.window as any).showQuickPick = async (items: any[]) => {
      const resolved = await items;
      quickPickChoices = resolved.map((item: any) => item.label);
      return quickPickLabel === undefined
        ? undefined
        : resolved.find((item: any) => item.label === quickPickLabel);
    };
    (vscode.window as any).showInputBox = async (opts: any) => {
      // The clipboard fallback shows the text in a pre-filled box; record it
      // rather than treating it as a name prompt.
      if (typeof opts?.title === 'string' && opts.title.includes('press Ctrl/Cmd+C')) {
        manualCopyOffered = opts.value;
        return undefined;
      }
      // VS Code will not resolve a value that fails validateInput, so neither do
      // we — that makes a refused name observable without the command throwing.
      if (inputAnswer !== undefined && opts?.validateInput) {
        const problem = await opts.validateInput(inputAnswer);
        if (problem) { validationError = problem; return undefined; }
      }
      return inputAnswer;
    };
    (vscode.window as any).showWarningMessage = async () => warningAnswer;
    (vscode.env.clipboard as any).writeText = async (text: string) => {
      if (!clipboardRefuses) { clipboardText = text; }
    };
    (vscode.env.clipboard as any).readText = async () => clipboardText;

    const provider = { refreshNode: (node: any) => { refreshed.push(node); } };
    new StudentFileCommands(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      provider as any
    ).registerCommands();
  });

  afterEach(() => {
    (vscode.commands as any).registerCommand = original.registerCommand;
    (vscode.commands as any).executeCommand = original.executeCommand;
    (vscode.window as any).showInputBox = original.showInputBox;
    (vscode.window as any).showWarningMessage = original.showWarningMessage;
    (vscode.window as any).showInformationMessage = original.showInformationMessage;
    (vscode.window as any).showQuickPick = original.showQuickPick;
    (vscode.env.clipboard as any).writeText = original.writeText;
    (vscode.env.clipboard as any).readText = original.readText;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });
}

/** Invoke a registered command handler by id. */
function run(command: string, item?: any): Promise<any> {
  const handler = handlers.get(command);
  if (!handler) { throw new Error(`not registered: ${command}`); }
  return handler(item);
}

describe('student file commands', () => {
  useCommandHarness();

  it('registers every contributed command', () => {
    for (const name of [
      'newFile', 'newFolder', 'rename', 'duplicate',
      'cut', 'copy', 'paste', 'revealInOS', 'copyPath', 'copyRelativePath',
      'copyTo', 'moveTo', 'deleteFile', 'deleteFolder'
    ]) {
      expect(handlers.has(`computor.student.fs.${name}`), name).to.equal(true);
    }
  });

  describe('new file / folder', () => {
    it('creates a file in the assignment folder', async () => {
      inputAnswer = 'solution.py';
      await run('computor.student.fs.newFile', assignmentItem());
      expect(fs.existsSync(path.join(repoRoot, 'solution.py'))).to.equal(true);
    });

    it('creates a folder inside a folder row', async () => {
      fs.mkdirSync(path.join(repoRoot, 'src'));
      inputAnswer = 'utils';
      await run('computor.student.fs.newFolder', fsItem('src', true));
      expect(fs.statSync(path.join(repoRoot, 'src', 'utils')).isDirectory()).to.equal(true);
    });

    it('creates alongside a file row rather than inside it', async () => {
      fs.mkdirSync(path.join(repoRoot, 'src'));
      fs.writeFileSync(path.join(repoRoot, 'src', 'main.py'), '');
      inputAnswer = 'helper.py';
      await run('computor.student.fs.newFile', fsItem('src/main.py', false));
      expect(fs.existsSync(path.join(repoRoot, 'src', 'helper.py'))).to.equal(true);
    });

    it('does nothing when the prompt is dismissed', async () => {
      inputAnswer = undefined;
      await run('computor.student.fs.newFile', assignmentItem());
      expect(fs.readdirSync(repoRoot)).to.deep.equal([]);
    });

    it('refuses a name that collides', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'original');
      inputAnswer = 'a.txt';
      await run('computor.student.fs.newFile', assignmentItem());
      expect(validationError).to.match(/already exists/);
      expect(fs.readFileSync(path.join(repoRoot, 'a.txt'), 'utf8')).to.equal('original');
    });

    it('refuses to shadow the backend-owned README at the assignment root', async () => {
      inputAnswer = 'README.md';
      await run('computor.student.fs.newFile', assignmentItem());
      expect(validationError).to.match(/managed by Computor/);
      expect(fs.existsSync(path.join(repoRoot, 'README.md'))).to.equal(false);
    });

    it('allows a README deeper in the tree', async () => {
      fs.mkdirSync(path.join(repoRoot, 'docs'));
      inputAnswer = 'README.md';
      await run('computor.student.fs.newFile', fsItem('docs', true));
      expect(fs.existsSync(path.join(repoRoot, 'docs', 'README.md'))).to.equal(true);
    });
  });

  describe('rename', () => {
    it('renames a file and refreshes the parent row', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'x');
      const parent = assignmentItem();
      inputAnswer = 'b.txt';
      await run('computor.student.fs.rename', fsItem('a.txt', false, parent));
      expect(fs.existsSync(path.join(repoRoot, 'b.txt'))).to.equal(true);
      expect(refreshed).to.deep.equal([parent]);
    });

    it('does nothing when the name is unchanged', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'x');
      inputAnswer = 'a.txt';
      await run('computor.student.fs.rename', fsItem('a.txt', false));
      expect(fs.existsSync(path.join(repoRoot, 'a.txt'))).to.equal(true);
      expect(refreshed).to.deep.equal([]);
    });
  });

  describe('delete', () => {
    it('removes the entry once confirmed', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'x');
      warningAnswer = 'Delete';
      await run('computor.student.fs.deleteFile', fsItem('a.txt', false));
      expect(fs.existsSync(path.join(repoRoot, 'a.txt'))).to.equal(false);
    });

    it('keeps the entry when the confirmation is declined', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'x');
      warningAnswer = undefined;
      await run('computor.student.fs.deleteFile', fsItem('a.txt', false));
      expect(fs.existsSync(path.join(repoRoot, 'a.txt'))).to.equal(true);
    });

    it('removes a folder and everything inside it', async () => {
      fs.mkdirSync(path.join(repoRoot, 'src'));
      fs.writeFileSync(path.join(repoRoot, 'src', 'main.py'), '');
      warningAnswer = 'Delete';
      await run('computor.student.fs.deleteFolder', fsItem('src', true));
      expect(fs.existsSync(path.join(repoRoot, 'src'))).to.equal(false);
    });
  });

  describe('duplicate', () => {
    it('names the copy without clobbering the original', async () => {
      fs.writeFileSync(path.join(repoRoot, 'main.py'), 'code');
      await run('computor.student.fs.duplicate', fsItem('main.py', false));
      expect(fs.readFileSync(path.join(repoRoot, 'main copy.py'), 'utf8')).to.equal('code');
      expect(fs.existsSync(path.join(repoRoot, 'main.py'))).to.equal(true);
    });

    it('counts up when a copy already exists', async () => {
      fs.writeFileSync(path.join(repoRoot, 'main.py'), 'code');
      fs.writeFileSync(path.join(repoRoot, 'main copy.py'), 'code');
      await run('computor.student.fs.duplicate', fsItem('main.py', false));
      expect(fs.existsSync(path.join(repoRoot, 'main copy 2.py'))).to.equal(true);
    });

    it('duplicates a folder recursively', async () => {
      fs.mkdirSync(path.join(repoRoot, 'src'));
      fs.writeFileSync(path.join(repoRoot, 'src', 'main.py'), 'code');
      await run('computor.student.fs.duplicate', fsItem('src', true));
      expect(fs.existsSync(path.join(repoRoot, 'src copy', 'main.py'))).to.equal(true);
    });
  });

  describe('clipboard', () => {
    it('flags the context key so Paste can appear', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'x');
      await run('computor.student.fs.copy', fsItem('a.txt', false));
      expect(contextKeys['computor.student.fs.hasClipboard']).to.equal(true);
    });

    it('copies a file into a folder, leaving the original', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'x');
      fs.mkdirSync(path.join(repoRoot, 'dest'));
      await run('computor.student.fs.copy', fsItem('a.txt', false));
      await run('computor.student.fs.paste', fsItem('dest', true));
      expect(fs.existsSync(path.join(repoRoot, 'dest', 'a.txt'))).to.equal(true);
      expect(fs.existsSync(path.join(repoRoot, 'a.txt'))).to.equal(true);
    });

    it('keeps the clipboard after a copy, so it can be pasted twice', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'x');
      fs.mkdirSync(path.join(repoRoot, 'one'));
      fs.mkdirSync(path.join(repoRoot, 'two'));
      await run('computor.student.fs.copy', fsItem('a.txt', false));
      await run('computor.student.fs.paste', fsItem('one', true));
      await run('computor.student.fs.paste', fsItem('two', true));
      expect(fs.existsSync(path.join(repoRoot, 'two', 'a.txt'))).to.equal(true);
    });

    it('moves the file on cut, and clears the clipboard afterwards', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'x');
      fs.mkdirSync(path.join(repoRoot, 'dest'));
      await run('computor.student.fs.cut', fsItem('a.txt', false));
      await run('computor.student.fs.paste', fsItem('dest', true));
      expect(fs.existsSync(path.join(repoRoot, 'dest', 'a.txt'))).to.equal(true);
      expect(fs.existsSync(path.join(repoRoot, 'a.txt'))).to.equal(false);
      expect(contextKeys['computor.student.fs.hasClipboard']).to.equal(false);
    });

    it('keeps both when the user chooses Keep Both on a collision', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'new');
      fs.mkdirSync(path.join(repoRoot, 'dest'));
      fs.writeFileSync(path.join(repoRoot, 'dest', 'a.txt'), 'old');
      warningAnswer = 'Keep Both';
      await run('computor.student.fs.copy', fsItem('a.txt', false));
      await run('computor.student.fs.paste', fsItem('dest', true));
      expect(fs.readFileSync(path.join(repoRoot, 'dest', 'a.txt'), 'utf8')).to.equal('old');
      expect(fs.readFileSync(path.join(repoRoot, 'dest', 'a copy.txt'), 'utf8')).to.equal('new');
    });

    it('replaces the target when the user chooses Overwrite', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'new');
      fs.mkdirSync(path.join(repoRoot, 'dest'));
      fs.writeFileSync(path.join(repoRoot, 'dest', 'a.txt'), 'old');
      warningAnswer = 'Overwrite';
      await run('computor.student.fs.copy', fsItem('a.txt', false));
      await run('computor.student.fs.paste', fsItem('dest', true));
      expect(fs.readFileSync(path.join(repoRoot, 'dest', 'a.txt'), 'utf8')).to.equal('new');
    });

    it('leaves everything alone when the collision prompt is dismissed', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'new');
      fs.mkdirSync(path.join(repoRoot, 'dest'));
      fs.writeFileSync(path.join(repoRoot, 'dest', 'a.txt'), 'old');
      warningAnswer = undefined;
      await run('computor.student.fs.copy', fsItem('a.txt', false));
      await run('computor.student.fs.paste', fsItem('dest', true));
      expect(fs.readFileSync(path.join(repoRoot, 'dest', 'a.txt'), 'utf8')).to.equal('old');
    });

    it('treats a cut pasted back into the same folder as a no-op', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'x');
      await run('computor.student.fs.cut', fsItem('a.txt', false));
      await run('computor.student.fs.paste', assignmentItem());
      expect(fs.readFileSync(path.join(repoRoot, 'a.txt'), 'utf8')).to.equal('x');
      expect(contextKeys['computor.student.fs.hasClipboard']).to.equal(false);
    });

    it('does nothing on paste when nothing was cut or copied', async () => {
      fs.mkdirSync(path.join(repoRoot, 'dest'));
      await run('computor.student.fs.paste', fsItem('dest', true));
      expect(fs.readdirSync(path.join(repoRoot, 'dest'))).to.deep.equal([]);
    });
  });

  describe('paths', () => {
    it('copies the absolute path of a file row', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), '');
      await run('computor.student.fs.copyPath', fsItem('a.txt', false));
      expect(clipboardText).to.equal(path.join(repoRoot, 'a.txt'));
    });

    it('copies a path relative to the repository root', async () => {
      fs.mkdirSync(path.join(repoRoot, 'src'));
      fs.writeFileSync(path.join(repoRoot, 'src', 'main.py'), '');
      await run('computor.student.fs.copyRelativePath', fsItem('src/main.py', false));
      expect(clipboardText).to.equal(path.join('src', 'main.py'));
    });

    it('falls back to the folder name at the root itself', async () => {
      await run('computor.student.fs.copyRelativePath', assignmentItem());
      expect(clipboardText).to.equal(path.basename(repoRoot));
    });

    it('makes an assignment row relative to its repository, like a file row', async () => {
      // The assignment used to be its own root, so Copy Relative Path answered
      // a bare basename there and a repo-relative path one level down
      // (computor-org/issues#353).
      fs.mkdirSync(path.join(repoRoot, '.git'));
      const assignmentDir = path.join(repoRoot, 'week_1');
      fs.mkdirSync(assignmentDir);

      await run('computor.student.fs.copyRelativePath', assignmentItem(assignmentDir));

      expect(clipboardText).to.equal('week_1');
    });

    it('offers the path by hand when the browser refuses the clipboard', async () => {
      // Under code-server the write can be refused without throwing, leaving
      // whatever was copied last in place — which is what made Copy Path look
      // like it copied the wrong thing.
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), '');
      clipboardText = 'something copied earlier';
      clipboardRefuses = true;

      await run('computor.student.fs.copyPath', fsItem('a.txt', false));

      expect(manualCopyOffered).to.equal(path.join(repoRoot, 'a.txt'));
    });
  });

  describe('copy to / move to', () => {
    /** A file row two levels down, with the tree parents the commands walk. */
    function nestedFile(): { assignmentDir: string; item: any } {
      const assignmentDir = path.join(repoRoot, 'week_1');
      fs.mkdirSync(path.join(assignmentDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(assignmentDir, 'out'));
      fs.writeFileSync(path.join(assignmentDir, 'src', 'main.py'), 'print(1)\n');

      const assignment = assignmentItem(assignmentDir);
      const srcFolder = fsItem('week_1/src', true, assignment);
      return { assignmentDir, item: fsItem('week_1/src/main.py', false, srcFolder) };
    }

    it('offers only folders inside the owning assignment', async () => {
      // A course repository holds every assignment; bounding the pick by it
      // would let a student move work into someone else's exercise.
      fs.mkdirSync(path.join(repoRoot, 'week_2'), { recursive: true });
      const { item } = nestedFile();

      await run('computor.student.fs.moveTo', item);

      expect(quickPickChoices).to.deep.equal([
        '$(root-folder) Assignment root',
        '$(folder) out'
      ]);
    });

    it('moves the file into the chosen folder', async () => {
      const { assignmentDir, item } = nestedFile();
      quickPickLabel = '$(folder) out';

      await run('computor.student.fs.moveTo', item);

      expect(fs.existsSync(path.join(assignmentDir, 'src', 'main.py'))).to.equal(false);
      expect(fs.readFileSync(path.join(assignmentDir, 'out', 'main.py'), 'utf-8')).to.equal('print(1)\n');
    });

    it('copies the file and leaves the original in place', async () => {
      const { assignmentDir, item } = nestedFile();
      quickPickLabel = '$(root-folder) Assignment root';

      await run('computor.student.fs.copyTo', item);

      expect(fs.existsSync(path.join(assignmentDir, 'src', 'main.py'))).to.equal(true);
      expect(fs.readFileSync(path.join(assignmentDir, 'main.py'), 'utf-8')).to.equal('print(1)\n');
    });

    it('does nothing when the destination pick is dismissed', async () => {
      const { assignmentDir, item } = nestedFile();
      quickPickLabel = undefined;

      await run('computor.student.fs.moveTo', item);

      expect(fs.existsSync(path.join(assignmentDir, 'src', 'main.py'))).to.equal(true);
    });

    it('keeps both copies when a name collides and the student says so', async () => {
      const { assignmentDir, item } = nestedFile();
      fs.writeFileSync(path.join(assignmentDir, 'out', 'main.py'), 'theirs\n');
      quickPickLabel = '$(folder) out';
      warningAnswer = 'Keep Both';

      await run('computor.student.fs.copyTo', item);

      expect(fs.readFileSync(path.join(assignmentDir, 'out', 'main.py'), 'utf-8')).to.equal('theirs\n');
      expect(fs.readFileSync(path.join(assignmentDir, 'out', 'main copy.py'), 'utf-8')).to.equal('print(1)\n');
    });

    it('never offers a folder its own subtree, or where it already is', async () => {
      const assignmentDir = path.join(repoRoot, 'week_1');
      fs.mkdirSync(path.join(assignmentDir, 'src', 'nested'), { recursive: true });
      fs.mkdirSync(path.join(assignmentDir, 'out'));
      const assignment = assignmentItem(assignmentDir);
      const srcFolder = fsItem('week_1/src', true, assignment);

      await run('computor.student.fs.moveTo', srcFolder);

      // Not the assignment root (src is already there), not src, not
      // src/nested — a folder cannot be moved inside itself.
      expect(quickPickChoices).to.deep.equal(['$(folder) out']);
    });

    it('says so instead of opening an empty pick when there is nowhere to go', async () => {
      const assignmentDir = path.join(repoRoot, 'week_1');
      fs.mkdirSync(path.join(assignmentDir, 'src'), { recursive: true });
      const assignment = assignmentItem(assignmentDir);
      const srcFolder = fsItem('week_1/src', true, assignment);

      await run('computor.student.fs.moveTo', srcFolder);

      expect(quickPickChoices).to.deep.equal([]);
      expect(fs.existsSync(path.join(assignmentDir, 'src'))).to.equal(true);
    });
  });

  describe('delete', () => {
    it('deletes a file through the file-specific entry', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), '');
      warningAnswer = 'Delete';
      await run('computor.student.fs.deleteFile', fsItem('a.txt', false));
      expect(fs.existsSync(path.join(repoRoot, 'a.txt'))).to.equal(false);
    });

    it('deletes a folder through the folder-specific entry', async () => {
      fs.mkdirSync(path.join(repoRoot, 'out'));
      warningAnswer = 'Delete';
      await run('computor.student.fs.deleteFolder', fsItem('out', true));
      expect(fs.existsSync(path.join(repoRoot, 'out'))).to.equal(false);
    });
  });
});
