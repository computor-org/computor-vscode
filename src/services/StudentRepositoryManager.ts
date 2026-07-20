import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ComputorApiService } from './ComputorApiService';
import { RepositoryTokenManager } from './RepositoryTokenManager';
import { execAsync, execAsyncWithTimeout, GitTimeoutError, GitCancelledError } from '../utils/exec';
import { execGitClone } from '../git/gitCloneHelpers';
import { CTGit } from '../git/CTGit';
import { GitErrorHandler } from '../git/GitErrorHandler';
import { createRepositoryBackup, isHistoryRewriteError } from '../utils/repositoryBackup';
import { addBasicCredentialsToGitUrl, addTokenToGitUrl, extractOriginFromGitUrl, redactGitCredentials, stripCredentialsFromGitUrl } from '../utils/gitUrlHelpers';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
import { studentRepoFolderFromRef } from '../utils/repositoryNaming';
import type { CourseMemberRepositoryGet } from '../types/courseGit';
import { notify } from '../utils/notify';

interface RepositoryInfo {
  cloneUrl: string;
  assignmentPath: string;  // Path in course structure (e.g., "assignment1")
  assignmentTitle: string;
  directory?: string;       // Directory path inside the git repository for sparse-checkout
  submissionGroupId?: string; // UUID of the submission group
  fullPath?: string;        // Full path of the repository (e.g., "course/student-123")
}

/**
 * Manages student repository cloning and updates
 * Handles automatic cloning when student view is activated
 */
