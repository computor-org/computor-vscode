import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { CourseMemberCommentList } from '../../types/generated';
import { CourseMemberCommentsInputPanelProvider } from '../panels/CourseMemberCommentsInputPanel';

interface CommentsWebviewData {
  courseMemberId: string;
  title: string;
  comments: CourseMemberCommentList[];
}

export class CourseMemberCommentsWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private inputPanel?: CourseMemberCommentsInputPanelProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService) {
    super(context, 'computor.courseMemberComments');
    this.apiService = apiService;
  }

  public setInputPanel(inputPanel: CourseMemberCommentsInputPanelProvider): void {
    this.inputPanel = inputPanel;
    // The actual onCommentChanged callback is (re)registered every time this
    // provider opens its display via showComments(), so the shared input panel
    // always pings the most recently opened comments view (lecturer vs tutor).
  }

  public isOpen(): boolean {
    return !!this.panel;
  }

  public getCurrentCourseMemberId(): string | undefined {
    const data = this.currentData as CommentsWebviewData | undefined;
    return data?.courseMemberId;
  }

  async showComments(
    courseMemberId: string,
    title: string,
    opts?: { preserveFocus?: boolean }
  ): Promise<void> {
    const comments = await this.apiService.listCourseMemberComments(courseMemberId);
    const payload: CommentsWebviewData = { courseMemberId, title, comments };
    await this.show(`Comments: ${title}`, payload, { preserveFocus: opts?.preserveFocus });
    if (this.inputPanel) {
      this.inputPanel.setTarget(courseMemberId, title);
      // Make sure the input panel's "comment was created/updated" callback
      // refreshes THIS provider's display webview rather than a sibling
      // provider that happened to register the callback later.
      this.inputPanel.setOnCommentChanged(async () => {
        await this.refreshComments();
      });
      void this.inputPanel.reveal({ preserveFocus: opts?.preserveFocus });
    }
  }

  protected async getWebviewContent(data?: CommentsWebviewData): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Comments', '<p>Loading…</p>');
    }

    return this.renderPage({
      title: 'Course Member Comments',
      bodyHtml: '<div id="app"></div>',
      cssFiles: ['components/components.css', 'comments.css'],
      scriptFiles: ['lib/marked.min.js', 'components.js', 'comments.js'],
      initialState: data ?? { courseMemberId: '', title: 'Comments', comments: [] }
    });
  }

  protected onPanelDisposed(): void {
    // Reset the input panel so it shows its empty-state hint again,
    // matching the behaviour of the messages view + input pair.
    this.inputPanel?.clearState();
  }

  protected async handleMessage(message: any): Promise<void> {
    if (!message) { return; }

    switch (message.command) {
      case 'editComment':
        this.handleEditComment(message.data);
        break;
      case 'requestDeleteComment':
        await this.requestDeleteComment(message.data);
        break;
      case 'deleteComment':
        await this.deleteComment(message.data);
        break;
      case 'refreshComments':
        await this.refreshComments();
        break;
      case 'showWarning':
        if (message.data) {
          vscode.window.showWarningMessage(String(message.data));
        }
        break;
      default:
        break;
    }
  }

  private getCourseMemberId(): string | undefined {
    const data = this.currentData as CommentsWebviewData | undefined;
    return data?.courseMemberId;
  }

  private updateCurrentData(comments: CourseMemberCommentList[]): void {
    const current = this.currentData as CommentsWebviewData | undefined;
    if (!current) {
      return;
    }
    this.currentData = { ...current, comments } satisfies CommentsWebviewData;
  }

  private postLoadingState(loading: boolean): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({ command: 'setLoading', data: { loading } });
  }

  private postComments(comments: CourseMemberCommentList[]): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({ command: 'updateComments', data: comments });
  }

  private handleEditComment(data: { commentId: string }): void {
    if (!data?.commentId) { return; }
    const current = this.currentData as CommentsWebviewData | undefined;
    const comment = current?.comments.find(c => c.id === data.commentId);
    if (!comment) { return; }
    if (!this.inputPanel) {
      vscode.window.showWarningMessage('Comment input panel is not available.');
      return;
    }
    this.inputPanel.setEditingComment(comment);
    void this.inputPanel.reveal();
  }

  private async requestDeleteComment(data: { commentId: string; courseMemberId?: string }): Promise<void> {
    const courseMemberId = data?.courseMemberId || this.getCourseMemberId();
    if (!courseMemberId || !data?.commentId) {
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      'Delete this comment permanently?',
      { modal: true },
      'Delete'
    );

    if (choice === 'Delete') {
      await this.deleteComment({ commentId: data.commentId, courseMemberId });
    }
  }

  private async deleteComment(data: { commentId: string; courseMemberId?: string }): Promise<void> {
    const courseMemberId = data?.courseMemberId || this.getCourseMemberId();
    if (!courseMemberId || !data?.commentId) {
      return;
    }

    try {
      this.postLoadingState(true);
      const comments = await this.apiService.deleteCourseMemberComment(courseMemberId, data.commentId);
      this.updateCurrentData(comments);
      this.postComments(comments);
      this.postLoadingState(false);
      // If the input panel was editing this comment, clear that state.
      this.inputPanel?.clearEditing();
      vscode.window.showInformationMessage('Comment deleted.');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to delete comment: ${error?.message || error}`);
      this.postLoadingState(false);
    }
  }

  private async refreshComments(): Promise<void> {
    const courseMemberId = this.getCourseMemberId();
    if (!courseMemberId || !this.panel) {
      return;
    }

    try {
      this.postLoadingState(true);
      const comments = await this.apiService.listCourseMemberComments(courseMemberId);
      this.updateCurrentData(comments);
      this.postComments(comments);
      this.postLoadingState(false);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to refresh comments: ${error?.message || error}`);
      this.postLoadingState(false);
    }
  }
}
