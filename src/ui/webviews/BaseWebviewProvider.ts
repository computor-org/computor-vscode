import * as vscode from 'vscode';
import * as path from 'path';
import { renderWebviewPage, getNonce, WebviewPageOptions } from './shared/webviewPage';
import { AUX_COLUMN, ensureAuxColumn } from '../editorLayout';

export abstract class BaseWebviewProvider {
  protected readonly context: vscode.ExtensionContext;
  protected panel: vscode.WebviewPanel | undefined;
  protected readonly viewType: string;
  protected currentData: any;
  protected isPanelVisible = false;
  private readonly resourceRoots: vscode.Uri[];

  constructor(context: vscode.ExtensionContext, viewType: string, extraResourceRoots: vscode.Uri[] = []) {
    this.context = context;
    this.viewType = viewType;
    this.resourceRoots = [
      vscode.Uri.file(path.join(this.context.extensionPath, 'webview-ui')),
      ...extraResourceRoots
    ];
  }

  /**
   * Which editor group this panel belongs in. Subclasses that are auxiliary
   * surfaces (messages, comments) override with AUX_COLUMN so they join the
   * figures/README group instead of covering the sources.
   */
  protected readonly column: vscode.ViewColumn = vscode.ViewColumn.One;

  public async show(title: string, data?: any, opts?: { preserveFocus?: boolean }): Promise<void> {
    // Store current data
    this.currentData = data;

    if (this.column === AUX_COLUMN) {
      await ensureAuxColumn();
    }

    if (this.panel) {
      // An explicit column: reveal(undefined) means "the active group", which
      // slowly migrated any re-shown panel to wherever focus happened to be.
      this.panel.reveal(this.column, opts?.preserveFocus ?? false);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        this.viewType,
        title,
        { viewColumn: this.column, preserveFocus: opts?.preserveFocus ?? false },
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
          this.isPanelVisible = false;
        },
        undefined,
        this.context.subscriptions
      );

      this.panel.onDidChangeViewState(
        (e) => {
          const wasVisible = this.isPanelVisible;
          this.isPanelVisible = e.webviewPanel.visible;
          if (!wasVisible && this.isPanelVisible) {
            this.onPanelBecameVisible();
          }
        },
        undefined,
        this.context.subscriptions
      );

      this.isPanelVisible = true;
    }

    if (this.panel && this.panel.title !== title) {
      this.panel.title = title;
    }

    // Re-render content when showing with new data on an existing panel
    if (data && this.panel) {
      this.panel.webview.html = await this.getWebviewContent(data);
    }
  }

  protected abstract getWebviewContent(data?: any): Promise<string>;
  protected abstract handleMessage(message: any): Promise<void>;

  /** Called when the webview panel is closed. Override to clean up resources. */
  protected onPanelDisposed(): void {
    // Override in subclasses if cleanup is needed
  }

  /** Called when the webview panel becomes visible (was hidden, now shown). */
  protected onPanelBecameVisible(): void {
    // Override in subclasses if needed
  }

  protected getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
  }

  protected getWebviewUri(webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, ...pathSegments)));
  }

  protected getNonce(): string {
    return getNonce();
  }

  /**
   * Renders the canonical webview page (CSP, nonce, base.css design system,
   * base.js runtime). All subclasses build their HTML through this.
   */
  protected renderPage(options: WebviewPageOptions): string {
    if (!this.panel) {
      throw new Error(`Cannot render page for '${this.viewType}': panel not created yet`);
    }
    return renderWebviewPage(this.panel.webview, this.context.extensionUri, options);
  }

  /** Minimal page for placeholders ("Loading…", "No data available"). */
  protected getBaseHtml(title: string, content: string): string {
    return this.renderPage({ title, bodyHtml: content, container: true });
  }
}
