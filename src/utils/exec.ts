import { exec, ExecOptions } from 'child_process';
import { promisify } from 'util';
import type { CancellationToken } from 'vscode';
import { redactGitCredentials } from './gitUrlHelpers';
import { GitCancelledError, GitTimeoutError } from '../exceptions/errors/GitExecError';

/**
 * Promisified version of exec for async/await usage
 */
export const execAsync = promisify(exec);

interface ExecWithTimeoutOptions extends ExecOptions {
  timeout?: number;
  cancellationToken?: CancellationToken;
}

export function execAsyncWithTimeout(
  command: string,
  options: ExecWithTimeoutOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const { timeout, cancellationToken, ...execOptions } = options;

  // A git command may carry a credential in the URL (`https://user:token@host`).
  // Every rejection path below echoes the command (GitTimeoutError/GitCancelledError
  // build their message from it; the Node exec error's .message/.cmd embed it), so
  // scrub credentials here — the single chokepoint — before the error propagates to
  // any logger or notification.
  const safeCommand = redactGitCredentials(command);

  return new Promise((resolve, reject) => {
    if (cancellationToken?.isCancellationRequested) {
      reject(new GitCancelledError(safeCommand));
      return;
    }

    const child = exec(command, { ...execOptions, ...(timeout ? { timeout } : {}) }, (error, stdout, stderr) => {
      cancellationListener?.dispose();
      if (error) {
        if (error.killed && timeout && !cancellationToken?.isCancellationRequested) {
          reject(new GitTimeoutError(safeCommand, timeout));
        } else if (error.killed && cancellationToken?.isCancellationRequested) {
          reject(new GitCancelledError(safeCommand));
        } else {
          if (typeof error.message === 'string') { error.message = redactGitCredentials(error.message); }
          const cmdBearing = error as { cmd?: string };
          if (typeof cmdBearing.cmd === 'string') { cmdBearing.cmd = redactGitCredentials(cmdBearing.cmd); }
          reject(error);
        }
        return;
      }
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
    });

    const cancellationListener = cancellationToken?.onCancellationRequested(() => {
      child.kill();
    });
  });
}