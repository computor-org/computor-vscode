import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseContentStudentList, CourseContentStudentGet, CourseContentTypeList, SubmissionGroupStudentList, SubmissionGroupStudentGet } from '../../types/generated/courses';

export interface StudentContentDetailsViewState {
  course?: {
    id: string;
    title?: string;
    path?: string;
  };
  content: CourseContentStudentList | CourseContentStudentGet;
  contentType?: CourseContentTypeList;
  submissionGroup?: SubmissionGroupStudentList | SubmissionGroupStudentGet | null;
  repository?: {
    hasRepository: boolean;
    fullPath?: string;
    cloneUrl?: string;
    webUrl?: string;
    localPath?: string;
    isCloned?: boolean;
    lastCommit?: string;
  };
  metrics?: {
    testsRun?: number;
    maxTests?: number | null;
    submissions?: number | null;
    maxSubmissions?: number | null;
    submitted?: boolean | null;
    resultPercent?: number | null;
    gradePercent?: number | null;
    gradeStatus?: string | null;
    gradedBy?: string | null;
    gradedAt?: string | null;
    status?: string | null;
    feedback?: string | null;
  };
  team?: {
    maxSize?: number | null;
    currentSize?: number | null;
    members?: Array<{ id?: string | null; name?: string | null; username?: string | null }>;
  };
  example?: {
    identifier?: string | null;
    versionId?: string | null;
  };
  actions?: {
    localPath?: string;
    webUrl?: string;
    cloneUrl?: string;
  };
  gradingHistory?: StudentGradingHistoryEntry[];
  resultsHistory?: StudentResultHistoryEntry[];
}

export interface StudentGradingHistoryEntry {
  id: string;
  gradePercent: number | null;
  rawGrade: number | null;
  status: string;
  feedback?: string | null;
  gradedAt?: string;
  graderName?: string;
}

export interface StudentResultHistoryEntry {
  id: string;
  resultPercent: number | null;
  rawResult: number | null;
  status?: string | null;
  submit?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  versionIdentifier?: string | null;
  testSystemId?: string | null;
}

export class StudentCourseContentDetailsWebviewProvider extends BaseWebviewProvider {
  constructor(context: vscode.ExtensionContext) {
    super(context, 'computor.student.contentDetails');
  }

  async showDetails(state: StudentContentDetailsViewState): Promise<void> {
    const title = state.content.title || state.content.path;
    await this.show(`Content Details: ${title}`, state);
  }

  protected async getWebviewContent(data?: StudentContentDetailsViewState): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Student Content Details', '<p>Loading…</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? {});
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'student-content-details.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'student-content-details.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Student Content Details</title>
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
    if (!message) {
      return;
    }

    switch (message.command) {
      case 'openFolder':
        await this.handleOpenFolder(message.data?.path);
        break;
      case 'openRepository':
        await this.handleOpenRepository(message.data?.url);
        break;
      case 'copyCloneUrl':
        await this.handleCopyCloneUrl(message.data?.url);
        break;
      case 'refresh':
        if (this.currentData) {
          this.panel?.webview.postMessage({ command: 'updateState', data: this.currentData });
        }
        break;
      case 'close':
        this.panel?.dispose();
        break;
      default:
        break;
    }
  }

  private async handleOpenFolder(folderPath?: string): Promise<void> {
    if (!folderPath) {
      vscode.window.showWarningMessage('No local folder available for this content.');
      return;
    }

    try {
      const exists = fs.existsSync(folderPath);
      if (!exists) {
        vscode.window.showWarningMessage('The local folder for this assignment could not be found.');
        return;
      }

      const stat = fs.statSync(folderPath);
      const targetUri = vscode.Uri.file(stat.isDirectory() ? folderPath : path.dirname(folderPath));
      await vscode.commands.executeCommand('revealFileInOS', targetUri);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open folder: ${error?.message || error}`);
    }
  }

  private async handleOpenRepository(url?: string): Promise<void> {
    if (!url) {
      vscode.window.showWarningMessage('No repository URL available for this content.');
      return;
    }

    try {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open repository: ${error?.message || error}`);
    }
  }

  private async handleCopyCloneUrl(url?: string): Promise<void> {
    if (!url) {
      vscode.window.showWarningMessage('No clone URL available for this content.');
      return;
    }

    try {
      await vscode.env.clipboard.writeText(url);
      vscode.window.showInformationMessage('Clone URL copied to clipboard.');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to copy clone URL: ${error?.message || error}`);
    }
  }
}
