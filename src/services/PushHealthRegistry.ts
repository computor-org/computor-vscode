/**
 * Session-wide record of course repositories that are not in a healthy state
 * with their remote. Keyed by the repo's local root path; read by the student
 * tree to render the ⚠ badge.
 *
 * Two distinct problems, because they need different words in the UI:
 *
 *   'push' — the push credential is broken AND could not be repaired
 *            automatically (issue #332). The student's work is committed but
 *            not reaching the server.
 *   'sync' — fetch or pull failed, so the local copy may be out of date. This
 *            used to be swallowed entirely: a student could keep working
 *            against a stale base, and a tutor could grade one, with nothing on
 *            screen to say so.
 *
 * Written by the provisioning sync (which probes auth and self-heals first) and
 * by the credential-refresh and update paths.
 */
export type RepoHealthProblem = 'push' | 'sync';

const unhealthyRepos = new Map<string, RepoHealthProblem>();

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn('[PushHealthRegistry] listener failed:', error);
    }
  }
}

export const PushHealthRegistry = {
  /** Record a problem. 'push' outranks 'sync': it is the more actionable one. */
  markFailing(repoRoot: string, problem: RepoHealthProblem = 'push'): void {
    const existing = unhealthyRepos.get(repoRoot);
    if (existing === 'push' && problem === 'sync') {
      return;
    }
    if (existing === problem) {
      return;
    }
    unhealthyRepos.set(repoRoot, problem);
    notifyChanged();
  },
  markHealthy(repoRoot: string): void {
    if (unhealthyRepos.delete(repoRoot)) {
      notifyChanged();
    }
  },
  isFailing(repoRoot: string): boolean {
    return unhealthyRepos.has(repoRoot);
  },
  problem(repoRoot: string): RepoHealthProblem | undefined {
    return unhealthyRepos.get(repoRoot);
  },
  /**
   * Subscribe to changes so a tree can refresh its badges. Nothing used to fire
   * when the registry mutated, so a repo could go bad and the badge only
   * appeared on the next unrelated refresh.
   */
  onDidChange(listener: Listener): { dispose: () => void } {
    listeners.add(listener);
    return { dispose: () => { listeners.delete(listener); } };
  },
  /** Test hook. */
  clear(): void {
    unhealthyRepos.clear();
    listeners.clear();
  }
};
