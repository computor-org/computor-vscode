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
