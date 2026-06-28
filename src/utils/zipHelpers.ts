import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

/**
 * Extract a git-archive ZIP buffer into `destDir`, stripping the single wrapper
 * directory git servers add (e.g. `repo-<sha>/`). Returns the number of files
 * written.
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
    const target = path.join(destDir, rel);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, await entry.async('nodebuffer'));
    count++;
  }
  return count;
}
