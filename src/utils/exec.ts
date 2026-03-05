import { exec, ExecOptions } from 'child_process';
import { promisify } from 'util';

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

export function execAsyncWithTimeout(
  command: string,
  options: ExecOptions & { timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  const { timeout, ...execOptions } = options;

  return new Promise((resolve, reject) => {
    const child = exec(command, { ...execOptions, ...(timeout ? { timeout } : {}) }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed && timeout) {
          reject(new GitTimeoutError(command, timeout));
        } else {
          reject(error);
        }
        return;
      }
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
    });

    void child;
  });
}