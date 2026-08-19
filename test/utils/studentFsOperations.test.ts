import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  containsProtectedSegment,
  copyEntry,
  createFile,
  createFolder,
  deleteEntry,
  isProtectedName,
  isReservedAtAssignmentRoot,
  isWithinRoot,
  moveEntry,
  normalizeRelativePath,
  renameEntry,
  uniqueName,
  validateSegment
} from '../../src/utils/studentFsOperations';

/**
 * These primitives are the only thing standing between a student's context menu
 * and their cloned submission repository. The containment guard and the `.git`
 * guard are the two that actually matter: escaping the root would let a rename
 * write anywhere on disk, and deleting `.git` would destroy submission history
 * with no undo.
 */

let root: string;

/** Per-test temp repo. Called inside each describe: hooks declared at module
 *  scope become Mocha ROOT hooks and would run for every spec in the suite. */
function useTempRoot(): void {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'student-fs-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
}

describe('validateSegment', () => {
  useTempRoot();
  it('rejects blank and whitespace-only names', () => {
    expect(validateSegment('')).to.be.a('string');
    expect(validateSegment('   ')).to.be.a('string');
  });

  it('rejects path separators in either direction', () => {
    expect(validateSegment('a/b')).to.contain('separator');
    expect(validateSegment('a\\b')).to.contain('separator');
  });

  it('rejects the relative-path names', () => {
    expect(validateSegment('.')).to.be.a('string');
    expect(validateSegment('..')).to.be.a('string');
  });

  // `.git` is deliberately NOT rejected here: validateSegment is the generic
  // segment check shared with the Documents tree. The student layer adds
  // isProtectedName on top, and the primitives refuse it regardless.
  it('leaves .git to the protected-name guard', () => {
    expect(validateSegment('.git')).to.equal(undefined);
  });

  it('accepts an ordinary file name', () => {
    expect(validateSegment('solution.py')).to.equal(undefined);
  });
});

describe('isWithinRoot', () => {
  useTempRoot();
  it('treats the root itself as inside', () => {
    expect(isWithinRoot(root, root)).to.equal(true);
  });

  it('accepts a nested path', () => {
    expect(isWithinRoot(root, path.join(root, 'a', 'b.txt'))).to.equal(true);
  });

  it('rejects a parent escape', () => {
    expect(isWithinRoot(root, path.join(root, '..', 'elsewhere'))).to.equal(false);
  });

  it('rejects an unrelated absolute path', () => {
    expect(isWithinRoot(root, path.join(os.tmpdir(), 'somewhere-else'))).to.equal(false);
  });
});

describe('normalizeRelativePath', () => {
  useTempRoot();
  it('keeps a nested relative path', () => {
    expect(normalizeRelativePath('src/utils')).to.equal(path.join('src', 'utils'));
  });

  it('collapses redundant separators', () => {
    expect(normalizeRelativePath('src//utils')).to.equal(path.join('src', 'utils'));
  });

  it('rejects traversal and drive-letter segments', () => {
    expect(normalizeRelativePath('../escape')).to.equal(undefined);
    expect(normalizeRelativePath('./here')).to.equal(undefined);
    expect(normalizeRelativePath('C:/windows')).to.equal(undefined);
  });

  it('rejects blank input', () => {
    expect(normalizeRelativePath('   ')).to.equal(undefined);
  });
});

describe('protected names', () => {
  useTempRoot();
  it('protects .git only', () => {
    expect(isProtectedName('.git')).to.equal(true);
    expect(isProtectedName('.gitignore')).to.equal(false);
  });

  it('detects a protected segment anywhere in a path', () => {
    expect(containsProtectedSegment(path.join(root, '.git', 'config'))).to.equal(true);
    expect(containsProtectedSegment(path.join(root, 'src', 'main.py'))).to.equal(false);
  });

  it('reserves the backend-owned description assets', () => {
    expect(isReservedAtAssignmentRoot('README.md')).to.equal(true);
    expect(isReservedAtAssignmentRoot('README_de.md')).to.equal(true);
    expect(isReservedAtAssignmentRoot('mediaFiles')).to.equal(true);
    expect(isReservedAtAssignmentRoot('notes.md')).to.equal(false);
  });
});

describe('uniqueName', () => {
  useTempRoot();
  it('returns the name unchanged when nothing collides', () => {
    expect(uniqueName(root, 'main.py', false)).to.equal('main.py');
  });

  it('appends "copy" before the extension', () => {
    fs.writeFileSync(path.join(root, 'main.py'), '');
    expect(uniqueName(root, 'main.py', false)).to.equal('main copy.py');
  });

  it('counts up when the copy also exists', () => {
    fs.writeFileSync(path.join(root, 'main.py'), '');
    fs.writeFileSync(path.join(root, 'main copy.py'), '');
    expect(uniqueName(root, 'main.py', false)).to.equal('main copy 2.py');
  });

  it('treats a dotfile as extension-less', () => {
    fs.writeFileSync(path.join(root, '.env'), '');
    expect(uniqueName(root, '.env', false)).to.equal('.env copy');
  });

  it('does not split a directory name on its dot', () => {
    fs.mkdirSync(path.join(root, 'my.folder'));
    expect(uniqueName(root, 'my.folder', true)).to.equal('my.folder copy');
  });
});

