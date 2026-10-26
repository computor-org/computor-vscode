/**
 * Which files of an assignment folder the backend keeps when it unpacks an
 * upload. This mirrors `_should_skip_file` in computor-backend
 * (business_logic/submissions.py): README files, media folders, hidden files,
 * build/cache folders, editor leftovers and executables are dropped there, so
 * a folder whose only non-empty files are of that kind is refused with
 * SUBMIT_014 after the commit, push and upload. The pre-flight checks of Test
 * and Submit use this to answer the student before any of that happens.
 *
 * `relPath` is relative to the assignment folder and uses `/` separators.
 */

const skippedExtensions = new Set([
  '.exe', '.dll', '.com', '.bat', '.cmd', '.msi', '.scr', '.vbs', '.wsf',
  '.bin', '.so', '.a', '.o',
  '.dylib', '.app', '.dmg', '.pkg',
  '.ps1', '.psm1',
  '.class',
  '.elf',
  '.db', '.sqlite', '.sqlite3',
  '.iso', '.img', '.vhd', '.vmdk'
]);

const skippedDirectories = new Set([
  'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache',
  'build', 'dist', 'target', 'bin', 'obj', '.gradle', '.next',
  'coverage', '.nyc_output', 'out'
]);

export function isSubmittablePath(relPath: string): boolean {
  const parts = relPath.split('/').filter(part => part.length > 0);
  const base = parts[parts.length - 1] ?? '';
  const lowerPath = relPath.toLowerCase();
  const lowerBase = base.toLowerCase();
  const dot = base.lastIndexOf('.');
  const extension = dot >= 0 ? base.slice(dot).toLowerCase() : '';

  if (skippedExtensions.has(extension)) { return false; }
  if (lowerBase.startsWith('readme')) { return false; }
  if (lowerPath.includes('mediafiles') || parts.includes('media')) { return false; }
  if (parts.some(part => part.startsWith('.'))) { return false; }
  if (lowerPath.includes('.ds_store') || lowerPath.includes('__macosx')) { return false; }
  if (lowerPath.includes('thumbs.db') || lowerPath.includes('desktop.ini')) { return false; }
  if (parts.some(part => skippedDirectories.has(part))) { return false; }
  if (base.endsWith('~') || base.endsWith('.bak')) { return false; }
  if (base.endsWith('.swp') || base.endsWith('.swo') || base.endsWith('.tmp')) { return false; }
  return true;
}
