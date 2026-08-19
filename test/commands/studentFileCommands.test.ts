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
    validationError = undefined;
    contextKeys = {};

    original.registerCommand = vscode.commands.registerCommand;
    original.executeCommand = vscode.commands.executeCommand;
    original.showInputBox = vscode.window.showInputBox;
    original.showWarningMessage = vscode.window.showWarningMessage;
    original.writeText = vscode.env.clipboard.writeText;

    (vscode.commands as any).registerCommand = (id: string, handler: Handler) => {
      handlers.set(id, handler);
      return { dispose() {} };
    };
    (vscode.commands as any).executeCommand = async (cmd: string, ...args: any[]) => {
      if (cmd === 'setContext') { contextKeys[args[0]] = args[1]; }
      return undefined;
    };
    (vscode.window as any).showInputBox = async (opts: any) => {
      // VS Code will not resolve a value that fails validateInput, so neither do
      // we — that makes a refused name observable without the command throwing.
      if (inputAnswer !== undefined && opts?.validateInput) {
        const problem = await opts.validateInput(inputAnswer);
        if (problem) { validationError = problem; return undefined; }
      }
      return inputAnswer;
    };
    (vscode.window as any).showWarningMessage = async () => warningAnswer;
    (vscode.env.clipboard as any).writeText = async (text: string) => { clipboardText = text; };

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
    (vscode.env.clipboard as any).writeText = original.writeText;
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
      'newFile', 'newFolder', 'rename', 'delete', 'duplicate',
      'cut', 'copy', 'paste', 'revealInOS', 'copyPath', 'copyRelativePath'
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
      await run('computor.student.fs.delete', fsItem('a.txt', false));
      expect(fs.existsSync(path.join(repoRoot, 'a.txt'))).to.equal(false);
    });

    it('keeps the entry when the confirmation is declined', async () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'x');
      warningAnswer = undefined;
      await run('computor.student.fs.delete', fsItem('a.txt', false));
      expect(fs.existsSync(path.join(repoRoot, 'a.txt'))).to.equal(true);
    });

    it('removes a folder and everything inside it', async () => {
      fs.mkdirSync(path.join(repoRoot, 'src'));
      fs.writeFileSync(path.join(repoRoot, 'src', 'main.py'), '');
      warningAnswer = 'Delete';
      await run('computor.student.fs.delete', fsItem('src', true));
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
  });
});
