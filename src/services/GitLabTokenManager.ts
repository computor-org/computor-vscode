import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { OrganizationList, CourseList } from '../types/generated';
import { execAsync } from '../utils/exec';
import { addTokenToGitUrl, extractOriginFromGitUrl, stripCredentialsFromGitUrl } from '../utils/gitUrlHelpers';

/**
 * GitLab Token Manager - Singleton service for managing GitLab tokens
 * Used by all views (lecturer, tutor, student) to access GitLab repositories
 */
export class GitLabTokenManager {
  private static instance: GitLabTokenManager;
  private settingsManager: ComputorSettingsManager;
  private tokenCache: Map<string, string> = new Map();

  private constructor(private context: vscode.ExtensionContext) {
    this.settingsManager = new ComputorSettingsManager(context);
  }

  /**
   * Get the singleton instance
   */
  static getInstance(context: vscode.ExtensionContext): GitLabTokenManager {
    if (!GitLabTokenManager.instance) {
      GitLabTokenManager.instance = new GitLabTokenManager(context);
    }
    return GitLabTokenManager.instance;
  }

  /**
   * Extract unique GitLab URLs from organizations and ensure we have tokens for each
   */
  async ensureTokensForOrganizations(organizations: OrganizationList[]): Promise<void> {
    const gitlabUrls = this.extractUniqueGitLabUrls(organizations);
    
    for (const url of gitlabUrls) {
      // Check if we already have a token for this URL
      let token = await this.getToken(url);
      
      if (!token) {
        // Prompt for token
        token = await this.promptForToken(url);
        if (token) {
          await this.storeToken(url, token);
        }
      }
    }
  }

  /**
   * Extract unique GitLab URLs from organizations
   */
  private extractUniqueGitLabUrls(organizations: OrganizationList[]): Set<string> {
    const urls = new Set<string>();
    
    // Note: OrganizationList doesn't have properties in the type, 
    // we might need to fetch full organization details
    // For now, we'll need to handle this when we get course details
    
    return urls;
  }

  /**
   * Extract GitLab URL from a course
   */
  extractGitLabUrlFromCourse(course: CourseList): string | undefined {
    if (course.properties?.gitlab?.url) {
      try {
        const url = new URL(course.properties.gitlab.url);
        return url.origin;
      } catch {
        // Invalid URL
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Ensure we have a token for a specific GitLab instance
   */
  async ensureTokenForUrl(gitlabUrl: string): Promise<string | undefined> {
    // Check cache first
    if (this.tokenCache.has(gitlabUrl)) {
      return this.tokenCache.get(gitlabUrl);
    }

    // Check stored token
    let token = await this.getToken(gitlabUrl);

    if (!token) {
      // Prompt for token and validate before storing
      token = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `GitLab Authentication for ${gitlabUrl}`,
        cancellable: false
      }, async (progress) => {
        let validatedToken: string | undefined;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts && !validatedToken) {
          attempts++;

          progress.report({ message: attempts > 1 ? `Attempt ${attempts}/${maxAttempts}` : 'Requesting token...' });

          const inputToken = await this.promptForToken(gitlabUrl);
          if (!inputToken) {
            // User cancelled
            return undefined;
          }

          progress.report({ message: 'Validating token...' });
          const validation = await this.validateToken(gitlabUrl, inputToken);

          if (validation.valid) {
            vscode.window.showInformationMessage(
              `✅ GitLab token validated successfully\nAuthenticated as: ${validation.name} (${validation.username})`
            );
            validatedToken = inputToken;
          } else {
            const retry = attempts < maxAttempts;
            const message = retry
              ? `❌ Token validation failed: ${validation.error}\n\nPlease try again.`
              : `❌ Token validation failed: ${validation.error}\n\nMaximum attempts reached.`;

            if (retry) {
              const choice = await vscode.window.showErrorMessage(
                message,
                'Retry',
                'Cancel'
              );
              if (choice !== 'Retry') {
                return undefined;
              }
            } else {
              vscode.window.showErrorMessage(message);
              return undefined;
            }
          }
        }

        return validatedToken;
      });

      if (token) {
        await this.storeToken(gitlabUrl, token);
      }
    }

    if (token) {
      this.tokenCache.set(gitlabUrl, token);
    }

    return token;
  }

