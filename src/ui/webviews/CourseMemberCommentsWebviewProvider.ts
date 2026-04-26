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
    inputPanel.setOnCommentChanged(async () => {
      await this.refreshComments();
    });
  }

  public isOpen(): boolean {
    return !!this.panel;
  }

  public getCurrentCourseMemberId(): string | undefined {
    const data = this.currentData as CommentsWebviewData | undefined;
    return data?.courseMemberId;
  }

  async showComments(courseMemberId: string, title: string): Promise<void> {
    const comments = await this.apiService.listCourseMemberComments(courseMemberId);
    const payload: CommentsWebviewData = { courseMemberId, title, comments };
    await this.show(`Comments: ${title}`, payload);
    if (this.inputPanel) {
      this.inputPanel.setTarget(courseMemberId, title);
      void this.inputPanel.reveal();
    }
  }

  protected async getWebviewContent(data?: CommentsWebviewData): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Comments', '<p>Loading…</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? { courseMemberId: '', title: 'Comments', comments: [] });
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const commentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'comments.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const commentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'comments.js');
    const markedJsUri = this.getWebviewUri(webview, 'webview-ui', 'lib', 'marked.min.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Course Member Comments</title>
      <link rel="stylesheet" href="${componentsCssUri}">
      <link rel="stylesheet" href="${commentsCssUri}">
    </head>
    <body>
      <div id="app"></div>
      <script nonce="${nonce}">
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${nonce}" src="${markedJsUri}"></script>
      <script nonce="${nonce}" src="${componentsJsUri}"></script>
      <script nonce="${nonce}" src="${commentsJsUri}"></script>
    </body>
    </html>`;
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
