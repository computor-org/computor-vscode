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

    const displayName = memberName || 'Student';

    const payload: CourseMemberProgressData = { memberGradings, fallbackName: memberName };
    await this.show(`Progress: ${displayName}`, payload);
  }

  protected async getWebviewContent(data?: CourseMemberProgressData): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Student Progress', '<p>Loading…</p>');
    }

    return this.renderPage({
      title: 'Student Progress',
      bodyHtml: '<div id="app"></div>',
      cssFiles: ['charts.css', 'course-member-progress.css'],
      scriptFiles: ['lib/chart.min.js', 'charts.js', 'course-member-progress.js'],
      initialState: data ?? { memberGradings: null }
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
      case 'showError':
        if (message.data) {
          vscode.window.showErrorMessage(String(message.data));
        }
        break;
      case 'copyToClipboard':
        if (message.data?.text) {
          try {
            await vscode.env.clipboard.writeText(message.data.text);
            this.panel?.webview.postMessage({ command: 'copySuccess', data: { btnId: message.data.btnId } });
          } catch (err) {
            vscode.window.showErrorMessage(`Failed to copy: ${err}`);
          }
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
