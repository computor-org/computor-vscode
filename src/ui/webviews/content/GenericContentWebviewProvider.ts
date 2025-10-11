import * as vscode from 'vscode';
import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';

/**
 * Webview provider for generic course content (lectures, readings, etc.).
 * Provides basic editing capabilities.
 */
export class GenericContentWebviewProvider extends BaseCourseContentWebviewProvider {
  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService,
    treeDataProvider?: LecturerTreeDataProvider
  ) {
    super(context, 'computor.genericContentView', apiService, treeDataProvider);
  }

  protected async getWebviewContent(data?: CourseContentWebviewData): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Content', '<p>Loading...</p>');
    }

    if (!data) {
      return this.getBaseHtml('Content', '<p>No content data available</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data);
    const cssUri = this.getWebviewUri(webview, 'webview-ui', 'generic-content-details.css');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'generic-content-details.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Content: ${data.courseContent.title || data.courseContent.path}</title>
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
}
