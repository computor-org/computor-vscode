import * as path from 'path';
import * as vscode from 'vscode';
import { CTGit } from '../git/CTGit';
import type { ComputorApiService } from '../services/ComputorApiService';
import type { StudentCourseContentTreeProvider } from './tree/student/StudentCourseContentTreeProvider';
import { notify } from '../utils/notify';
import { checkSubmitted } from '../utils/submittedFiles';

/**
 * Noticing when a file that was already handed in disappears
 * (computor-org/issues#352).
 *
 * The tree's own Delete and Move ask before they act. Nothing can ask for a
 * delete made in the file explorer or in a terminal: `onWillDeleteFiles` offers
 * a `waitUntil` for a workspace edit, not a veto, and a terminal `rm` produces
 * no such event at all. What is left is to notice immediately afterwards and
 * make undoing it one click — which is the more useful half anyway, since the
 * student has usually just realised what they did.
 *
 * Restoring means checking the path out of HEAD: the deletion is still
 * uncommitted at this point, so HEAD is exactly "how it was handed in", give or
 * take work the student had committed since.
 */

const DEBOUNCE_MS = 400;

/** Deleted paths waiting to be reported together. */
let pending: string[] = [];
let timer: NodeJS.Timeout | undefined;

/** Paths this guard restored, to ignore the create events it causes itself. */
const restoring = new Set<string>();

async function offerRestore(
  paths: string[],
  treeDataProvider: StudentCourseContentTreeProvider,
  apiService: ComputorApiService
): Promise<void> {
  // Group by repository: one dialog per repository, one git call per batch.
  const byRepo = new Map<string, { title: string; relPaths: string[] }>();

  for (const fsPath of paths) {
    const assignment = treeDataProvider.findAssignmentForPath(fsPath);
    if (!assignment?.submissionGroupId) {
      continue;
    }

    const check = await checkSubmitted(
      assignment.repoRoot,
      fsPath,
      assignment.submissionGroupId,
      apiService
    );
    if (!check.submitted) {
      continue;
    }

    const relative = path.relative(assignment.repoRoot, fsPath).split(path.sep).join('/');
    const entry = byRepo.get(assignment.repoRoot) ?? { title: assignment.title, relPaths: [] };
    entry.relPaths.push(relative);
    byRepo.set(assignment.repoRoot, entry);
  }

  for (const [repoRoot, { title, relPaths }] of byRepo) {
    const what = relPaths.length === 1
      ? `“${path.basename(relPaths[0] as string)}”`
      : `${relPaths.length} files`;

    const choice = await notify.modal(
      'warning',
      `${what} of “${title}” was part of a submission you already handed in.`,
      {
        detail:
          'It is deleted now. Restoring brings back your last committed version. ' +
          'Keeping it deleted is fine too — "Update Repository from Template" then ' +
          'delivers a fresh copy from the course template.',
        actions: ['Restore My Version', 'Keep Deleted']
      }
    );
    if (choice !== 'Restore My Version') {
      continue;
    }

    try {
      for (const relative of relPaths) {
        restoring.add(path.join(repoRoot, relative));
      }
      await new CTGit(repoRoot).restorePathsFromHead(relPaths);
      notify.info(
        relPaths.length === 1
          ? `Restored ${relPaths[0]}.`
          : `Restored ${relPaths.length} files.`
      );
      treeDataProvider.refreshNode(undefined);
    } catch (error) {
      notify.error(
        `Could not restore: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      for (const relative of relPaths) {
        restoring.delete(path.join(repoRoot, relative));
      }
    }
  }
}

/**
 * Watch the student's repositories for deletions of already-submitted files.
 *
 * The tree provider's own watcher exists for the git badges and swallows the
 * paths; this one keeps them, which is the whole point here.
 */
export function registerSubmittedDeleteGuard(
  context: vscode.ExtensionContext,
  treeDataProvider: StudentCourseContentTreeProvider,
  apiService: ComputorApiService
): void {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsRoot) {
    return;
  }

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(path.join(wsRoot, 'student')), '**/*')
  );

  watcher.onDidDelete((uri) => {
    const fsPath = uri.fsPath;
    // Git's own bookkeeping churns constantly and is not the student's doing.
    if (fsPath.split(path.sep).includes('.git') || restoring.has(fsPath)) {
      return;
    }

    pending.push(fsPath);
    if (timer) {
      clearTimeout(timer);
    }
    // Deleting a folder arrives as one event per file inside it; a checkout of
    // a hundred paths should be one question, not a hundred.
    timer = setTimeout(() => {
      const batch = pending;
      pending = [];
      timer = undefined;
      void offerRestore(batch, treeDataProvider, apiService);
    }, DEBOUNCE_MS);
  });

  context.subscriptions.push(watcher);
}
