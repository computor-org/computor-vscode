import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execAsync } from '../utils/exec';
import { addTokenToGitUrl, extractOriginFromGitUrl } from '../utils/gitUrlHelpers';

/**
 * Repository configuration for offline mode
 */
interface OfflineRepositoryConfig {
  repositoryUrl: string;
  templateUrl: string;
  gitlabToken: string;
  gitlabOrigin: string;
}

/**
 * Manages offline repository operations
 * Provides functionality to add courses manually in offline mode
 * Does NOT use secret storage - always prompts for tokens
 */
export class OfflineRepositoryManager {
  constructor() {
    // No dependencies needed
  }

  /**
   * Add a new course repository to offline mode
   * Prompts for GitLab token, repository URL, and template URL
   * Always prompts for token - does NOT use secret storage
   */
  async addCourse(): Promise<void> {
    try {
      // Get repository URL
      const repositoryUrl = await this.promptRepositoryUrl();
      if (!repositoryUrl) {
        return; // User cancelled
      }

      // Get template URL (fork origin)
      const templateUrl = await this.promptTemplateUrl();
      if (!templateUrl) {
        return; // User cancelled
      }

      // Extract GitLab origin from repository URL
      const gitlabOrigin = extractOriginFromGitUrl(repositoryUrl);
      if (!gitlabOrigin) {
        vscode.window.showErrorMessage('Invalid repository URL. Must be a valid HTTPS GitLab URL.');
        return;
      }

      // Always prompt for GitLab token (no secret storage in offline mode)
      const gitlabToken = await this.promptGitLabToken(gitlabOrigin);
      if (!gitlabToken) {
        return; // User cancelled
      }

      const config: OfflineRepositoryConfig = {
        repositoryUrl,
        templateUrl,
        gitlabToken,
        gitlabOrigin
      };

      // Clone the repository
      await this.cloneRepository(config);

      vscode.window.showInformationMessage('✓ Course repository added successfully');
    } catch (error: any) {
      console.error('[OfflineRepositoryManager] Failed to add course:', error);
      vscode.window.showErrorMessage(`Failed to add course: ${error.message}`);
    }
  }

