import { exec, ExecOptions } from 'child_process';
import { promisify } from 'util';
import type { CancellationToken } from 'vscode';

/**
 * Promisified version of exec for async/await usage
 */
export const execAsync = promisify(exec);

export class GitTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`Git operation timed out after ${timeoutMs / 1000}s: ${command}`);
    this.name = 'GitTimeoutError';
  }
}

export class GitCancelledError extends Error {
  constructor(command: string) {
    super(`Git operation cancelled: ${command}`);
    this.name = 'GitCancelledError';
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

  return new Promise((resolve, reject) => {
    if (cancellationToken?.isCancellationRequested) {
      reject(new GitCancelledError(command));
      return;
    }

    const child = exec(command, { ...execOptions, ...(timeout ? { timeout } : {}) }, (error, stdout, stderr) => {
      cancellationListener?.dispose();
      if (error) {
        if (error.killed && timeout && !cancellationToken?.isCancellationRequested) {
          reject(new GitTimeoutError(command, timeout));
        } else if (error.killed && cancellationToken?.isCancellationRequested) {
          reject(new GitCancelledError(command));
        } else {
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