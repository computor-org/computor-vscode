import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const backupRootDir = '.backups';

function sanitizeTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[:.]/g, '-');
}

async function copyDirectoryExcludingGit(src: string, dest: string): Promise<void> {
  const stat = await fs.promises.stat(src);
  if (!stat.isDirectory()) {
    throw new Error(`Source path "${src}" is not a directory`);
  }

  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.git') {
      continue;
    }

    const sourceEntry = path.join(src, entry.name);
    const targetEntry = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryExcludingGit(sourceEntry, targetEntry);
    } else if (entry.isSymbolicLink()) {
      const linkTarget = await fs.promises.readlink(sourceEntry);
      await fs.promises.symlink(linkTarget, targetEntry);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(sourceEntry, targetEntry);
    }
  }
}

export async function createRepositoryBackup(
  repoPath: string,
  workspaceRoot: string,
  options?: { repoName?: string; timestamp?: Date }
): Promise<string | undefined> {
  try {
    const stats = await fs.promises.stat(repoPath);
    if (!stats.isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const repoName = options?.repoName || path.basename(repoPath);
  const timestamp = sanitizeTimestamp(options?.timestamp ?? new Date());
  const backupsRoot = path.join(workspaceRoot, backupRootDir);
  const backupPath = path.join(backupsRoot, `${repoName}_${timestamp}`);

  await fs.promises.mkdir(backupsRoot, { recursive: true });
  await fs.promises.rm(backupPath, { force: true, recursive: true });
  await copyDirectoryExcludingGit(repoPath, backupPath);

  return backupPath;
}

export function isHistoryRewriteError(error: any): boolean {
  const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
  const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  const combined = `${stderr}\n${stdout}\n${message}`.toLowerCase();

  // "not possible to fast-forward" is deliberately NOT listed: that is what
  // `git pull --ff-only` prints for an ordinary diverged branch (local commits
  // that were never pushed + origin moved on), which is a routine state — not a
  // reason to throw the repository away.
  return combined.includes('refusing to merge unrelated histories') ||
    combined.includes('fatal: unrelated histories');
}

/**
 * How the checked-out branch relates to its upstream.
 *
 * `unrelated` means the two have no common ancestor at all — the remote is a
 * different repository, which is the only case where recreating the clone can
 * be justified. Note that a force-push and an ordinary divergence are
 * indistinguishable by ancestry alone (in both, neither side contains the
 * other), so both report `diverged` and neither may be resolved destructively.
 */
export type RemoteRelation =
  | 'unrelated'
  | 'diverged'
  | 'behind'
  | 'ahead'
  | 'up-to-date'
  | 'unknown';

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoPath,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 15_000
  });
  return stdout.trim();
}

export async function classifyRemoteRelation(
  repoPath: string,
  upstreamRef?: string
): Promise<RemoteRelation> {
  try {
    const upstream =
      upstreamRef ||
      (await git(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']));
    if (!upstream) {
      return 'unknown';
    }

    let mergeBase: string;
    try {
      mergeBase = await git(repoPath, ['merge-base', 'HEAD', upstream]);
    } catch {
      // No common ancestor: git exits non-zero rather than printing a base.
      return 'unrelated';
    }
    if (!mergeBase) {
      return 'unrelated';
    }

    const head = await git(repoPath, ['rev-parse', 'HEAD']);
    const remote = await git(repoPath, ['rev-parse', upstream]);

    if (head === remote) {
      return 'up-to-date';
    }
    if (mergeBase === head) {
      return 'behind';
    }
    if (mergeBase === remote) {
      return 'ahead';
    }
    return 'diverged';
  } catch {
    return 'unknown';
  }
}
