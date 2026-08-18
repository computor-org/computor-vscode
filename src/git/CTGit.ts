import * as vscode from 'vscode';
import { showOptions } from '../ui/editorLayout';
import * as fs from 'fs';
import * as path from 'path';
import { SimpleGit } from 'simple-git';
import { createSimpleGit } from './simpleGitFactory';
import { notify } from '../utils/notify';

function openFileInMergeEditor(filePath: string): void {
  void vscode.workspace.openTextDocument(filePath).then((document) => {
    // A conflicted file is a file to edit, so it belongs in the source group
    // rather than wherever focus happened to be (computor-org/issues#286).
    void vscode.window.showTextDocument(document, showOptions(filePath));
  });
}

export class CTGit {
  private readonly repoPath: string;
  private readonly simpleGit: SimpleGit;

  constructor(repoPath: string) {
    this.repoPath = repoPath;

    this.simpleGit = createSimpleGit({
      baseDir: this.repoPath,
      maxConcurrentProcesses: 6,
      trimmed: false
    });
  }

  async hasUnmergedPaths(): Promise<string[]> {
    const status = await this.simpleGit.status();
    return status.conflicted;
  }

  async fetch(): Promise<void> {
    // Spelled out as a raw command on purpose: simple-git's `fetch()` drops a
    // remote name unless a branch is passed with it, so anything but the
    // trailing-options form silently fetches something else. See forkUpdate.
    await this.simpleGit.raw(['fetch', '--all']);
  }

  async pull(): Promise<void> {
    await this.simpleGit.pull(['--ff-only']);
  }

  private buildCheckoutTargets(paths?: string[]): string[] {
    if (!paths || paths.length === 0) {
      return ['.'];
    }
    return paths;
  }

  private async stagePaths(paths?: string[]): Promise<void> {
    if (!paths || paths.length === 0) {
      console.log('[CTGit] Staging all changes');
      await this.simpleGit.raw(['add', '--all']);
      return;
    }

    console.log('[CTGit] Staging paths:', paths);
    await this.simpleGit.raw(['add', '--', ...paths]);
  }

  async resolveConflictsUsingTheirs(paths?: string[]): Promise<void> {
    const targets = this.buildCheckoutTargets(paths);
    await this.simpleGit.raw(['checkout', '--theirs', ...targets]);
    await this.stagePaths(paths);
  }

  async resolveConflictsUsingOurs(paths?: string[]): Promise<void> {
    const targets = this.buildCheckoutTargets(paths);
    await this.simpleGit.raw(['checkout', '--ours', ...targets]);
    await this.stagePaths(paths);
  }

  private async ensureRemote(remoteName: string, remoteUrl: string): Promise<void> {
    try {
      await this.simpleGit.addRemote(remoteName, remoteUrl);
    } catch {
      await this.simpleGit.remote(['set-url', remoteName, remoteUrl]);
    }
  }

  /** Fetch URL currently configured for `remoteName`, or undefined if the
   * repository has no such remote. */
  private async remoteFetchUrl(remoteName: string): Promise<string | undefined> {
    try {
      const remotes = await this.simpleGit.getRemotes(true);
      return remotes.find(remote => remote.name === remoteName)?.refs?.fetch || undefined;
    } catch (error) {
      console.warn(`[CTGit] Failed to read the URL of remote ${remoteName}:`, error);
      return undefined;
    }
  }

  private parseDefaultBranch(remoteInfo: string): string | undefined {
    const match = /HEAD branch:\s*(.+)/.exec(remoteInfo);
    return match && match[1] ? match[1].trim() : undefined;
  }

  private async detectDefaultBranch(remoteName: string, fallback: string[]): Promise<string | undefined> {
    try {
      const remoteInfo = await this.simpleGit.raw(['remote', 'show', remoteName]);
      const detected = this.parseDefaultBranch(remoteInfo);
      if (detected) {
        return detected;
      }
    } catch (error) {
      console.warn(`[CTGit] Failed to inspect remote ${remoteName}:`, error);
    }

    for (const candidate of fallback) {
      try {
        await this.simpleGit.revparse([`refs/remotes/${remoteName}/${candidate}`]);
        return candidate;
      } catch {
        // Continue searching
      }
    }

    return undefined;
  }

