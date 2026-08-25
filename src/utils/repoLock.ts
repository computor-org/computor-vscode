import * as path from 'path';

/**
 * Serializes git operations per repository.
 *
 * Several things reach for the same clone at once: the startup sync, the
 * refresh command, tree-expansion setup, the clone commands, and two
 * fire-and-forget credential rewriters that run `git remote set-url` while a
 * fetch is in flight. Interleaved, they corrupt each other — one run stashes the
 * other's half-merged state, or strips the upstream remote mid-fetch.
 *
 * A promise chain per path is enough: git operations are async but the extension
 * host is single-threaded, so there is no lost-update race in claiming a slot.
 * Locks are keyed on the resolved path so `/x/repo` and `/x/./repo` share one.
 */
const chains = new Map<string, Promise<unknown>>();

export function withRepoLock<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(repoPath);
  const previous = chains.get(key) ?? Promise.resolve();

  // Swallow the predecessor's rejection: waiting our turn must not fail because
  // the operation before us did.
  const result = previous.then(operation, operation);

  // Keep the chain alive regardless of outcome, and drop it once this is the
  // last waiter so the map does not grow for the life of the session.
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) {
      chains.delete(key);
    }
  });

  return result;
}

/** Whether an operation is currently queued or running for this repository. */
export function isRepoLocked(repoPath: string): boolean {
  return chains.has(path.resolve(repoPath));
}

/** Test hook. */
export function clearRepoLocks(): void {
  chains.clear();
}
