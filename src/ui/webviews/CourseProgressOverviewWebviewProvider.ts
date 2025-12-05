import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { CourseGet, CourseMemberGradingsList } from '../../types/generated';

interface CourseProgressOverviewData {
  course: CourseGet;
  students: CourseMemberGradingsList[];
}

export class CourseProgressOverviewWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService) {
    super(context, 'computor.courseProgressOverview');
    this.apiService = apiService;
  }

  async showCourseProgress(course: CourseGet): Promise<void> {
    const students = await this.apiService.getCourseMemberGradings(course.id);
    const payload: CourseProgressOverviewData = { course, students };
    await this.show(`Progress: ${course.title || course.path}`, payload);
  }

  protected async getWebviewContent(data?: CourseProgressOverviewData): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Course Progress', '<p>Loading…</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? { course: null, students: [] });

    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const chartsCssUri = this.getWebviewUri(webview, 'webview-ui', 'charts.css');
    const progressCssUri = this.getWebviewUri(webview, 'webview-ui', 'course-progress-overview.css');
    const chartJsUri = this.getWebviewUri(webview, 'webview-ui', 'lib', 'chart.min.js');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const chartsJsUri = this.getWebviewUri(webview, 'webview-ui', 'charts.js');
    const progressJsUri = this.getWebviewUri(webview, 'webview-ui', 'course-progress-overview.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Course Progress Overview</title>
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
      case 'showStudentDetails':
        if (message.data?.courseMemberId) {
          await vscode.commands.executeCommand(
            'computor.lecturer.showCourseMemberProgress',
            message.data.courseMemberId,
            message.data.studentName
          );
        }
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
    const data = this.currentData as CourseProgressOverviewData | undefined;
    if (!data?.course || !this.panel) {
      return;
    }

    try {
      this.postLoadingState(true);
      const students = await this.apiService.getCourseMemberGradings(data.course.id);
      this.currentData = { ...data, students };
      this.panel.webview.postMessage({ command: 'updateData', data: { students } });
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
