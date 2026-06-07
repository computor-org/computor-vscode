import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ComputorApiService } from './ComputorApiService';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
import { execGitClone } from '../git/gitCloneHelpers';
import { execAsyncWithTimeout } from '../utils/exec';
import { addBasicCredentialsToGitUrl } from '../utils/gitUrlHelpers';
import type { CourseGitDescriptor, CourseMemberRepositoryGet } from '../types/courseGit';

export interface SetUpOptions {
  cancellationToken?: vscode.CancellationToken;
  onProgress?: (message: string) => void;
}

/** Outcome of trying to set up the student's repository for one course. */
export type SetUpOutcome =
  | { status: 'cloned'; path: string; repo: CourseMemberRepositoryGet }
  | { status: 'already-cloned'; path: string; repo: CourseMemberRepositoryGet }
  | { status: 'forgejo-login-required'; repo: CourseMemberRepositoryGet }
  | { status: 'unsupported-mode'; modes: string[] }
  | { status: 'not-configured' };

/**
 * Course-level student repository provisioning (the "babysitting" side of
 * VSCODE_STUDENT_REPO_PROVISIONING.md). Phase 2 / increment: Mode A (Forgejo
 * babysat) only — Mode B (GitLab BYO) and the tree UI land in later increments.
 *
 * Everything is keyed by `course_id` and is idempotent/re-runnable: we never
 * create a second repo for a (student, course) pair, and re-running just
 * re-clones / refreshes the rotated clone token.
 */
export class StudentRepositoryProvisioningService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ComputorApiService
  ) {}

  /** Does the student already have a repo recorded for this course? */
  async getRepository(courseId: string): Promise<CourseMemberRepositoryGet | null> {
    return this.api.getCourseRepository(courseId);
  }

  /** What the course offers (modes + template). */
  async getDescriptor(courseId: string): Promise<CourseGitDescriptor> {
    return this.api.getCourseGitDescriptor(courseId);
  }

  /**
   * Ensure the student has a local working repository for the course. Currently
   * handles the Forgejo babysat mode end-to-end; for courses that only offer
   * GitLab BYO / download it reports `unsupported-mode` (built in a later step).
   */
  async setUpRepository(courseId: string, opts?: SetUpOptions): Promise<SetUpOutcome> {
    const report = opts?.onProgress ?? (() => {});

    report('Checking course repository options…');
    const descriptor = await this.getDescriptor(courseId);
    if (!descriptor.configured) {
      return { status: 'not-configured' };
    }

    // Prefer the mode of an already-existing repo; otherwise the course's offer.
    report('Checking for an existing repository…');
    const existing = await this.getRepository(courseId);
    const mode = existing?.mode || (descriptor.student_repo_modes.includes('forgejo')
      ? 'forgejo'
      : descriptor.student_repo_modes[0]);

    if (mode === 'forgejo') {
      return this.provisionAndCloneForgejo(courseId, opts);
    }

    // gitlab_byo / download — not wired in this increment.
    return { status: 'unsupported-mode', modes: descriptor.student_repo_modes };
  }

  // --- Mode A — Forgejo (backend-babysat) -----------------------------------

  private async provisionAndCloneForgejo(courseId: string, opts?: SetUpOptions): Promise<SetUpOutcome> {
    const report = opts?.onProgress ?? (() => {});

    report('Provisioning your Forgejo repository…');
    // Idempotent + self-healing: returns the existing repo and a freshly-rotated
    // one-time clone token on every call.
    const repo = await this.api.provisionStudentRepository(courseId);

    if (!repo.http_url) {
      throw new Error('Provisioning did not return a repository URL.');
    }

    // clone_token/clone_username are null until the student's first Forgejo login
    // (the account is created on first OIDC login). Caller prompts, then re-runs.
    if (!repo.clone_token || !repo.clone_username) {
      return { status: 'forgejo-login-required', repo };
    }

    // The token is rotated on every provision call — persist the latest.
    if (repo.server_url) {
      await this.context.secrets.store(`forgejo-token-${repo.server_url}`, repo.clone_token);
    }

    const targetPath = this.localPathFor(repo);
    const authUrl = addBasicCredentialsToGitUrl(repo.http_url, repo.clone_username, repo.clone_token);

    if (this.isCloned(targetPath)) {
      // Already cloned — just refresh origin to carry the rotated token so the
      // next push/pull authenticates.
      report('Refreshing repository credentials…');
      await this.updateRemoteUrl(targetPath, authUrl);
      return { status: 'already-cloned', path: targetPath, repo };
    }

    report('Cloning your repository…');
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await execGitClone(authUrl, targetPath, { cancellationToken: opts?.cancellationToken });
    return { status: 'cloned', path: targetPath, repo };
  }

  // --- helpers ---------------------------------------------------------------

  /** Local clone path under `student/`, collision-free per course. */
  private localPathFor(repo: CourseMemberRepositoryGet): string {
    const ws = WorkspaceStructureManager.getInstance();
    return ws.getStudentRepositoryPath(this.repoFolderName(repo));
  }

  private repoFolderName(repo: CourseMemberRepositoryGet): string {
    const ref = (repo.repo_ref || '').trim();
    const base = ref
      ? ref.split('/').filter(Boolean).join('.')
      : (repo.course_member_id || repo.id);
    return base.replace(/[^a-zA-Z0-9._-]/g, '-');
  }

  private isCloned(repoPath: string): boolean {
    return fs.existsSync(path.join(repoPath, '.git'));
  }

  private async updateRemoteUrl(repoPath: string, authUrl: string): Promise<void> {
    try {
      await execAsyncWithTimeout(`git remote set-url origin "${authUrl}"`, { cwd: repoPath, timeout: 15_000 });
    } catch (err) {
      console.warn('[StudentRepoProvisioning] Failed to refresh origin URL:', err);
    }
  }
}
