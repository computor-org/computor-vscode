import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

/**
 * Resolve a zip entry name against `destDir`, refusing anything that escapes it.
 *
 * Zip entry names are attacker-controlled data, not paths to trust: an entry
 * called `../../.bashrc` (or an absolute path) writes outside the destination.
 * That matters most for submission artifacts, which are built from student
 * content and auto-extract on a TUTOR's machine when they expand a tree node.
 *
 * Returns undefined for an entry that must be skipped.
 */
export function safeExtractTarget(destDir: string, entryName: string): string | undefined {
  const normalized = entryName.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return undefined;
  }
  const root = path.resolve(destDir);
  const target = path.resolve(root, normalized);
  // `root + sep` so a sibling directory sharing a prefix (`/tmp/dest-evil`)
  // does not pass as being inside `/tmp/dest`.
  if (target !== root && !target.startsWith(root + path.sep)) {
    return undefined;
  }
  return target;
}

/**
 * Extract a git-archive ZIP buffer into `destDir`, stripping the single wrapper
 * directory git servers add (e.g. `repo-<sha>/`). Returns the number of files
 * written. Entries that would escape `destDir` are skipped and logged.
 */
export async function extractZipBuffer(buffer: Buffer, destDir: string): Promise<number> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  const tops = new Set(entries.filter(e => !e.dir).map(e => e.name.split('/')[0]));
  const strip = tops.size === 1 ? `${[...tops][0]}/` : '';
  let count = 0;
  for (const entry of entries) {
    if (entry.dir) { continue; }
    let rel = entry.name;
    if (strip && rel.startsWith(strip)) { rel = rel.slice(strip.length); }
    if (!rel) { continue; }
    const target = safeExtractTarget(destDir, rel);
    if (!target) {
      console.warn(`[zipHelpers] Skipping archive entry outside the destination: ${entry.name}`);
      continue;
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, await entry.async('nodebuffer'));
    count++;
  }
  return count;
}
