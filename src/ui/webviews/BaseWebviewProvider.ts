import * as vscode from 'vscode';
import * as path from 'path';

export abstract class BaseWebviewProvider {
  protected readonly context: vscode.ExtensionContext;
  protected panel: vscode.WebviewPanel | undefined;
  protected readonly viewType: string;
  protected currentData: any;
  private readonly resourceRoots: vscode.Uri[];

  constructor(context: vscode.ExtensionContext, viewType: string, extraResourceRoots: vscode.Uri[] = []) {
    this.context = context;
    this.viewType = viewType;
    this.resourceRoots = [
      vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
      vscode.Uri.file(path.join(this.context.extensionPath, 'webview-ui')),
      ...extraResourceRoots
    ];
  }

  public async show(title: string, data?: any): Promise<void> {
    // Store current data
    this.currentData = data;
    
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        this.viewType,
        title,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: this.resourceRoots
        }
      );

      this.panel.webview.html = await this.getWebviewContent(data);
      
      this.panel.webview.onDidReceiveMessage(
        message => this.handleMessage(message),
        undefined,
        this.context.subscriptions
      );

      this.panel.onDidDispose(
        () => {
          this.onPanelDisposed();
          this.panel = undefined;
          this.currentData = undefined;
        },
        undefined,
        this.context.subscriptions
      );
    }

    if (this.panel && this.panel.title !== title) {
      this.panel.title = title;
    }

    // Update content if data is provided
    if (data && this.panel) {
      this.panel.webview.postMessage({ command: 'update', data });
    }
  }

  protected abstract getWebviewContent(data?: any): Promise<string>;
  protected abstract handleMessage(message: any): Promise<void>;

  /** Called when the webview panel is closed. Override to clean up resources. */
  protected onPanelDisposed(): void {
    // Override in subclasses if cleanup is needed
  }

  protected getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
  }

  protected getWebviewUri(webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, ...pathSegments)));
  }

  protected getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  protected getBaseHtml(title: string, content: string): string {
    const nonce = this.getNonce();
    
    // Replace nonce placeholders in content
    const contentWithNonce = content.replace(/{{NONCE}}/g, nonce);
    
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel?.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>${title}</title>
      <style>
        body {
          padding: 20px;
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
        }
        h1, h2, h3 {
          color: var(--vscode-titleBar-activeForeground);
        }
        .button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 16px;
          cursor: pointer;
          border-radius: 4px;
          font-size: 14px;
        }
        .button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        .button.secondary {
          background-color: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
        }
        .button.secondary:hover {
          background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .form-group {
          margin-bottom: 16px;
        }
        label {
          display: block;
          margin-bottom: 4px;
          font-weight: 500;
        }
        input, textarea, select {
          width: 100%;
          padding: 8px;
          border: 1px solid var(--vscode-input-border);
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border-radius: 4px;
        }
        input:focus, textarea:focus, select:focus {
          outline: none;
          border-color: var(--vscode-focusBorder);
        }
        .info-section {
          background-color: var(--vscode-textBlockQuote-background);
          border-left: 4px solid var(--vscode-textBlockQuote-border);
          padding: 16px;
          margin: 16px 0;
        }
        .actions {
          display: flex;
          gap: 8px;
          margin-top: 16px;
        }
        .status {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          display: inline-block;
        }
        .status.success {
          background-color: var(--vscode-testing-passBorder);
          color: var(--vscode-testing-passIcon);
        }
        .status.pending {
          background-color: var(--vscode-testing-queuedBorder);
          color: var(--vscode-testing-queuedIcon);
        }
        .status.error {
          background-color: var(--vscode-testing-failBorder);
          color: var(--vscode-testing-failIcon);
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${contentWithNonce}
      </div>
      <script nonce="${nonce}">
        const vscode = window.vscodeApi || acquireVsCodeApi();
        window.vscodeApi = vscode;
        
        // Handle messages from extension
        window.addEventListener('message', event => {
          const message = event.data;
          if (message.command === 'update') {
            updateView(message.data);
          }
        });
        
        // Send message to extension
        function sendMessage(command, data) {
          vscode.postMessage({ command, data });
        }
        
        // Update view function (to be implemented in specific views)
        function updateView(data) {
          // Override in specific implementations
        }
      </script>
    </body>
    </html>`;
  }
}
