import * as vscode from 'vscode';
import { ComputorApiService } from '../../services/ComputorApiService';
import { UiStateService } from '../../services/UiStateService';
import { CourseMemberCommentList } from '../../types/generated';
import { renderWebviewPage } from '../webviews/shared/webviewPage';
import { notify } from '../../utils/notify';
import { say, sayFailed, uiLanguage } from '../../utils/uiLanguage';

interface InputPanelState {
  courseMemberId?: string;
  title?: string;
  editingComment?: CourseMemberCommentList;
  loading: boolean;
}

export class CourseMemberCommentsInputPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'computor.courseMemberCommentsInputPanel';
  private view?: vscode.WebviewView;
  private state: InputPanelState = { loading: false };
  private onCommentChangedCallback?: () => Promise<void>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: ComputorApiService
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const uiState = UiStateService.getInstanceOrUndefined();
    uiState?.setViewVisible(CourseMemberCommentsInputPanelProvider.viewType, webviewView.visible);
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.onDidChangeVisibility(() => {
      uiState?.setViewVisible(CourseMemberCommentsInputPanelProvider.viewType, webviewView.visible);
      if (webviewView.visible) {
        this.postState();
      }
    });

    webviewView.onDidDispose(() => {
      uiState?.setViewVisible(CourseMemberCommentsInputPanelProvider.viewType, false);
      this.view = undefined;
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'createComment':
          await this.handleCreateComment(message.data);
          break;
        case 'updateComment':
          await this.handleUpdateComment(message.data);
          break;
        case 'cancel':
          this.clearEditing();
          break;
        case 'showWarning':
          if (message.data) {
            notify.warning(String(message.data));
          }
          break;
        case 'ready':
          this.postState();
          break;
      }
    });

    this.updateHtml();
  }

  public setOnCommentChanged(callback: () => Promise<void>): void {
    this.onCommentChangedCallback = callback;
  }

  public setTarget(courseMemberId: string, title: string): void {
    this.state.courseMemberId = courseMemberId;
    this.state.title = title;
    this.state.editingComment = undefined;
    this.postState();
  }

  public setEditingComment(comment: CourseMemberCommentList): void {
    this.state.editingComment = comment;
    this.postState();
  }

  public clearEditing(): void {
    this.state.editingComment = undefined;
    this.postState();
  }

  public clearState(): void {
    this.state = { loading: false };
    if (this.view) {
      this.updateHtml();
    }
  }

  public async reveal(opts?: { preserveFocus?: boolean }): Promise<void> {
    const preserveFocus = opts?.preserveFocus ?? false;
    if (this.view) {
      this.view.show(preserveFocus);
    } else if (!preserveFocus) {
      // Only force-focus the view if the caller actually wants focus there;
      // otherwise leave the view hidden until the user opens it themselves.
      await vscode.commands.executeCommand('computor.courseMemberCommentsInputPanel.focus');
    }
  }

  /** Relabels the composer in place, keeping a half-written comment. */
  public refreshLanguage(): void {
    void this.view?.webview.postMessage({ command: 'setLanguage', data: { language: uiLanguage() } });
  }

  private postState(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.postMessage({
      command: 'updateState',
      data: {
        courseMemberId: this.state.courseMemberId,
        title: this.state.title,
        editingComment: this.state.editingComment,
        loading: this.state.loading
      }
    });
  }

  private postLoading(loading: boolean): void {
    this.state.loading = loading;
    if (!this.view) {
      return;
    }
    this.view.webview.postMessage({ command: 'setLoading', data: { loading } });
  }

  private async handleCreateComment(data: { message: string }): Promise<void> {
    if (!this.state.courseMemberId) {
      notify.warning(say('Select a course member to comment on first.', 'Wähle zuerst ein Kursmitglied aus, das du kommentieren möchtest.'));
      return;
    }
    if (!data?.message?.trim()) {
      notify.warning(say('Comment text is required.', 'Bitte gib einen Kommentar ein.'));
      return;
    }
    try {
      this.postLoading(true);
      await this.api.createCourseMemberComment(this.state.courseMemberId, data.message);
      this.clearEditing();
      if (this.onCommentChangedCallback) {
        await this.onCommentChangedCallback();
      }
    } catch (error: any) {
      notify.error(sayFailed('Failed to create comment', 'Der Kommentar konnte nicht gespeichert werden', error?.message || error));
    } finally {
      this.postLoading(false);
    }
  }

  private async handleUpdateComment(data: { commentId: string; message: string }): Promise<void> {
    if (!this.state.courseMemberId || !data?.commentId) {
      return;
    }
    if (!data?.message?.trim()) {
      notify.warning(say('Comment text is required.', 'Bitte gib einen Kommentar ein.'));
      return;
    }
    try {
      this.postLoading(true);
      await this.api.updateCourseMemberComment(this.state.courseMemberId, data.commentId, data.message);
      this.clearEditing();
      if (this.onCommentChangedCallback) {
        await this.onCommentChangedCallback();
      }
    } catch (error: any) {
      notify.error(sayFailed('Failed to update comment', 'Der Kommentar konnte nicht geändert werden', error?.message || error));
    } finally {
      this.postLoading(false);
    }
  }

  private updateHtml(): void {
    if (!this.view) {
      return;
    }

    this.view.webview.html = renderWebviewPage(this.view.webview, this.extensionUri, {
      title: say('Comment', 'Kommentar'),
      bodyHtml: '<div id="app"></div>',
      cssFiles: ['messaging/comments-input.css'],
      scriptFiles: ['messaging/comments-input.js']
    });
  }
}
