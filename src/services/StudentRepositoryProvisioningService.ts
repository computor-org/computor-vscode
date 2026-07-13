import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ComputorApiService } from './ComputorApiService';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
import { execGitClone } from '../git/gitCloneHelpers';
import { execAsyncWithTimeout } from '../utils/exec';
import { addBasicCredentialsToGitUrl, addTokenToGitUrl, redactGitCredentials } from '../utils/gitUrlHelpers';
import { extractZipBuffer } from '../utils/zipHelpers';
import { RepositoryTokenManager } from './RepositoryTokenManager';
import { studentRepoFolderFromRef } from '../utils/repositoryNaming';
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
  private readonly tokens: RepositoryTokenManager;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ComputorApiService
  ) {
    this.tokens = RepositoryTokenManager.getInstance(context);
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
      || (descriptor.student_repo_modes.includes('managed') ? 'managed' : descriptor.student_repo_modes[0]);

    if (mode === 'managed') {
      // 'managed' is provider-agnostic; the template's server type picks the backend.
      if (descriptor.template?.server_type === 'gitlab') {
        return this.provisionAndCloneGitlabManaged(courseId, descriptor, opts);
      }
      return this.provisionAndCloneForgejo(courseId, opts);
    }
    if (mode === 'external') {
      return this.provisionAndCloneExternal(courseId, descriptor, opts);
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

    report('Provisioning your repository…');
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

  // --- Mode: external (student-hosted on ANY provider; seeded from template) ---

  private async provisionAndCloneExternal(
    courseId: string,
    descriptor: CourseGitDescriptor,
    opts?: SetUpOptions
  ): Promise<SetUpOutcome> {
    const report = opts?.onProgress ?? (() => {});

    // The student supplies an EMPTY repo they created on any provider; we seed it
    // from the course template and link the template as `upstream` for later syncs.
    const entered = await vscode.window.showInputBox({
      title: 'Link your repository',
      prompt: 'URL of an EMPTY git repository you created (any provider) to seed from the course template',
      placeHolder: 'https://github.com/me/my-course.git',
      ignoreFocusOut: true,
      validateInput: (v) => (v && /^https?:\/\/.+/.test(v.trim())) ? undefined : 'Enter an http(s) git repository URL'
    });
    if (!entered) { return { status: 'cancelled' }; }
    const url = entered.trim();
    const host = this.originOf(url);

    const token = await this.ensureExternalToken(host);
    if (!token) { return { status: 'cancelled' }; }

    // Record the location with Computor (tracking only — never used for grading).
    report('Registering your repository…');
    const repo = await this.api.registerStudentRepository(courseId, {
      mode: 'external',
      server_url: host,
      repo_ref: this.repoRefFromUrl(url),
      http_url: url
    });

    const targetPath = this.localPathFor(repo);
    const authUrl = addTokenToGitUrl(url, token);

    if (this.isCloned(targetPath)) {
      report('Refreshing repository credentials…');
      await this.updateRemoteUrl(targetPath, authUrl);
      return { status: 'already-cloned', path: targetPath, repo };
    }

    if (descriptor.template?.server_type === 'forgejo') {
      // History-preserving seed: clone the template (read-only one-time
      // credential) and push it into the student's empty repo. The shared
      // ancestry is what makes later template updates plain git merges.
      report('Requesting template access…');
      const access = await this.api.getTemplateAccess(courseId);
      if (!access.clone_url) {
        throw new Error('The course template has no clone URL.');
      }
      if (!access.token || !access.username) {
        // Account appears on first SSO login — caller prompts, then re-runs.
        return { status: 'forgejo-login-required', repo };
      }
      report('Seeding your repository from the course template…');
      await this.seedFromTemplateClone(
        targetPath,
        addBasicCredentialsToGitUrl(access.clone_url, access.username, access.token),
        access.clone_url,
        authUrl,
        access.default_branch || 'main',
        opts?.cancellationToken
      );
      return { status: 'cloned', path: targetPath, repo };
    }

    // Non-Forgejo template (deferred): seed from the snapshot ZIP — the repo
    // starts without shared history, so template updates won't merge cleanly.
    report('Downloading the course template…');
    const buffer = await this.api.downloadTemplateArchive(courseId);
    await fs.promises.mkdir(targetPath, { recursive: true });
    await extractZipBuffer(buffer, targetPath);

    report('Linking your repository to the course template…');
    await this.seedAndPush(targetPath, authUrl, descriptor.template?.clone_url ?? undefined);
    return { status: 'cloned', path: targetPath, repo };
  }

  private originOf(url: string): string {
    try { return new URL(url).origin; } catch { return url; }
  }

  private repoRefFromUrl(url: string): string {
    try { return new URL(url).pathname.replace(/^\//, '').replace(/\.git$/, ''); } catch { return url; }
  }

  /** Prompt for (and cache) a write token for an arbitrary git host. */
  private async ensureExternalToken(host: string): Promise<string | undefined> {
    const key = `git-token-${host}`;
    let token = await this.context.secrets.get(key);
    if (!token) {
      token = await vscode.window.showInputBox({
        title: `Access token for ${host}`,
        prompt: `Enter a git access token for ${host} with write access (stored securely on this machine)`,
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v && v.trim()) ? undefined : 'A token is required'
      });
      if (!token) { return undefined; }
      await this.context.secrets.store(key, token.trim());
    }
    return token.trim();
  }

  /** Clone the course template WITH history and push it into the student's
   * empty origin. The template stays linked as `upstream` (credential-free —
   * template tokens rotate, the sync flow re-mints and injects one per fetch). */
  private async seedFromTemplateClone(
    repoPath: string,
    authTemplateUrl: string,
    plainTemplateUrl: string,
    authOriginUrl: string,
    defaultBranch: string,
    cancellationToken?: vscode.CancellationToken
  ): Promise<void> {
    await fs.promises.mkdir(path.dirname(repoPath), { recursive: true });
    await execGitClone(authTemplateUrl, repoPath, { cancellationToken });
    const run = (cmd: string) => execAsyncWithTimeout(cmd, { cwd: repoPath, timeout: 60_000 });
    await run('git remote rename origin upstream');
    await run(`git remote set-url upstream "${plainTemplateUrl}"`);
    await run(`git remote add origin "${authOriginUrl}"`);
    await run(`git push -u origin "${defaultBranch}"`);
  }

  /** Initialise the extracted template as a git repo, push it to the student's
   * empty origin, and link the course template as `upstream` for later syncs. */
  private async seedAndPush(repoPath: string, authOriginUrl: string, templateUpstreamUrl?: string): Promise<void> {
    const run = (cmd: string) => execAsyncWithTimeout(cmd, { cwd: repoPath, timeout: 60_000 });
    await run('git init');
    await run('git checkout -B main');
    await run('git add -A');
    await run('git -c user.name="Computor Student" -c user.email="student@computor.local" commit -m "Initialize from course template"');
    await run(`git remote add origin "${authOriginUrl}"`);
    await run('git push -u origin main');
    if (templateUpstreamUrl) {
      try { await run(`git remote add upstream "${templateUpstreamUrl}"`); } catch { /* best effort — upstream may need template access */ }
    }
  }

  // --- helpers ---------------------------------------------------------------

  /** Local clone path under `student/`, collision-free per course. */
  private localPathFor(repo: CourseMemberRepositoryGet): string {
    const ws = WorkspaceStructureManager.getInstance();
    return ws.getStudentRepositoryPath(this.repoFolderName(repo));
  }

  private repoFolderName(repo: CourseMemberRepositoryGet): string {
    // Shared with the student tree so both agree on the clone location.
    return studentRepoFolderFromRef(repo.repo_ref, repo.course_member_id || repo.id);
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
