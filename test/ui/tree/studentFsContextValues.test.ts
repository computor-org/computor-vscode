import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { FileSystemItem } from '../../../src/ui/tree/student/StudentCourseContentTreeProvider';

/**
 * The filesystem commands hang off these context values. The bare `file` /
 * `folder` values these replaced were the only un-namespaced ones in the repo,
 * which made them easy to match by accident from another view's menu.
 *
 * Course and unit rows are deliberately absent here: the tree never lists their
 * directories, so anything created on them would be invisible, and they carry
 * no filesystem actions at all.
 */

let workspace: string;

/** Called inside the describe: module-scope hooks are Mocha ROOT hooks and
 *  would run for every spec in the suite. */
function useWorkspace(): void {
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'student-ctx-'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });
}

describe('FileSystemItem context value', () => {
  useWorkspace();

  it('namespaces the file context value to the student tree', () => {
    const uri = vscode.Uri.file(path.join(workspace, 'main.py'));
    const item = new FileSystemItem('main.py', uri, vscode.FileType.File);
    expect(item.contextValue).to.equal('studentFile');
  });

  it('namespaces the folder context value to the student tree', () => {
    const uri = vscode.Uri.file(path.join(workspace, 'src'));
    const item = new FileSystemItem('src', uri, vscode.FileType.Directory);
    expect(item.contextValue).to.equal('studentFolder');
  });

  it('carries the repo root and parent a mutation needs', () => {
    // Without these the commands cannot bound an operation, and cannot refresh
    // the row that changed — the provider has no getParent.
    const repoRoot = path.join(workspace, 'student', 'courses.algo');
    const parent = new FileSystemItem('src', vscode.Uri.file(repoRoot), vscode.FileType.Directory);
    const item = new FileSystemItem(
      'main.py',
      vscode.Uri.file(path.join(repoRoot, 'main.py')),
      vscode.FileType.File,
      repoRoot,
      parent
    );
    expect(item.repoRoot).to.equal(repoRoot);
    expect(item.parent).to.equal(parent);
  });
});
