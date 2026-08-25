import * as path from 'path';
import { createSimpleGit } from '../git/simpleGitFactory';
import type { ComputorApiService } from '../services/ComputorApiService';

/**
 * Which files of an assignment were part of an official submission.
 *
 * A student may delete or move anything in their repository — that is their
 * work — but doing it to a file they have already handed in deserves a question
 * first (computor-org/issues#352). Answering it needs more than "this file was
 * saved once": the interesting question is whether the file was *in* a
 * submission, which is exactly whether it exists in the commit a submission
 * recorded.
 *
 * Every official submission carries the commit it was made from
 * (`version_identifier`), and that commit is immutable — so its file listing is
 * cached for the session and each repository is asked at most once per commit.
 */

/** Paths of one submitted commit, by `<repoRoot>\0<commit>`. */
const treeCache = new Map<string, Set<string>>();

/** Submitted commits per submission group, by group id. */
const commitCache = new Map<string, string[]>();

function treeKey(repoRoot: string, commit: string): string {
  return `${repoRoot}\0${commit}`;
}

/** The commits official submissions were made from, newest first. */
async function submittedCommits(
  submissionGroupId: string,
  apiService: ComputorApiService
): Promise<string[]> {
  const cached = commitCache.get(submissionGroupId);
  if (cached) {
    return cached;
  }

  const artifacts = await apiService.listSubmissionArtifacts(submissionGroupId, { submit: true });
  const commits = Array.from(
    new Set(
      (artifacts ?? [])
        .filter((artifact) => artifact.submit !== false)
        .map((artifact) => artifact.version_identifier)
        .filter((commit): commit is string => typeof commit === 'string' && commit.length > 0)
    )
  );

  // Only cached once there is an answer to cache: an API hiccup must not make
  // every later question in this session answer "nothing was submitted".
  if (artifacts !== undefined) {
    commitCache.set(submissionGroupId, commits);
  }
  return commits;
}

/** Every path a commit contains, or an empty set when the commit is unknown here. */
async function pathsInCommit(repoRoot: string, commit: string): Promise<Set<string>> {
  const key = treeKey(repoRoot, commit);
  const cached = treeCache.get(key);
  if (cached) {
    return cached;
  }

  const paths = new Set<string>();
  try {
    const git = createSimpleGit({ baseDir: repoRoot, maxConcurrentProcesses: 6, trimmed: false });
    // `-z` so paths needing quoting come back raw, as in CTGit's template
    // restore; the listing is compared against on-disk paths.
    const listing = await git.raw(['ls-tree', '-r', '--name-only', '-z', commit]);
    for (const entry of listing.split('\0')) {
      if (entry.length > 0) {
        paths.add(entry);
      }
    }
  } catch {
    // A commit the local clone does not have (submitted from elsewhere, or the
    // repo was re-cloned) tells us nothing. Cached as empty all the same: it
    // will not appear on a later fetch either, and asking git again per click
    // would only cost time.
  }

  treeCache.set(key, paths);
  return paths;
}

/** Repository-relative, forward-slashed — the shape `ls-tree` reports. */
function repoRelative(repoRoot: string, target: string): string | undefined {
  const relative = path.relative(repoRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join('/');
}

export interface SubmittedCheck {
  /** Whether the path (or, for a folder, anything inside it) was submitted. */
  submitted: boolean;
  /** Submitted files inside a folder, for naming them in the question. */
  paths: string[];
}

/**
 * Whether `target` was part of an official submission of `submissionGroupId`.
 *
 * A folder counts as submitted when any file under it does. Never throws: a
 * guard that cannot answer must not block the operation it guards, so every
 * failure reports "not submitted" and the action proceeds as before.
 */
export async function checkSubmitted(
  repoRoot: string,
  target: string,
  submissionGroupId: string | undefined,
  apiService: ComputorApiService,
  options: { isDirectory?: boolean } = {}
): Promise<SubmittedCheck> {
  const none: SubmittedCheck = { submitted: false, paths: [] };
  if (!submissionGroupId) {
    return none;
  }

  const relative = repoRelative(repoRoot, target);
  if (relative === undefined) {
    return none;
  }

  try {
    const commits = await submittedCommits(submissionGroupId, apiService);
    if (commits.length === 0) {
      return none;
    }

    const matches = new Set<string>();
    const prefix = `${relative}/`;
    for (const commit of commits) {
      for (const submittedPath of await pathsInCommit(repoRoot, commit)) {
        if (options.isDirectory ? submittedPath.startsWith(prefix) : submittedPath === relative) {
          matches.add(submittedPath);
        }
      }
    }

    return { submitted: matches.size > 0, paths: Array.from(matches).sort() };
  } catch (error) {
    console.warn('Could not determine whether the file was submitted:', error);
    return none;
  }
}

/**
 * Sentence for a confirmation dialog, or undefined when nothing was submitted.
 *
 * Written to say what is at stake rather than to scare: the student is allowed
 * to do this, and the template restore is how a fresh copy comes back.
 */
export function submittedWarning(check: SubmittedCheck, isDirectory: boolean): string | undefined {
  if (!check.submitted) {
    return undefined;
  }
  if (!isDirectory) {
    return 'This file was part of a submission you already handed in.';
  }
  const count = check.paths.length;
  return count === 1
    ? `It contains ${check.paths[0]}, which was part of a submission you already handed in.`
    : `It contains ${count} files that were part of a submission you already handed in.`;
}

/** Forget everything cached — for tests, and after a repository is re-cloned. */
export function clearSubmittedCache(): void {
  treeCache.clear();
  commitCache.clear();
}
