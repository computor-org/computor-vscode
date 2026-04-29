import * as vscode from 'vscode';

const DEFAULT_TIMEOUT_MS = 60_000;
const inFlightKeys = new Set<string>();

export interface ProgressLockOptions {
  /** Unique key — concurrent attempts with the same key are blocked. */
  key: string;
  /** Notification title shown while work runs. */
  title: string;
  /** Friendly message shown when a duplicate click is rejected. Omit to silently ignore. */
  duplicateMessage?: string;
  /** Hard cap on lock + progress duration. Defaults to 60 s. */
  timeoutMs?: number;
}

/**
 * Run `work` under a non-cancellable progress notification with a per-key
 * in-flight guard. Re-clicking the same `key` while work is running is a
 * no-op (or a friendly toast if `duplicateMessage` is set). The lock is
 * released as soon as work resolves/rejects, or after `timeoutMs` as a
 * safety net for hung calls.
 *
 * Returns the result of `work`, or `undefined` if a duplicate click was
 * rejected.
 */
export async function runLockedWithProgress<T>(
  options: ProgressLockOptions,
  work: () => Promise<T>
): Promise<T | undefined> {
  if (inFlightKeys.has(options.key)) {
    if (options.duplicateMessage) {
      void vscode.window.showInformationMessage(options.duplicateMessage);
    }
    return undefined;
  }

  inFlightKeys.add(options.key);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: false,
        title: options.title
      },
      async () => {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error('Operation timed out'));
          }, timeoutMs);
        });
        try {
          return await Promise.race([work(), timeoutPromise]);
        } finally {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
        }
      }
    );
  } finally {
    inFlightKeys.delete(options.key);
  }
}
