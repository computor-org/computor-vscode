import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { shouldExcludeExampleEntry } from './exampleExcludePatterns';

function collectFiles(dir: string, baseDir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) { return files; }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldExcludeExampleEntry(entry.name)) { continue; }
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile()) {
      files.push(path.relative(baseDir, fullPath));
    } else if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, baseDir));
    }
  }
  return files;
}

export function hashDirectory(dir: string): string {
  const files = collectFiles(dir, dir).sort();
  const hash = crypto.createHash('sha256');

  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(dir, file)));
  }

  return hash.digest('hex');
}

export function hasExampleChanged(workingDir: string, snapshotDir: string): boolean {
  if (!fs.existsSync(snapshotDir)) { return true; }
  return hashDirectory(workingDir) !== hashDirectory(snapshotDir);
}

export interface ExampleDiff {
  /** Files present in both, with different bytes. */
  modified: string[];
  /** Files present in `right` but not in `left`. */
  added: string[];
  /** Files present in `left` but not in `right`. */
  removed: string[];
}

/**
 * Compares the contents of two example directories, returning per-file
 * status. Both sides are filtered through {@link shouldExcludeExampleEntry}
 * (drops `.computor-example.json`, `node_modules`, etc.).
 *
 * "left" is treated as the *original* / reference side and "right" as the
 * *modified* / current side. So "added" means the file appeared on the right
 * (e.g. the working copy) and "removed" means it disappeared from the right.
 */
export function computeExampleDiff(leftDir: string, rightDir: string): ExampleDiff {
  const leftFiles = new Set(fs.existsSync(leftDir) ? collectFiles(leftDir, leftDir) : []);
  const rightFiles = new Set(fs.existsSync(rightDir) ? collectFiles(rightDir, rightDir) : []);

  const modified: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const rel of rightFiles) {
    if (!leftFiles.has(rel)) {
      added.push(rel);
      continue;
    }
    const leftPath = path.join(leftDir, rel);
    const rightPath = path.join(rightDir, rel);
    if (!filesEqual(leftPath, rightPath)) {
      modified.push(rel);
    }
  }

  for (const rel of leftFiles) {
    if (!rightFiles.has(rel)) {
      removed.push(rel);
    }
  }

  added.sort();
  modified.sort();
  removed.sort();
  return { modified, added, removed };
}

function filesEqual(a: string, b: string): boolean {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    if (sa.size !== sb.size) { return false; }
    const ba = fs.readFileSync(a);
    const bb = fs.readFileSync(b);
    return ba.equals(bb);
  } catch {
    return false;
  }
}
