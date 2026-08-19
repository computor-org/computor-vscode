import * as fs from 'fs';
import * as path from 'path';

/**
 * Filesystem primitives behind the student tree's file operations.
 *
 * Everything here is `vscode`-free so it can be unit-tested directly (the test
 * harness stubs `vscode` and deliberately has no `workspace.fs`). The module
 * also owns the safety guards: every mutating call takes the repository root it
 * must stay inside and throws a plain `Error` — carrying a user-facing message —
 * rather than silently doing the wrong thing. `commandRegistrar` surfaces those
 * through `showErrorWithSeverity`.
 */

/** Names that are never creatable, renamable or deletable, anywhere in a repo. */
const ALWAYS_PROTECTED = new Set(['.git']);

/**
 * Backend-managed assignment description assets. `listAssignmentFiles` hides
 * these at the assignment root, so a student can't select them — but they could
 * still collide with a "New File". Only reserved at the root: deeper folders
 * legitimately contain READMEs and the tree does show those.
 */
const RESERVED_AT_ROOT = new Set(['mediaFiles', 'README.md']);

/** Validates a single path segment for the file/folder name inputs. */
export function validateSegment(value: string): string | undefined {
  if (!value || !value.trim()) { return 'Name cannot be empty.'; }
  if (value.includes('/') || value.includes('\\')) { return 'Name cannot contain path separators.'; }
  if (value === '.' || value === '..') { return 'Reserved name.'; }
  return undefined;
}

/** True when `candidate` is `base` itself or lives inside it. */
export function isWithinRoot(base: string, candidate: string): boolean {
  const relative = path.relative(base, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Normalises user input like `src/utils` into a safe relative path.
 * Returns `undefined` for blank input or anything containing `.`, `..` or `:`.
 */
export function normalizeRelativePath(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  const segments = trimmed.split(/[/\\]+/).filter(segment => segment.length > 0);
  if (segments.length === 0) {
    return undefined;
  }

  if (segments.some(segment => segment === '.' || segment === '..' || segment.includes(':'))) {
    return undefined;
  }

  return path.join(...segments);
}

/** `.git` is protected everywhere — losing it would destroy submission history. */
export function isProtectedName(name: string): boolean {
  return ALWAYS_PROTECTED.has(name);
}

/** True when any segment of `absPath` is a protected name. */
export function containsProtectedSegment(absPath: string): boolean {
  return absPath.split(/[/\\]+/).some(segment => isProtectedName(segment));
}

/** README.md / README_de.md / mediaFiles — backend-owned, only at the assignment root. */
export function isReservedAtAssignmentRoot(name: string): boolean {
  if (RESERVED_AT_ROOT.has(name)) { return true; }
  return name.startsWith('README_') && name.endsWith('.md');
}

/**
 * A name that does not yet exist in `dir`, derived from `name`:
 * `main.py` -> `main copy.py` -> `main copy 2.py`. Directories keep their whole
 * name (no extension split), and dotfiles like `.env` count as extension-less.
 */
export function uniqueName(dir: string, name: string, isDirectory: boolean): string {
  if (!fs.existsSync(path.join(dir, name))) {
    return name;
  }

  // `path.extname('.env')` is '' already, so dotfiles fall out correctly.
  const ext = isDirectory ? '' : path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;

  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${stem} copy${ext}` : `${stem} copy ${n}${ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) {
      return candidate;
    }
  }
}

/** Throws unless `target` is a usable, in-bounds path under `root`. */
function assertWritableTarget(root: string, target: string): void {
  if (!isWithinRoot(root, target)) {
    throw new Error('Operation would leave the course repository.');
  }
  if (containsProtectedSegment(target)) {
    throw new Error('That path is managed by Computor and cannot be modified.');
  }
}

function assertAbsent(target: string): void {
  if (fs.existsSync(target)) {
    throw new Error(`"${path.basename(target)}" already exists.`);
  }
}

export function createFile(root: string, dir: string, name: string): string {
  const target = path.join(dir, name);
  assertWritableTarget(root, target);
  assertAbsent(target);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, '', 'utf8');
  return target;
}

export function createFolder(root: string, dir: string, name: string): string {
  const target = path.join(dir, name);
  assertWritableTarget(root, target);
  assertAbsent(target);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

export function renameEntry(root: string, absPath: string, newName: string): string {
  assertWritableTarget(root, absPath);
  const target = path.join(path.dirname(absPath), newName);
  assertWritableTarget(root, target);
  if (target === absPath) {
    return absPath;
  }
  assertAbsent(target);
  fs.renameSync(absPath, target);
  return target;
}

export function deleteEntry(root: string, absPath: string): void {
  assertWritableTarget(root, absPath);
  fs.rmSync(absPath, { recursive: true, force: true });
}

/** Throws when `destDir` sits inside `srcAbs` — copying/moving a folder into itself. */
function assertNotIntoOwnSubtree(srcAbs: string, destDir: string): void {
  if (isWithinRoot(srcAbs, destDir)) {
    throw new Error('Cannot move or copy a folder into itself.');
  }
}

export function copyEntry(
  root: string,
  srcAbs: string,
  destDir: string,
  opts: { overwrite?: boolean; name?: string } = {}
): string {
  if (!fs.existsSync(srcAbs)) {
    throw new Error(`"${path.basename(srcAbs)}" no longer exists.`);
  }
  const isDirectory = fs.statSync(srcAbs).isDirectory();
  if (isDirectory) {
    assertNotIntoOwnSubtree(srcAbs, destDir);
  }

  const target = path.join(destDir, opts.name ?? path.basename(srcAbs));
  assertWritableTarget(root, target);
  if (!opts.overwrite) {
    assertAbsent(target);
  } else if (target === srcAbs) {
    throw new Error('Source and destination are the same.');
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(srcAbs, target, { recursive: true, force: true });
  return target;
}

export function moveEntry(
  root: string,
  srcAbs: string,
  destDir: string,
  opts: { overwrite?: boolean; name?: string; srcRoot?: string } = {}
): string {
  if (!fs.existsSync(srcAbs)) {
    throw new Error(`"${path.basename(srcAbs)}" no longer exists.`);
  }
  // The source is bounded by where it came from, the destination by where it is
  // going: a cut in one assignment pasted into another is legitimate, and both
  // ends still have to stay inside a directory the student owns.
  assertWritableTarget(opts.srcRoot ?? root, srcAbs);
  if (fs.statSync(srcAbs).isDirectory()) {
    assertNotIntoOwnSubtree(srcAbs, destDir);
  }

  const name = opts.name ?? path.basename(srcAbs);
  const target = path.join(destDir, name);
  // Moving an entry onto itself is a no-op, not an error — a cut/paste in the
  // same folder should quietly do nothing rather than complain.
  if (target === srcAbs) {
    return srcAbs;
  }
  assertWritableTarget(root, target);
  if (!opts.overwrite) {
    assertAbsent(target);
  }

  fs.mkdirSync(destDir, { recursive: true });
  if (opts.overwrite && fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.renameSync(srcAbs, target);
  return target;
}

/**
 * Nearest ancestor of `startPath` (inclusive) containing a `.git` directory.
 * A fallback for nodes that don't carry their repository root: download-mode
 * courses extract a plain ZIP with no `.git`, so callers should prefer a root
 * the tree already knows and only fall back to this.
 */
export function findRepoRoot(startPath: string): string | undefined {
  let current = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}
