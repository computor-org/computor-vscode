/**
 * Session-wide record of course repositories whose push credential is broken
 * AND could not be repaired automatically (issue #332). Written by the
 * provisioning sync (which probes auth and self-heals first) and by the
 * credential-refresh paths; read by the student tree to render the ⚠ badge.
 * Keyed by the repo's local root path.
 */
const failingRepos = new Set<string>();

export const PushHealthRegistry = {
  markFailing(repoRoot: string): void {
    failingRepos.add(repoRoot);
  },
  markHealthy(repoRoot: string): void {
    failingRepos.delete(repoRoot);
  },
  isFailing(repoRoot: string): boolean {
    return failingRepos.has(repoRoot);
  },
  /** Test hook. */
  clear(): void {
    failingRepos.clear();
  }
};
