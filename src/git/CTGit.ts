import * as vscode from 'vscode';
import { openFile } from '../ui/editorLayout';
import * as fs from 'fs';
import * as path from 'path';
import { SimpleGit } from 'simple-git';
import { createSimpleGit } from './simpleGitFactory';
import { notify } from '../utils/notify';

function openFileInMergeEditor(filePath: string): void {
  // A conflicted file is a file to edit, so it belongs in the source group
  // rather than wherever focus happened to be (computor-org/issues#286).
  // Through `openFile` so a conflicted binary gets the editor its type asks
  // for instead of a text editor that cannot decode it.
  void openFile(filePath);
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

  /**
   * Restore the work stashed before a merge.
   *
   * Applying can genuinely fail — most often because the merge touched the very
   * files that were stashed — and that used to be swallowed with a console
   * warning. The student's in-progress edits simply disappeared from the working
   * tree, surviving only as a stash entry they had no reason to look for. So the
   * failure is now named, with the ref they need to recover it by hand.
   *
   * Uses `pop` rather than `apply`: pop drops the entry only when it applied
   * cleanly, and leaves it in place when it did not — which is exactly the
   * behaviour wanted here. The previous `apply` never dropped anything, so a
   * stash entry accumulated on every single sync.
   */
  private async applyLatestStash(): Promise<void> {
    try {
      const stashList = await this.simpleGit.stashList();
      if (!stashList.latest) {
        return;
      }
      // No ref argument: we stashed at the start of this operation and hold the
      // repository lock, so the most recent entry is ours.
      await this.simpleGit.raw(['stash', 'pop']);
    } catch (error) {
      console.warn('[CTGit] Failed to restore stash:', error);
      void notify.warning(
        `Your uncommitted changes could not be restored automatically after the update. ` +
        `They are safe in the git stash — run "git stash list" and "git stash pop" in the ` +
        `repository to get them back.`
      );
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

  /**
   * Resolve conflicts without asking, for the unattended sync path.
   *
   * "Ours" is safe — during a merge it keeps the student's own version — so it
   * runs automatically. "Theirs" REPLACES their committed work with upstream and
   * is therefore opt-in (`preferUpstreamOnConflict`). When ours is not enough the
   * honest outcome is to fail and let the caller abort the merge, which restores
   * the pre-merge state, rather than to finish the merge by discarding work.
   */
  private async resolveConflictsAutomatically(
    conflicts: string[],
    preferUpstreamOnConflict = false
  ): Promise<boolean> {
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
      remaining = await this.hasUnmergedPaths();
    }

    if (remaining.length === 0) {
      return true;
    }

    if (!preferUpstreamOnConflict) {
      console.warn('[CTGit] Conflicts need upstream versions to clear; not discarding local work:', remaining);
      return false;
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
      remaining = await this.hasUnmergedPaths();
    }

    if (remaining.length === 0) {
      return true;
    }

    console.warn('[CTGit] Automatic conflict resolution failed. Remaining conflicts:', remaining);
    return false;
  }

  /**
   * Last-ditch resolution after the user chose a strategy. Reports whether the
   * tree is actually clean rather than pretending.
   *
   * There used to be a final `git add --all` here "to ensure clean state".
   * Staging an unmerged path marks it resolved while the file on disk still
   * contains `<<<<<<<` markers — and `hasUnmergedPaths()` reads
   * `status().conflicted`, so it then reported nothing wrong and the marker-ridden
   * files were committed and pushed to the repository the student is graded on.
   */
  private async forceResolveRemainingConflicts(conflicts: string[]): Promise<boolean> {
    if (conflicts.length === 0) {
      return true;
    }

    try {
      console.warn('[CTGit] Forcing conflict resolution by keeping local versions:', conflicts);
      await this.resolveConflictsUsingOurs(conflicts);
    } catch (error) {
      console.warn('[CTGit] Force keep ours failed, falling back to theirs:', error);
    }

    let remaining = await this.hasUnmergedPaths();
    if (remaining.length === 0) {
      return true;
    }

    try {
      console.warn('[CTGit] Accepting upstream versions to clear conflicts:', remaining);
      await this.resolveConflictsUsingTheirs(remaining);
    } catch (error) {
      console.warn('[CTGit] Force keep theirs failed:', error);
    }

    remaining = await this.hasUnmergedPaths();
    return remaining.length === 0;
  }

  /** Return the tree to its pre-merge state; best effort, never masks the real error. */
  private async abortMergeQuietly(): Promise<void> {
    try {
      await this.simpleGit.raw(['merge', '--abort']);
    } catch (error) {
      console.warn('[CTGit] Could not abort the merge:', error);
    }
  }

  /**
   * Files that still contain conflict markers, checked against the working tree
   * rather than the index — a path can be staged (so git calls it resolved) while
   * the file on disk is still full of `<<<<<<<`.
   */
  private async filesWithConflictMarkers(): Promise<string[]> {
    let candidates: string[];
    try {
      const status = await this.simpleGit.status();
      candidates = Array.from(new Set(
        [...status.staged, ...status.modified, ...status.created]
          .filter((file): file is string => Boolean(file))
      ));
    } catch (error) {
      console.warn('[CTGit] Could not list files to scan for conflict markers:', error);
      return [];
    }

    const marked: string[] = [];
    for (const file of candidates) {
      try {
        const contents = await fs.promises.readFile(path.join(this.repoPath, file), 'utf-8');
        if (/^<{7} /m.test(contents) && /^>{7} /m.test(contents)) {
          marked.push(file);
        }
      } catch {
        // Binary, unreadable or already gone — nothing to assert about it.
      }
    }
    return marked;
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
    options?: {
      defaultBranch?: string;
      removeRemote?: boolean;
      /** Resolve conflicts without prompting. Keeps local work; never discards it. */
      autoResolveConflicts?: boolean;
      /**
       * Allow replacing the student's conflicting content with the upstream
       * version. Off by default: it discards committed work, so it has to be a
       * deliberate choice rather than a fallback the sync reaches on its own.
       */
      preferUpstreamOnConflict?: boolean;
    }
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

        const resolvedAutomatically = await this.resolveConflictsAutomatically(
          conflicts,
          options?.preferUpstreamOnConflict
        );
        if (resolvedAutomatically) {
          mergeCompleted = true;
        } else {
          // If auto-resolve is enabled, force resolution without prompting
          if (options?.autoResolveConflicts) {
            console.log('[CTGit] Auto-resolving conflicts without user prompt');
            const forced = await this.forceResolveRemainingConflicts(conflicts);
            if (forced) {
              mergeCompleted = true;
              void notify.info(
                'Fork updated successfully. Some conflicts were automatically resolved by keeping your local changes where possible.'
              );
            } else {
              // Abort so the working tree goes back to its pre-merge state
              // instead of being left half-merged for the next run to trip over.
              const remainingAfterForce = await this.hasUnmergedPaths();
              await this.abortMergeQuietly();
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

        // git considers a staged path resolved even when the file still holds
        // conflict markers. Committing that would push `<<<<<<<` into the
        // repository the student is graded on, so check the working tree itself.
        const markered = await this.filesWithConflictMarkers();
        if (markered.length > 0) {
          console.warn('[CTGit] Conflict markers remain in:', markered);
          await this.abortMergeQuietly();
          void notify.error(
            `The update was stopped because conflict markers were left in:\n${markered.join('\n')}\n` +
            `Your repository was returned to its previous state.`
          );
          throw new Error('merge-unresolved');
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

  /**
   * Put back every file the course template still has and this repository no
   * longer does, then commit and push.
   *
   * A merge cannot do this. Once a student deletes a template file and commits,
   * the merge base has it, our side dropped it and upstream never touched it —
   * git resolves that cleanly to "still deleted". And when the template has no
   * new commits at all, {@link forkUpdate} returns before it even touches the
   * working tree. So restoring is a separate pass, deliberately independent of
   * how far behind the template we are (computor-org/issues#352).
   *
   * Only *missing* paths are checked out, so work in every surviving file is
   * left exactly as it is. A student who wants a fresh copy of a file deletes
   * it and runs this.
   */
  async restoreMissingFromTemplate(
    remoteUrl: string,
    options?: { defaultBranch?: string; removeRemote?: boolean }
  ): Promise<{ restored: string[]; defaultBranch?: string; pushed: boolean }> {
    const remoteName = 'upstream';
    const previousRemoteUrl = await this.remoteFetchUrl(remoteName);
    const shouldRemoveRemote = options?.removeRemote ?? true;

    await this.ensureRemote(remoteName, remoteUrl);
    // Raw command: `simpleGit.fetch(remoteName)` does not fetch that remote.
    await this.simpleGit.raw(['fetch', remoteName]);

    const defaultBranch = options?.defaultBranch
      ?? await this.detectDefaultBranch(remoteName, ['main', 'master']);
    if (!defaultBranch) {
      await this.releaseRemote(remoteName, previousRemoteUrl, shouldRemoveRemote);
      throw new Error('Could not determine the course template’s default branch.');
    }

    const upstreamRef = `${remoteName}/${defaultBranch}`;

    try {
      // `-z` so paths with non-ASCII or quoting-worthy characters come back raw
      // rather than C-quoted, which would not resolve on disk.
      const listing = await this.simpleGit.raw(['ls-tree', '-r', '--name-only', '-z', upstreamRef]);
      const missing = listing
        .split('\0')
        .filter(line => line.length > 0)
        .filter(relPath => !fs.existsSync(path.join(this.repoPath, relPath)));

      if (missing.length === 0) {
        return { restored: [], defaultBranch, pushed: false };
      }

      // Batched: a course template can carry more paths than a single command
      // line holds, and `checkout -- <paths>` is all-or-nothing per invocation.
      for (const batch of chunk(missing, 100)) {
        await this.simpleGit.raw(['checkout', upstreamRef, '--', ...batch]);
        await this.stagePaths(batch);
      }
      await this.simpleGit.commit(`vscode: Restored ${missing.length} file(s) from the course template`);

      // Push whatever branch is actually checked out — the student may be on a
      // branch of their own, and pushing the template's default branch instead
      // would publish a ref they never touched.
      const current = (await this.simpleGit.status()).current;
      let pushed = false;
      if (!current || current === 'DETACHED') {
        notify.warning('Restored files were committed but not pushed: the repository has no branch checked out.');
      } else {
        try {
          await this.simpleGit.push('origin', current);
          pushed = true;
        } catch (pushError) {
          console.warn('[CTGit] Failed to push the restored files to origin:', pushError);
          notify.warning('Restored files could not be pushed to your repository. Please push manually.');
        }
      }

      return { restored: missing, defaultBranch, pushed };
    } finally {
      await this.releaseRemote(remoteName, previousRemoteUrl, shouldRemoveRemote);
    }
  }

  /**
   * Bring paths back from the last commit, undoing a deletion that has not been
   * committed yet (computor-org/issues#352).
   *
   * Unlike {@link restoreMissingFromTemplate} this restores the *student's* own
   * version rather than the template's, and commits nothing: undoing an
   * accidental delete should leave the repository exactly as it was a moment
   * before, including whether there was anything to commit.
   *
   * Paths are repository-relative and are checked out in batches, since a
   * folder can hold more of them than one command line takes.
   */
  async restorePathsFromHead(relativePaths: string[]): Promise<void> {
    if (relativePaths.length === 0) {
      return;
    }
    for (const batch of chunk(relativePaths, 100)) {
      await this.simpleGit.raw(['checkout', 'HEAD', '--', ...batch]);
    }
  }
}

/** Split `items` into runs of at most `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