  private async promptForConflictResolution(conflicts: string[]): Promise<'ours' | 'theirs' | 'editor' | 'abort'> {
    const mergeOptions = [
      { label: 'Use ours (apply your local changes)', value: 'ours' as const },
      { label: 'Use theirs (accept upstream changes)', value: 'theirs' as const },
      { label: 'Resolve in merge editor', value: 'editor' as const },
      { label: 'Abort', value: 'abort' as const }
    ];

    const selection = await vscode.window.showQuickPick(mergeOptions, {
      canPickMany: false,
      title: 'Merge conflicts detected. How would you like to proceed?'
    });

    if (!selection) {
      return 'abort';
    }

    if (selection.value === 'editor') {
      for (const file of conflicts) {
        openFileInMergeEditor(path.join(this.repoPath, file));
      }
      void notify.error(`Your repository has unresolved conflicts in:\n${conflicts.join('\n')}`);
    }

    return selection.value;
  }

  private async applyLatestStash(): Promise<void> {
    try {
      const stashList = await this.simpleGit.stashList();
      const latest = stashList.latest?.hash;
      if (latest) {
        await this.simpleGit.raw(['stash', 'apply', latest]);
      }
    } catch (error) {
      console.warn('[CTGit] Failed to apply stash:', error);
    }
  }

  private async autoResolveDeletedByThemConflicts(conflicts: string[]): Promise<boolean> {
    void conflicts; // Currently unused - we fetch fresh status
    try {
      const status = await this.simpleGit.status();
      const deletedByThem = Array.from(new Set(
        status.files
          .filter(file => file.index === 'U' && file.working_dir === 'D')
          .map(file => file.path)
          .filter((filePath): filePath is string => Boolean(filePath))
      ));

      if (deletedByThem.length === 0) {
        return false;
      }

      console.log('[CTGit] Auto-resolving "deleted by them" conflicts for:', deletedByThem);
      await this.resolveConflictsUsingOurs(deletedByThem);

      const remainingConflicts = await this.hasUnmergedPaths();
      if (remainingConflicts.length > 0) {
        console.warn('[CTGit] Conflicts remain after auto-resolving deletions:', remainingConflicts);
        return false;
      }

      void notify.info(
        'Upstream removed assignment files you modified. Your local versions were kept to preserve your work.'
      );
      return true;
    } catch (error) {
      console.warn('[CTGit] Failed to auto-resolve deleted-by-upstream conflicts:', error);
      return false;
    }
  }

  private async resolveConflictsAutomatically(conflicts: string[]): Promise<boolean> {
    const keptDeletedFiles = await this.autoResolveDeletedByThemConflicts(conflicts);
    if (keptDeletedFiles) {
      return true;
    }

    let remaining = await this.hasUnmergedPaths();
    if (remaining.length === 0) {
      return true;
    }

    try {
      console.log('[CTGit] Attempting to resolve conflicts by keeping local changes:', remaining);
      await this.resolveConflictsUsingOurs(remaining);
      remaining = await this.hasUnmergedPaths();
      if (remaining.length === 0) {
        void notify.info('Merge conflicts were resolved by keeping your local changes.');
        return true;
      }
    } catch (error) {
      console.warn('[CTGit] Failed to resolve conflicts using ours:', error);
    }

    remaining = await this.hasUnmergedPaths();
    if (remaining.length === 0) {
      return true;
    }

    try {
      console.log('[CTGit] Falling back to upstream changes to resolve conflicts:', remaining);
      await this.resolveConflictsUsingTheirs(remaining);
      remaining = await this.hasUnmergedPaths();
      if (remaining.length === 0) {
        void notify.warning(
          'Conflicting files were replaced with upstream versions to finish the merge.'
        );
        return true;
      }
    } catch (error) {
      console.warn('[CTGit] Failed to resolve conflicts using theirs:', error);
    }

    remaining = await this.hasUnmergedPaths();
    if (remaining.length === 0) {
      return true;
    }

    console.warn('[CTGit] Automatic conflict resolution failed. Remaining conflicts:', remaining);
    return false;
  }

  private async forceResolveRemainingConflicts(conflicts: string[]): Promise<void> {
    if (conflicts.length === 0) {
      return;
    }

    try {
      console.warn('[CTGit] Forcing conflict resolution by keeping local versions:', conflicts);
      await this.resolveConflictsUsingOurs(conflicts);
    } catch (error) {
      console.warn('[CTGit] Force keep ours failed, falling back to theirs:', error);
    }

    let remaining = await this.hasUnmergedPaths();
    if (remaining.length === 0) {
      return;
    }

    try {
      console.warn('[CTGit] Accepting upstream versions to clear conflicts:', remaining);
      await this.resolveConflictsUsingTheirs(remaining);
    } catch (error) {
      console.warn('[CTGit] Force keep theirs failed:', error);
    }

    remaining = await this.hasUnmergedPaths();
    if (remaining.length === 0) {
      return;
    }

    console.warn('[CTGit] Conflicts persisted after force resolution. Staging all to ensure clean state.');
    try {
      await this.simpleGit.raw(['add', '--all']);
    } catch (error) {
      console.warn('[CTGit] Failed to stage all files during forced resolution:', error);
    }
  }

