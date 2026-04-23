import type { CancellationToken } from 'vscode';
import { execAsyncWithTimeout } from '../utils/exec';

export interface ExecGitCloneOptions {
  /** Clone timeout in milliseconds. Defaults to 40s. */
  timeout?: number;
  cancellationToken?: CancellationToken;
  /** Working directory for the clone command (rarely needed). */
  cwd?: string;
  /**
   * @internal Override for tests. Callers SHOULD NOT supply this — the default
   * is `execAsyncWithTimeout` from `src/utils/exec.ts`. Carrying it as an
   * option avoids module-cache hacks in unit tests under either Node CJS or
   * Node ESM loader paths.
   */
  exec?: typeof execAsyncWithTimeout;
}

/**
 * Run `git clone <authenticatedUrl> <targetPath>` through execAsyncWithTimeout
 * with `GIT_TERMINAL_PROMPT=0` set so the process fails fast instead of
 * hanging on a stdin credential prompt. Assumes the URL already carries the
 * token; token refresh / prompting is the caller's responsibility.
 */
export async function execGitClone(
  authenticatedUrl: string,
  targetPath: string,
  options: ExecGitCloneOptions = {}
): Promise<void> {
  const exec = options.exec ?? execAsyncWithTimeout;
  await exec(
    `git clone "${authenticatedUrl}" "${targetPath}"`,
    {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: options.timeout ?? 40_000,
      cancellationToken: options.cancellationToken,
      cwd: options.cwd
    }
  );
}
