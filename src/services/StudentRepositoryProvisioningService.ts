import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ComputorApiService } from './ComputorApiService';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
import { execGitClone } from '../git/gitCloneHelpers';
import { execAsyncWithTimeout } from '../utils/exec';
import { addBasicCredentialsToGitUrl, addTokenToGitUrl, redactGitCredentials } from '../utils/gitUrlHelpers';
import { GitLabByoProvisioner } from './GitLabByoProvisioner';
import { GitLabTokenManager } from './GitLabTokenManager';
import type { CourseGitDescriptor, CourseMemberRepositoryGet } from '../types/courseGit';

export interface SetUpOptions {
  cancellationToken?: vscode.CancellationToken;
  onProgress?: (message: string) => void;
  /**
   * Mode to use when the course offers a choice and no repo exists yet. Ignored
   * if a repo already exists (its recorded mode wins) or if not offered.
   */
  preferredMode?: string;
}

/** Outcome of trying to set up the student's repository for one course. */
export type SetUpOutcome =
  | { status: 'cloned'; path: string; repo: CourseMemberRepositoryGet }
  | { status: 'already-cloned'; path: string; repo: CourseMemberRepositoryGet }
  | { status: 'forgejo-login-required'; repo: CourseMemberRepositoryGet }
  | { status: 'unsupported-mode'; modes: string[] }
  | { status: 'cancelled' }
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
  private readonly byo: GitLabByoProvisioner;
  private readonly tokens: GitLabTokenManager;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ComputorApiService
  ) {
    this.byo = new GitLabByoProvisioner(context);
    this.tokens = GitLabTokenManager.getInstance(context);
  }

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

    // Prefer the mode of an already-existing repo; otherwise the caller's choice
    // (when offered); otherwise default to Forgejo, then the first offered mode.
    report('Checking for an existing repository…');
    const existing = await this.getRepository(courseId);
    const preferred = (opts?.preferredMode && descriptor.student_repo_modes.includes(opts.preferredMode))
      ? opts.preferredMode
      : undefined;
    const mode = existing?.mode
      || preferred
      || (descriptor.student_repo_modes.includes('forgejo') ? 'forgejo' : descriptor.student_repo_modes[0]);

    if (mode === 'forgejo') {
      return this.provisionAndCloneForgejo(courseId, opts);
    }
    if (mode === 'gitlab_managed') {
      return this.provisionAndCloneGitlabManaged(courseId, descriptor, opts);
    }
    if (mode === 'gitlab_byo') {
      return this.provisionAndCloneGitLabByo(courseId, descriptor, opts);
    }

    // download — handled by a separate "Download template" command, not here.
    return { status: 'unsupported-mode', modes: descriptor.student_repo_modes };
  }

  // --- Managed GitLab (backend forks; student authenticates with their PAT) ---

  private async provisionAndCloneGitlabManaged(
    courseId: string,
    descriptor: CourseGitDescriptor,
    opts?: SetUpOptions
  ): Promise<SetUpOutcome> {
    const report = opts?.onProgress ?? (() => {});

    report('Provisioning your GitLab repository…');
    // Backend forks the template into the course's students group (idempotent).
    // No clone token for GitLab — the student authenticates with their own PAT.
    const repo = await this.api.provisionStudentRepository(courseId);
    if (!repo.http_url) {
      throw new Error('Provisioning did not return a repository URL.');
    }

    const serverUrl = repo.server_url || descriptor.template?.base_url;
    if (!serverUrl) {
      return { status: 'unsupported-mode', modes: descriptor.student_repo_modes };
    }

    // The student's own PAT proves their GitLab identity; the backend reads it
    // (GET /user) and grants them access to the repo with its group token.
    report('Connecting your GitLab account…');
    const token = await this.tokens.ensureTokenForUrl(serverUrl);
    if (!token) {
      return { status: 'cancelled' };
    }

    report('Granting access to your repository…');
    await this.api.registerGitlabManaged(courseId, token);

    const targetPath = this.localPathFor(repo);
    const authUrl = addTokenToGitUrl(repo.http_url, token);

    if (this.isCloned(targetPath)) {
      report('Refreshing repository credentials…');
      await this.updateRemoteUrl(targetPath, authUrl);
      return { status: 'already-cloned', path: targetPath, repo };
    }

    report('Cloning your repository…');
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await execGitClone(authUrl, targetPath, { cancellationToken: opts?.cancellationToken });
    return { status: 'cloned', path: targetPath, repo };
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

  // --- Mode B — GitLab BYO (client-side fork) -------------------------------

  private async provisionAndCloneGitLabByo(
    courseId: string,
    descriptor: CourseGitDescriptor,
    opts?: SetUpOptions
  ): Promise<SetUpOutcome> {
    const report = opts?.onProgress ?? (() => {});
    const template = descriptor.template;

    // v1 handles the primary case: native fork on the GitLab instance the
    // template lives on. Cross-instance (template elsewhere) clone-and-push is
    // a later increment.
    if (!template || template.server_type !== 'gitlab' || !template.repo) {
      return { status: 'unsupported-mode', modes: descriptor.student_repo_modes };
    }

    report('Preparing your GitLab repository…');
    const slug = await this.courseSlug(courseId);
    const fork = await this.byo.forkTemplate(template, slug);
    if (!fork) {
      return { status: 'cancelled' };
    }

    // Register the location with Computor (tracking only — never used for grading).
    report('Registering your repository…');
    const repo = await this.api.registerStudentRepository(courseId, {
      mode: 'gitlab_byo',
      server_url: fork.serverUrl,
      repo_ref: fork.repoRef,
      http_url: fork.httpUrl,
      ssh_url: fork.sshUrl ?? null,
      web_url: fork.webUrl ?? null
    });

    const targetPath = this.localPathFor(repo);
    const authUrl = addTokenToGitUrl(fork.httpUrl, fork.token);

    if (this.isCloned(targetPath)) {
      report('Refreshing repository credentials…');
      await this.updateRemoteUrl(targetPath, authUrl);
      return { status: 'already-cloned', path: targetPath, repo };
    }

    report('Cloning your repository…');
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await execGitClone(authUrl, targetPath, { cancellationToken: opts?.cancellationToken });
    return { status: 'cloned', path: targetPath, repo };
  }

  /** A short, readable course slug for repo names (last path/title segment). */
  private async courseSlug(courseId: string): Promise<string> {
    try {
      const course = await this.api.getStudentCourse(courseId);
      const raw = String(course?.path || course?.title || courseId);
      return raw.split(/[./]/).filter(Boolean).pop() || courseId.slice(0, 8);
    } catch {
      return courseId.slice(0, 8);
    }
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
    } catch (err: any) {
      // Redact: the exec error's message/cmd carries the credential-embedded URL.
      console.warn('[StudentRepoProvisioning] Failed to refresh origin URL:', redactGitCredentials(err?.message || String(err)));
    }
  }
}
