import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { shouldExcludeExampleEntry } from './exampleExcludePatterns';
import { buildStudentRepoRoot } from './repositoryNaming';
import type { CourseContentStudentList } from '../types/generated';

export type CourseExportFormat = 'flat' | 'tree';

export interface CourseExportInput {
  contents: CourseContentStudentList[];
  workspaceRoot: string;
  format: CourseExportFormat;
}

export interface CourseExportResult {
  zip: JSZip;
  packaged: number;
  /** Title list for assignments whose source folder didn't exist on disk. */
  missing: string[];
  /** Probed paths — surfaced when packaged == 0 to help debug. */
  probedPaths: string[];
}

/** Replaces whitespace with `_`, strips filesystem-unsafe and control chars,
 *  collapses repeats. Returns `'untitled'` for blank inputs. */
export function sanitizeContentDirName(raw: string | null | undefined): string {
  const source = (raw ?? '').toString().normalize('NFKD');
  const cleaned = source
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .trim();
  return cleaned || 'untitled';
}

/** Mirrors StudentCourseContentTreeProvider.getStudentRepoRoot — turns
 *  `submission_group.repository.full_path` into the local repo directory. */
function repoRootFor(
  content: CourseContentStudentList,
  workspaceRoot: string
): string | undefined {
  const fullPath = content.submission_group?.repository?.full_path;
  if (!fullPath) { return undefined; }
  const dirName = fullPath.replace(/\//g, '.');
  return buildStudentRepoRoot(workspaceRoot, dirName);
}

/** Mirrors StudentCourseContentTreeProvider's `resolvePath` helper used to
 *  locate the assignment folder: absolute `directory` is taken verbatim;
 *  relative `directory` is joined onto repoRoot. When `directory` is missing
 *  we fall back to repoRoot itself. */
function localAssignmentPath(
  content: CourseContentStudentList,
  workspaceRoot: string
): string | undefined {
  const repoRoot = repoRootFor(content, workspaceRoot);
  if (!repoRoot) { return undefined; }
  const directory = (content as any)?.directory as string | undefined;
  if (!directory) { return repoRoot; }
  if (path.isAbsolute(directory)) { return directory; }
  return path.join(repoRoot, directory);
}

function buildTreePath(
  content: CourseContentStudentList,
  byPath: Map<string, CourseContentStudentList>
): string {
  const parts = (content.path || '').split('.').filter(Boolean);
  const segments: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const ancestorPath = parts.slice(0, i).join('.');
    const ancestor = byPath.get(ancestorPath);
    const fallback = parts[i - 1] ?? '';
    segments.push(sanitizeContentDirName(ancestor?.title ?? fallback));
  }
  return segments.join('/');
}

function flatNameFor(content: CourseContentStudentList): string {
  const exampleId = content.submission_group?.example_identifier;
  const directory = (content as any)?.directory as string | undefined;
  const fallback = content.path?.split('.').pop();
  return sanitizeContentDirName(exampleId || (directory ? path.basename(directory) : '') || fallback || content.id);
}

function addDirectoryToZip(zip: JSZip, sourceDir: string, zipBasePath: string): void {
  const walk = (current: string, baseInZip: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      console.warn('[courseExportZip] Failed to read directory:', current, err);
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) { continue; }
      if (shouldExcludeExampleEntry(entry.name)) { continue; }
      const abs = path.join(current, entry.name);
      const inZipPath = baseInZip ? `${baseInZip}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, inZipPath);
      } else if (entry.isFile()) {
        try {
          zip.file(inZipPath, fs.readFileSync(abs));
        } catch (err) {
          console.warn('[courseExportZip] Failed to read file:', abs, err);
        }
      }
    }
  };
  walk(sourceDir, zipBasePath);
}

export async function buildCourseExportZip(input: CourseExportInput): Promise<CourseExportResult> {
  const zip = new JSZip();
  const byPath = new Map<string, CourseContentStudentList>();
  for (const c of input.contents) {
    if (typeof c.path === 'string' && c.path.length > 0) {
      byPath.set(c.path, c);
    }
  }

  let packaged = 0;
  const missing: string[] = [];
  const probedPaths: string[] = [];

  for (const content of input.contents) {
    // The student tree only renders files for nodes with a submission_group;
    // mirror that — pure unit folders aren't exportable.
    if (!content.submission_group) { continue; }

    const sourcePath = localAssignmentPath(content, input.workspaceRoot);
    if (!sourcePath) { continue; }
    probedPaths.push(sourcePath);

    let exists = false;
    try {
      exists = fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) {
      missing.push(content.title || content.path || content.id);
      continue;
    }

    const zipBasePath = input.format === 'flat'
      ? flatNameFor(content)
      : buildTreePath(content, byPath);

    if (!zipBasePath) { continue; }
    addDirectoryToZip(zip, sourcePath, zipBasePath);
    packaged += 1;
  }

  return { zip, packaged, missing, probedPaths };
}
