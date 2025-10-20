import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ComputorApiService } from './ComputorApiService';
import { GitLabTokenManager } from './GitLabTokenManager';
import { execAsync } from '../utils/exec';
import { CTGit } from '../git/CTGit';
import { createRepositoryBackup, isHistoryRewriteError } from '../utils/repositoryBackup';
import { addTokenToGitUrl, extractOriginFromGitUrl, stripCredentialsFromGitUrl } from '../utils/gitUrlHelpers';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';

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
  private gitLabTokenManager: GitLabTokenManager;
  private apiService: ComputorApiService;

  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService
  ) {
    this.apiService = apiService;
    this.gitLabTokenManager = GitLabTokenManager.getInstance(context);
    this.workspaceStructure = WorkspaceStructureManager.getInstance();
  }

  /**
   * Auto-clone or update all repositories for a student's courses
   */
  async autoSetupRepositories(courseId?: string, onProgress?: (message: string) => void): Promise<void> {
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
        report(`Processing repositories for course ${courseIdForRepo} (${repos.length})`);
        await this.processRepositoriesForCourse(courseIdForRepo, repos, courseContents, report);
      }
      
      console.log('[StudentRepositoryManager] Repository setup completed');
      report('Repository setup completed');
      
    } catch (error) {
      console.error('[StudentRepositoryManager] Failed to auto-setup repositories:', error);
      // Don't show error to user - this is a background operation
      // They can still manually clone if needed
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
      const isAssignment = content.course_content_type?.course_content_kind_id === 'assignment' ||
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
   * Process repositories for a specific course
   */
  private async processRepositoriesForCourse(
    courseId: string, 
    repositories: RepositoryInfo[],
    courseContents: any[],
    onProgress?: (message: string) => void
  ): Promise<void> {
    const report = onProgress || (() => {});
    if (repositories.length === 0) return;
    
    // Get GitLab token
    const firstRepo = repositories[0];
    if (!firstRepo) return;
    
    const gitlabUrl = new URL(firstRepo.cloneUrl).origin;
    let token = await this.gitLabTokenManager.ensureTokenForUrl(gitlabUrl);

    if (!token) {
      console.warn('[StudentRepositoryManager] No GitLab token available, skipping clone');
      return;
    }

    void this.gitLabTokenManager.refreshWorkspaceGitCredentials(gitlabUrl);

    // Get course information to find upstream repository
    let upstreamUrl: string | undefined;
    try {
      const course = await this.apiService.getStudentCourse(courseId);
      console.log('[StudentRepositoryManager] Course data:', JSON.stringify(course, null, 2));
      if (course?.repository) {
        // Construct upstream URL from provider_url and full_path
        // The upstream is always the student-template repository in the course namespace
        const providerUrl = course.repository.provider_url.replace(/\/$/, ''); // Remove trailing slash if present
        const fullPath = course.repository.full_path.replace(/^\//, ''); // Remove leading slash if present
        upstreamUrl = `${providerUrl}/${fullPath}/student-template.git`;
        console.log(`[StudentRepositoryManager] Upstream repository: ${upstreamUrl}`);
      } else {
        console.log('[StudentRepositoryManager] No repository field in course data');
      }
    } catch (error) {
      console.warn('[StudentRepositoryManager] Could not get course information for upstream:', error);
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
      const firstRepo = repoInfos[0];
      if (firstRepo && (firstRepo as any).fullPath) {
        const cloneUrl = firstRepo.cloneUrl;
        const fullPath = (firstRepo as any).fullPath;
        const repoName = firstRepo.assignmentTitle || fullPath;
        report(`Setting up ${repoName}...`);
        token = await this.setupUniqueRepository(courseId, fullPath, cloneUrl, repoInfos, token, courseContents, upstreamUrl, onProgress);
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
    token: string,
    courseContents: any[],
    upstreamUrl?: string,
    onProgress?: (message: string) => void
  ): Promise<string> {
    void courseId; // Only used for logging
    const report = onProgress || (() => {});
    let effectiveToken = token;
    // Use full_path with dots instead of slashes as the directory name
    const dirName = fullPath.replace(/\//g, '.');
    const repoPath = this.workspaceStructure.getStudentRepositoryPath(dirName);
    const repoName = repoInfos[0]?.assignmentTitle || fullPath;

    const repoExists = await this.directoryExists(repoPath);
    
    if (!repoExists) {
      console.log(`[StudentRepositoryManager] Cloning repository ${cloneUrl}`);
      report(`Cloning ${repoName}...`);
      effectiveToken = await this.cloneRepository(repoPath, cloneUrl, effectiveToken);
    } else {
      console.log(`[StudentRepositoryManager] Repository exists at ${repoPath}, updating`);
      report(`Updating ${repoName}...`);
      effectiveToken = await this.updateRepository(repoPath, cloneUrl, effectiveToken, repoName, report);
    }

    // Sync fork with upstream if available
    if (upstreamUrl) {
      console.log('[StudentRepositoryManager] Checking if fork needs update from upstream');
      report('Checking for upstream updates...');
      const updated = await this.syncForkWithUpstream(repoPath, upstreamUrl, effectiveToken);
      
      if (updated) {
        console.log('[StudentRepositoryManager] Fork was updated');
        report('Upstream updates merged; pushing to origin...');
        // Push the update to origin
        try {
          await execAsync('git push origin', {
            cwd: repoPath,
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0'
            }
          });
          console.log('[StudentRepositoryManager] Pushed fork update to origin');
        } catch (error) {
          console.error('[StudentRepositoryManager] Failed to push fork update:', error);
        }
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
        const isAssignment = content.course_content_type?.course_content_kind_id === 'assignment' ||
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
   * Sync fork with upstream repository
   */
  private async syncForkWithUpstream(
    repoPath: string,
    upstreamUrl: string,
    token?: string
  ): Promise<boolean> {
    const authenticatedUpstreamUrl = token ? addTokenToGitUrl(upstreamUrl, token) : upstreamUrl;
    console.log('[StudentRepositoryManager] Authenticated upstream URL:', authenticatedUpstreamUrl);

    let upstreamAddedByUs = false;
    let stashRef: string | undefined;

    try {
      await this.ensureMergeNotInProgress(repoPath);

      const cleanResult = await this.ensureWorkingTreeClean(repoPath);
      stashRef = cleanResult.stashRef;
      if (!cleanResult.proceed) {
        return false;
      }

      const remoteExisted = await this.ensureUpstreamRemote(repoPath, authenticatedUpstreamUrl);
      upstreamAddedByUs = !remoteExisted;

      const defaultBranch = await this.getUpstreamDefaultBranch(repoPath);
      if (!defaultBranch) {
        vscode.window.showWarningMessage('Unable to detect the upstream default branch. Contact your lecturer.');
        return false;
      }

      const behindCount = await this.getUpstreamBehindCount(repoPath, defaultBranch);
      console.log('[StudentRepositoryManager] Fork behind upstream commits:', behindCount);

      if (behindCount <= 0) {
        return false;
      }

      const choice = await vscode.window.showInformationMessage(
        `Your repository fork is ${behindCount} commit(s) behind upstream/${defaultBranch}. Update now?`,
        'Yes, Update',
        'Skip'
      );

      if (choice !== 'Yes, Update') {
        return false;
      }

      const gitHelper = new CTGit(repoPath);
      const updateResult = await gitHelper.forkUpdate(authenticatedUpstreamUrl, {
        defaultBranch,
        removeRemote: !remoteExisted
      });

      if (updateResult.updated) {
        console.log(`[StudentRepositoryManager] Fork updated from upstream/${defaultBranch}`);
      } else {
        console.log('[StudentRepositoryManager] Fork update finished without changes');
      }
      return updateResult.updated;
    } catch (error) {
      console.error('[StudentRepositoryManager] Failed to sync fork:', error);
      await this.abortMergeIfPossible(repoPath);
      return false;
    } finally {
      if (stashRef) {
        await this.restoreStash(repoPath, stashRef);
      }
      if (upstreamAddedByUs) {
        await this.removeUpstreamRemote(repoPath);
      }
    }
  }

  private async ensureWorkingTreeClean(repoPath: string): Promise<{ proceed: boolean; stashRef?: string }> {
    const status = await execAsync('git status --porcelain', { cwd: repoPath });
    const output = status.stdout.trim();
    if (!output) {
      return { proceed: true };
    }

    const hasConflicts = output.split('\n').some(line => line.startsWith('U') || line.includes('AA') || line.includes('DD'));
    if (hasConflicts) {
      const choice = await vscode.window.showWarningMessage(
        'Your repository has unresolved merge conflicts. Resolve them manually and try again.',
        'View Git Output',
        'Cancel'
      );
      if (choice === 'View Git Output') {
        await vscode.commands.executeCommand('git.showOutput');
      }
      return { proceed: false };
    }

    try {
      const stashMessage = `computor-auto-sync-${Date.now()}`;
      await execAsync(`git stash push --include-untracked --message ${JSON.stringify(stashMessage)}`, { cwd: repoPath });
      const stashRef = await this.findStashReference(repoPath, stashMessage);
      if (stashRef) {
        console.log(`[StudentRepositoryManager] Stashed local changes as ${stashRef} before syncing.`);
      }
      return { proceed: true, stashRef };
    } catch (error) {
      console.error('[StudentRepositoryManager] Failed to stash local changes automatically:', error);
      vscode.window.showWarningMessage('Could not stash local changes before syncing repositories. Please resolve your changes manually and try again.');
      return { proceed: false };
    }
  }

  private async ensureMergeNotInProgress(repoPath: string): Promise<void> {
    try {
      await fs.promises.access(path.join(repoPath, '.git', 'MERGE_HEAD'));
      console.warn('[StudentRepositoryManager] Detected unfinished merge. Aborting before continuing.');
      await this.abortMergeIfPossible(repoPath);
    } catch {
      // No merge in progress
    }
  }

  private async ensureUpstreamRemote(repoPath: string, remoteUrl: string): Promise<boolean> {
    const { stdout } = await execAsync('git remote', { cwd: repoPath });
    const remotes = stdout.split('\n').map(line => line.trim()).filter(Boolean);

    const upstreamExists = remotes.includes('upstream');

    if (!upstreamExists) {
      await execAsync(`git remote add upstream "${remoteUrl}"`, { cwd: repoPath });
    } else {
      await execAsync(`git remote set-url upstream "${remoteUrl}"`, { cwd: repoPath });
    }

    await execAsync('git fetch upstream', {
      cwd: repoPath,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0'
      }
    });

    return upstreamExists;
  }

  private async removeUpstreamRemote(repoPath: string): Promise<void> {
    try {
      await execAsync('git remote remove upstream', { cwd: repoPath });
    } catch {
      // Ignore removal errors
    }
  }

  private async findStashReference(repoPath: string, marker: string): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('git stash list --pretty=format:%gd::%gs', { cwd: repoPath });
      const lines = stdout.split('\n').map(line => line.trim()).filter(Boolean);
      for (const line of lines) {
        const [ref, message] = line.split('::');
        if (message && message.includes(marker)) {
          return ref?.trim();
        }
      }
    } catch (error) {
      console.warn('[StudentRepositoryManager] Unable to read stash list:', error);
    }
    return undefined;
  }

  private async restoreStash(repoPath: string, stashRef: string): Promise<void> {
    try {
      await execAsync(`git stash pop ${stashRef}`, { cwd: repoPath });
      console.log(`[StudentRepositoryManager] Restored stashed changes from ${stashRef}.`);
    } catch (error) {
      console.error(`[StudentRepositoryManager] Failed to restore stashed changes from ${stashRef}:`, error);
      vscode.window.showWarningMessage('Automatic restoration of stashed changes failed. Please run "git stash pop" manually to recover your work.');
    }
  }

  private async getUpstreamDefaultBranch(repoPath: string): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('git remote show upstream', {
        cwd: repoPath,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0'
        }
      });

      const match = stdout.match(/HEAD branch:\s*(.+)/);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch (error) {
      console.warn('[StudentRepositoryManager] Failed to detect upstream default branch via remote show:', error);
    }

    for (const candidate of ['main', 'master']) {
      try {
        await execAsync(`git rev-parse --verify upstream/${candidate}`, { cwd: repoPath });
        return candidate;
      } catch {
        // Continue searching
      }
    }

    return undefined;
  }

  private async getUpstreamBehindCount(repoPath: string, branch: string): Promise<number> {
    try {
      const { stdout } = await execAsync(`git rev-list --count HEAD..upstream/${branch}`, { cwd: repoPath });
      const parsed = parseInt(stdout.trim(), 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    } catch (error) {
      console.warn('[StudentRepositoryManager] Failed to compute upstream divergence:', error);
    }

    return 0;
  }

  private async abortMergeIfPossible(repoPath: string): Promise<void> {
    try {
      await execAsync('git merge --abort', { cwd: repoPath });
    } catch {
      // Ignore when there is nothing to abort
    }
  }
  
  private async cloneRepository(repoPath: string, cloneUrl: string, token: string): Promise<string> {
    const attemptClone = async (activeToken: string): Promise<void> => {
      const authenticatedUrl = addTokenToGitUrl(cloneUrl, activeToken);
      await execAsync(`git clone "${authenticatedUrl}" "${repoPath}"`, {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0'
        }
      });
      console.log(`[StudentRepositoryManager] Successfully cloned to ${repoPath}`);
    };

    try {
      await attemptClone(token);
      return token;
    } catch (error: any) {
      console.error('[StudentRepositoryManager] Clone failed:', error);

      if (!this.isAuthenticationError(error)) {
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
    report: (message: string) => void
  ): Promise<string> {
    try {
      await execAsync('git fetch --all', {
        cwd: repoPath,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0'
        }
      });

      const { stdout: branch } = await execAsync('git symbolic-ref --short HEAD 2>/dev/null || echo "DETACHED"', {
        cwd: repoPath
      });

      if (branch.trim() !== 'DETACHED') {
        await execAsync('git pull --ff-only', {
          cwd: repoPath,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0'
          }
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
        vscode.window.showErrorMessage(`Computor could not reset the repository "${repoName}". Please remove it manually and try again.`);
        throw removeError;
      }

      report(`Recreating ${repoName} from origin...`);
      let refreshedToken = token;
      try {
        refreshedToken = await this.cloneRepository(repoPath, cloneUrl, token);
      } catch (cloneError) {
        console.error(`[StudentRepositoryManager] Re-clone failed for ${repoPath}:`, cloneError);
        vscode.window.showErrorMessage(`Computor could not recreate the repository "${repoName}". Your previous files${backupPath ? ` were backed up at ${backupPath}` : ''}.`);
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

      const choice = await vscode.window.showWarningMessage(message, ...actions);
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
        vscode.window.showErrorMessage(`Remote "${remoteName}" is not configured for this repository.`);
        return false;
      }

      const sanitizedUrl = stripCredentialsFromGitUrl(currentUrl);
      if (!sanitizedUrl) {
        vscode.window.showErrorMessage('Unsupported remote URL format. Update the remote manually and retry.');
        return false;
      }

      const origin = extractOriginFromGitUrl(sanitizedUrl);
      if (!origin) {
        vscode.window.showErrorMessage('Unable to determine GitLab host for this repository.');
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
      vscode.window.showErrorMessage('Could not update Git credentials. Please try again.');
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
