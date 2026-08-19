import { execAsyncWithTimeout } from '../utils/exec';

/**
 * What a student repo's git state means for the tree badges (issue #332): which
 * files carry uncommitted edits, which files sit in commits that never reached
 * the server, and how many commits those are. Read-only — git stays the single
 * source of truth; this module only reports what it says.
 */
export interface RepoWorkState {
  /** Repo-relative paths with uncommitted changes (staged, unstaged, untracked). */
  dirtyPaths: string[];
  /** Repo-relative paths touched by commits not yet pushed to upstream. */
  unpushedPaths: string[];
  /** Commits ahead of upstream (0 when everything is pushed or no upstream exists). */
  aheadCount: number;
}

export const EMPTY_WORK_STATE: RepoWorkState = { dirtyPaths: [], unpushedPaths: [], aheadCount: 0 };

/** Paths out of `git status --porcelain` output; renames yield the new name. */
export function parsePorcelainStatus(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length < 4) {
      continue;
    }
    let p = line.slice(3);
    const renameArrow = p.indexOf(' -> ');
    if (renameArrow >= 0) {
      p = p.slice(renameArrow + 4);
    }
    paths.push(unquote(p));
  }
  return paths;
}

/**
 * Parse `git log <upstream>..HEAD --name-only --pretty=format:%H`: commit
 * hashes count towards `aheadCount`, everything else is a touched path.
 */
export function parseUnpushedLog(stdout: string): { paths: string[]; aheadCount: number } {
  const paths = new Set<string>();
  let aheadCount = 0;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (/^[0-9a-f]{40}$/.test(line)) {
      aheadCount++;
    } else {
      paths.add(unquote(line));
    }
  }
  return { paths: [...paths], aheadCount };
}

/** Does any of the repo-relative `paths` live under `relDir` (also repo-relative)? */
export function pathsTouchDirectory(relDir: string, paths: string[]): boolean {
  const prefix = relDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  return paths.some((p) => {
    const normalized = p.replace(/\\/g, '/');
    return normalized === prefix.slice(0, -1) || normalized.startsWith(prefix);
  });
}

/** Read the repo's work state; git failures degrade to the empty state. */
export async function readRepoWorkState(repoRoot: string): Promise<RepoWorkState> {
  const state: RepoWorkState = { dirtyPaths: [], unpushedPaths: [], aheadCount: 0 };

  try {
    const { stdout } = await execAsyncWithTimeout('git status --porcelain', { cwd: repoRoot, timeout: 15_000 });
    state.dirtyPaths = parsePorcelainStatus(stdout);
  } catch (err) {
    console.warn(`[repoWorkState] git status failed for ${repoRoot}:`, err);
  }

  try {
    // `@{upstream}` errors when the branch tracks nothing — then there is no
    // "pushed" to compare against and unpushed stays empty.
    const { stdout } = await execAsyncWithTimeout(
      'git log @{upstream}..HEAD --name-only --pretty=format:%H',
      { cwd: repoRoot, timeout: 15_000 }
    );
    const { paths, aheadCount } = parseUnpushedLog(stdout);
    state.unpushedPaths = paths;
    state.aheadCount = aheadCount;
  } catch {
    // No upstream (or no commits) — nothing to report as unpushed.
  }

  return state;
}

/** git quotes paths with special characters as "..." with C-style escapes. */
function unquote(p: string): string {
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) {
    try {
      return JSON.parse(p);
    } catch {
      return p.slice(1, -1);
    }
  }
  return p;
}