  private async cleanupRemote(remoteName: string): Promise<void> {
    try {
      await this.simpleGit.removeRemote(remoteName);
    } catch {
      // Ignore cleanup issues
    }
  }

  /**
   * Undo whatever {@link ensureRemote} did to `remoteName`.
   *
   * A remote the repository already owned is kept and only has its URL put
   * back — `ensureRemote` overwrote it with a credential-carrying one. Repos
   * seeded from the course template keep the template linked as `upstream`
   * (see `StudentRepositoryProvisioningService.seedFromTemplateClone`), and
   * removing the remote would take its remote-tracking refs with it.
   */
  private async releaseRemote(
    remoteName: string,
    previousUrl: string | undefined,
    remove: boolean
  ): Promise<void> {
    if (previousUrl !== undefined) {
      try {
        await this.simpleGit.remote(['set-url', remoteName, previousUrl]);
      } catch (error) {
        console.warn(`[CTGit] Failed to restore the URL of remote ${remoteName}:`, error);
      }
      return;
    }

    if (remove) {
      await this.cleanupRemote(remoteName);
    }
  }

  async forkUpdate(
    remoteUrl: string,
    options?: { defaultBranch?: string; removeRemote?: boolean; autoResolveConflicts?: boolean }
  ): Promise<{ updated: boolean; defaultBranch?: string; behindCount?: number }> {
    const remoteName = 'upstream';

    // An unfinished merge (leftover MERGE_HEAD) would fail every git operation
    // below — abort it before starting.
    try {
      await fs.promises.access(path.join(this.repoPath, '.git', 'MERGE_HEAD'));
      console.warn('[CTGit] Unfinished merge detected. Aborting it before fork update.');
      try { await this.simpleGit.raw(['merge', '--abort']); } catch { /* best effort */ }
    } catch { /* no merge in progress */ }

    // Remember whether the repository already had this remote: one it owns is
    // restored rather than deleted once we are done (see releaseRemote).
    const previousRemoteUrl = await this.remoteFetchUrl(remoteName);
    await this.ensureRemote(remoteName, remoteUrl);
    // Spelled out as a raw command: `simpleGit.fetch(remoteName)` does NOT
    // fetch that remote. simple-git only passes the remote through when a
    // branch is given with it, so it degrades to a bare `git fetch` — origin
    // gets fetched, `refs/remotes/upstream/*` is never written, and every
    // comparison below fails.
    await this.simpleGit.raw(['fetch', remoteName]);

    const defaultBranch = options?.defaultBranch
      ?? await this.detectDefaultBranch(remoteName, ['main', 'master']);
    const shouldRemoveRemote = options?.removeRemote ?? true;

    if (!defaultBranch) {
      await this.releaseRemote(remoteName, previousRemoteUrl, shouldRemoveRemote);
      notify.warning('Unable to determine upstream default branch. Skipping fork update.');
      return { updated: false };
    }

    const upstreamRef = `${remoteName}/${defaultBranch}`;

    let behindCount: number;
    try {
      const revList = await this.simpleGit.raw(['rev-list', '--count', `HEAD..${upstreamRef}`]);
      behindCount = parseInt(revList.trim(), 10);
    } catch (error) {
      // NOT "already up to date": the template could not be compared against at
      // all. Reporting no-update here is exactly what hid the broken fetch
      // above, so this failure has to reach the caller.
      await this.releaseRemote(remoteName, previousRemoteUrl, shouldRemoveRemote);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to compare this repository against ${upstreamRef}: ${message}`);
    }

    if (!Number.isFinite(behindCount)) {
      await this.releaseRemote(remoteName, previousRemoteUrl, shouldRemoveRemote);
      throw new Error(`Failed to read how far behind ${upstreamRef} this repository is.`);
    }

    if (behindCount <= 0) {
      await this.releaseRemote(remoteName, previousRemoteUrl, shouldRemoveRemote);
      return { updated: false, defaultBranch, behindCount };
    }

    const statusSummary = await this.simpleGit.status();
    const originalBranch = statusSummary.current || 'DETACHED';

    let switchedBranch: string | undefined;
    let stashCreated = false;
    let mergeCompleted = false;

    try {
      try {
        // Include untracked files: a merge bringing in a file that exists
        // untracked locally would otherwise abort with "would be overwritten".
        const stashResult = await this.simpleGit.stash(['push', '--include-untracked']);
        stashCreated = !/No local changes to save/i.test(stashResult);
      } catch (stashError) {
        console.warn('[CTGit] Failed to stash local changes before fork update:', stashError);
      }

      if (originalBranch !== defaultBranch && originalBranch !== 'DETACHED') {
        const branches = await this.simpleGit.branch();
        if (!branches.all.includes(defaultBranch)) {
          try {
            await this.simpleGit.checkoutBranch(defaultBranch, `origin/${defaultBranch}`);
          } catch {
            await this.simpleGit.checkoutBranch(defaultBranch, upstreamRef);
          }
        } else {
          await this.simpleGit.checkout(defaultBranch);
        }

        switchedBranch = originalBranch;
      }

      try {
        await this.simpleGit.pull('origin', defaultBranch, { '--ff-only': null });
      } catch (pullError) {
        console.warn('[CTGit] Failed to fast-forward from origin:', pullError);
        try {
          await this.simpleGit.pull('origin', defaultBranch);
        } catch (nonFastForwardError) {
          console.warn('[CTGit] Pull with merge from origin failed:', nonFastForwardError);
        }
      }

      try {
        await this.simpleGit.raw(['merge', '--no-edit', '--allow-unrelated-histories', upstreamRef]);
        mergeCompleted = true;
      } catch (mergeError) {
        console.warn('[CTGit] Merge from upstream failed:', mergeError);
        const conflicts = await this.hasUnmergedPaths();
        if (conflicts.length === 0) {
          throw mergeError;
        }

        const resolvedAutomatically = await this.resolveConflictsAutomatically(conflicts);
        if (resolvedAutomatically) {
          mergeCompleted = true;
        } else {
          // If auto-resolve is enabled, force resolution without prompting
          if (options?.autoResolveConflicts) {
            console.log('[CTGit] Auto-resolving conflicts without user prompt');
            await this.forceResolveRemainingConflicts(conflicts);
            const remainingAfterForce = await this.hasUnmergedPaths();
            if (remainingAfterForce.length === 0) {
              mergeCompleted = true;
              void notify.info(
                'Fork updated successfully. Some conflicts were automatically resolved by keeping your local changes where possible.'
              );
            } else {
              throw new Error(`merge-unresolved: ${remainingAfterForce.length} conflicts could not be resolved automatically`);
            }
          } else {
            // Interactive mode - prompt user
            const resolution = await this.promptForConflictResolution(conflicts);

            if (resolution === 'ours') {
              await this.resolveConflictsUsingOurs();
              mergeCompleted = true;
            } else if (resolution === 'theirs') {
              await this.resolveConflictsUsingTheirs();
              mergeCompleted = true;
            } else if (resolution === 'editor') {
              throw new Error('merge-editor');
            } else {
              await this.simpleGit.raw(['merge', '--abort']);
              throw new Error('merge-abort');
            }
          }
        }
      }

      if (mergeCompleted) {
        let remainingConflicts = await this.hasUnmergedPaths();
        if (remainingConflicts.length > 0) {
          console.warn('[CTGit] Merge still has unresolved conflicts:', remainingConflicts);
          await this.forceResolveRemainingConflicts(remainingConflicts);
          remainingConflicts = await this.hasUnmergedPaths();
          if (remainingConflicts.length > 0) {
            console.warn('[CTGit] Conflicts persisted after forced resolution:', remainingConflicts);
            throw new Error('merge-unresolved');
          }
        }

        try {
          await this.simpleGit.commit('vscode: Merged from upstream');
        } catch (commitError) {
          const message = String(commitError ?? '');
          if (/nothing to commit/i.test(message)) {
            // Nothing staged; proceed
          } else if (/unmerged files/i.test(message)) {
            console.warn('[CTGit] Commit failed due to unresolved conflicts');
            throw new Error('merge-unresolved');
          } else {
            console.warn('[CTGit] Failed to commit merge result:', commitError);
            throw commitError;
          }
        }

        try {
          await this.simpleGit.push('origin', defaultBranch);
        } catch (pushError) {
          notify.warning('Failed to push merged changes to origin. Please push manually.');
          console.warn('[CTGit] Failed to push merge result:', pushError);
        }
      }
    } finally {
      if (switchedBranch) {
        try {
          await this.simpleGit.checkout(switchedBranch);
        } catch (checkoutError) {
          console.warn(`[CTGit] Failed to switch back to branch ${switchedBranch}:`, checkoutError);
        }
      }

      if (stashCreated) {
        await this.applyLatestStash();
      }

      await this.releaseRemote(remoteName, previousRemoteUrl, shouldRemoveRemote);
    }

    return { updated: mergeCompleted, defaultBranch, behindCount };
  }
}
