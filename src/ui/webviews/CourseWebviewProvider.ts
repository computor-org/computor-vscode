import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseGet, CourseFamilyList, OrganizationList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';

export class CourseWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService, treeDataProvider?: LecturerTreeDataProvider) {
    super(context, 'computor.courseView');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  protected async getWebviewContent(data?: {
    course: CourseGet;
    courseFamily: CourseFamilyList;
    organization: OrganizationList;
  }): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Course', '<p>Loading…</p>');
    }

    if (!data) {
      return this.getBaseHtml('Course', '<p>No course data available</p>');
    }

    const { course, courseFamily, organization } = data;

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify({ course, courseFamily, organization });
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'course-details.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'course-details.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Course Details</title>
      <link rel="stylesheet" href="${componentsCssUri}">
      <link rel="stylesheet" href="${stylesUri}">
    </head>
    <body>
      <div id="app" class="view-root"></div>
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
    switch (message.command) {
      case 'updateCourse':
        try {
          await this.apiService.updateCourse(message.data.courseId, message.data.updates);
          vscode.window.showInformationMessage('Course updated successfully');
          
          // Update tree with changes
          if (this.treeDataProvider) {
            this.treeDataProvider.updateNode('course', message.data.courseId, message.data.updates);
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to update course: ${error}`);
        }
        break;

      case 'refresh':
        if (message.data.courseId) {
          try {
            const course = await this.apiService.getCourse(message.data.courseId);
            if (course && this.currentData) {
              this.currentData.course = course;
              this.panel?.webview.postMessage({
                command: 'updateState',
                data: { course, courseFamily: this.currentData.courseFamily, organization: this.currentData.organization }
              });
              vscode.window.showInformationMessage('Course refreshed');
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh: ${error}`);
          }
        }
        break;
    }
  }
}