import { exec, ExecOptions } from 'child_process';
import { promisify } from 'util';
import type { CancellationToken } from 'vscode';
import { redactGitCredentials } from './gitUrlHelpers';
import { GitCancelledError, GitTimeoutError } from '../exceptions/errors/GitExecError';

const execPromise = promisify(exec);

/**
 * Scrub credentials from every field of a failed exec that can carry the command
 * back to a log or a notification.
 *
 * Node builds the rejection message as `Command failed: <the whole command>`, so
 * an error from a git call with `https://user:token@host` in it reproduces the
 * token verbatim — and `.stderr`/`.stdout` carry git's own output, which several
 * callers interpolate into user-facing messages and which the history-rewrite
 * classifier reads.
 */
export function redactExecError<T>(error: T): T {
  const bearer = error as { message?: unknown; cmd?: unknown; stderr?: unknown; stdout?: unknown };
  for (const field of ['message', 'cmd', 'stderr', 'stdout'] as const) {
    if (typeof bearer[field] === 'string') {
      bearer[field] = redactGitCredentials(bearer[field] as string);
    }
  }
  return error;
}

/**
 * Promisified version of exec for async/await usage.
 *
 * Prefer `execAsyncWithTimeout` for anything that talks to a remote: this has no
 * timeout and no cancellation. Both redact credentials from rejections.
 */
export async function execAsync(
  command: string,
  options: ExecOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execPromise(command, options);
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (error) {
    throw redactExecError(error);
  }
}

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
          reject(redactExecError(error));
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