import * as vscode from 'vscode';
import { GitLabTokenManager } from '../services/GitLabTokenManager';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { SetPasswordRequest, PasswordOperationResponse } from '../types/generated/common';

/**
 * Commands for user sign-up (initial password setup)
 *
 * This handles the case where a user doesn't have a password yet and needs to:
 * 1. Authenticate with GitLab PAT + GitLab URL
 * 2. Set their initial password via /password/set endpoint
 * 3. Store the GitLab token for future use
 * 4. Trigger the login flow
 */
export class SignUpCommands {
  private gitLabTokenManager: GitLabTokenManager;
  private settingsManager: ComputorSettingsManager;

  constructor(private context: vscode.ExtensionContext) {
    this.gitLabTokenManager = GitLabTokenManager.getInstance(context);
    this.settingsManager = new ComputorSettingsManager(context);
  }

  register(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.signUp', () => this.signUp())
    );
  }

  private async signUp(): Promise<void> {
    try {
      // Step 1: Ensure we have a backend URL
      const baseUrl = await this.ensureBaseUrl();
      if (!baseUrl) {
        return;
      }

      // Step 2: Prompt for GitLab URL
      const gitlabUrl = await this.promptForGitLabUrl();
      if (!gitlabUrl) {
        return;
      }

      // Step 3: Prompt for GitLab Personal Access Token
      const gitlabToken = await this.promptForGitLabToken(gitlabUrl);
      if (!gitlabToken) {
        return;
      }

      // Step 4: Validate the GitLab token
      const isValid = await this.validateGitLabToken(gitlabUrl, gitlabToken);
      if (!isValid) {
        return;
      }

      // Step 5: Prompt for new password
      const password = await this.promptForPassword();
      if (!password) {
        return;
      }

      // Step 6: Call /password/set endpoint with provider_auth
      await this.setInitialPassword(baseUrl, gitlabUrl, gitlabToken, password);

      // Step 7: Store the GitLab token
      await this.gitLabTokenManager.storeToken(gitlabUrl, gitlabToken);

      // Step 8: Trigger login flow
      vscode.window.showInformationMessage(
        'Password set successfully! Please log in with your new credentials.'
      );
      await vscode.commands.executeCommand('computor.login');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Sign-up failed: ${error?.message || error}`);
      console.error('[SignUpCommands] Sign-up error:', error);
    }
  }

  private async ensureBaseUrl(): Promise<string | undefined> {
    const existingBaseUrl = await this.settingsManager.getBaseUrl();

    if (existingBaseUrl) {
      return existingBaseUrl;
    }

    const baseUrl = await vscode.window.showInputBox({
      title: 'Computor Sign Up - Backend URL',
      prompt: 'Enter the Computor backend URL',
      placeHolder: 'http://localhost:8000',
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          new URL(value);
          return undefined;
        } catch {
          return 'Enter a valid URL';
        }
      }
    });

    if (!baseUrl) {
      return undefined;
    }

    await this.settingsManager.setBaseUrl(baseUrl);
    return baseUrl;
  }

  private async promptForGitLabUrl(): Promise<string | undefined> {
    const gitlabUrl = await vscode.window.showInputBox({
      title: 'Computor Sign Up - GitLab URL',
      prompt: 'Enter your GitLab instance URL (for authentication)',
      placeHolder: 'https://gitlab.com',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) {
          return 'GitLab URL is required';
        }
        try {
          const url = new URL(value);
          if (!url.protocol.startsWith('http')) {
            return 'URL must start with http:// or https://';
          }
          return undefined;
        } catch {
          return 'Enter a valid URL';
        }
      }
    });

    if (!gitlabUrl) {
      return undefined;
    }

    // Normalize to origin (remove trailing slash and path)
    try {
      const url = new URL(gitlabUrl);
      return url.origin;
    } catch {
      return gitlabUrl;
    }
  }

  private async promptForGitLabToken(gitlabUrl: string): Promise<string | undefined> {
    const token = await vscode.window.showInputBox({
      title: 'Computor Sign Up - GitLab Token',
      prompt: `Enter your GitLab Personal Access Token for ${gitlabUrl}`,
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

  private async validateGitLabToken(gitlabUrl: string, token: string): Promise<boolean> {
    return await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Validating GitLab token...',
      cancellable: false
    }, async () => {
      const validation = await this.gitLabTokenManager.validateToken(gitlabUrl, token);

      if (validation.valid) {
        vscode.window.showInformationMessage(
          `✓ GitLab token validated successfully\nAuthenticated as: ${validation.name} (${validation.username})`
        );
        return true;
      } else {
        vscode.window.showErrorMessage(
          `GitLab token validation failed: ${validation.error}`
        );
        return false;
      }
    });
  }

  private async promptForPassword(): Promise<string | undefined> {
    const newPassword = await vscode.window.showInputBox({
      title: 'Computor Sign Up - New Password',
      prompt: 'Enter your new password (minimum 12 characters)',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) {
          return 'Password is required';
        }
        if (value.length < 12) {
          return 'Password must be at least 12 characters';
        }
        return undefined;
      }
    });

    if (!newPassword) {
      return undefined;
    }

    const confirmPassword = await vscode.window.showInputBox({
      title: 'Computor Sign Up - Confirm Password',
      prompt: 'Confirm your new password',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) {
          return 'Password confirmation is required';
        }
        if (value !== newPassword) {
          return 'Passwords do not match';
        }
        return undefined;
      }
    });

    if (!confirmPassword) {
      return undefined;
    }

    return newPassword;
  }

  private async setInitialPassword(
    baseUrl: string,
    gitlabUrl: string,
    gitlabToken: string,
    password: string
  ): Promise<void> {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Setting initial password...',
      cancellable: false
    }, async () => {
      const payload: SetPasswordRequest = {
        new_password: password,
        confirm_password: password,
        provider_auth: {
          method: 'gitlab_pat',
          credentials: {
            access_token: gitlabToken,
            gitlab_url: gitlabUrl
          }
        }
      };

      const url = `${baseUrl}/password/set`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.detail) {
            errorMessage = errorJson.detail;
          } else if (errorJson.message) {
            errorMessage = errorJson.message;
          }
        } catch {
          if (errorText) {
            errorMessage = errorText;
          }
        }

        throw new Error(errorMessage);
      }

      const result: PasswordOperationResponse = await response.json();
      console.log('[SignUpCommands] Password set successfully:', result);
    });
  }
}
