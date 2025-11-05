import * as vscode from 'vscode';
import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';

/**
 * Webview provider for unit (container) course content.
 * Handles child content management and navigation.
 */
export class UnitContentWebviewProvider extends BaseCourseContentWebviewProvider {
  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService,
    treeDataProvider?: LecturerTreeDataProvider
  ) {
    super(context, 'computor.unitContentView', apiService, treeDataProvider);
  }

  protected async getWebviewContent(data?: CourseContentWebviewData): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Unit', '<p>Loading...</p>');
    }

    if (!data) {
      return this.getBaseHtml('Unit', '<p>No unit data available</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data);
    const cssUri = this.getWebviewUri(webview, 'webview-ui', 'unit-content-details.css');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'unit-content-details.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Unit: ${data.courseContent.title || data.courseContent.path}</title>
      <link rel="stylesheet" href="${cssUri}">
    </head>
    <body>
      <div id="app" class="view-root"></div>
      <script nonce="${nonce}">
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }

  /**
   * Handle unit-specific messages
   */
  protected async handleCustomMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'loadChildren':
        await this.handleLoadChildren(message.data);
        break;

      case 'reorderChildren':
        await this.handleReorderChildren(message.data);
        break;

      default:
        // Unknown command
        break;
    }
  }

  /**
   * Load child content items
   */
  private async handleLoadChildren(data: any): Promise<void> {
    try {
      // Get all course contents and filter by parent path (ltree structure)
      const allContents = await this.apiService.getCourseContents(data.courseId, false, false);
      const parentPath = data.parentPath || '';

      // Filter children: path should be parentPath.something (one level deeper)
      const children = allContents.filter(c => {
        if (!parentPath) {
          // Root level: no dots in path
          return !c.path.includes('.');
        }
        // Check if this is a direct child
        const isChild = c.path.startsWith(parentPath + '.') &&
                       c.path.split('.').length === parentPath.split('.').length + 1;
        return isChild;
      });

      if (this.panel) {
        this.panel.webview.postMessage({
          command: 'childrenLoaded',
          data: { children }
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load children: ${error}`);
    }
  }

  /**
   * Reorder child content items
   */
  private async handleReorderChildren(data: any): Promise<void> {
    vscode.window.showInformationMessage('Child reordering coming soon!');
  }
}
