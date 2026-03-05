import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { GitLabTokenManager } from '../../services/GitLabTokenManager';
import { ComputorSettingsManager } from '../../settings/ComputorSettingsManager';
import { GitEnvironmentService } from '../../services/GitEnvironmentService';
import { ComputorApiService } from '../../services/ComputorApiService';
import { UserPassword } from '../../types/generated';

const execFileAsync = promisify(execFile);

interface StoredGitLabToken {
  url: string;
  hasToken: boolean;
}

interface SettingsInitialState {
  backendUrl: string;
  gitName: string;
  gitEmail: string;
  storedGitLabTokens: StoredGitLabToken[];
  canChangePassword: boolean;
}

export class SettingsWebviewProvider extends BaseWebviewProvider {
  private gitLabTokenManager: GitLabTokenManager;
  private settingsManager: ComputorSettingsManager;
  private apiService: ComputorApiService | undefined;

  constructor(context: vscode.ExtensionContext, apiService?: ComputorApiService) {
    super(context, 'computor.settingsView');
    this.gitLabTokenManager = GitLabTokenManager.getInstance(context);
    this.settingsManager = new ComputorSettingsManager(context);
    this.apiService = apiService;
  }

  setApiService(apiService: ComputorApiService): void {
    this.apiService = apiService;
  }