  /**
   * Prompt for repository URL
   */
  private async promptRepositoryUrl(): Promise<string | undefined> {
    const url = await vscode.window.showInputBox({
      title: 'Add Course - Repository URL',
      prompt: 'Enter the HTTPS or git@ URL of your student repository',
      placeHolder: 'https://gitlab.com/user/repo.git or git@gitlab.com:user/repo.git',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) {
          return 'Repository URL is required';
        }

        // Normalize git@ URLs to https://
        let normalizedUrl = value.trim();
        if (normalizedUrl.startsWith('git@')) {
          // Convert git@gitlab.com:user/repo.git to https://gitlab.com/user/repo.git
          const match = normalizedUrl.match(/^git@([^:]+):(.+)$/);
          if (!match) {
            return 'Invalid git@ URL format';
          }
          normalizedUrl = `https://${match[1]}/${match[2]}`;
        }

        // Validate as URL
        try {
          const urlObj = new URL(normalizedUrl);
          if (!['http:', 'https:'].includes(urlObj.protocol)) {
            return 'Only HTTP/HTTPS URLs are supported';
          }
        } catch {
          return 'Enter a valid repository URL';
        }

        return undefined;
      }
    });

    if (!url) {
      return undefined;
    }

    // Normalize git@ URLs to https://
    let normalizedUrl = url.trim();
    if (normalizedUrl.startsWith('git@')) {
      const match = normalizedUrl.match(/^git@([^:]+):(.+)$/);
      if (match) {
        normalizedUrl = `https://${match[1]}/${match[2]}`;
      }
    }

    // Ensure .git extension
    if (!normalizedUrl.endsWith('.git')) {
      normalizedUrl += '.git';
    }

    return normalizedUrl;
  }

  /**
   * Prompt for template URL (fork origin)
   */
  private async promptTemplateUrl(): Promise<string | undefined> {
    const url = await vscode.window.showInputBox({
      title: 'Add Course - Template Repository URL',
      prompt: 'Enter the HTTPS URL of the student-template repository (fork origin)',
      placeHolder: 'https://gitlab.com/course/student-template.git',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) {
          return 'Template URL is required';
        }

        // Normalize git@ URLs to https://
        let normalizedUrl = value.trim();
        if (normalizedUrl.startsWith('git@')) {
          const match = normalizedUrl.match(/^git@([^:]+):(.+)$/);
          if (!match) {
            return 'Invalid git@ URL format';
          }
          normalizedUrl = `https://${match[1]}/${match[2]}`;
        }

        // Validate as URL
        try {
          const urlObj = new URL(normalizedUrl);
          if (!['http:', 'https:'].includes(urlObj.protocol)) {
            return 'Only HTTP/HTTPS URLs are supported';
          }
        } catch {
          return 'Enter a valid template URL';
        }

        return undefined;
      }
    });

    if (!url) {
      return undefined;
    }

    // Normalize git@ URLs to https://
    let normalizedUrl = url.trim();
    if (normalizedUrl.startsWith('git@')) {
      const match = normalizedUrl.match(/^git@([^:]+):(.+)$/);
      if (match) {
        normalizedUrl = `https://${match[1]}/${match[2]}`;
      }
    }

    // Ensure .git extension
    if (!normalizedUrl.endsWith('.git')) {
      normalizedUrl += '.git';
    }

    return normalizedUrl;
  }

  /**
   * Prompt for GitLab personal access token
   */
  private async promptGitLabToken(gitlabOrigin: string): Promise<string | undefined> {
    const token = await vscode.window.showInputBox({
      title: `Add Course - GitLab Token for ${gitlabOrigin}`,
      prompt: `Enter your GitLab Personal Access Token for ${gitlabOrigin}`,
      placeHolder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) {
          return 'GitLab token is required';
        }
        if (value.length < 10) {
          return 'Token seems too short';
        }
        return undefined;
      }
    });

    return token;
  }

  /**
   * Clone the repository with authentication
   */
  private async cloneRepository(config: OfflineRepositoryConfig): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error('No workspace folder open');
    }

    // Ensure student/ directory exists
    const studentDir = path.join(workspaceRoot, 'student');
    await fs.promises.mkdir(studentDir, { recursive: true });

    // Extract repository name from URL
    // Example: https://gitlab.com/user/repo.git -> repo
    // Remove .git suffix and get last path segment
    const repoName = this.extractRepoName(config.repositoryUrl);
    const targetPath = path.join(studentDir, repoName);

    // Check if directory already exists
    if (fs.existsSync(targetPath)) {
      const action = await vscode.window.showWarningMessage(
        `Directory "${repoName}" already exists. Do you want to overwrite it?`,
        'Overwrite',
        'Cancel'
      );

      if (action !== 'Overwrite') {
        return;
      }

      // Remove existing directory
      await fs.promises.rm(targetPath, { recursive: true, force: true });
    }

    // Clone with progress
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Cloning ${repoName}...`,
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 0, message: 'Preparing...' });

      // Add token to URL for authentication
      const authenticatedUrl = addTokenToGitUrl(config.repositoryUrl, config.gitlabToken);

      progress.report({ increment: 30, message: 'Cloning repository...' });

      try {
        // Clone the repository
        await execAsync(`git clone "${authenticatedUrl}" "${repoName}"`, {
          cwd: studentDir
        });

        progress.report({ increment: 60, message: 'Setting up remote...' });

        // Add upstream remote (template repository) with authentication
        const authenticatedTemplateUrl = addTokenToGitUrl(config.templateUrl, config.gitlabToken);
        await execAsync(`git remote add upstream "${authenticatedTemplateUrl}"`, {
          cwd: targetPath
        });

        progress.report({ increment: 90, message: 'Configuring repository...' });

        // Configure git to use the stored credentials
        await execAsync(`git config credential.helper store`, {
          cwd: targetPath
        });

        progress.report({ increment: 100, message: 'Done!' });
      } catch (error: any) {
        // Clean up on failure
        if (fs.existsSync(targetPath)) {
          await fs.promises.rm(targetPath, { recursive: true, force: true });
        }
        throw new Error(`Failed to clone repository: ${error.message}`);
      }
    });
  }

  /**
   * Extract repository name from URL
   * Example: https://gitlab.com/user/repo.git -> user.repo
   * Example: https://gitlab.com/namespace/group/subgroup/repo.git -> namespace.group.subgroup.repo
   */
  private extractRepoName(url: string): string {
    try {
      // Remove .git suffix
      let cleanUrl = url.replace(/\.git$/, '');

      // Parse URL to get pathname
      const urlObj = new URL(cleanUrl);
      const pathname = urlObj.pathname;

      // Get the full path after the host (e.g., /user/repo or /namespace/group/repo)
      // Remove leading slash
      const fullPath = pathname.replace(/^\//, '');

      // Replace all slashes with dots to create a flat directory name
      // This matches the pattern used in normal student view
      const repoName = fullPath.replace(/\//g, '.');

      return repoName;
    } catch (error) {
      // Fallback: just get the last segment
      const segments = url.replace(/\.git$/, '').split('/');
      const lastSegment = segments[segments.length - 1];
      return lastSegment || 'repository';
    }
  }

  /**
   * Get workspace root directory
   */
  private getWorkspaceRoot(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }
    return workspaceFolders[0]!.uri.fsPath;
  }
}
