import * as vscode from 'vscode';
import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';

/**
 * Webview provider for assignment (submittable) course content.
 * Handles deployment, submission tracking, grading, and example management.
 */
export class AssignmentContentWebviewProvider extends BaseCourseContentWebviewProvider {
  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService,
    treeDataProvider?: LecturerTreeDataProvider
  ) {
    super(context, 'computor.assignmentContentView', apiService, treeDataProvider);
  }

  protected async getWebviewContent(data?: CourseContentWebviewData): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Assignment', '<p>Loading...</p>');
    }

    if (!data) {
      return this.getBaseHtml('Assignment', '<p>No assignment data available</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data);
    const cssUri = this.getWebviewUri(webview, 'webview-ui', 'assignment-content-details.css');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'assignment-content-details.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Assignment: ${data.courseContent.title || data.courseContent.path}</title>
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
   * Handle assignment-specific messages
   */
  protected async handleCustomMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'deployAssignment':
        await this.handleDeployAssignment(message.data);
        break;

      case 'viewSubmissions':
        await this.handleViewSubmissions(message.data);
        break;

      case 'openGitLabRepo':
        await this.handleOpenGitLabRepo(message.data);
        break;

      case 'viewTestResults':
        await this.handleViewTestResults(message.data);
        break;

      default:
        // Unknown command
        break;
    }
  }

  /**
   * Deploy assignment to students
   */
  private async handleDeployAssignment(data: any): Promise<void> {
    try {
      await vscode.commands.executeCommand('computor.lecturer.releaseCourseContent', {
        courseId: data.courseId,
        contentId: data.contentId
      });
      vscode.window.showInformationMessage('Assignment deployment initiated');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to deploy assignment: ${error}`);
    }
  }

  /**
   * View student submissions
   */
  private async handleViewSubmissions(data: any): Promise<void> {
    vscode.window.showInformationMessage('Submission viewing coming soon!');
  }

  /**
   * Open GitLab repository
   */
  private async handleOpenGitLabRepo(data: any): Promise<void> {
    await vscode.commands.executeCommand('computor.lecturer.openGitLabRepo', data);
  }

  /**
   * View test results
   */
  private async handleViewTestResults(data: any): Promise<void> {
    vscode.window.showInformationMessage('Test results viewing coming soon!');
  }
}
