import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { OrganizationList, CourseList } from '../types/generated';
import { execAsync } from '../utils/exec';
import { addTokenToGitUrl, extractOriginFromGitUrl, stripCredentialsFromGitUrl } from '../utils/gitUrlHelpers';
import { notify } from '../utils/notify';

/**
 * GitLab Token Manager - Singleton service for managing GitLab tokens
 * Used by all views (lecturer, tutor, student) to access GitLab repositories
 */
export class RepositoryTokenManager {
  private static instance: RepositoryTokenManager;
  private settingsManager: ComputorSettingsManager;
  private tokenCache: Map<string, string> = new Map();

  private constructor(private context: vscode.ExtensionContext) {
    this.settingsManager = new ComputorSettingsManager(context);
  }

  /**
   * Get the singleton instance
   */
  static getInstance(context: vscode.ExtensionContext): RepositoryTokenManager {
    if (!RepositoryTokenManager.instance) {
      RepositoryTokenManager.instance = new RepositoryTokenManager(context);
      void RepositoryTokenManager.instance.migrateOldTokens();
    }
    return RepositoryTokenManager.instance;
  }

  /**
   * Migrate old tokens from JSON config to URL tracking
   * This handles the case where tokens were stored in plain text before the security fix
   */
  private async migrateOldTokens(): Promise<void> {
    try {
      const settings = await this.settingsManager.getSettings();
      const legacyTokens = (settings.workspace as any)?.gitlabTokens;

      if (legacyTokens && typeof legacyTokens === 'object' && Object.keys(legacyTokens).length > 0) {
        console.log('[RepositoryTokenManager] Migrating legacy tokens from JSON config...');

        for (const [url, token] of Object.entries(legacyTokens)) {
          if (typeof token === 'string' && token.length > 0) {
            await this.context.secrets.store(`gitlab-token-${url}`, token);
            await this.settingsManager.addGitLabUrl(url);
            console.log(`[RepositoryTokenManager] Migrated token for ${url}`);
          }
        }

        delete (settings.workspace as any).gitlabTokens;
        await this.settingsManager.saveSettings(settings);
        console.log('[RepositoryTokenManager] Migration complete, legacy tokens removed from JSON');
      }
    } catch (error) {
      console.warn('[RepositoryTokenManager] Migration failed, but continuing:', error);
    }
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
            notify.info(
              `✅ GitLab token validated successfully\nAuthenticated as: ${validation.name} (${validation.username})`
            );
            validatedToken = inputToken;
          } else {
            const retry = attempts < maxAttempts;
            const message = retry
              ? `❌ Token validation failed: ${validation.error}\n\nPlease try again.`
              : `❌ Token validation failed: ${validation.error}\n\nMaximum attempts reached.`;

            if (retry) {
              const choice = await notify.error(
                message,
                'Retry',
                'Cancel'
              );
              if (choice !== 'Retry') {
                return undefined;
              }
            } else {
              notify.error(message);
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
   * Read the rotated clone token that {@link StudentRepositoryProvisioningService}
   * stored for a backend-managed Forgejo server (`forgejo-token-<origin>`).
   *
   * Present only for backend-hosted Forgejo repos, whose credentials the backend
   * issues and embeds in the git remote — never prompts. Returns undefined for
   * self-hosted GitLab (BYO), which is the only case that needs a manual token.
   */
  async getManagedForgejoToken(serverUrl: string): Promise<string | undefined> {
    return this.context.secrets.get(`forgejo-token-${serverUrl}`);
  }

  /**
   * Persist the backend-issued Forgejo clone token. Rotated on every provision
   * call, so whoever re-provisions must store the fresh one here (same key the
   * provisioning service writes).
   */
  async storeManagedForgejoToken(serverUrl: string, token: string): Promise<void> {
    await this.context.secrets.store(`forgejo-token-${serverUrl}`, token);
  }

  /**
   * Store token securely for a GitLab URL
   */
  async storeToken(gitlabUrl: string, token: string): Promise<void> {
    // Store in secure storage ONLY
    await this.context.secrets.store(`gitlab-token-${gitlabUrl}`, token);

    // Track the URL (but NOT the token) in config for management UI
    await this.settingsManager.addGitLabUrl(gitlabUrl);

    // Update cache
    this.tokenCache.set(gitlabUrl, token);

    notify.info(`GitLab token stored for ${gitlabUrl}`);

    // Refresh any repositories that already use this origin
    void this.updateWorkspaceRemotes(gitlabUrl, token).catch((error) => {
      console.warn('[RepositoryTokenManager] Failed to refresh workspace remotes:', error);
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

    // Remove the URL from config tracking
    await this.settingsManager.removeGitLabUrl(gitlabUrl);
  }

  /**
   * Get all stored GitLab URLs
   */
  async getStoredProviderUrls(): Promise<string[]> {
    // Get tracked URLs from settings (VS Code doesn't provide a way to list all secrets)
    return await this.settingsManager.getGitLabUrls();
  }

  /**
   * Clear all tokens
   */
  async clearAllTokens(): Promise<void> {
    const urls = await this.getStoredProviderUrls();
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
      return addTokenToGitUrl(repoUrl, token);
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
          console.log(`[RepositoryTokenManager] Updated remote ${remote} for repository ${repoPath}`);
        } catch (remoteError) {
          console.warn(`[RepositoryTokenManager] Failed to update remote ${remote} in ${repoPath}:`, remoteError);
        }
      }
    } catch (error) {
      console.warn(`[RepositoryTokenManager] Could not enumerate remotes for ${repoPath}:`, error);
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
      // Try both provider APIs: GitLab (/api/v4 + PRIVATE-TOKEN) and Forgejo/Gitea
      // (/api/v1 + Authorization: token). The first that returns a user wins.
      const baseUrl = gitlabUrl.endsWith('/') ? gitlabUrl.slice(0, -1) : gitlabUrl;
      const attempts: Array<{ url: string; headers: Record<string, string> }> = [
        { url: `${baseUrl}/api/v4/user`, headers: { 'PRIVATE-TOKEN': token } },
        { url: `${baseUrl}/api/v1/user`, headers: { 'Authorization': `token ${token}` } }
      ];
      let lastError = '';
      for (const attempt of attempts) {
        const response = await fetch(attempt.url, { headers: attempt.headers });
        if (response.ok) {
          const userData = await response.json();
          return {
            valid: true,
            name: userData.name || userData.full_name || 'Unknown',
            username: userData.username || userData.login || 'unknown'
          };
        }
        const errorText = await response.text();
        lastError = `HTTP ${response.status}: ${errorText || response.statusText}`;
      }
      return { valid: false, error: lastError || 'Token validation failed' };
    } catch (error: any) {
      console.error('[RepositoryTokenManager] Token validation failed:', error);
      return {
        valid: false,
        error: error?.message || String(error)
      };
    }
  }
}
