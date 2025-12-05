import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { CourseMemberGradingsGet } from '../../types/generated';

interface CourseMemberProgressData {
  memberGradings: CourseMemberGradingsGet;
  fallbackName?: string;
}

export class CourseMemberProgressWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService) {
    super(context, 'computor.courseMemberProgress');
    this.apiService = apiService;
  }

  async showMemberProgress(courseMemberId: string, memberName?: string): Promise<void> {
    const memberGradings = await this.apiService.getCourseMemberGradingsDetail(courseMemberId);
    if (!memberGradings) {
      vscode.window.showErrorMessage('Failed to load course member progress data.');
      return;
    }

    const displayName = memberName ||
      [memberGradings.given_name, memberGradings.family_name].filter(Boolean).join(' ') ||
      memberGradings.username ||
      'Student';

    const payload: CourseMemberProgressData = { memberGradings, fallbackName: memberName };
    await this.show(`Progress: ${displayName}`, payload);
  }

  protected async getWebviewContent(data?: CourseMemberProgressData): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Student Progress', '<p>Loading…</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? { memberGradings: null });

    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const chartsCssUri = this.getWebviewUri(webview, 'webview-ui', 'charts.css');
    const progressCssUri = this.getWebviewUri(webview, 'webview-ui', 'course-member-progress.css');
    const chartJsUri = this.getWebviewUri(webview, 'webview-ui', 'lib', 'chart.min.js');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const chartsJsUri = this.getWebviewUri(webview, 'webview-ui', 'charts.js');
    const progressJsUri = this.getWebviewUri(webview, 'webview-ui', 'course-member-progress.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Student Progress</title>
      <link rel="stylesheet" href="${componentsCssUri}">
      <link rel="stylesheet" href="${chartsCssUri}">
      <link rel="stylesheet" href="${progressCssUri}">
    </head>
    <body>
      <div id="app"></div>
      <script nonce="${nonce}">
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${nonce}" src="${chartJsUri}"></script>
      <script nonce="${nonce}" src="${componentsJsUri}"></script>
      <script nonce="${nonce}" src="${chartsJsUri}"></script>
      <script nonce="${nonce}" src="${progressJsUri}"></script>
    </body>
    </html>`;
  }

  protected async handleMessage(message: any): Promise<void> {
    if (!message) {
      return;
    }

    switch (message.command) {
      case 'refresh':
        await this.refreshData();
        break;
      case 'showError':
        if (message.data) {
          vscode.window.showErrorMessage(String(message.data));
        }
        break;
      default:
        break;
    }
  }

  private async refreshData(): Promise<void> {
    const data = this.currentData as CourseMemberProgressData | undefined;
    if (!data?.memberGradings || !this.panel) {
      return;
    }

    try {
      this.postLoadingState(true);
      const memberGradings = await this.apiService.getCourseMemberGradingsDetail(
        data.memberGradings.course_member_id
      );
      if (memberGradings) {
        this.currentData = { memberGradings };
        this.panel.webview.postMessage({ command: 'updateData', data: { memberGradings } });
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to refresh progress data: ${error?.message || error}`);
    } finally {
      this.postLoadingState(false);
    }
  }

  private postLoadingState(loading: boolean): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({ command: 'setLoading', data: { loading } });
  }
}
