import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { CourseGroupGet, CourseList } from '../../types/generated';

export class CourseGroupWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService, treeDataProvider?: LecturerTreeDataProvider) {
    super(context, 'computor.courseGroupView');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  protected async getWebviewContent(data?: {
    group: CourseGroupGet;
    course?: CourseList;
    membersCount?: number;
  }): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Course Group', '<p>Loading…</p>');
    }

    if (!data) {
      return this.getBaseHtml('Course Group', '<p>No course group data available</p>');
    }

    const { group, course, membersCount } = data;

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify({ group, course, membersCount });
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'course-group-details.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'course-group-details.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Course Group Details</title>
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
      case 'updateCourseGroup':
        try {
          await this.apiService.updateCourseGroup(message.data.groupId, message.data.updates);
          vscode.window.showInformationMessage('Course group updated successfully');

          // Update tree with changes
          if (this.treeDataProvider) {
            await this.treeDataProvider.refresh();
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to update course group: ${error}`);
        }
        break;

      case 'refresh':
        if (message.data.groupId && this.currentData) {
          try {
            const group = await this.apiService.getCourseGroup(message.data.groupId);
            if (group) {
              // Get updated members count
              let membersCount = 0;
              try {
                const members = await this.apiService.getCourseMembers(group.course_id, group.id);
                membersCount = members.length;
              } catch (error) {
                console.error('Failed to get members count:', error);
              }

              this.currentData.group = group;
              this.currentData.membersCount = membersCount;
              this.panel?.webview.postMessage({
                command: 'updateState',
                data: { group, course: this.currentData.course, membersCount }
              });
              vscode.window.showInformationMessage('Course group refreshed');
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh: ${error}`);
          }
        }
        break;
    }
  }
}
