import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { canReplyInScope, deriveScopeFromCreatePayload } from '../../services/MessagePermissions';
import { MessageGet, MessageList, MessageQuery } from '../../types/generated';
import type { MessagesInputPanelProvider } from '../panels/MessagesInputPanel';
import { WebSocketService } from '../../services/WebSocketService';
import { notify } from '../../utils/notify';

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
  /** When true, the input panel hides compose UI and shows a read-only notice. */
  readOnly?: boolean;
  /** Optional reason shown alongside the read-only notice. */
  readOnlyReason?: string;
  /** Whether replies are permitted in this scope (computed from createPayload). */
  allowReplies?: boolean;
}

interface MessagesWebviewData {
  target: MessageTargetContext;
  messages: EnrichedMessage[];
  identity?: { id: string; full_name?: string };
  activeFilters?: MessageFilters;
}

type EnrichedMessage = MessageList & {
  author_display?: string;
  author_name?: string;
  can_edit?: boolean;
  can_delete?: boolean;
  is_author?: boolean;
};

export class MessagesWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private inputPanel?: MessagesInputPanelProvider;
  private wsService?: WebSocketService;
  private currentWsChannel?: string;
  private readonly wsHandlerId: string;
  private pendingUnreadMessageIds: Set<string> = new Set();

  /** Shared instance reused across the chat, student, tutor and lecturer
   *  views — every caller routes through the same provider so that opening
   *  the same thread from two different trees focuses one panel rather than
   *  spawning a second copy. */
  private static shared: MessagesWebviewProvider | undefined;

  static getShared(context: vscode.ExtensionContext, apiService: ComputorApiService): MessagesWebviewProvider {
    if (!this.shared) {
      this.shared = new MessagesWebviewProvider(context, apiService);
    }
    return this.shared;
  }

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService) {
    super(context, 'computor.messagesView');
    this.apiService = apiService;
    this.wsHandlerId = `messages-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  public setInputPanel(inputPanel: MessagesInputPanelProvider): void {
    this.inputPanel = inputPanel;
  }

  private withReplyPolicy(target: MessageTargetContext): MessageTargetContext {
    if (target.allowReplies !== undefined) {
      return target;
    }
    const scope = deriveScopeFromCreatePayload(target.createPayload);
    return { ...target, allowReplies: canReplyInScope(scope) };
  }

  public setWebSocketService(wsService: WebSocketService): void {
    this.wsService = wsService;
  }

  /**
   * Cached id of the signed-in user, used to suppress our own typing echoes.
   * The backend fans typing events back to the sender, so without a reliable
   * self-match the user sees their own "is typing" indicator (issue #268).
   * SSO/Bearer sessions expose the id synchronously via the decoded JWT, but
   * API-token sessions (code-server/Coder workspaces) only learn it from
   * GET /user — so resolution is a promise and typing events await it.
   */
  private currentUserId?: string;
  private currentUserIdPromise?: Promise<string | undefined>;

  private ensureCurrentUserId(): Promise<string | undefined> {
    if (this.currentUserId) {
      return Promise.resolve(this.currentUserId);
    }
    const sync = this.apiService.getCurrentUserId();
    if (sync) {
      this.currentUserId = sync;
      return Promise.resolve(sync);
    }
    if (!this.currentUserIdPromise) {
      this.currentUserIdPromise = this.apiService.getCurrentUser()
        .then(user => {
          if (user?.id) this.currentUserId = user.id;
          return this.currentUserId;
        })
        .catch(() => undefined)
        .finally(() => { this.currentUserIdPromise = undefined; });
    }
    return this.currentUserIdPromise;
  }

  async showMessages(target: MessageTargetContext): Promise<void> {
    target = this.withReplyPolicy(target);
    // Resolve identity unconditionally, and before subscribing to the WS
    // channel below: API-token sessions can't read the user id from the
    // token, so GET /user is the only way to learn it. Skipping it left the
    // own-typing filter inert in Coder workspaces (issue #268).
    const [identity, rawMessages] = await Promise.all([
      this.apiService.getCurrentUser().catch(() => undefined),
      this.apiService.listMessages(target.query)
    ]);
    if (identity?.id) {
      this.currentUserId = identity.id;
    }
    const currentUserId = this.currentUserId ?? this.apiService.getCurrentUserId();

    const normalizedMessages = this.normalizeReadState(rawMessages, currentUserId);
    void this.markUnreadMessagesAsRead(rawMessages, target, currentUserId);
    const messages = this.enrichMessages(normalizedMessages, identity);
    const payload: MessagesWebviewData = { target, messages, identity };
    await this.show(`Messages: ${target.title}`, payload);

    // Subscribe to WebSocket channel for real-time updates
    this.subscribeToChannel(target);

    if (this.inputPanel) {
      this.inputPanel.setTarget(target, rawMessages);
      this.inputPanel.setOnMessageCreated(() => this.refreshMessages({ skipIndicatorUpdate: true }));
      if (target.wsChannel) {
        this.inputPanel.setWebSocketChannel(target.wsChannel);
      }
      await this.inputPanel.reveal();
    }
  }

  /**
   * Returns true when the messages panel is currently visible AND its target
   * matches the channel of the given message. Lets callers (e.g. the chat
   * inbox toast) suppress notifications the user is already looking at.
   */
  public isShowingMessage(message: Record<string, unknown>): boolean {
    if (!this.isPanelVisible || !this.panel) { return false; }
    const target = this.getCurrentTarget();
    if (!target) { return false; }

    // If the panel pinned a scope, the message must share it.
    const pinnedScope = (target.query as Record<string, unknown>).scope;
    if (typeof pinnedScope === 'string' && pinnedScope !== message.scope) {
      return false;
    }

    // Match every id-shaped query key that's set on the panel against the
    // same key on the incoming message. If none are set the panel is the
    // global list, so accept any global message.
    const idKeys = [
      'submission_group_id',
      'course_content_id',
      'course_group_id',
      'course_id',
      'course_family_id',
      'organization_id',
      'course_member_id',
      'user_id'
    ];
    let anyIdMatched = false;
    for (const key of idKeys) {
      const targetVal = (target.query as Record<string, unknown>)[key];
      if (targetVal === undefined) { continue; }
      anyIdMatched = true;
      if ((message as Record<string, unknown>)[key] !== targetVal) {
        return false;
      }
    }
    if (!anyIdMatched) {
      return pinnedScope === 'global' && message.scope === 'global';
    }
    return true;
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
          void this.handleWsTypingUpdate(userId, userName, isTyping);
        }
      }
    });
  }

  private handleWsMessageNew(data: Record<string, unknown>): void {
    if (!this.panel) {
      return;
    }
    // WebSocket sends { channel, data: MessageGet } - extract the nested data
    const messageData = (data.data ?? data) as unknown as MessageGet;
    console.log('[MessagesWebviewProvider] handleWsMessageNew received:', {
      id: messageData.id,
      is_author: messageData.is_author,
      is_read: (messageData as any).is_read,
      author_id: (messageData as any).author_id,
      isPanelVisible: this.isPanelVisible
    });

    const enrichedMessage = this.enrichMessageGet(messageData);

    // Send to webview for display
    this.panel.webview.postMessage({
      command: 'wsMessageNew',
      data: enrichedMessage
    });

    // Handle read marking if message is not from current user. Use the
    // enriched is_author — the raw WS payload has it stripped (see above).
    if (!enrichedMessage.is_author && messageData.id) {
      console.log('[MessagesWebviewProvider] Message is not from current user, will mark as read');
      if (this.isPanelVisible) {
        // Panel is visible - mark as read immediately
        console.log('[MessagesWebviewProvider] Panel visible, marking as read immediately:', messageData.id);
        this.markSingleMessageAsRead(messageData.id);
      } else {
        // Panel is hidden - queue for later
        console.log('[MessagesWebviewProvider] Panel hidden, queuing for later:', messageData.id);
        this.pendingUnreadMessageIds.add(messageData.id);
      }
    } else {
      console.log('[MessagesWebviewProvider] Message is from current user (is_author=true), skipping read mark');
    }
  }

  private handleWsMessageUpdate(messageId: string, data: Record<string, unknown>): void {
    if (!this.panel) {
      return;
    }
    // WebSocket sends { channel, data: MessageGet } - extract the nested data
    const messageData = (data.data ?? data) as unknown as MessageGet;
    const enrichedMessage = this.enrichMessageGet(messageData);

    this.panel.webview.postMessage({
      command: 'wsMessageUpdate',
      data: { messageId, ...enrichedMessage }
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

  private async handleWsTypingUpdate(userId: string, userName: string, isTyping: boolean): Promise<void> {
    console.log('[MessagesWebviewProvider] handleWsTypingUpdate', { userId, userName, isTyping });

    // Don't show typing indicator for the current user. Awaiting the id may
    // take a GET /user round-trip on API-token sessions; events awaiting the
    // same promise are released in arrival order, so start/stop stay ordered.
    const currentUserId = this.currentUserId ?? await this.ensureCurrentUserId();
    if (currentUserId && userId === currentUserId) {
      console.log('[MessagesWebviewProvider] Ignoring own typing update (same user)');
      return;
    }

    if (!this.panel) {
      console.log('[MessagesWebviewProvider] No panel, skipping typing update');
      return;
    }
    this.panel.webview.postMessage({
      command: 'wsTypingUpdate',
      data: { userId, userName, isTyping }
    });

    // Also forward to input panel for display
    if (this.inputPanel) {
      console.log('[MessagesWebviewProvider] Forwarding typing update to input panel');
      this.inputPanel.updateTypingUser(userId, userName, isTyping);
    } else {
      console.log('[MessagesWebviewProvider] No input panel available');
    }
  }

  protected onPanelDisposed(): void {
    console.log('[MessagesWebviewProvider] onPanelDisposed called');

    // Unsubscribe from WebSocket channel when panel is closed
    if (this.wsService && this.currentWsChannel) {
      this.wsService.unsubscribe([this.currentWsChannel], this.wsHandlerId);
      this.currentWsChannel = undefined;
    }
    this.pendingUnreadMessageIds.clear();

    // Clear the input panel state (removes typing indicators and resets form)
    console.log('[MessagesWebviewProvider] Clearing input panel state, inputPanel exists:', !!this.inputPanel);
    if (this.inputPanel) {
      this.inputPanel.clearState();
    }
  }

  protected onPanelBecameVisible(): void {
    // Mark all pending unread messages as read
    if (this.pendingUnreadMessageIds.size > 0) {
      for (const messageId of this.pendingUnreadMessageIds) {
        this.markSingleMessageAsRead(messageId);
      }
      this.pendingUnreadMessageIds.clear();
    }
  }

  private markSingleMessageAsRead(messageId: string): void {
    console.log('[MessagesWebviewProvider] markSingleMessageAsRead called for:', messageId);

    // Mark via REST API for persistence
    this.apiService
      .markMessageRead(messageId)
      .then(() => {
        console.log('[MessagesWebviewProvider] Successfully marked message as read via API:', messageId);
        // Inbox unread badges depend on this; see notifyIndicatorsUpdated for context.
        void vscode.commands.executeCommand('computor.chat.refresh');
      })
      .catch((error) => {
        console.error(`Failed to mark message ${messageId} as read:`, error);
      });

    // Mark via WebSocket for real-time read receipts
    if (this.wsService && this.currentWsChannel) {
      console.log('[MessagesWebviewProvider] Also marking via WebSocket:', messageId, this.currentWsChannel);
      this.wsService.markMessageRead(this.currentWsChannel, messageId);
    }
  }

  protected async getWebviewContent(data?: MessagesWebviewData): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Messages', '<p>Loading…</p>');
    }

    return this.renderPage({
      title: 'Messages',
      bodyHtml: '<div id="app"></div>',
      cssFiles: ['shared/components.css', 'shared/chat-shared.css', 'messaging/messages.css'],
      scriptFiles: ['vendor/marked.min.js', 'shared/components.js', 'messaging/messages.js'],
      initialState: data ?? { target: null, messages: [] }
    });
  }

  protected async handleMessage(message: any): Promise<void> {
    if (!message) {
      return;
    }

    switch (message.command) {
      case 'replyTo':
        if (this.inputPanel && message.data) {
          const target = this.getCurrentTarget();
          if (target && target.allowReplies === false) {
            // Webview button should already be hidden, but defend in case the
            // command arrives via a stale render or another path.
            return;
          }
          this.inputPanel.setReplyTo(message.data);
          await this.inputPanel.reveal();
        }
        break;
      case 'editMessage':
        if (this.inputPanel && message.data) {
          this.inputPanel.setEditingMessage(message.data);
          await this.inputPanel.reveal();
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
          notify.warning(String(message.data));
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

  private getIdentity(): { id: string; full_name?: string } | undefined {
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
    console.log('[MessagesWebviewProvider] markUnreadMessagesAsRead called', {
      totalMessages: messages.length,
      currentUserId,
      messageStates: messages.map((m) => ({
        id: m.id,
        is_read: m.is_read,
        author_id: m.author_id,
        isOwnMessage: m.author_id === currentUserId
      }))
    });

    const unreadIds = messages
      .filter((message) => !message.is_read && message.author_id !== currentUserId)
      .map((message) => message.id);

    console.log('[MessagesWebviewProvider] Found unread messages to mark:', unreadIds);

    if (unreadIds.length === 0) {
      console.log('[MessagesWebviewProvider] No unread messages to mark');
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
        // Use refreshTree instead of refresh to avoid Git updates
        void vscode.commands.executeCommand('computor.student.refreshTree');
        break;
      }
      case 'tutor': {
        const memberId = target.createPayload.course_member_id || target.query.course_member_id;
        if (typeof memberId === 'string' && memberId.length > 0) {
          this.apiService.clearTutorMemberCourseContentsCache(memberId);
          // Use refreshTree instead of refresh to avoid unnecessary API re-fetch
          void vscode.commands.executeCommand('computor.tutor.refreshTree');
        }
        break;
      }
      default:
        break;
    }

    // Refresh the chat inbox so its unread badges drop after a read sweep.
    // Backend WS read:update only fires for submission_group today, so any
    // other scope (course_group, course_content, course, family, org, global)
    // would otherwise show stale unread counts until manual refresh.
    void vscode.commands.executeCommand('computor.chat.refresh');
  }

  private async handleConfirmDeleteMessage(data: { messageId: string; title?: string }): Promise<void> {
    if (!data?.messageId) {
      return;
    }

    const title = data.title || 'this message';
    const confirmed = await notify.confirm(
      `Delete "${title}"?`,
      'Delete'
    );

    if (confirmed) {
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
      // Skip indicator update - deleting a message doesn't change unread state
      await this.refreshMessages({ skipIndicatorUpdate: true });
      notify.info('Message deleted.');
    } catch (error: any) {
      notify.error(`Failed to delete message: ${error?.message || error}`);
      this.postLoadingState(false);
    }
  }

  public async refreshMessages(options?: { skipIndicatorUpdate?: boolean }): Promise<void> {
    const target = this.getCurrentTarget();
    if (!target || !this.panel) {
      return;
    }

    try {
      this.postLoadingState(true);
      const identity = (await this.apiService.getCurrentUser().catch(() => this.getIdentity())) || this.getIdentity();
      if (identity?.id) {
        this.currentUserId = identity.id;
      }
      const currentUserId = this.currentUserId ?? this.apiService.getCurrentUserId();
      const activeFilters = this.getActiveFilters();

      const query: MessageQuery = {
        ...target.query,
        ...activeFilters
      };

      const rawMessages = await this.apiService.listMessages(query);
      const normalizedMessages = this.normalizeReadState(rawMessages, currentUserId);
      // Only mark as read and update indicators when not skipping (e.g., after sending a message)
      if (!options?.skipIndicatorUpdate) {
        void this.markUnreadMessagesAsRead(rawMessages, target, currentUserId);
      }
      const messages = this.enrichMessages(normalizedMessages, identity);
      this.currentData = { target, messages, identity, activeFilters } satisfies MessagesWebviewData;
      this.panel.webview.postMessage({ command: 'updateMessages', data: messages });
      this.postLoadingState(false);

      if (this.inputPanel) {
        this.inputPanel.updateMessages(rawMessages);
      }
    } catch (error: any) {
      notify.error(`Failed to refresh messages: ${error?.message || error}`);
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

  private enrichMessages(messages: MessageList[], identity?: { id: string; full_name?: string }): EnrichedMessage[] {
    return messages.map((message) => this.enrichSingleMessage(message, identity));
  }

  private enrichSingleMessage(message: MessageList, identity?: { id: string; full_name?: string }): EnrichedMessage {
    const currentUserId = identity?.id;
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
      can_delete: canEdit,
      is_author: canEdit
    } satisfies EnrichedMessage;
  }

  private enrichMessageGet(message: MessageGet): EnrichedMessage {
    const author = message.author;
    const trimmedParts = [author?.given_name, author?.family_name]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter((part) => part.length > 0);
    const fullName = trimmedParts.join(' ');
    const hasFullName = fullName.length > 0;
    // The backend strips `is_author` from WS broadcasts (it's per-recipient),
    // so we recompute it client-side. Without this, edit/delete buttons never
    // appear on freshly arrived own messages until the user hits Refresh.
    const currentUserId = this.currentUserId ?? this.apiService.getCurrentUserId();
    const isAuthor = currentUserId ? message.author_id === currentUserId : (message.is_author ?? false);

    return {
      ...message,
      author_display: hasFullName ? fullName : undefined,
      author_name: hasFullName ? fullName : undefined,
      can_edit: isAuthor,
      can_delete: isAuthor,
      is_author: isAuthor
    } satisfies EnrichedMessage;
  }


  private postLoadingState(loading: boolean): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({ command: 'setLoading', data: { loading } });
  }
}
