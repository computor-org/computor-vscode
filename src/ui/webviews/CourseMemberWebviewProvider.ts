import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseMemberGet, CourseList, CourseGroupGet, CourseRoleList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';

export class CourseMemberWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService, treeDataProvider?: LecturerTreeDataProvider) {
    super(context, 'computor.courseMemberView');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  protected async getWebviewContent(data?: {
    member: CourseMemberGet;
    course?: CourseList;
    group?: CourseGroupGet | null;
    role?: CourseRoleList;
    availableGroups?: CourseGroupGet[];
    availableRoles?: CourseRoleList[];
  }): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Course Member', '<p>Loading…</p>');
    }

    if (!data) {
      return this.getBaseHtml('Course Member', '<p>No course member data available</p>');
    }

    const { member, course, group, role, availableGroups, availableRoles } = data;

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify({ member, course, group, role, availableGroups, availableRoles });
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'course-member-details.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'course-member-details.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Course Member Details</title>
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
      case 'updateCourseMember':
        try {
          await this.apiService.updateCourseMember(message.data.memberId, message.data.updates);
          vscode.window.showInformationMessage('Course member updated successfully');

          // Update tree with changes
          if (this.treeDataProvider) {
            await this.treeDataProvider.refresh();
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to update course member: ${error}`);
        }
        break;

      case 'refresh':
        if (message.data.memberId && this.currentData) {
          try {
            const member = await this.apiService.getCourseMember(message.data.memberId);
            if (member) {
              this.currentData.member = member;
              this.panel?.webview.postMessage({
                command: 'updateState',
                data: this.currentData
              });
              vscode.window.showInformationMessage('Course member refreshed');
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh: ${error}`);
          }
        }
        break;
    }
  }
}
