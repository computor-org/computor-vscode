import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';

/**
 * Commands for logging out and clearing credentials
 */
export class LogoutCommands {
  private context: vscode.ExtensionContext;
  private settingsManager: ComputorSettingsManager;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.settingsManager = new ComputorSettingsManager(context);
  }

  registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.logout', async () => {
        await this.handleLogout();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.clearAllData', async () => {
        await this.handleClearAllData();
      })
    );
  }

  /**
   * Logout - clears JWT tokens but keeps username/password for easy re-login
   */
  private async handleLogout(): Promise<void> {
    try {
      const confirmation = await vscode.window.showWarningMessage(
        'Are you sure you want to logout? This will clear your session tokens.\n\n' +
        'Your username and password will be kept for easy re-login.',
        { modal: true },
        'Logout',
        'Cancel'
      );

      if (confirmation !== 'Logout') {
        return;
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Logging out...',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Clearing session tokens...' });

        // Clear only JWT tokens, keep username/password for auto-login
        await this.clearSessionTokens();

        progress.report({ message: 'Clearing session state...' });

        // Clear relevant global state
        await this.clearAuthenticationState();

        progress.report({ message: 'Logout complete.' });
      });

      vscode.window.showInformationMessage(
        'Logged out successfully. Restart VS Code to login again with your saved credentials.',
        'Reload Window'
      ).then(choice => {
        if (choice === 'Reload Window') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
    } catch (error: any) {
      console.error('Logout failed:', error);
      vscode.window.showErrorMessage(`Failed to logout: ${error.message || error}`);
    }
  }

  /**
   * Clear all data - clears credentials, settings, and cached data
   */
  private async handleClearAllData(): Promise<void> {
    try {
      const confirmation = await vscode.window.showWarningMessage(
        'Are you sure you want to clear ALL Computor data? This will remove:\n' +
        '• Authentication credentials\n' +
        '• All settings and preferences\n' +
        '• GitLab tokens\n' +
        '• Cached data\n\n' +
        'This action cannot be undone.',
        { modal: true },
        'Clear All Data',
        'Cancel'
      );

      if (confirmation !== 'Clear All Data') {
        return;
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Clearing all Computor data...',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Clearing authentication credentials...' });

        // Clear authentication secrets
        await this.clearAuthenticationSecrets();

        progress.report({ message: 'Clearing GitLab tokens...' });

        // Clear GitLab tokens
        await this.clearGitLabTokens();

        progress.report({ message: 'Clearing settings...' });

        // Clear settings file
        await this.clearSettingsFile();

        progress.report({ message: 'Clearing global state...' });

        // Clear all global state
        await this.clearAllGlobalState();

        progress.report({ message: 'All data cleared.' });
      });

      vscode.window.showInformationMessage(
        'All Computor data has been cleared successfully. Restart VS Code to start fresh.',
        'Reload Window'
      ).then(choice => {
        if (choice === 'Reload Window') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
    } catch (error: any) {
      console.error('Clear all data failed:', error);
      vscode.window.showErrorMessage(`Failed to clear data: ${error.message || error}`);
    }
  }

  /**
   * Clear session tokens only (JWT tokens), keep username/password
   */
  private async clearSessionTokens(): Promise<void> {
    const tokenKey = 'computor.auth';

    try {
      await this.context.secrets.delete(tokenKey);
      console.log(`[Logout] Deleted session tokens: ${tokenKey}`);
    } catch (error) {
      console.warn(`[Logout] Failed to delete session tokens:`, error);
    }
  }

  /**
   * Clear all authentication-related secrets including username/password
   */
  private async clearAuthenticationSecrets(): Promise<void> {
    const secretKeys = [
      'computor.auth',
      'computor.username',
      'computor.password'
    ];

    for (const key of secretKeys) {
      try {
        await this.context.secrets.delete(key);
        console.log(`[Logout] Deleted secret: ${key}`);
      } catch (error) {
        console.warn(`[Logout] Failed to delete secret ${key}:`, error);
      }
    }
  }

  /**
   * Clear GitLab tokens for all known URLs
   */
  private async clearGitLabTokens(): Promise<void> {
    try {
      const gitlabUrls = await this.settingsManager.getGitLabUrls();

      for (const url of gitlabUrls) {
        const tokenKey = `gitlab-token-${url}`;
        try {
          await this.context.secrets.delete(tokenKey);
          console.log(`[Logout] Deleted GitLab token for: ${url}`);
        } catch (error) {
          console.warn(`[Logout] Failed to delete GitLab token for ${url}:`, error);
        }
      }
    } catch (error) {
      console.warn('[Logout] Failed to retrieve GitLab URLs:', error);
    }
  }

  /**
   * Clear authentication-related global state
   */
  private async clearAuthenticationState(): Promise<void> {
    const stateKeys = [
      'computor.lastUsername',
      'computor.lastBackendUrl'
    ];

    for (const key of stateKeys) {
      try {
        await this.context.globalState.update(key, undefined);
        console.log(`[Logout] Cleared global state: ${key}`);
      } catch (error) {
        console.warn(`[Logout] Failed to clear global state ${key}:`, error);
      }
    }
  }

  /**
   * Clear all Computor-related global state
   */
  private async clearAllGlobalState(): Promise<void> {
    const stateKeys = [
      'computor.lastUsername',
      'computor.lastBackendUrl',
      'computor.tutor.selection',
      'computor.selectedCourse',
      'computor.activeViews'
    ];

    for (const key of stateKeys) {
      try {
        await this.context.globalState.update(key, undefined);
        console.log(`[Logout] Cleared global state: ${key}`);
      } catch (error) {
        console.warn(`[Logout] Failed to clear global state ${key}:`, error);
      }
    }

    // Clear context keys
    const contextKeys = [
      'computor.lecturer.show',
      'computor.student.show',
      'computor.tutor.show'
    ];

    for (const key of contextKeys) {
      try {
        await vscode.commands.executeCommand('setContext', key, false);
        console.log(`[Logout] Cleared context: ${key}`);
      } catch (error) {
        console.warn(`[Logout] Failed to clear context ${key}:`, error);
      }
    }
  }

  /**
   * Clear the settings file
   */
  private async clearSettingsFile(): Promise<void> {
    try {
      const settingsPath = path.join(os.homedir(), '.computor', 'config.json');

      if (fs.existsSync(settingsPath)) {
        await fs.promises.unlink(settingsPath);
        console.log(`[Logout] Deleted settings file: ${settingsPath}`);
      }

      // Also try to remove the .computor directory if it's empty
      const computorDir = path.dirname(settingsPath);
      if (fs.existsSync(computorDir)) {
        const files = await fs.promises.readdir(computorDir);
        if (files.length === 0) {
          await fs.promises.rmdir(computorDir);
          console.log(`[Logout] Removed empty directory: ${computorDir}`);
        }
      }
    } catch (error) {
      console.warn('[Logout] Failed to clear settings file:', error);
    }
  }
}
