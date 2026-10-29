import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { commandRegistrar } from './commandHelpers';
import { notify } from '../utils/notify';
import { say, sayFailed } from '../utils/uiLanguage';

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

    const register = commandRegistrar(this.context);
    register('computor.logout', async () => {
      await this.handleLogout();
    });

    register('computor.clearAllData', async () => {
      await this.handleClearAllData();
    });
  }

  /**
   * Sign out - clears the stored SSO session token (and any stored API token).
   * The user signs back in through the browser SSO flow.
   */
  private async handleLogout(): Promise<void> {
    try {
      const confirmation = await notify.confirm(
        say(
          'Sign out of Computor? This clears your stored session on this machine. ' +
          'You will sign in again through your browser (SSO).',
          'Von Computor abmelden? Dabei wird deine gespeicherte Sitzung auf diesem Rechner gelöscht. ' +
          'Du meldest dich danach wieder über deinen Browser an (SSO).'
        ),
        say('Sign Out', 'Abmelden')
      );

      if (!confirmation) {
        return;
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: say('Signing out…', 'Abmeldung läuft …'),
        cancellable: false
      }, async (progress) => {
        progress.report({ message: say('Clearing stored session…', 'Gespeicherte Sitzung wird gelöscht …') });
        await this.clearSessionTokens();

        progress.report({ message: say('Clearing session state…', 'Sitzungsdaten werden gelöscht …') });
        await this.clearAuthenticationState();

        progress.report({ message: say('Sign-out complete.', 'Abmeldung abgeschlossen.') });
      });

      const reload = say('Reload Window', 'Fenster neu laden');
      const endSession = say('End Browser Session', 'Browser-Sitzung beenden');
      const choice = await notify.info(
        say(
          'Signed out. Reload the window to finish, or also end your browser SSO session.',
          'Du bist abgemeldet. Lade das Fenster neu, um abzuschließen, oder beende auch deine SSO-Sitzung im Browser.'
        ),
        reload,
        endSession
      );
      if (choice === reload) {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      } else if (choice === endSession) {
        await this.endKeycloakSession();
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    } catch (error: any) {
      console.error('Logout failed:', error);
      notify.error(sayFailed(`Failed to sign out`, `Die Abmeldung ist fehlgeschlagen`, error.message || error));
    }
  }

  /** Open the Keycloak end-session URL in the browser to end the SSO session. */
  private async endKeycloakSession(): Promise<void> {
    try {
      const baseUrl = await this.settingsManager.getBaseUrl();
      if (!baseUrl) { return; }
      const url = `${baseUrl.replace(/\/$/, '')}/auth/keycloak/logout`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      console.warn('[Logout] Failed to open Keycloak logout URL:', error);
    }
  }

  /**
   * Clear all data - clears credentials, settings, and cached data
   */
  private async handleClearAllData(): Promise<void> {
    try {
      const confirmation = await notify.confirm(
        say(
          'Are you sure you want to clear ALL Computor data? This will remove:\n' +
          '• Authentication credentials\n' +
          '• All settings and preferences\n' +
          '• GitLab tokens\n' +
          '• Cached data\n\n' +
          'This action cannot be undone.',
          'Willst du wirklich ALLE Computor-Daten löschen? Dabei werden entfernt:\n' +
          '• Anmeldedaten\n' +
          '• alle Einstellungen\n' +
          '• GitLab-Tokens\n' +
          '• zwischengespeicherte Daten\n\n' +
          'Das lässt sich nicht rückgängig machen.'
        ),
        say('Clear All Data', 'Alle Daten löschen')
      );

      if (!confirmation) {
        return;
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: say('Clearing all Computor data…', 'Alle Computor-Daten werden gelöscht …'),
        cancellable: false
      }, async (progress) => {
        progress.report({ message: say('Clearing authentication credentials…', 'Anmeldedaten werden gelöscht …') });

        // Clear authentication secrets
        await this.clearAuthenticationSecrets();

        progress.report({ message: say('Clearing GitLab tokens…', 'GitLab-Tokens werden gelöscht …') });

        // Clear GitLab tokens
        await this.clearGitLabTokens();

        progress.report({ message: say('Clearing settings…', 'Einstellungen werden gelöscht …') });

        // Clear settings file
        await this.clearSettingsFile();

        progress.report({ message: say('Clearing global state…', 'Gespeicherter Zustand wird gelöscht …') });

        // Clear all global state
        await this.clearAllGlobalState();

        progress.report({ message: say('All data cleared.', 'Alle Daten gelöscht.') });
      });

      const reload = say('Reload Window', 'Fenster neu laden');
      notify.info(
        say(
          'All Computor data has been cleared successfully. Restart VS Code to start fresh.',
          'Alle Computor-Daten wurden gelöscht. Starte VS Code neu, um von vorn zu beginnen.'
        ),
        reload
      ).then(choice => {
        if (choice === reload) {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
    } catch (error: any) {
      console.error('Clear all data failed:', error);
      notify.error(sayFailed(`Failed to clear data`, `Die Daten konnten nicht gelöscht werden`, error.message || error));
    }
  }

  /**
   * Clear the stored SSO session token and any stored API token.
   */
  private async clearSessionTokens(): Promise<void> {
    for (const key of ['computor.auth', 'computor.apiToken']) {
      try {
        await this.context.secrets.delete(key);
        console.log(`[Logout] Deleted secret: ${key}`);
      } catch (error) {
        console.warn(`[Logout] Failed to delete secret ${key}:`, error);
      }
    }
  }

  /**
   * Clear all authentication-related secrets (session token + API token).
   */
  private async clearAuthenticationSecrets(): Promise<void> {
    const secretKeys = [
      'computor.auth',
      'computor.apiToken'
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
    // Logging out is the one place that forgets things — the session teardown
    // used to clear the tutor selection on every window close, which is why
    // it never survived a reopen (computor-org/issues#285).
    const stateKeys = [
      'computor.lastUsername',
      'computor.lastBackendUrl',
      'computor.tutor.selection',
      'computor.selectedCourse',
      'computor.activeViews',
      'computor.ui.state'
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
