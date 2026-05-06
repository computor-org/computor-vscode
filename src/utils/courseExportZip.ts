import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { shouldExcludeExampleEntry } from './exampleExcludePatterns';
import { buildStudentRepoRoot } from './repositoryNaming';
import type {
  CourseContentStudentList,
  SubmissionGroupStudentList
} from '../types/generated';

export type CourseExportFormat = 'flat' | 'tree';

export interface CourseExportInput {
  contents: CourseContentStudentList[];
  workspaceRoot: string;
  format: CourseExportFormat;
}

export interface CourseExportResult {
  zip: JSZip;
  /** Number of assignment directories actually packaged. */
  packaged: number;
  /** Assignments whose local directory is missing on disk. */
  missing: string[];
}

/** Replaces whitespace with `_`, strips filesystem-unsafe and control
 *  characters, collapses repeats. Returns `'untitled'` for inputs that boil
 *  down to nothing usable. Used for tree-format folder names. */
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

/** Mirrors the convention from the tutor / student trees: the assignment
 *  files live in the repository at `directory` (or fall back to the example
 *  identifier / last path segment). */
function deriveAssignmentSubdirectory(content: CourseContentStudentList): string | undefined {
  const raw = (content as any)?.directory as string | undefined
    ?? content.submission_group?.example_identifier
    ?? content.path?.split('.').pop();
  if (!raw) { return undefined; }
  const normalized = path.normalize(raw).replace(/^([\\/]+)/, '');
  if (!normalized || normalized === '.' || normalized === '..') {
    return undefined;
  }
  const segments = normalized.split(/[\\/]+/).filter(seg => seg && seg !== '..');
  return segments.length > 0 ? segments.join(path.sep) : undefined;
}

function getRepoRoot(workspaceRoot: string, submissionGroup: SubmissionGroupStudentList | undefined | null): string | undefined {
  const fullPath = submissionGroup?.repository?.full_path;
  if (!fullPath) { return undefined; }
  const dirName = fullPath.replace(/\//g, '.');
  return buildStudentRepoRoot(workspaceRoot, dirName);
}

/** A content node is exportable if it has a submission_group (which is the
 *  practical signal that it's an assignment with cloneable files) regardless
 *  of how the kind / slug are spelled. Pure units don't get a submission_group. */
function isExportable(content: CourseContentStudentList): boolean {
  return content.submission_group != null && !!content.submission_group.repository?.full_path;
}

/** Builds the zip-internal path for a content node in tree format by walking
 *  its dotted `path` ancestors and joining sanitized titles. */
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
    const candidate = ancestor?.title ?? fallback;
    segments.push(sanitizeContentDirName(candidate));
  }
  return segments.join('/');
}

/** Recursively packages a directory into the zip under `zipBasePath`,
 *  skipping git / IDE / OS metadata files via `shouldExcludeExampleEntry` and
 *  also any entry whose name starts with `.` (catches things the shared
 *  exclude list misses, e.g. `.envrc`). */
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

  for (const content of input.contents) {
    if (!isExportable(content)) { continue; }
    const submissionGroup = content.submission_group;
    const repoRoot = getRepoRoot(input.workspaceRoot, submissionGroup);
    if (!repoRoot) { continue; }

    const subdir = deriveAssignmentSubdirectory(content);
    const sourcePath = subdir ? path.join(repoRoot, subdir) : repoRoot;

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
      ? sanitizeContentDirName(submissionGroup?.example_identifier || subdir || content.title || content.path)
      : buildTreePath(content, byPath);

    if (!zipBasePath) { continue; }

    addDirectoryToZip(zip, sourcePath, zipBasePath);
    packaged += 1;
  }

  return { zip, packaged, missing };
}
