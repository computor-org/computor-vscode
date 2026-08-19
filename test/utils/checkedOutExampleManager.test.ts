import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  scanCheckedOutExamples,
  isWorkingCopyDirty,
  writeCheckoutMetadata
} from '../../src/utils/checkedOutExampleManager';
import type { CheckedOutExampleGroup } from '../../src/utils/checkedOutExampleManager';
import { WorkspaceStructureManager } from '../../src/utils/workspaceStructure';

/**
 * "Checkout Latest (Filtered)" overwrites working copies and "Clean Up Local
 * Examples (Filtered)" deletes them (computor-org/issues#339, #340). Both ask
 * this one question first, and both destroy a lecturer's edits if it answers
 * wrongly — so a snapshot it cannot compare against has to count as dirty,
 * even though the tree's own badge takes the opposite view.
 */

let workspaceRoot: string;

function examplesDir(): string { return path.join(workspaceRoot, 'examples'); }
function versionsDir(): string { return path.join(workspaceRoot, 'example_versions'); }

function checkout(directory: string, versionTag: string, files: Record<string, string>): void {
  const working = path.join(examplesDir(), directory);
  fs.mkdirSync(working, { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(working, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  }
  writeCheckoutMetadata(working, {
    exampleId: `id-${directory}`,
    repositoryId: 'repo-1',
    directory,
    versionId: `version-${versionTag}`,
    versionTag,
    versionNumber: 1,
    checkedOutAt: new Date().toISOString()
  });

  const snapshot = path.join(versionsDir(), directory, versionTag);
  fs.mkdirSync(path.dirname(snapshot), { recursive: true });
  fs.cpSync(working, snapshot, { recursive: true });
}

function group(directory: string): CheckedOutExampleGroup {
  const found = scanCheckedOutExamples().find(g => g.directory === directory);
  expect(found, `a group for ${directory}`).to.not.equal(undefined);
  return found!;
}

beforeEach(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-checkout-'));
  (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];
  (WorkspaceStructureManager as any).instance = undefined;
});

afterEach(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  (vscode.workspace as any).workspaceFolders = undefined;
  (WorkspaceStructureManager as any).instance = undefined;
});

describe('isWorkingCopyDirty', () => {
  it('is clean when the working copy still matches its snapshot', () => {
    checkout('alpha', '1.0.0', { 'main.py': 'print(1)\n' });
    expect(isWorkingCopyDirty(group('alpha'))).to.equal(false);
  });

  it('is dirty once a file is edited', () => {
    checkout('alpha', '1.0.0', { 'main.py': 'print(1)\n' });
    fs.writeFileSync(path.join(examplesDir(), 'alpha', 'main.py'), 'print(2)\n', 'utf8');

    expect(isWorkingCopyDirty(group('alpha'))).to.equal(true);
  });

  it('is dirty once a file is added', () => {
    checkout('alpha', '1.0.0', { 'main.py': 'print(1)\n' });
    fs.writeFileSync(path.join(examplesDir(), 'alpha', 'extra.py'), 'print(3)\n', 'utf8');

    expect(isWorkingCopyDirty(group('alpha'))).to.equal(true);
  });

  it('is dirty when the snapshot is gone, because nothing proves the copy is safe to discard', () => {
    checkout('alpha', '1.0.0', { 'main.py': 'print(1)\n' });
    fs.rmSync(path.join(versionsDir(), 'alpha'), { recursive: true, force: true });

    expect(isWorkingCopyDirty(group('alpha'))).to.equal(true);
  });

  it('is clean when there is no working copy at all — nothing to protect', () => {
    checkout('alpha', '1.0.0', { 'main.py': 'print(1)\n' });
    fs.rmSync(path.join(examplesDir(), 'alpha'), { recursive: true, force: true });

    const snapshotOnly = group('alpha');
    expect(snapshotOnly.workingVersion).to.equal(undefined);
    expect(isWorkingCopyDirty(snapshotOnly)).to.equal(false);
  });

  it('ignores the checkout marker itself, which is never part of the example', () => {
    checkout('alpha', '1.0.0', { 'main.py': 'print(1)\n' });
    writeCheckoutMetadata(path.join(examplesDir(), 'alpha'), {
      exampleId: 'id-alpha',
      repositoryId: 'repo-1',
      directory: 'alpha',
      versionId: 'version-1.0.0',
      versionTag: '1.0.0',
      versionNumber: 1,
      checkedOutAt: new Date('2020-01-01').toISOString()
    });

    expect(isWorkingCopyDirty(group('alpha'))).to.equal(false);
  });
});
