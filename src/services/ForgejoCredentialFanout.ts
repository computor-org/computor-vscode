import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
import { execAsyncWithTimeout } from '../utils/exec';
import {
  addBasicCredentialsToGitUrl,
  extractOriginFromGitUrl,
  hasNonOAuthEmbeddedCredentials,
  redactGitCredentials,
  stripCredentialsFromGitUrl
} from '../utils/gitUrlHelpers';
import { tryWithRepoLock } from '../utils/repoLock';

/**
 * The backend mints ONE Forgejo clone token per user and git server and rotates
 * it on every provision call (computor-org/issues#318), so provisioning course B
 * silently kills the credential embedded in course A's origin remote — a push
 * from the Source Control panel then fails with a bare 401 (issue #332). The
 * flip side of "one token per server" is that one fresh token repairs every
 * clone on that server, which is what this module does after each provision.
 */

export interface PropagateForgejoCredentialOptions {
  serverUrl: string;
  username: string;
  token: string;
  /** Repo whose origin the caller already updated itself. */
  excludeRepoPath?: string;
  /** Overrides the workspace `student/` directory (for tests). */
  studentRoot?: string;
}

/**
 * Pure decision: rewrite this origin URL with the fresh clone credential?
 * Requires the same host as the Forgejo server AND an embedded basic (non
 * `oauth2:`) credential — so GitLab managed, external/BYO, credential-less and
 * other-host remotes are never touched.
 */
export function shouldRewriteOriginForForgejo(originUrl: string, serverUrl: string): boolean {
  const repoOrigin = extractOriginFromGitUrl(originUrl);
  const serverOrigin = extractOriginFromGitUrl(serverUrl);
  if (!repoOrigin || !serverOrigin || repoOrigin !== serverOrigin) {
    return false;
  }
  return hasNonOAuthEmbeddedCredentials(originUrl);
}

/** Subdirectories of the `student/` root that contain a `.git` directory. */
export async function listStudentRepositories(studentRoot?: string): Promise<string[]> {
  const root = studentRoot ?? tryGetWorkspaceStudentRoot();
  if (!root) {
    return [];
  }
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .filter((repoPath) => fs.existsSync(path.join(repoPath, '.git')));
  } catch {
    return [];
  }
}

/**
 * Rewrite the origin remote of every local managed-Forgejo clone on `serverUrl`
 * to carry the fresh clone credential, preserving each repo's own URL path.
 * Failures are logged (redacted) and skipped. Returns how many were updated.
 */
export async function propagateForgejoCloneCredential(opts: PropagateForgejoCredentialOptions): Promise<number> {
  const repoPaths = await listStudentRepositories(opts.studentRoot);
  let updated = 0;

  for (const repoPath of repoPaths) {
    if (opts.excludeRepoPath && path.resolve(repoPath) === path.resolve(opts.excludeRepoPath)) {
      continue;
    }
    try {
      // This can land on a repo that is mid-fetch or mid-merge, so take its
      // lock before touching the remote — but only if it is free. The caller
      // may itself be holding another repository's lock (the 401-heal runs
      // inside one), and two heals queuing on each other's repositories would
      // deadlock. A busy sibling is skipped: its own operation re-mints a
      // broken credential on demand.
      const attempt = await tryWithRepoLock(repoPath, async () => {
        const { stdout } = await execAsyncWithTimeout('git remote get-url origin', { cwd: repoPath, timeout: 15_000 });
        const currentUrl = stdout.trim();
        if (!currentUrl || !shouldRewriteOriginForForgejo(currentUrl, opts.serverUrl)) {
          return false;
        }

        const bareUrl = stripCredentialsFromGitUrl(currentUrl);
        if (!bareUrl) {
          return false;
        }
        const authUrl = addBasicCredentialsToGitUrl(bareUrl, opts.username, opts.token);
        if (authUrl === currentUrl) {
          return false;
        }

        await execAsyncWithTimeout(`git remote set-url origin "${authUrl}"`, { cwd: repoPath, timeout: 15_000 });
        return true;
      });
      if (!attempt.ran) {
        console.log(`[ForgejoCredentialFanout] ${repoPath} is busy; leaving it to its own operation`);
        continue;
      }
      if (attempt.value) {
        updated++;
      }
    } catch (err: any) {
      console.warn(
        `[ForgejoCredentialFanout] Could not refresh origin of ${repoPath}:`,
        redactGitCredentials(err?.message || String(err))
      );
    }
  }

  if (updated > 0) {
    console.log(`[ForgejoCredentialFanout] Refreshed the clone credential of ${updated} sibling repositories on ${opts.serverUrl}`);
  }
  return updated;
}

function tryGetWorkspaceStudentRoot(): string | undefined {
  try {
    return WorkspaceStructureManager.getInstance().getDirectories().student;
  } catch {
    // No workspace open — nothing to enumerate.
    return undefined;
  }
}