  async open(): Promise<void> {
    try {
      const initialState = await this.loadInitialState();
      await this.show('Computor Settings', initialState);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open settings: ${error?.message || error}`);
    }
  }

  protected async getWebviewContent(data?: SettingsInitialState): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Settings', '<p>Loading...</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? {});
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'settings-view.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const validatorsJsUri = this.getWebviewUri(webview, 'webview-ui', 'validators.js');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'settings-view.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Computor Settings</title>
      <link rel="stylesheet" href="${componentsCssUri}">
      <link rel="stylesheet" href="${stylesUri}">
    </head>
    <body>
      <div id="app" class="settings-root"></div>
      <script nonce="${nonce}">
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${nonce}" src="${componentsJsUri}"></script>
      <script nonce="${nonce}" src="${validatorsJsUri}"></script>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }

  protected async handleMessage(message: any): Promise<void> {
    if (!message) {
      return;
    }

    switch (message.command) {
      case 'saveBackendUrl':
        await this.handleSaveBackendUrl(message.data);
        break;
      case 'saveGitConfig':
        await this.handleSaveGitConfig(message.data);
        break;
      case 'validateGitLabToken':
        await this.handleValidateGitLabToken(message.data);
        break;
      case 'saveGitLabToken':
        await this.handleSaveGitLabToken(message.data);
        break;
      case 'removeGitLabToken':
        await this.handleRemoveGitLabToken(message.data);
        break;
      case 'changePassword':
        await this.handleChangePassword(message.data);
        break;
      default:
        break;
    }
  }

  private async loadInitialState(): Promise<SettingsInitialState> {
    const backendUrl = await this.settingsManager.getBaseUrl() || '';
    const gitName = await this.getGitConfig('user.name') || '';
    const gitEmail = await this.getGitConfig('user.email') || '';
    const storedGitLabTokens = await this.loadStoredGitLabTokens();

    let canChangePassword = false;
    try {
      const username = await this.context.secrets.get('computor.username');
      if (username) {
        canChangePassword = true;
      }
    } catch {
      // Not logged in or no password-based auth
    }

    return { backendUrl, gitName, gitEmail, storedGitLabTokens, canChangePassword };
  }

  private async loadStoredGitLabTokens(): Promise<StoredGitLabToken[]> {
    const urls = await this.gitLabTokenManager.getStoredGitLabUrls();
    const tokens: StoredGitLabToken[] = [];
    for (const url of urls) {
      const token = await this.gitLabTokenManager.getToken(url);
      tokens.push({ url, hasToken: !!token });
    }
    return tokens;
  }

  private async getGitConfig(key: string): Promise<string | undefined> {
    try {
      const gitBinary = await GitEnvironmentService.getInstance().getGitBinaryPath();
      if (!gitBinary) {
        return undefined;
      }
      const { stdout } = await execFileAsync(gitBinary, ['config', '--global', '--get', key]);
      const value = stdout.trim();
      return value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private async setGitConfig(key: string, value: string): Promise<void> {
    const gitBinary = await GitEnvironmentService.getInstance().getGitBinaryPath();
    if (!gitBinary) {
      throw new Error('Git is required but was not found. Install Git and ensure it is available on your PATH.');
    }
    await execFileAsync(gitBinary, ['config', '--global', key, value]);
  }

  private async handleSaveBackendUrl(data: { backendUrl: string }): Promise<void> {
    try {
      await this.settingsManager.setBaseUrl(data.backendUrl.trim());
      this.postNotice('success', 'Backend URL saved.');
    } catch (error: any) {
      this.postNotice('error', `Failed to save backend URL: ${error?.message || error}`);
    }
  }

  private async handleSaveGitConfig(data: { gitName: string; gitEmail: string }): Promise<void> {
    try {
      await this.setGitConfig('user.name', data.gitName.trim());
      await this.setGitConfig('user.email', data.gitEmail.trim());
      this.postNotice('success', 'Git configuration saved.');
    } catch (error: any) {
      this.postNotice('error', `Failed to save git config: ${error?.message || error}`);
    }
  }

  private async handleValidateGitLabToken(data: { url: string; token: string }): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      const validation = await this.gitLabTokenManager.validateToken(data.url, data.token);
      this.panel.webview.postMessage({
        command: 'validationResult',
        data: {
          url: data.url,
          valid: validation.valid,
          name: validation.name,
          username: validation.username,
          error: validation.error
        }
      });
    } catch (error: any) {
      this.panel.webview.postMessage({
        command: 'validationResult',
        data: {
          url: data.url,
          valid: false,
          error: error?.message || 'Validation failed'
        }
      });
    }
  }

  private async handleSaveGitLabToken(data: { url: string; token: string }): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      await this.gitLabTokenManager.storeToken(data.url, data.token);
      const storedGitLabTokens = await this.loadStoredGitLabTokens();
      this.panel.webview.postMessage({
        command: 'gitLabTokenSaved',
        data: { url: data.url, storedGitLabTokens }
      });
      this.postNotice('success', `GitLab token saved for ${data.url}.`);
    } catch (error: any) {
      this.postNotice('error', `Failed to save GitLab token: ${error?.message || error}`);
    }
  }

  private async handleRemoveGitLabToken(data: { url: string }): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      await this.gitLabTokenManager.removeToken(data.url);
      const storedGitLabTokens = await this.loadStoredGitLabTokens();
      this.panel.webview.postMessage({
        command: 'gitLabTokenRemoved',
        data: { url: data.url, storedGitLabTokens }
      });
      this.postNotice('success', `GitLab token removed for ${data.url}.`);
    } catch (error: any) {
      this.postNotice('error', `Failed to remove GitLab token: ${error?.message || error}`);
    }
  }

  private async handleChangePassword(raw: any): Promise<void> {
    if (!this.panel) {
      return;
    }

    const currentPassword = typeof raw?.currentPassword === 'string' ? raw.currentPassword : undefined;
    const newPassword = typeof raw?.newPassword === 'string' ? raw.newPassword : undefined;
    const confirmPassword = typeof raw?.confirmPassword === 'string' ? raw.confirmPassword : undefined;

    if (!currentPassword) {
      this.postNotice('error', 'Current password is required.');
      return;
    }
    if (!newPassword) {
      this.postNotice('error', 'New password cannot be empty.');
      return;
    }
    if (newPassword !== confirmPassword) {
      this.postNotice('error', 'New password and confirmation do not match.');
      return;
    }

    if (!this.apiService) {
      this.postNotice('error', 'Password changes require an active login session.');
      return;
    }

    let username: string | undefined;
    try {
      username = await this.context.secrets.get('computor.username');
    } catch {
      username = undefined;
    }

    if (!username) {
      this.postNotice('error', 'Password changes are only available for password-based authentication.');
      return;
    }

    try {
      const payload: UserPassword = {
        password_old: currentPassword,
        password: newPassword
      };
      await this.apiService.updateUserPassword(payload);
      await this.updateStoredCredentials(username, newPassword);
      this.postNotice('success', 'Password updated successfully.');
    } catch (error: any) {
      const detail = error?.message || error?.response?.data?.detail || String(error);
      this.postNotice('error', `Failed to update password: ${detail}`);
    }
  }

  private async updateStoredCredentials(username: string, newPassword: string): Promise<void> {
    try {
      await this.context.secrets.store('computor.username', username);
      await this.context.secrets.store('computor.password', newPassword);
    } catch (error) {
      console.warn('[SettingsWebview] Failed to persist updated credentials:', error);
    }
  }

  private postNotice(type: string, message: string): void {
    this.panel?.webview.postMessage({
      command: 'notice',
      data: { type, message }
    });
  }
}