  /**
   * Prompt user for GitLab personal access token
   */
  private async promptForToken(gitlabUrl: string, value?: string): Promise<string | undefined> {
    const token = await vscode.window.showInputBox({
      title: `GitLab Authentication for ${gitlabUrl}`,
      prompt: `Enter your GitLab Personal Access Token for ${gitlabUrl}`,
      placeHolder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
      value,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) {
          return 'Token is required';
        }
        // Basic validation - GitLab tokens can have various formats
        // glpat-xxxx (new format), or just alphanumeric with dashes/underscores
        if (value.length < 10) {
          return 'Token seems too short';
        }
        return undefined;
      }
    });

    return token;
  }

  public async requestAndStoreToken(gitlabUrl: string, existing?: string): Promise<string | undefined> {
    const token = await this.promptForToken(gitlabUrl, existing);
    if (token) {
      await this.storeToken(gitlabUrl, token);
    }
    return token;
  }

  /**
   * Get stored token for a GitLab URL
   */
  async getToken(gitlabUrl: string): Promise<string | undefined> {
    // First check cache
    if (this.tokenCache.has(gitlabUrl)) {
      return this.tokenCache.get(gitlabUrl);
    }

    // Then check secure storage
    const token = await this.context.secrets.get(`gitlab-token-${gitlabUrl}`);
    
    if (token) {
      // Update cache
      this.tokenCache.set(gitlabUrl, token);
    }

    return token;
  }

  /**
   * Store token securely for a GitLab URL
   */
  async storeToken(gitlabUrl: string, token: string): Promise<void> {
    // Store in secure storage
    await this.context.secrets.store(`gitlab-token-${gitlabUrl}`, token);

    // Persist in config for management commands
    await this.settingsManager.setGitLabToken(gitlabUrl, token);

    // Update cache
    this.tokenCache.set(gitlabUrl, token);

    vscode.window.showInformationMessage(`GitLab token stored for ${gitlabUrl}`);

    // Refresh any repositories that already use this origin
    void this.updateWorkspaceRemotes(gitlabUrl, token).catch((error) => {
      console.warn('[GitLabTokenManager] Failed to refresh workspace remotes:', error);
    });
  }

  /**
   * Remove token for a GitLab URL
   */
  async removeToken(gitlabUrl: string): Promise<void> {
    // Remove from secure storage
    await this.context.secrets.delete(`gitlab-token-${gitlabUrl}`);
    
    // Remove from cache
    this.tokenCache.delete(gitlabUrl);

    // Remove from persisted config if present
    const settings = await this.settingsManager.getSettings();
    if (settings.workspace?.gitlabTokens && gitlabUrl in settings.workspace.gitlabTokens) {
      delete settings.workspace.gitlabTokens[gitlabUrl];
      await this.settingsManager.saveSettings(settings);
    }
  }

  /**
   * Get all stored GitLab URLs
   */
  async getStoredGitLabUrls(): Promise<string[]> {
    // This is a bit tricky as VS Code doesn't provide a way to list all secrets
    // We'll need to track this separately in settings
    const settings = await this.settingsManager.getSettings();
    return Object.keys(settings.workspace?.gitlabTokens || {});
  }

  /**
   * Clear all tokens
   */
  async clearAllTokens(): Promise<void> {
    const urls = await this.getStoredGitLabUrls();
    for (const url of urls) {
      await this.removeToken(url);
    }
    this.tokenCache.clear();
  }

  /**
   * Build clone URL with token
   */
  buildAuthenticatedCloneUrl(repoUrl: string, token: string): string {
    try {
      const url = new URL(repoUrl);
      // For GitLab, we can use oauth2 as username with the token as password
      url.username = 'oauth2';
      url.password = token;
      return url.toString();
    } catch {
      // If URL parsing fails, try basic concatenation
      return repoUrl.replace('https://', `https://oauth2:${token}@`);
    }
  }

  async refreshWorkspaceGitCredentials(gitlabUrl: string): Promise<void> {
    const token = await this.getToken(gitlabUrl);
    if (!token) {
      return;
    }
    await this.updateWorkspaceRemotes(gitlabUrl, token);
  }

  private async updateWorkspaceRemotes(gitlabUrl: string, token: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    const processed = new Set<string>();

    for (const folder of workspaceFolders) {
      const repoPaths = await this.collectGitRepositories(folder.uri.fsPath);
      for (const repoPath of repoPaths) {
        if (processed.has(repoPath)) {
          continue;
        }
        processed.add(repoPath);
        await this.updateRepositoryRemote(repoPath, gitlabUrl, token);
      }
    }
  }

  private async collectGitRepositories(rootPath: string, maxDepth: number = 3): Promise<string[]> {
    const repositories: string[] = [];
    const stack: Array<{ dir: string; depth: number }> = [{ dir: rootPath, depth: 0 }];
    const skipDirectories = new Set(['.git', 'node_modules', '.vscode', 'dist', 'build', '.idea', 'out']);

    while (stack.length > 0) {
      const current = stack.pop()!;

      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }

      const hasGitDir = entries.some((entry) => entry.isDirectory() && entry.name === '.git');
      if (hasGitDir) {
        repositories.push(current.dir);
        continue;
      }

      if (current.depth >= maxDepth) {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          continue;
        }

        if (skipDirectories.has(entry.name)) {
          continue;
        }

        // Skip hidden directories except .computor (contains workspace metadata)
        if (entry.name.startsWith('.') && entry.name !== '.computor') {
          continue;
        }

        const nextPath = path.join(current.dir, entry.name);
        stack.push({ dir: nextPath, depth: current.depth + 1 });
      }
    }

    return repositories;
  }

  private async updateRepositoryRemote(repoPath: string, gitlabUrl: string, token: string): Promise<void> {
    try {
      const { stdout } = await execAsync('git remote', { cwd: repoPath });
      const remoteNames = stdout
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter((name) => name.length > 0);

      for (const remote of remoteNames) {
        try {
          const { stdout: urlOutput } = await execAsync(`git remote get-url ${remote}`, { cwd: repoPath });
          const currentUrl = urlOutput.trim();
          if (!currentUrl) {
            continue;
          }

          const sanitizedUrl = stripCredentialsFromGitUrl(currentUrl);
          if (!sanitizedUrl) {
            continue;
          }

          const origin = extractOriginFromGitUrl(sanitizedUrl);
          if (!origin || origin !== gitlabUrl) {
            continue;
          }

          const updatedUrl = addTokenToGitUrl(sanitizedUrl, token);
          if (updatedUrl === currentUrl) {
            continue;
          }

          await execAsync(`git remote set-url ${remote} "${updatedUrl}"`, { cwd: repoPath });
          console.log(`[GitLabTokenManager] Updated remote ${remote} for repository ${repoPath}`);
        } catch (remoteError) {
          console.warn(`[GitLabTokenManager] Failed to update remote ${remote} in ${repoPath}:`, remoteError);
        }
      }
    } catch (error) {
      console.warn(`[GitLabTokenManager] Could not enumerate remotes for ${repoPath}:`, error);
    }
  }

  /**
   * Validate a GitLab token by testing it against the GitLab API
   * @param gitlabUrl The GitLab instance URL
   * @param token The token to validate
   * @returns Validation result with user info or error
   */
  async validateToken(gitlabUrl: string, token: string): Promise<{ valid: boolean; name?: string; username?: string; error?: string }> {
    try {
      // Normalize URL and construct API endpoint
      const baseUrl = gitlabUrl.endsWith('/') ? gitlabUrl.slice(0, -1) : gitlabUrl;
      const apiUrl = `${baseUrl}/api/v4/user`;

      const response = await fetch(apiUrl, {
        headers: {
          'PRIVATE-TOKEN': token
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          valid: false,
          error: `HTTP ${response.status}: ${errorText || response.statusText}`
        };
      }

      const userData = await response.json();
      const name = userData.name || 'Unknown';
      const username = userData.username || 'unknown';

      return {
        valid: true,
        name,
        username
      };
    } catch (error: any) {
      console.error('[GitLabTokenManager] Token validation failed:', error);
      return {
        valid: false,
        error: error?.message || String(error)
      };
    }
  }
}
