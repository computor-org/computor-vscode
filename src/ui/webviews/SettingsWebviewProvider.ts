import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { RepositoryTokenManager } from '../../services/RepositoryTokenManager';
import { ComputorSettingsManager } from '../../settings/ComputorSettingsManager';
import { GitEnvironmentService } from '../../services/GitEnvironmentService';
import { BackendConnectionService } from '../../services/BackendConnectionService';

const execFileAsync = promisify(execFile);

interface StoredProviderToken {
  url: string;
  hasToken: boolean;
}

interface SettingsInitialState {
  backendUrl: string;
  gitName: string;
  gitEmail: string;
  storedProviderTokens: StoredProviderToken[];
}

export class SettingsWebviewProvider extends BaseWebviewProvider {
  private providerTokenManager: RepositoryTokenManager;
  private settingsManager: ComputorSettingsManager;

  constructor(context: vscode.ExtensionContext) {
    super(context, 'computor.settingsView');
    this.providerTokenManager = RepositoryTokenManager.getInstance(context);
    this.settingsManager = new ComputorSettingsManager(context);
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

    return this.renderPage({
      title: 'Computor Settings',
      bodyHtml: '<div id="app" class="settings-root"></div>',
      cssFiles: ['settings-view.css'],
      scriptFiles: ['validators.js', 'settings-view.js'],
      initialState: data ?? {}
    });
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
      case 'validateBackendUrl':
        await this.handleValidateBackendUrl(message.data);
        break;
      case 'validateProviderToken':
        await this.handleValidateProviderToken(message.data);
        break;
      case 'saveProviderToken':
        await this.handleSaveProviderToken(message.data);
        break;
      case 'removeProviderToken':
        await this.handleRemoveProviderToken(message.data);
        break;
      default:
        break;
    }
  }

  private async loadInitialState(): Promise<SettingsInitialState> {
    const backendUrl = await this.settingsManager.getBaseUrl() || '';
    const gitName = await this.getGitConfig('user.name') || '';
    const gitEmail = await this.getGitConfig('user.email') || '';
    const storedProviderTokens = await this.loadStoredProviderTokens();

    return { backendUrl, gitName, gitEmail, storedProviderTokens };
  }

  private async loadStoredProviderTokens(): Promise<StoredProviderToken[]> {
    const urls = await this.providerTokenManager.getStoredProviderUrls();
    const tokens: StoredProviderToken[] = [];
    for (const url of urls) {
      const token = await this.providerTokenManager.getToken(url);
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

  private async handleValidateBackendUrl(data: { url: string }): Promise<void> {
    if (!this.panel) {
      return;
    }

    const status = await BackendConnectionService.getInstance().checkBackendConnection(data.url.trim());
    this.panel.webview.postMessage({
      command: 'backendUrlValidationResult',
      data: {
        valid: status.isReachable,
        error: status.message
      }
    });
  }

  private async handleValidateProviderToken(data: { url: string; token: string }): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      const validation = await this.providerTokenManager.validateToken(data.url, data.token);
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

  private async handleSaveProviderToken(data: { url: string; token: string }): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      await this.providerTokenManager.storeToken(data.url, data.token);
      const storedProviderTokens = await this.loadStoredProviderTokens();
      this.panel.webview.postMessage({
        command: 'providerTokenSaved',
        data: { url: data.url, storedProviderTokens }
      });
      this.postNotice('success', `Provider token saved for ${data.url}.`);
    } catch (error: any) {
      this.postNotice('error', `Failed to save Provider token: ${error?.message || error}`);
    }
  }

  private async handleRemoveProviderToken(data: { url: string }): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      await this.providerTokenManager.removeToken(data.url);
      const storedProviderTokens = await this.loadStoredProviderTokens();
      this.panel.webview.postMessage({
        command: 'providerTokenRemoved',
        data: { url: data.url, storedProviderTokens }
      });
      this.postNotice('success', `Provider token removed for ${data.url}.`);
    } catch (error: any) {
      this.postNotice('error', `Failed to remove Provider token: ${error?.message || error}`);
    }
  }

  private postNotice(type: string, message: string): void {
    this.panel?.webview.postMessage({
      command: 'notice',
      data: { type, message }
    });
  }
}
