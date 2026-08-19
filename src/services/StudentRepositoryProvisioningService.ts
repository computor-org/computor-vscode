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
import { propagateForgejoCloneCredential } from './ForgejoCredentialFanout';
import { isGitAuthenticationError } from '../utils/gitErrors';
import { URL } from 'url';
import { studentRepoFolderFromRef } from '../utils/repositoryNaming';
import { CTGit } from '../git/CTGit';
import { notify } from '../utils/notify';
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
      return this.provisionAndCloneForgejo(courseId, descriptor, opts);
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
    // The student's PAT has read access on the template, so it also
    // authenticates the update-fork fetch.
    const templateUrl = descriptor.template?.clone_url;
    const authTemplateUrl = templateUrl ? addTokenToGitUrl(templateUrl, token) : undefined;

    if (this.isCloned(targetPath)) {
      report('Refreshing repository credentials…');
      await this.updateRemoteUrl(targetPath, authUrl);
      if (authTemplateUrl) {
        await this.syncFromTemplate(targetPath, authTemplateUrl, report);
      }
      return { status: 'already-cloned', path: targetPath, repo };
    }

    report('Cloning your repository…');
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await execGitClone(authUrl, targetPath, { cancellationToken: opts?.cancellationToken });
    if (authTemplateUrl) {
      await this.syncFromTemplate(targetPath, authTemplateUrl, report);
    }
    return { status: 'cloned', path: targetPath, repo };
  }

  // --- Mode A — Forgejo (backend-babysat) -----------------------------------

  private async provisionAndCloneForgejo(
    courseId: string,
    descriptor: CourseGitDescriptor,
    opts?: SetUpOptions
  ): Promise<SetUpOutcome> {
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

    // One token per user and server: this provision just invalidated the
    // credential embedded in every OTHER clone on the server (issue #332), so
    // rewrite their origins with the fresh one before they fail a push.
    if (repo.server_url) {
      await propagateForgejoCloneCredential({
        serverUrl: repo.server_url,
        username: repo.clone_username,
        token: repo.clone_token,
        excludeRepoPath: targetPath
      });
    }
    // Provisioning grants the student read access on the course template, so
    // the same rotating clone credential authenticates the update-fork fetch.
    const templateUrl = descriptor.template?.clone_url;
    const authTemplateUrl = templateUrl
      ? addBasicCredentialsToGitUrl(templateUrl, repo.clone_username, repo.clone_token)
      : undefined;

    if (this.isCloned(targetPath)) {
      // Already cloned — refresh origin to carry the rotated token so the
      // next push/pull authenticates, then merge any new template commits
      // (the GitLab "update fork" behavior).
      report('Refreshing repository credentials…');
      await this.updateRemoteUrl(targetPath, authUrl);
      if (authTemplateUrl) {
        await this.syncFromTemplate(targetPath, authTemplateUrl, report);
      }
      return { status: 'already-cloned', path: targetPath, repo };
    }

    report('Cloning your repository…');
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await execGitClone(authUrl, targetPath, { cancellationToken: opts?.cancellationToken });
    // The repo on the server may itself be behind the template (it is only a
    // point-in-time copy from provisioning) — catch up right after the clone.
    if (authTemplateUrl) {
      await this.syncFromTemplate(targetPath, authTemplateUrl, report);
    }
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
      // Update-fork: merge new template commits using a freshly-minted
      // one-time read credential (template tokens rotate per sync).
      if (descriptor.template?.server_type === 'forgejo') {
        try {
          const access = await this.api.getTemplateAccess(courseId);
          const templateUrl = access.clone_url || descriptor.template?.clone_url;
          if (access.token && access.username && templateUrl) {
            await this.syncFromTemplate(
              targetPath,
              addBasicCredentialsToGitUrl(templateUrl, access.username, access.token),
              report
            );
          }
        } catch (error) {
          console.warn('[StudentRepositoryProvisioningService] Could not get template access for sync:', error);
        }
      }
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

  /**
   * The GitLab "[update fork]" behavior for the course-level repo: merge new
   * template commits into the student's clone and push them back to origin.
   * {@link CTGit.forkUpdate} owns the whole cycle (upstream remote, stash,
   * merge + conflict auto-resolution, push, cleanup). A failed sync never
   * fails provisioning — the student keeps working on the version they have.
   */
  private async syncFromTemplate(
    repoPath: string,
    authTemplateUrl: string,
    report: (message: string) => void
  ): Promise<void> {
    report('Checking for template updates…');
    try {
      const result = await new CTGit(repoPath).forkUpdate(authTemplateUrl, { autoResolveConflicts: true });
      if (result.updated) {
        report('Template updates merged.');
        console.log(
          `[StudentRepositoryProvisioningService] Merged ${result.behindCount} template commit(s) from upstream/${result.defaultBranch}`
        );
      }
    } catch (error) {
      console.warn('[StudentRepositoryProvisioningService] Template sync failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      void notify.warning(
        `Failed to update your repository from the course template. You may be working with an older version. Error: ${redactGitCredentials(message)}`
      );
    }
  }

  /**
   * Update-fork every given course whose managed course-level repo is already
   * cloned locally — the "[refresh]" / extension-startup trigger. Skips
   * courses without a repo record or local clone (nothing to update), so for
   * managed Forgejo it never prompts; managed GitLab asks for a token only if
   * the stored one went missing.
   */
  async syncClonedManagedRepos(courseIds: Iterable<string>, opts?: SetUpOptions): Promise<void> {
    for (const courseId of courseIds) {
      if (opts?.cancellationToken?.isCancellationRequested) { return; }
      try {
        const repo = await this.getRepository(courseId);
        if (!(repo?.mode === 'managed' && this.isCloned(this.localPathFor(repo)))) {
          continue;
        }

        // Forgejo: provisioning ROTATES the per-user-per-server clone token, so
        // running it for every course in this loop would invalidate the
        // credential of every previously-synced sibling (issue #332). Only
        // provision when the local credential actually stopped working.
        if (repo.provider_type === 'forgejo') {
          const repoPath = this.localPathFor(repo);
          const auth = await this.remoteAuthWorks(repoPath);
          if (auth === 'ok') {
            await this.syncForgejoTemplateWithLocalCreds(courseId, repoPath, opts?.onProgress ?? (() => {}));
            continue;
          }
          if (auth === 'unreachable') {
            console.warn(`[StudentRepositoryProvisioningService] Git server unreachable for course ${courseId}; skipping sync.`);
            continue;
          }
        }

        await this.setUpRepository(courseId, opts);
      } catch (error) {
        console.warn(`[StudentRepositoryProvisioningService] Template sync for course ${courseId} failed:`, error);
      }
    }
  }

  /** Can the credential embedded in origin still authenticate against the server? */
  private async remoteAuthWorks(repoPath: string): Promise<'ok' | 'auth-failed' | 'unreachable'> {
    try {
      await execAsyncWithTimeout('git ls-remote --heads origin', { cwd: repoPath, timeout: 20_000 });
      return 'ok';
    } catch (error) {
      return isGitAuthenticationError(error) ? 'auth-failed' : 'unreachable';
    }
  }

  /**
   * Template sync using the still-valid credential already embedded in origin —
   * the no-rotation path of {@link syncClonedManagedRepos}. The clone credential
   * also reads the template (provisioning grants template read access).
   */
  private async syncForgejoTemplateWithLocalCreds(
    courseId: string,
    repoPath: string,
    report: (message: string) => void
  ): Promise<void> {
    const descriptor = await this.getDescriptor(courseId);
    const templateUrl = descriptor.template?.clone_url;
    if (!templateUrl) {
      return;
    }
    const creds = await this.getOriginCredentials(repoPath);
    if (!creds) {
      return;
    }
    const authTemplateUrl = addBasicCredentialsToGitUrl(templateUrl, creds.username, creds.password);
    await this.syncFromTemplate(repoPath, authTemplateUrl, report);
  }

  private async getOriginCredentials(repoPath: string): Promise<{ username: string; password: string } | undefined> {
    try {
      const { stdout } = await execAsyncWithTimeout('git remote get-url origin', { cwd: repoPath, timeout: 15_000 });
      const url = new URL(stdout.trim());
      if (url.username && url.password) {
        return { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
      }
    } catch (error: any) {
      console.warn('[StudentRepositoryProvisioningService] Could not read origin credentials:', redactGitCredentials(error?.message || String(error)));
    }
    return undefined;
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
