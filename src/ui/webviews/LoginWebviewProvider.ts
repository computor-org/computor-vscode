import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorSettingsManager } from '../../settings/ComputorSettingsManager';

export interface LoginCredentials {
  username: string;
  password: string;
  enableAutoLogin?: boolean;
  /** The backend URL the user picked / typed in the login form. May differ
   *  from the active baseUrl when the user switches dev / staging / prod. */
  backendUrl?: string;
}

interface LoginInitialState {
  backendUrl: string;
  username: string;
  password: string;
  enableAutoLogin: boolean;
  showAutoLoginToggle: boolean;
  /** Most-recently-used first. The current backendUrl appears here too if previously used. */
  previousBackendUrls: string[];
}

export class LoginWebviewProvider extends BaseWebviewProvider {
  private settingsManager: ComputorSettingsManager;
  private credentialsResolver: ((creds: LoginCredentials | undefined) => void) | undefined;

  constructor(context: vscode.ExtensionContext) {
    super(context, 'computor.loginView');
    this.settingsManager = new ComputorSettingsManager(context);
  }

  /**
   * Open the login webview and wait for the user to submit credentials.
   * Returns the credentials, or undefined if the user closes the panel.
   */
  async promptCredentials(
    previous?: { username?: string; password?: string },
    currentAutoLogin?: boolean
  ): Promise<LoginCredentials | undefined> {
    const backendUrl = await this.settingsManager.getBaseUrl() || '';
    const stored = await this.settingsManager.getPreviousBackendUrls();
    // Ensure the current URL is offered as an option even if it was never recorded yet.
    const previousBackendUrls = backendUrl
      ? [backendUrl, ...stored.filter(u => u.trim().toLowerCase() !== backendUrl.trim().toLowerCase())]
      : stored;

    const initialState: LoginInitialState = {
      backendUrl,
      username: previous?.username || '',
      password: previous?.password || '',
      enableAutoLogin: currentAutoLogin ?? false,
      showAutoLoginToggle: currentAutoLogin === undefined,
      previousBackendUrls,
    };

    // Create a promise that resolves when the user submits or closes
    return new Promise<LoginCredentials | undefined>((resolve) => {
      this.credentialsResolver = resolve;
      this.show('Computor Login', initialState);
    });
  }

  /**
   * Notify the webview of a login failure and wait for the user to retry.
   * Returns new credentials on retry, or undefined if the panel is closed.
   */
  notifyLoginFailed(error?: string): Promise<LoginCredentials | undefined> {
    this.panel?.webview.postMessage({
      command: 'loginResult',
      data: { success: false, error: error || 'Authentication failed.' }
    });

    // Wait for the next submit or panel close
    return new Promise<LoginCredentials | undefined>((resolve) => {
      this.credentialsResolver = resolve;
    });
  }

  /** Close the login panel (call after successful auth). */
  close(): void {
    this.panel?.dispose();
  }

  protected async getWebviewContent(data?: LoginInitialState): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Login', '<p>Loading...</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? {});
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'login.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const validatorsJsUri = this.getWebviewUri(webview, 'webview-ui', 'validators.js');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'login.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Computor Login</title>
      <link rel="stylesheet" href="${componentsCssUri}">
      <link rel="stylesheet" href="${stylesUri}">
    </head>
    <body>
      <div id="app" class="login-root"></div>
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
    if (!message) { return; }

    switch (message.command) {
      case 'login':
        if (this.credentialsResolver) {
          const creds: LoginCredentials = {
            username: message.data.username,
            password: message.data.password,
            enableAutoLogin: message.data.enableAutoLogin,
            backendUrl: typeof message.data.backendUrl === 'string' && message.data.backendUrl.trim().length > 0
              ? message.data.backendUrl.trim()
              : undefined,
          };
          this.credentialsResolver(creds);
          this.credentialsResolver = undefined;
        }
        break;
    }
  }

  protected onPanelDisposed(): void {
    // If the panel is closed without submitting, resolve with undefined
    if (this.credentialsResolver) {
      this.credentialsResolver(undefined);
      this.credentialsResolver = undefined;
    }
  }
}