describe('createFile / createFolder', () => {
  useTempRoot();
  it('creates an empty file', () => {
    const created = createFile(root, root, 'a.txt');
    expect(fs.readFileSync(created, 'utf8')).to.equal('');
  });

  it('creates a folder', () => {
    const created = createFolder(root, root, 'src');
    expect(fs.statSync(created).isDirectory()).to.equal(true);
  });

  it('refuses to overwrite an existing entry', () => {
    createFile(root, root, 'a.txt');
    expect(() => createFile(root, root, 'a.txt')).to.throw(/already exists/);
  });

  it('refuses a target outside the root', () => {
    const outside = path.join(root, '..');
    expect(() => createFile(root, outside, 'escaped.txt')).to.throw(/leave the course repository/);
  });
});

describe('renameEntry', () => {
  useTempRoot();
  it('renames a file', () => {
    const created = createFile(root, root, 'a.txt');
    const renamed = renameEntry(root, created, 'b.txt');
    expect(fs.existsSync(renamed)).to.equal(true);
    expect(fs.existsSync(created)).to.equal(false);
  });

  it('is a no-op when the name is unchanged', () => {
    const created = createFile(root, root, 'a.txt');
    expect(renameEntry(root, created, 'a.txt')).to.equal(created);
  });

  it('refuses to clobber an existing sibling', () => {
    const created = createFile(root, root, 'a.txt');
    createFile(root, root, 'b.txt');
    expect(() => renameEntry(root, created, 'b.txt')).to.throw(/already exists/);
  });

  it('refuses to rename .git', () => {
    fs.mkdirSync(path.join(root, '.git'));
    expect(() => renameEntry(root, path.join(root, '.git'), 'gone')).to.throw(/managed by Computor/);
  });

  it('refuses to rename out of the root', () => {
    const created = createFile(root, root, 'a.txt');
    expect(() => renameEntry(root, created, '../escaped.txt')).to.throw(/leave the course repository/);
  });
});

describe('deleteEntry', () => {
  useTempRoot();
  it('deletes a file', () => {
    const created = createFile(root, root, 'a.txt');
    deleteEntry(root, created);
    expect(fs.existsSync(created)).to.equal(false);
  });

  it('deletes a folder and its contents', () => {
    const dir = createFolder(root, root, 'src');
    createFile(root, dir, 'main.py');
    deleteEntry(root, dir);
    expect(fs.existsSync(dir)).to.equal(false);
  });

  it('refuses to delete .git', () => {
    const git = path.join(root, '.git');
    fs.mkdirSync(git);
    expect(() => deleteEntry(root, git)).to.throw(/managed by Computor/);
    expect(fs.existsSync(git)).to.equal(true);
  });
});

describe('copyEntry', () => {
  useTempRoot();
  it('copies a file into another folder', () => {
    const src = createFile(root, root, 'a.txt');
    fs.writeFileSync(src, 'hello');
    const dest = createFolder(root, root, 'dest');
    const copied = copyEntry(root, src, dest);
    expect(fs.readFileSync(copied, 'utf8')).to.equal('hello');
    expect(fs.existsSync(src)).to.equal(true);
  });

  it('copies a folder recursively', () => {
    const dir = createFolder(root, root, 'src');
    createFile(root, dir, 'main.py');
    const dest = createFolder(root, root, 'dest');
    const copied = copyEntry(root, dir, dest);
    expect(fs.existsSync(path.join(copied, 'main.py'))).to.equal(true);
  });

  it('honours an explicit name, which is how Duplicate works', () => {
    const src = createFile(root, root, 'main.py');
    const copied = copyEntry(root, src, root, { name: uniqueName(root, 'main.py', false) });
    expect(path.basename(copied)).to.equal('main copy.py');
  });

  it('refuses to copy a folder into its own subtree', () => {
    const dir = createFolder(root, root, 'src');
    const inner = createFolder(root, dir, 'inner');
    expect(() => copyEntry(root, dir, inner)).to.throw(/into itself/);
  });

  it('refuses when the source has vanished', () => {
    expect(() => copyEntry(root, path.join(root, 'ghost.txt'), root)).to.throw(/no longer exists/);
  });
});

describe('moveEntry', () => {
  useTempRoot();
  it('moves a file', () => {
    const src = createFile(root, root, 'a.txt');
    const dest = createFolder(root, root, 'dest');
    const moved = moveEntry(root, src, dest);
    expect(fs.existsSync(moved)).to.equal(true);
    expect(fs.existsSync(src)).to.equal(false);
  });

  it('no-ops when moving into the folder it already lives in', () => {
    const src = createFile(root, root, 'a.txt');
    expect(moveEntry(root, src, root)).to.equal(src);
    expect(fs.existsSync(src)).to.equal(true);
  });

  it('refuses to move a folder into its own subtree', () => {
    const dir = createFolder(root, root, 'src');
    const inner = createFolder(root, dir, 'inner');
    expect(() => moveEntry(root, dir, inner)).to.throw(/into itself/);
  });

  it('refuses to move .git', () => {
    const git = path.join(root, '.git');
    fs.mkdirSync(git);
    const dest = createFolder(root, root, 'dest');
    expect(() => moveEntry(root, git, dest)).to.throw(/managed by Computor/);
  });

  it('replaces the target when overwrite is requested', () => {
    const src = createFile(root, root, 'a.txt');
    fs.writeFileSync(src, 'new');
    const dest = createFolder(root, root, 'dest');
    fs.writeFileSync(path.join(dest, 'a.txt'), 'old');
    const moved = moveEntry(root, src, dest, { overwrite: true });
    expect(fs.readFileSync(moved, 'utf8')).to.equal('new');
  });
});
