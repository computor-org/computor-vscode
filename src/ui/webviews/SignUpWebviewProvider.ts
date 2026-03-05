import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { GitLabTokenManager } from '../../services/GitLabTokenManager';
import { ComputorSettingsManager } from '../../settings/ComputorSettingsManager';
import { GitEnvironmentService } from '../../services/GitEnvironmentService';
import { SetPasswordRequest, PasswordOperationResponse } from '../../types/generated/common';

const execFileAsync = promisify(execFile);

interface GitLabEntry {
  url: string;
  token: string;
}

interface SignUpSubmitData {
  backendUrl: string;
  gitName: string;
  gitEmail: string;
  password: string;
  gitlabEntries: GitLabEntry[];
}

interface StoredGitLabToken {
  url: string;
  hasToken: boolean;
}

interface SignUpInitialState {
  backendUrl: string;
  gitName: string;
  gitEmail: string;
  storedGitLabTokens: StoredGitLabToken[];
}

export class SignUpWebviewProvider extends BaseWebviewProvider {
  private gitLabTokenManager: GitLabTokenManager;
  private settingsManager: ComputorSettingsManager;

  constructor(context: vscode.ExtensionContext) {
    super(context, 'computor.signUpView');
    this.gitLabTokenManager = GitLabTokenManager.getInstance(context);
    this.settingsManager = new ComputorSettingsManager(context);
  }

  async open(): Promise<void> {
    try {
      const initialState = await this.loadInitialState();
      await this.show('Computor Sign Up', initialState);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open sign-up: ${error?.message || error}`);
    }
  }

  protected async getWebviewContent(data?: SignUpInitialState): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Sign Up', '<p>Loading...</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? {});
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'sign-up.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'sign-up.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Computor Sign Up</title>
      <link rel="stylesheet" href="${componentsCssUri}">
      <link rel="stylesheet" href="${stylesUri}">
    </head>
    <body>
      <div id="app" class="sign-up-root"></div>
      <script nonce="${nonce}">
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${nonce}" src="${componentsJsUri}"></script>
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
      case 'submit':
        await this.handleSubmit(message.data);
        break;
      default:
        break;
    }
  }

  private async loadInitialState(): Promise<SignUpInitialState> {
    const backendUrl = await this.settingsManager.getBaseUrl() || '';
    const gitName = await this.getGitConfig('user.name') || '';
    const gitEmail = await this.getGitConfig('user.email') || '';
    const storedGitLabTokens = await this.loadStoredGitLabTokens();

    return { backendUrl, gitName, gitEmail, storedGitLabTokens };
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

  private async handleSubmit(data: SignUpSubmitData): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      this.postProgress('backend', 'Saving backend URL...');
      await this.settingsManager.setBaseUrl(data.backendUrl);

      this.postProgress('git', 'Configuring git...');
      await this.setGitConfig('user.name', data.gitName.trim());
      await this.setGitConfig('user.email', data.gitEmail.trim());

      this.postProgress('password', 'Setting password...');
      await this.setInitialPassword(data);

      this.postProgress('tokens', 'Storing GitLab tokens...');
      for (const entry of data.gitlabEntries) {
        await this.gitLabTokenManager.storeToken(entry.url, entry.token);
      }

      this.panel.webview.postMessage({
        command: 'submitResult',
        data: { success: true }
      });

      vscode.window.showInformationMessage(
        'Password set successfully! Please log in with your new credentials.'
      );
      await vscode.commands.executeCommand('computor.login');
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      console.error('[SignUpWebview] Submit error:', error);
      this.panel?.webview.postMessage({
        command: 'submitResult',
        data: { success: false, error: errorMessage }
      });
    }
  }

  private async setInitialPassword(data: SignUpSubmitData): Promise<void> {
    const firstGitlabEntry = data.gitlabEntries[0];

    const payload: SetPasswordRequest = {
      new_password: data.password,
      confirm_password: data.password,
      provider_auth: firstGitlabEntry
        ? {
            method: 'gitlab_pat',
            credentials: {
              access_token: firstGitlabEntry.token,
              gitlab_url: firstGitlabEntry.url
            }
          }
        : undefined
    };

    const url = `${data.backendUrl}/password/set`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    console.log('[SignUpWebview] Password set successfully:', result);
  }

  private postProgress(step: string, message: string): void {
    this.panel?.webview.postMessage({
      command: 'submitProgress',
      data: { step, message }
    });
  }

  private postNotice(type: string, message: string): void {
    this.panel?.webview.postMessage({
      command: 'notice',
      data: { type, message }
    });
  }
}
