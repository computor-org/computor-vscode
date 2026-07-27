import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { CourseGet, CourseMemberGradingsList } from '../../types/generated';
import { notify } from '../../utils/notify';

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

    return this.renderPage({
      title: 'Course Progress Overview',
      bodyHtml: '<div id="app"></div>',
      cssFiles: ['courses/charts.css', 'courses/course-progress-overview.css'],
      scriptFiles: ['vendor/chart.min.js', 'courses/charts.js', 'courses/course-progress-overview.js'],
      initialState: data ?? { course: null, students: [] }
    });
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
          notify.error(String(message.data));
        }
        break;
      case 'copyToClipboard':
        if (message.data?.text) {
          try {
            await vscode.env.clipboard.writeText(message.data.text);
            this.panel?.webview.postMessage({ command: 'copySuccess', data: { btnId: message.data.btnId } });
          } catch (err) {
            notify.error(`Failed to copy: ${err}`);
          }
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
      notify.error(`Failed to refresh progress data: ${error?.message || error}`);
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
