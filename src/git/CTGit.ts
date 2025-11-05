import * as vscode from 'vscode';
import * as path from 'path';
import { SimpleGit } from 'simple-git';
import { createSimpleGit } from './simpleGitFactory';

function openFileInMergeEditor(filePath: string): void {
  void vscode.workspace.openTextDocument(filePath).then((document) => {
    void vscode.window.showTextDocument(document);
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
    await this.simpleGit.fetch(['--all']);
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
      void vscode.window.showErrorMessage(`Your repository has unresolved conflicts in:\n${conflicts.join('\n')}`);
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

      void vscode.window.showInformationMessage(
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
        void vscode.window.showInformationMessage('Merge conflicts were resolved by keeping your local changes.');
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
        void vscode.window.showWarningMessage(
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

  async forkUpdate(
    remoteUrl: string,
    options?: { defaultBranch?: string; removeRemote?: boolean; autoResolveConflicts?: boolean }
  ): Promise<{ updated: boolean; defaultBranch?: string; behindCount?: number }> {
    const remoteName = 'upstream';
    await this.ensureRemote(remoteName, remoteUrl);
    await this.simpleGit.fetch(remoteName);

    const defaultBranch = options?.defaultBranch
      ?? await this.detectDefaultBranch(remoteName, ['main', 'master']);
    const shouldRemoveRemote = options?.removeRemote ?? true;

    if (!defaultBranch) {
      if (shouldRemoveRemote) {
        await this.cleanupRemote(remoteName);
      }
      vscode.window.showWarningMessage('Unable to determine upstream default branch. Skipping fork update.');
      return { updated: false };  
    }

    const upstreamRef = `${remoteName}/${defaultBranch}`;

    let behindCount = 0;
    try {
      const revList = await this.simpleGit.raw(['rev-list', '--count', `HEAD..${upstreamRef}`]);
      behindCount = parseInt(revList.trim(), 10);
    } catch (error) {
      console.warn('[CTGit] Failed to check commit difference:', error);
    }

    if (!Number.isFinite(behindCount) || behindCount <= 0) {
      if (shouldRemoveRemote) {
        await this.cleanupRemote(remoteName);
      }
      return { updated: false, defaultBranch, behindCount: Number.isFinite(behindCount) ? behindCount : undefined };
    }

    const statusSummary = await this.simpleGit.status();
    const originalBranch = statusSummary.current || 'DETACHED';

    let switchedBranch: string | undefined;
    let stashCreated = false;
    let mergeCompleted = false;

    try {
      try {
        const stashResult = await this.simpleGit.stash();
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
        await this.simpleGit.raw(['merge', '--no-edit', upstreamRef]);
        mergeCompleted = true;
      } catch (mergeError) {
        console.warn('[CTGit] Merge from upstream failed:', mergeError);
        const conflicts = await this.hasUnmergedPaths();
        if (conflicts.length === 0) {
          throw mergeError;
        }

        const resolvedAutomatically = await this.resolveConflictsAutomatically(conflicts);
        console.log("[][][] " + resolvedAutomatically);
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
              void vscode.window.showInformationMessage(
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
          vscode.window.showWarningMessage('Failed to push merged changes to origin. Please push manually.');
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

      if (shouldRemoveRemote) {
        await this.cleanupRemote(remoteName);
      }
    }

    return { updated: mergeCompleted, defaultBranch, behindCount };
  }
}