export class StudentRepositoryManager {
  private workspaceStructure: WorkspaceStructureManager;
  private gitLabTokenManager: RepositoryTokenManager;
  private apiService: ComputorApiService;
  private corruptIndexHandler?: (repoPath: string) => void;

  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService
  ) {
    this.apiService = apiService;
    this.gitLabTokenManager = RepositoryTokenManager.getInstance(context);
    this.workspaceStructure = WorkspaceStructureManager.getInstance();
  }

  setCorruptIndexHandler(handler: (repoPath: string) => void): void {
    this.corruptIndexHandler = handler;
  }

  private isCorruptIndexError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return GitErrorHandler.isCorruptIndex(message);
  }

  /**
   * Auto-clone or update all repositories for a student's courses
   * @param courseId - Optional specific course to setup
   * @param onProgress - Optional progress callback
   * @param expandedCourseIds - Optional set of course IDs to process. When provided,
   *                           only repositories belonging to these courses will be
   *                           cloned/updated/fork-synced. Other courses are skipped
   *                           for faster startup.
   */
  async autoSetupRepositories(
    courseId?: string,
    onProgress?: (message: string) => void,
    expandedCourseIds?: Set<string>,
    cancellationToken?: vscode.CancellationToken
  ): Promise<void> {
    const report = onProgress || (() => {});
    console.log('[StudentRepositoryManager] Starting auto-setup of repositories');
    report('Discovering course contents...');
    
    try {
      // Ensure workspace directories exist
      await this.workspaceStructure.ensureDirectories();
      
      // Get course contents
      const courseContents = await this.apiService.getStudentCourseContents(courseId, { force: true });
      
      if (!courseContents || courseContents.length === 0) {
        console.log('[StudentRepositoryManager] No course contents found');
        report('No course contents found');
        return;
      }
      
      // Collect repositories from assignments
      const repositories = this.collectRepositoriesFromContents(courseContents);
      
      if (repositories.length === 0) {
        console.log('[StudentRepositoryManager] No repositories to clone');
        report('No repositories to clone');
        return;
      }
      
      console.log(`[StudentRepositoryManager] Found ${repositories.length} repositories to process`);
      report(`Found ${repositories.length} repositories to process`);
      
      // Group by course
      const reposByCourse = new Map<string, RepositoryInfo[]>();
      for (const repo of repositories) {
        // Extract course ID from the assignment data
        const content = courseContents.find(c => c.path === repo.assignmentPath);
        const contentCourseId = content?.course_id || courseId || 'default';
        
        if (!reposByCourse.has(contentCourseId)) {
          reposByCourse.set(contentCourseId, []);
        }
        reposByCourse.get(contentCourseId)!.push(repo);
      }
      
      // Process each course's repositories
      for (const [courseIdForRepo, repos] of reposByCourse) {
        if (cancellationToken?.isCancellationRequested) {
          console.log('[StudentRepositoryManager] Repository setup cancelled by user');
          report('Cancelled');
          return;
        }
        // Skip courses not in the expanded set (if provided)
        if (expandedCourseIds && !expandedCourseIds.has(courseIdForRepo)) {
          console.log(`[StudentRepositoryManager] Skipping course ${courseIdForRepo} (not expanded)`);
          continue;
        }
        report(`Processing repositories for course ${courseIdForRepo} (${repos.length})`);
        await this.processRepositoriesForCourse(courseIdForRepo, repos, courseContents, report, cancellationToken);
      }
      
      console.log('[StudentRepositoryManager] Repository setup completed');
      report('Repository setup completed');
      
    } catch (error) {
      if (error instanceof GitCancelledError) {
        console.log('[StudentRepositoryManager] Repository setup cancelled by user');
        throw error;
      }
      console.error('[StudentRepositoryManager] Failed to auto-setup repositories:', error);
    }
  }

  /**
   * Collect unique repositories from course contents
   * Groups by (url, full_path) tuple to handle shared repositories
   */
  private collectRepositoriesFromContents(courseContents: any[]): RepositoryInfo[] {
    const repoMap = new Map<string, RepositoryInfo>();

    for (const content of courseContents) {
      // Check if it's an assignment with a repository
      // Handle both course_content_type (singular) and course_content_types (plural)
      const contentType = content.course_content_type || content.course_content_types;
      const isAssignment = contentType?.course_content_kind_id === 'assignment' ||
                          content.example_id;
      const repo = content.submission_group?.repository;

      if (isAssignment && repo?.clone_url && repo?.full_path && content.submission_group?.id) {
        // Use (url, full_path) as the unique key for repositories
        const key = `${repo.clone_url}::${repo.full_path}`;
        if (!repoMap.has(key)) {
          console.log(`[StudentRepositoryManager] Repository info for ${content.title}:`, {
            cloneUrl: repo.clone_url,
            fullPath: repo.full_path,
            assignmentPath: content.path,
            directory: content.directory,
            exampleIdentifier: content.submission_group?.example_identifier
          });
          // Use directory from backend when available; otherwise fall back to example_identifier
          // Treat these as subdirectories inside the repository (not absolute)
          const subdirectory = (typeof content.directory === 'string' && content.directory.length > 0)
            ? content.directory
            : content.submission_group?.example_identifier;
          console.log(`[StudentRepositoryManager] Subdirectory for ${content.title}: "${subdirectory}"`);

          repoMap.set(key, {
            cloneUrl: repo.clone_url,
            assignmentPath: content.path,
            assignmentTitle: content.title || content.path,
            directory: subdirectory,  // This should be just the subdirectory, not a full path
            submissionGroupId: content.submission_group.id,
            fullPath: repo.full_path  // Store the full_path from repository
          } as RepositoryInfo & { submissionGroupId: string; fullPath: string });
        }
      }
    }

    return Array.from(repoMap.values());
  }

  /**
   * The course-level repository record plus how this flow must treat it.
   *
   * Managed Forgejo repos are provisioned and cloned by
   * {@link StudentRepositoryProvisioningService} with a backend-issued,
   * repo-scoped clone token embedded directly in the git remote, so this flow
   * must not prompt for a token or rewrite the remote for them. GitLab
   * (managed or legacy org-scoped) authenticates with the student's own PAT
   * (already stored, so `ensureTokenForUrl` returns it silently); external
   * repos with the token the student registered for their host.
   */
  private async resolveCourseRepoContext(
    courseId: string,
    origin: string
  ): Promise<{ repo: CourseMemberRepositoryGet | null; forgejoManaged: boolean }> {
    let repo: CourseMemberRepositoryGet | null = null;
    try {
      repo = await this.apiService.getCourseRepository(courseId);
    } catch (error) {
      console.warn('[StudentRepositoryManager] Could not determine course repository mode:', error);
    }
    let forgejoManaged = repo?.mode === 'managed' && repo?.provider_type === 'forgejo';
    if (!repo) {
      // Fallback: a stored Forgejo clone token proves the server is a
      // backend-hosted Forgejo even if the record is momentarily unavailable.
      forgejoManaged = !!(await this.gitLabTokenManager.getManagedForgejoToken(origin));
    }
    return { repo, forgejoManaged };
  }

  /**
   * Process repositories for a specific course
   */
  private async processRepositoriesForCourse(
    courseId: string,
    repositories: RepositoryInfo[],
    courseContents: any[],
    onProgress?: (message: string) => void,
    cancellationToken?: vscode.CancellationToken
  ): Promise<void> {
    const report = onProgress || (() => {});
    if (repositories.length === 0) return;
    
    // Work out how to authenticate git for this course's repositories.
    const firstRepo = repositories[0];
    if (!firstRepo) return;

    const gitlabUrl = new URL(firstRepo.cloneUrl).origin;

    // Backend-managed Forgejo repos are provisioned and cloned by
    // StudentRepositoryProvisioningService, which embeds a backend-issued,
    // repo-scoped clone token directly in the git remote. They must NEVER trigger a
    // manual token prompt here, and we must not rewrite their remotes. GitLab
    // (managed or BYO) still authenticates with the student's own token, so it
    // keeps going through ensureTokenForUrl (which returns a stored token silently).
    const { repo: courseRepo, forgejoManaged } = await this.resolveCourseRepoContext(courseId, gitlabUrl);

    let token: string | undefined;
    if (forgejoManaged) {
      // Reuse the stored Forgejo clone token for downstream bookkeeping if we have
      // one, but the embedded remote credentials are what actually authenticate.
      token = await this.gitLabTokenManager.getManagedForgejoToken(gitlabUrl);
    } else {
      token = await this.gitLabTokenManager.ensureTokenForUrl(gitlabUrl);
      if (!token) {
        console.warn('[StudentRepositoryManager] No GitLab token available, skipping clone');
        return;
      }
      void this.gitLabTokenManager.refreshWorkspaceGitCredentials(gitlabUrl);
    }

    // Find the upstream (student-template) location so new template commits can
    // be merged into the student's repo. The course git descriptor covers every
    // model: managed Forgejo/GitLab bindings AND legacy org-GitLab courses (the
    // backend synthesizes their template ref — the old `course.repository`
    // field this flow used to read no longer exists).
    let upstreamUrl: string | undefined;
    let upstreamAuth: { username: string; password: string } | undefined;
    try {
      const descriptor = await this.apiService.getCourseGitDescriptor(courseId);
      const template = descriptor?.template;
      if (!template?.clone_url) {
        console.log('[StudentRepositoryManager] No template location for course; skipping template sync');
      } else if (forgejoManaged) {
        // Auth: the clone credentials embedded in the origin remote (or the
        // stored clone token) — provisioning grants read on the template.
        upstreamUrl = template.clone_url;
      } else if (courseRepo?.mode === 'external') {
        if (template.server_type === 'forgejo') {
          // One-time read-only template credential, minted fresh per sync.
          const access = await this.apiService.getTemplateAccess(courseId);
          if (access?.token && access.username) {
            upstreamUrl = access.clone_url || template.clone_url;
            upstreamAuth = { username: access.username, password: access.token };
          } else {
            console.log('[StudentRepositoryManager] Template access pending first git-server login; skipping template sync');
          }
        } else {
          console.log('[StudentRepositoryManager] External repo on a non-Forgejo course; template sync not supported yet');
        }
      } else {
        // Managed GitLab and legacy org-GitLab: the student's PAT (the course
        // token resolved above) has read access on the template.
        upstreamUrl = template.clone_url;
      }
      if (upstreamUrl) {
        console.log(`[StudentRepositoryManager] Template upstream: ${upstreamUrl}`);
      }
    } catch (error) {
      console.warn('[StudentRepositoryManager] Could not resolve template upstream:', error);
    }
    
      // Group repositories by (url, full_path) to get unique repositories
    const uniqueRepos = new Map<string, RepositoryInfo[]>();
    for (const repo of repositories) {
      const fullPath = (repo as any).fullPath;
      if (fullPath) {
        const key = `${repo.cloneUrl}::${fullPath}`;
        if (!uniqueRepos.has(key)) {
          uniqueRepos.set(key, []);
        }
        uniqueRepos.get(key)!.push(repo);
      }
    }

    console.log(`[StudentRepositoryManager] Found ${uniqueRepos.size} unique repositories for course ${courseId}`);
    report(`Found ${uniqueRepos.size} unique repositories`);

    // Clone/update each unique repository only once
    for (const [, repoInfos] of uniqueRepos) {
      if (cancellationToken?.isCancellationRequested) {
        console.log('[StudentRepositoryManager] Repository setup cancelled by user');
        return;
      }
      const firstRepo = repoInfos[0];
      if (firstRepo && (firstRepo as any).fullPath) {
        const cloneUrl = firstRepo.cloneUrl;
        const fullPath = (firstRepo as any).fullPath;
        const repoName = firstRepo.assignmentTitle || fullPath;
        report(`Setting up ${repoName}...`);
        token = await this.setupUniqueRepository(courseId, fullPath, cloneUrl, repoInfos, token, courseContents, upstreamUrl, upstreamAuth, courseRepo, forgejoManaged, onProgress, cancellationToken);
      }
    }
    
    // Also check for any existing repositories that might not have their directory field set
    // This handles the case where repositories were cloned in a previous session
    this.updateExistingRepositoryPaths(courseId, courseContents);
  }

  /**
   * Set up or update a unique repository and link assignments to it
   */
  private async setupUniqueRepository(
    courseId: string, // Used for logging and upstream URL
    fullPath: string, // Repository full_path (e.g., "course/student-123")
    cloneUrl: string,
    repoInfos: RepositoryInfo[],
    token: string | undefined,
    courseContents: any[],
    upstreamUrl: string | undefined,
    upstreamAuth: { username: string; password: string } | undefined,
    courseRepo: CourseMemberRepositoryGet | null,
    forgejoManaged: boolean,
    onProgress?: (message: string) => void,
    cancellationToken?: vscode.CancellationToken
  ): Promise<string | undefined> {
    void courseId; // Only used for logging
    const report = onProgress || (() => {});
    let effectiveToken = token;
    // Directory scheme: when this IS the course-level repo, use the same
    // repo_ref-based folder as the provisioning service and the tree, so both
    // stacks agree on ONE clone location (a divergent name silently disabled
    // the template sync). An already-cloned legacy dot-dir keeps working; the
    // dot scheme also remains the fallback for legacy per-assignment repos.
    const dotDir = this.workspaceStructure.getStudentRepositoryPath(fullPath.replace(/\//g, '.'));
    let repoPath = dotDir;
    if (courseRepo?.repo_ref && fullPath === courseRepo.repo_ref) {
      const unified = this.workspaceStructure.getStudentRepositoryPath(
        studentRepoFolderFromRef(courseRepo.repo_ref, courseRepo.course_member_id || courseRepo.id)
      );
      if (unified !== dotDir && !((await this.directoryExists(dotDir)) && !(await this.directoryExists(unified)))) {
        repoPath = unified;
      }
    }
    const repoName = repoInfos[0]?.assignmentTitle || fullPath;

    const repoExists = await this.directoryExists(repoPath);

    if (!repoExists) {
      if (forgejoManaged) {
        // The first clone of a managed Forgejo repo is owned by the provisioning
        // service, which holds the backend-issued credentials. Nothing to clone
        // here — it appears once the student runs "Set up repository".
        console.log(`[StudentRepositoryManager] Managed Forgejo repo ${fullPath} not present locally; deferring first clone to provisioning`);
        return effectiveToken;
      }
      console.log(`[StudentRepositoryManager] Cloning repository ${cloneUrl}`);
      report(`Cloning ${repoName}...`);
      effectiveToken = await this.cloneRepository(repoPath, cloneUrl, effectiveToken as string, cancellationToken);
    } else {
      console.log(`[StudentRepositoryManager] Repository exists at ${repoPath}, updating`);
      report(`Updating ${repoName}...`);
      // Managed Forgejo repos authenticate via the credentials already embedded in
      // their remote, so the (possibly absent) token here is only bookkeeping.
      effectiveToken = await this.updateRepository(repoPath, cloneUrl, effectiveToken as string, repoName, report, cancellationToken);
    }

    // Merge new template commits if we resolved an upstream. CTGit.forkUpdate
    // owns the whole cycle including the push back to origin.
    if (upstreamUrl) {
      console.log('[StudentRepositoryManager] Checking for template updates');
      report('Checking for template updates...');
      const updated = await this.syncForkWithUpstream(repoPath, upstreamUrl, effectiveToken, upstreamAuth);
      if (updated) {
        console.log('[StudentRepositoryManager] Repository updated from template');
        report('Template updates merged.');
      }
    }
    
    // Now update the directory field for each assignment in this repository
    for (const repo of repoInfos) {
      const content = courseContents.find(c => c.path === repo.assignmentPath);
      if (content) {
        let finalPath: string | undefined;
        // Prefer backend-provided directory on content
        if (typeof content.directory === 'string' && content.directory.length > 0) {
          const p = path.isAbsolute(content.directory) ? content.directory : path.join(repoPath, content.directory);
          if (fs.existsSync(p)) {
            finalPath = p;
            console.log(`[StudentRepositoryManager] Using backend directory for ${repo.assignmentTitle}: ${content.directory}`);
          }
        }
        // Else use the repoInfo directory (example_identifier)
        if (!finalPath && repo.directory) {
          const p = path.join(repoPath, repo.directory);
          if (fs.existsSync(p)) {
            finalPath = p;
            console.log(`[StudentRepositoryManager] Using example_identifier subdirectory for ${repo.assignmentTitle}: ${repo.directory}`);
          }
        }
        
        console.log(`[StudentRepositoryManager] Setting directory for ${repo.assignmentTitle}:`, {
          repoPath,
          subdirectory: repo.directory,
          finalPath,
          exists: finalPath ? fs.existsSync(finalPath) : false
        });
        
        // Set the absolute path to the assignment directory only when it exists
        if (finalPath && fs.existsSync(finalPath)) {
          content.directory = finalPath;
          console.log(`[StudentRepositoryManager] Set directory for ${repo.assignmentTitle} to ${finalPath}`);
        }
      }
    }
    return effectiveToken;
  }

  /**
   * Update directory paths for existing repositories
   */
  public updateExistingRepositoryPaths(courseId: string, courseContents: any[]): void {
    void courseId; // Not used in new structure

    // List all directories in the student directory that are git repositories
    try {
      const studentDir = this.workspaceStructure.getDirectories().student;
      const dirs = fs.existsSync(studentDir)
        ? fs.readdirSync(studentDir).filter(file => {
            const filePath = path.join(studentDir, file);
            return fs.statSync(filePath).isDirectory() && fs.existsSync(path.join(filePath, '.git'));
          })
        : [];

      console.log(`[StudentRepositoryManager] Found existing repositories in workspace: ${dirs.join(', ')}`);
      
        // For each content item, check if its directory exists
        for (const content of courseContents) {
          // Skip if directory is already set and exists
          if (content.directory && fs.existsSync(content.directory)) {
            continue;
          }
        
        // Try to find the repository for this content
        // Handle both course_content_type (singular) and course_content_types (plural)
        const contentType = content.course_content_type || content.course_content_types;
        const isAssignment = contentType?.course_content_kind_id === 'assignment' ||
                            content.example_id;

        if (isAssignment && content.submission_group?.repository?.full_path) {
          // Convert full_path to directory name format
          const expectedDirName = content.submission_group.repository.full_path.replace(/\//g, '.');

          // Check if this directory exists
          if (dirs.includes(expectedDirName)) {
            const studentDir = this.workspaceStructure.getDirectories().student;
            const repoPath = path.join(studentDir, expectedDirName);

            // Determine expected subdirectory from backend data first
            let subdirectory: string | undefined;
            if (typeof content.directory === 'string' && content.directory.length > 0) {
              subdirectory = content.directory;
            } else if (content.submission_group?.example_identifier) {
              subdirectory = content.submission_group.example_identifier;
            }

            if (subdirectory) {
              const fullPath = path.isAbsolute(subdirectory) ? subdirectory : path.join(repoPath, subdirectory);
              if (fs.existsSync(fullPath)) {
                content.directory = fullPath;
                console.log(`[StudentRepositoryManager] Found existing directory for ${content.title}: ${fullPath}`);
              } else {
                console.log(`[StudentRepositoryManager] Assignment directory not found for ${content.title}: ${subdirectory}`);
              }
            } else {
              console.log(`[StudentRepositoryManager] No subdirectory defined for ${content.title} - assignment not deployed yet`);
            }
          }
        }
      }
    } catch (error) {
      console.error('[StudentRepositoryManager] Error updating existing repository paths:', error);
    }
  }

  /**
   * Merge new template commits into the student's repo (the GitLab
   * "update fork" behavior). {@link CTGit.forkUpdate} owns the whole
   * operation — upstream remote, stash (incl. untracked), branch detection,
   * merge + conflict handling, push to origin, cleanup — this wrapper only
   * resolves authentication for the upstream URL and maps failures to the
   * user-facing UX.
   */
  private async syncForkWithUpstream(
    repoPath: string,
    upstreamUrl: string,
    token?: string,
    upstreamAuth?: { username: string; password: string }
  ): Promise<boolean> {
    let authenticatedUpstreamUrl: string;
    if (upstreamAuth) {
      // Pre-resolved credential (external repos: one-time template token).
      authenticatedUpstreamUrl = addBasicCredentialsToGitUrl(upstreamUrl, upstreamAuth.username, upstreamAuth.password);
    } else if (token) {
      // GitLab PAT / stored Forgejo clone token.
      authenticatedUpstreamUrl = addTokenToGitUrl(upstreamUrl, token);
    } else {
      // Managed Forgejo repos often have no separately stored token — their
      // clone credentials live embedded in the origin remote URL (set by the
      // provisioning service). Reuse them for the upstream (template) fetch;
      // the backend grants the student read access there.
      const originCreds = await this.getOriginRemoteCredentials(repoPath);
      authenticatedUpstreamUrl = originCreds
        ? addBasicCredentialsToGitUrl(upstreamUrl, originCreds.username, originCreds.password)
        : upstreamUrl;
    }
    console.log('[StudentRepositoryManager] Syncing from template:', redactGitCredentials(authenticatedUpstreamUrl));

    try {
      const result = await new CTGit(repoPath).forkUpdate(authenticatedUpstreamUrl, {
        autoResolveConflicts: true  // Automatically resolve conflicts without user prompts
      });
      if (result.updated) {
        console.log(`[StudentRepositoryManager] Updated from template (${result.behindCount} commit(s) behind upstream/${result.defaultBranch})`);
      }
      return result.updated;
    } catch (error) {
      console.error('[StudentRepositoryManager] Failed to sync from template:', error);

      if (this.isCorruptIndexError(error) && this.corruptIndexHandler) {
        this.corruptIndexHandler(repoPath);
        return false;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      await notify.warning(
        `Failed to automatically update your repository from the course template. You may be working with an older version. Error: ${redactGitCredentials(errorMessage)}`,
        'View Git Output',
        'Dismiss'
      ).then(choice => {
        if (choice === 'View Git Output') {
          void vscode.commands.executeCommand('git.showOutput');
        }
      });

      return false;
    }
  }

  /**
   * Credentials embedded in the origin remote URL — managed Forgejo repos are
   * cloned with `clone_username:clone_token@` baked into the remote by the
   * provisioning service, and there is no other reliable local copy of them.
   */
  private async getOriginRemoteCredentials(repoPath: string): Promise<{ username: string; password: string } | undefined> {
    try {
      const { stdout } = await execAsync('git remote get-url origin', { cwd: repoPath });
      const url = new URL(stdout.trim());
      if (url.username && url.password) {
        return { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
      }
    } catch (error) {
      console.warn('[StudentRepositoryManager] Could not read origin remote credentials:', error);
    }
    return undefined;
  }

  private async cloneRepository(repoPath: string, cloneUrl: string, token: string, cancellationToken?: vscode.CancellationToken): Promise<string> {
    const attemptClone = async (activeToken: string): Promise<void> => {
      const authenticatedUrl = addTokenToGitUrl(cloneUrl, activeToken);
      try {
        await execGitClone(authenticatedUrl, repoPath, { cancellationToken });
        console.log(`[StudentRepositoryManager] Successfully cloned to ${repoPath}`);
      } catch (error) {
        // Clean up partial clone directory on any failure
        try {
          if (fs.existsSync(repoPath)) {
            await fs.promises.rm(repoPath, { recursive: true, force: true });
            console.log(`[StudentRepositoryManager] Cleaned up partial clone at ${repoPath}`);
          }
        } catch (cleanupError) {
          console.warn('[StudentRepositoryManager] Failed to clean up partial clone:', cleanupError);
        }
        throw error;
      }
    };

    try {
      await attemptClone(token);
      return token;
    } catch (error: any) {
      console.error('[StudentRepositoryManager] Clone failed:', error);

      if (error instanceof GitTimeoutError || error instanceof GitCancelledError || !this.isAuthenticationError(error)) {
        throw error;
      }

      const gitlabUrl = new URL(cloneUrl).origin;
      await this.gitLabTokenManager.removeToken(gitlabUrl);
      const refreshedToken = await this.gitLabTokenManager.ensureTokenForUrl(gitlabUrl);
      if (!refreshedToken) {
        throw new Error('GitLab authentication required');
      }

      await attemptClone(refreshedToken);
      return refreshedToken;
    }
  }

  /**
   * Update an existing repository
   */
  private async updateRepository(
    repoPath: string,
    cloneUrl: string,
    token: string,
    repoName: string,
    report: (message: string) => void,
    cancellationToken?: vscode.CancellationToken
  ): Promise<string> {
    try {
      await execAsyncWithTimeout('git fetch --all', {
        cwd: repoPath,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0'
        },
        timeout: 30_000,
        cancellationToken
      });

      const { stdout: branch } = await execAsync('git symbolic-ref --short HEAD 2>/dev/null || echo "DETACHED"', {
        cwd: repoPath
      });

      if (branch.trim() !== 'DETACHED') {
        await execAsyncWithTimeout('git pull --ff-only', {
          cwd: repoPath,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0'
          },
          timeout: 30_000,
          cancellationToken
        });
      }
      return token;
    } catch (error: any) {
      console.warn(`[StudentRepositoryManager] Failed to update repository at ${repoPath}:`, error);

      if (!isHistoryRewriteError(error)) {
        return token;
      }

      report(`Detected remote replacement for ${repoName}. Creating backup...`);

      let backupPath: string | undefined;
      try {
        const backupRoot = path.join(this.workspaceStructure.getDirectories().root, '.computor');
        await fs.promises.mkdir(backupRoot, { recursive: true });
        backupPath = await createRepositoryBackup(repoPath, backupRoot, { repoName });
        if (backupPath) {
          console.log(`[StudentRepositoryManager] Backup created at ${backupPath}`);
        }
      } catch (backupError) {
        console.error(`[StudentRepositoryManager] Failed to create backup for ${repoPath}:`, backupError);
      }

      try {
        await fs.promises.rm(repoPath, { recursive: true, force: true });
      } catch (removeError) {
        console.error(`[StudentRepositoryManager] Failed to remove repository at ${repoPath}:`, removeError);
        notify.error(`Computor could not reset the repository "${repoName}". Please remove it manually and try again.`);
        throw removeError;
      }

      report(`Recreating ${repoName} from origin...`);
      let refreshedToken = token;
      try {
        refreshedToken = await this.cloneRepository(repoPath, cloneUrl, token);
      } catch (cloneError) {
        console.error(`[StudentRepositoryManager] Re-clone failed for ${repoPath}:`, cloneError);
        notify.error(`Computor could not recreate the repository "${repoName}". Your previous files${backupPath ? ` were backed up at ${backupPath}` : ''}.`);
        throw cloneError;
      }

      const actions: string[] = [];
      if (backupPath) {
        actions.push('Open Backup Folder');
      }
      actions.push('Dismiss');

      const message = backupPath
        ? `The repository "${repoName}" was reset because the remote history changed. A backup without Git metadata is available at ${backupPath}. This is unusual—if it happens again, please inform your course instructor.`
        : `The repository "${repoName}" was reset because the remote history changed. This is unusual—if it happens again, please inform your course instructor.`;

      const choice = await notify.warning(message, ...actions);
      if (choice === 'Open Backup Folder' && backupPath) {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(backupPath));
      }

      return refreshedToken;
    }
  }

  /**
   * Check if a directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Refresh remote credentials by prompting for a new token and updating the remote URL.
   */
  public async refreshRepositoryAuth(repoPath: string, remoteName: string = 'origin'): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`git remote get-url ${remoteName}`, { cwd: repoPath });
      const currentUrl = stdout.trim();
      if (!currentUrl) {
        notify.error(`Remote "${remoteName}" is not configured for this repository.`);
        return false;
      }

      const sanitizedUrl = stripCredentialsFromGitUrl(currentUrl);
      if (!sanitizedUrl) {
        notify.error('Unsupported remote URL format. Update the remote manually and retry.');
        return false;
      }

      const origin = extractOriginFromGitUrl(sanitizedUrl);
      if (!origin) {
        notify.error('Unable to determine GitLab host for this repository.');
        return false;
      }

      const existingToken = await this.gitLabTokenManager.getToken(origin);
      const token = await this.gitLabTokenManager.requestAndStoreToken(origin, existingToken);
      if (!token) {
        return false;
      }

      const updatedUrl = addTokenToGitUrl(sanitizedUrl, token);
      if (updatedUrl === currentUrl) {
        return true;
      }

      await execAsync(`git remote set-url ${remoteName} "${updatedUrl}"`, { cwd: repoPath });
      console.log(`[StudentRepositoryManager] Updated ${remoteName} remote for ${repoPath}`);
      return true;
    } catch (error) {
      console.error('[StudentRepositoryManager] Failed to refresh repository credentials:', error);
      notify.error('Could not update Git credentials. Please try again.');
      return false;
    }
  }

  /**
   * Expose authentication error detection for other services.
   */
  public isAuthenticationError(error: any): boolean {
    const message = error?.message || error?.toString() || '';
    return message.includes('Authentication failed') ||
           message.includes('Access denied') ||
           message.includes('HTTP Basic') ||
           message.includes('401');
  }

}
