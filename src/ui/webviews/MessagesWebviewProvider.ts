import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { MessageList, MessageQuery } from '../../types/generated';
import type { MessagesInputPanelProvider } from '../panels/MessagesInputPanel';
import { WebSocketService } from '../../services/WebSocketService';

export type MessageTargetType = 'course' | 'courseGroup' | 'courseContent' | 'submissionGroup' | 'courseMember';

export interface MessageFilters {
  unread?: boolean;
  created_after?: string;
  created_before?: string;
  tags?: string[];
  tags_match_all?: boolean;
}

export interface MessageTargetContext {
  title: string;
  subtitle?: string;
  query: Record<string, string>;
  createPayload: Record<string, unknown>;
  sourceRole?: 'student' | 'tutor' | 'lecturer';
  /** WebSocket channel for real-time updates (e.g., "submission_group:uuid") */
  wsChannel?: string;
}

interface MessagesWebviewData {
  target: MessageTargetContext;
  messages: EnrichedMessage[];
  identity?: { id: string; username: string; full_name?: string };
  activeFilters?: MessageFilters;
}

type EnrichedMessage = MessageList & {
  author_display?: string;
  author_name?: string;
  can_edit?: boolean;
  can_delete?: boolean;
};

export class MessagesWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private inputPanel?: MessagesInputPanelProvider;
  private wsService?: WebSocketService;
  private currentWsChannel?: string;
  private readonly wsHandlerId: string;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService) {
    super(context, 'computor.messagesView');
    this.apiService = apiService;
    this.wsHandlerId = `messages-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  public setInputPanel(inputPanel: MessagesInputPanelProvider): void {
    this.inputPanel = inputPanel;
  }

  public setWebSocketService(wsService: WebSocketService): void {
    this.wsService = wsService;
  }

  async showMessages(target: MessageTargetContext): Promise<void> {
    const currentUserId = this.apiService.getCurrentUserId();
    const [identity, rawMessages] = await Promise.all([
      currentUserId ? this.apiService.getCurrentUser().catch(() => undefined) : Promise.resolve(undefined),
      this.apiService.listMessages(target.query)
    ]);

    const normalizedMessages = this.normalizeReadState(rawMessages, currentUserId);
    void this.markUnreadMessagesAsRead(rawMessages, target, currentUserId);
    const messages = this.enrichMessages(normalizedMessages, identity);
    const payload: MessagesWebviewData = { target, messages, identity };
    await this.show(`Messages: ${target.title}`, payload);

    // Subscribe to WebSocket channel for real-time updates
    this.subscribeToChannel(target);

    if (this.inputPanel) {
      this.inputPanel.setTarget(target, rawMessages);
      // Register this provider's refresh callback when showing messages
      this.inputPanel.setOnMessageCreated(() => this.refreshMessages());
      // Pass WebSocket channel to input panel for typing indicators
      if (target.wsChannel) {
        this.inputPanel.setWebSocketChannel(target.wsChannel);
      }
      void vscode.commands.executeCommand('computor.messagesInputPanel.focus');
    }
  }

  private subscribeToChannel(target: MessageTargetContext): void {
    if (!this.wsService || !target.wsChannel) {
      return;
    }

    // Unsubscribe from previous channel if different
    if (this.currentWsChannel && this.currentWsChannel !== target.wsChannel) {
      this.wsService.unsubscribe([this.currentWsChannel], this.wsHandlerId);
    }

    this.currentWsChannel = target.wsChannel;

    this.wsService.subscribe([target.wsChannel], this.wsHandlerId, {
      onMessageNew: (channel, data) => {
        if (channel === this.currentWsChannel) {
          this.handleWsMessageNew(data);
        }
      },
      onMessageUpdate: (channel, messageId, data) => {
        if (channel === this.currentWsChannel) {
          this.handleWsMessageUpdate(messageId, data);
        }
      },
      onMessageDelete: (channel, messageId) => {
        if (channel === this.currentWsChannel) {
          this.handleWsMessageDelete(messageId);
        }
      },
      onTypingUpdate: (channel, userId, userName, isTyping) => {
        if (channel === this.currentWsChannel) {
          this.handleWsTypingUpdate(userId, userName, isTyping);
        }
      }
    });
  }

  private handleWsMessageNew(data: Record<string, unknown>): void {
    if (!this.panel) {
      return;
    }
    // Send new message to webview
    this.panel.webview.postMessage({
      command: 'wsMessageNew',
      data
    });
  }

  private handleWsMessageUpdate(messageId: string, data: Record<string, unknown>): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({
      command: 'wsMessageUpdate',
      data: { messageId, ...data }
    });
  }

  private handleWsMessageDelete(messageId: string): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({
      command: 'wsMessageDelete',
      data: { messageId }
    });
  }

  private handleWsTypingUpdate(userId: string, userName: string, isTyping: boolean): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({
      command: 'wsTypingUpdate',
      data: { userId, userName, isTyping }
    });
  }

  public dispose(): void {
    // Unsubscribe from WebSocket channel
    if (this.wsService && this.currentWsChannel) {
      this.wsService.unsubscribe([this.currentWsChannel], this.wsHandlerId);
    }
  }

  protected async getWebviewContent(data?: MessagesWebviewData): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Messages', '<p>Loading…</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? { target: null, messages: [] });
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const messagesCssUri = this.getWebviewUri(webview, 'webview-ui', 'messages.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const messagesJsUri = this.getWebviewUri(webview, 'webview-ui', 'messages.js');
    const markedJsUri = this.getWebviewUri(webview, 'webview-ui', 'lib', 'marked.min.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Messages</title>
      <link rel="stylesheet" href="${componentsCssUri}">
      <link rel="stylesheet" href="${messagesCssUri}">
    </head>
    <body>
      <div id="app"></div>
      <script nonce="${nonce}">
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${nonce}" src="${markedJsUri}"></script>
      <script nonce="${nonce}" src="${componentsJsUri}"></script>
      <script nonce="${nonce}" src="${messagesJsUri}"></script>
    </body>
    </html>`;
  }

  protected async handleMessage(message: any): Promise<void> {
    if (!message) {
      return;
    }

    switch (message.command) {
      case 'replyTo':
        if (this.inputPanel && message.data) {
          this.inputPanel.setReplyTo(message.data);
          void vscode.commands.executeCommand('computor.messagesInputPanel.focus');
        }
        break;
      case 'editMessage':
        if (this.inputPanel && message.data) {
          this.inputPanel.setEditingMessage(message.data);
          void vscode.commands.executeCommand('computor.messagesInputPanel.focus');
        }
        break;
      case 'confirmDeleteMessage':
        await this.handleConfirmDeleteMessage(message.data);
        break;
      case 'deleteMessage':
        await this.handleDeleteMessage(message.data);
        break;
      case 'refreshMessages':
        await this.refreshMessages();
        break;
      case 'applyFilters':
        await this.handleApplyFilters(message.data);
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

  private getCurrentTarget(): MessageTargetContext | undefined {
    const data = this.currentData as MessagesWebviewData | undefined;
    return data?.target;
  }

  private getIdentity(): { id: string; username: string; full_name?: string } | undefined {
    const data = this.currentData as MessagesWebviewData | undefined;
    return data?.identity;
  }

  private getActiveFilters(): MessageFilters | undefined {
    const data = this.currentData as MessagesWebviewData | undefined;
    return data?.activeFilters;
  }

  private setActiveFilters(filters: MessageFilters | undefined): void {
    const data = this.currentData as MessagesWebviewData | undefined;
    if (data) {
      data.activeFilters = filters;
    }
  }

  private normalizeReadState(messages: MessageList[], currentUserId?: string): MessageList[] {
    if (!currentUserId) {
      return messages;
    }

    return messages.map((message) => {
      if (message.is_read || message.author_id === currentUserId) {
        return message;
      }
      return { ...message, is_read: true } satisfies MessageList;
    });
  }

  private async markUnreadMessagesAsRead(
    messages: MessageList[],
    target: MessageTargetContext | undefined,
    currentUserId?: string
  ): Promise<void> {
    const unreadIds = messages
      .filter((message) => !message.is_read && message.author_id !== currentUserId)
      .map((message) => message.id);

    if (unreadIds.length === 0) {
      return;
    }

    await Promise.allSettled(
      unreadIds.map(async (messageId) => {
        try {
          await this.apiService.markMessageRead(messageId);
        } catch (error) {
          console.error(`Failed to mark message ${messageId} as read:`, error);
        }
      })
    );

    this.notifyIndicatorsUpdated(target, messages);
  }

  private notifyIndicatorsUpdated(target: MessageTargetContext | undefined, messages: MessageList[]): void {
    if (!target) {
      return;
    }

    const contentIds = new Set<string>();
    for (const message of messages) {
      if (typeof message.course_content_id === 'string' && message.course_content_id.length > 0) {
        contentIds.add(message.course_content_id);
      }
    }

    const fallbackContentId = target.createPayload.course_content_id || target.query.course_content_id;
    if (contentIds.size === 0 && typeof fallbackContentId === 'string' && fallbackContentId.length > 0) {
      contentIds.add(fallbackContentId);
    }

    switch (target.sourceRole) {
      case 'student': {
        const courseId = target.createPayload.course_id || target.query.course_id;
        if (typeof courseId === 'string' && courseId.length > 0) {
          this.apiService.clearStudentCourseContentsCache(courseId);
        }
        for (const contentId of contentIds) {
          this.apiService.clearStudentCourseContentCache(contentId);
        }
        void vscode.commands.executeCommand('computor.student.refresh');
        break;
      }
      case 'tutor': {
        const memberId = target.createPayload.course_member_id || target.query.course_member_id;
        if (typeof memberId === 'string' && memberId.length > 0) {
          this.apiService.clearTutorMemberCourseContentsCache(memberId);
          void vscode.commands.executeCommand('computor.tutor.refresh');
        }
        break;
      }
      default:
        break;
    }
  }

  private async handleConfirmDeleteMessage(data: { messageId: string; title?: string }): Promise<void> {
    if (!data?.messageId) {
      return;
    }

    const title = data.title || 'this message';
    const confirmed = await vscode.window.showWarningMessage(
      `Delete "${title}"?`,
      { modal: true },
      'Delete'
    );

    if (confirmed === 'Delete') {
      await this.handleDeleteMessage(data);
    }
  }

  private async handleDeleteMessage(data: { messageId: string }): Promise<void> {
    if (!data?.messageId) {
      return;
    }

    try {
      this.postLoadingState(true);
      await this.apiService.deleteMessage(data.messageId);
      await this.refreshMessages();
      vscode.window.showInformationMessage('Message deleted.');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to delete message: ${error?.message || error}`);
      this.postLoadingState(false);
    }
  }

  public async refreshMessages(): Promise<void> {
    const target = this.getCurrentTarget();
    if (!target || !this.panel) {
      return;
    }

    try {
      this.postLoadingState(true);
      const currentUserId = this.apiService.getCurrentUserId();
      const identity = (await this.apiService.getCurrentUser().catch(() => this.getIdentity())) || this.getIdentity();
      const activeFilters = this.getActiveFilters();

      const query: MessageQuery = {
        ...target.query,
        ...activeFilters
      };

      const rawMessages = await this.apiService.listMessages(query);
      const normalizedMessages = this.normalizeReadState(rawMessages, currentUserId);
      void this.markUnreadMessagesAsRead(rawMessages, target, currentUserId);
      const messages = this.enrichMessages(normalizedMessages, identity);
      this.currentData = { target, messages, identity, activeFilters } satisfies MessagesWebviewData;
      this.panel.webview.postMessage({ command: 'updateMessages', data: messages });
      this.postLoadingState(false);

      if (this.inputPanel) {
        this.inputPanel.updateMessages(rawMessages);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to refresh messages: ${error?.message || error}`);
      this.postLoadingState(false);
    }
  }

  private async handleApplyFilters(filters: MessageFilters): Promise<void> {
    const hasFilters = filters && Object.keys(filters).some(key => {
      const value = filters[key as keyof MessageFilters];
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null;
    });

    this.setActiveFilters(hasFilters ? filters : undefined);
    await this.refreshMessages();
  }

  private enrichMessages(messages: MessageList[], identity?: { id: string; username: string; full_name?: string }): EnrichedMessage[] {
    const currentUserId = identity?.id;

    return messages.map((message) => {
      const author = message.author;
      const trimmedParts = [author?.given_name, author?.family_name]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter((part) => part.length > 0);
      const fullName = trimmedParts.join(' ');
      const hasFullName = fullName.length > 0;
      const canEdit = currentUserId ? message.author_id === currentUserId : false;

      return {
        ...message,
        author_display: hasFullName ? fullName : undefined,
        author_name: hasFullName ? fullName : undefined,
        can_edit: canEdit,
        can_delete: canEdit
      } satisfies EnrichedMessage;
    });
  }


  private postLoadingState(loading: boolean): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({ command: 'setLoading', data: { loading } });
  }
}
