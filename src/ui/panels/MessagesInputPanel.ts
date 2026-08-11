import * as vscode from 'vscode';
import { ComputorApiService } from '../../services/ComputorApiService';
import { MessageCreate, MessageUpdate, MessageList, MessageMentionRef, MentionableQuery } from '../../types/generated';
import { MessageTargetContext } from '../webviews/MessagesWebviewProvider';
import { WebSocketService } from '../../services/WebSocketService';
import { renderWebviewPage } from '../webviews/shared/webviewPage';
import { notify } from '../../utils/notify';
import { deriveScopeFromCreatePayload, scopeHasSubject } from '../../services/MessagePermissions';
import { MESSAGE_TARGET_FIELDS } from '../../types/generated/constants';

interface TypingUser {
  userId: string;
  userName: string;
}

interface InputPanelState {
  target?: MessageTargetContext;
  replyTo?: MessageList;
  editingMessage?: MessageList;
  loading: boolean;
  messages?: MessageList[];
  wsChannel?: string;
  typingUsers: TypingUser[];
  mentionableUsers?: MessageMentionRef[];
}

export class MessagesInputPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'computor.messagesInputPanel';
  private view?: vscode.WebviewView;
  private state: InputPanelState = { loading: false, typingUsers: [] };
  private onMessageCreatedCallback?: () => Promise<void>;
  private wsService?: WebSocketService;
  private typingTimeout?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: ComputorApiService
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    // Re-send state when view becomes visible (handles VS Code suspending webviews)
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        console.log('[MessagesInputPanel] View became visible, re-sending state');
        this.postState();
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'createMessage':
          this.stopTyping();
          await this.handleCreateMessage(message.data);
          break;
        case 'updateMessage':
          this.stopTyping();
          await this.handleUpdateMessage(message.data);
          break;
        case 'cancel':
          this.stopTyping();
          this.clearReplyAndEdit();
          break;
        case 'showWarning':
          if (message.data) {
            notify.warning(String(message.data));
          }
          break;
        case 'ready':
          this.postState();
          void this.fetchAndPostMentionable();
          break;
        case 'fetchMentionable':
          await this.fetchAndPostMentionable(message.data?.search);
          break;
        case 'typing':
          this.notifyTyping();
          break;
      }
    });

    this.updateHtml();
  }

  public setOnMessageCreated(callback: () => Promise<void>): void {
    this.onMessageCreatedCallback = callback;
  }

  public setTarget(target: MessageTargetContext, messages?: MessageList[]): void {
    this.state.target = target;
    this.state.messages = messages;
    this.state.replyTo = undefined;
    this.state.editingMessage = undefined;
    this.postState();
    // Pre-fetch the audience so the @-mention dropdown is ready on first keystroke.
    void this.fetchAndPostMentionable();
  }

  // Scope for the @-mention audience query: replies inherit the parent's scope;
  // otherwise the most-specific target the message will be posted to.
  private buildMentionScope(): MentionableQuery | undefined {
    if (this.state.replyTo) {
      return { parent_id: this.state.replyTo.id };
    }
    const payload = this.state.target?.createPayload as Record<string, unknown> | undefined;
    if (!payload) {
      return undefined;
    }
    for (const field of MESSAGE_TARGET_FIELDS) {
      const value = payload[field];
      if (typeof value === 'string' && value.length > 0) {
        return { [field]: value } as MentionableQuery;
      }
    }
    return undefined;
  }

  private async fetchAndPostMentionable(search?: string): Promise<void> {
    if (!this.view) {
      return;
    }
    const query = this.buildMentionScope();
    if (!query) {
      // No mentionable scope (e.g. a global announcement). Still answer the
      // webview so its autocomplete resolves to "No matching people" instead
      // of hanging on "Searching…".
      this.state.mentionableUsers = [];
      this.view.webview.postMessage({
        command: 'mentionableUsers',
        data: { users: [], search: search ?? null }
      });
      return;
    }
    query.limit = 200;
    if (search) {
      query.search = search;
    }
    try {
      const users = await this.api.getMentionableUsers(query);
      if (!this.view) {
        return;
      }
      this.state.mentionableUsers = users;
      this.view.webview.postMessage({
        command: 'mentionableUsers',
        data: { users, search: search ?? null }
      });
    } catch (error) {
      // Non-fatal — the autocomplete just won't have suggestions. Still answer
      // the webview (empty) so it stops showing "Searching…".
      console.warn('[MessagesInputPanel] failed to fetch mentionable users', error);
      if (this.view) {
        this.view.webview.postMessage({
          command: 'mentionableUsers',
          data: { users: [], search: search ?? null }
        });
      }
    }
  }

  public setReplyTo(message: MessageList): void {
    this.state.replyTo = message;
    this.state.editingMessage = undefined;
    this.postState();
  }

  public setEditingMessage(message: MessageList): void {
    this.state.editingMessage = message;
    this.state.replyTo = undefined;
    this.postState();
  }

  public async reveal(): Promise<void> {
    if (this.view) {
      this.view.show(false);
    } else {
      await vscode.commands.executeCommand('computor.messagesInputPanel.focus');
    }
  }

  public clearReplyAndEdit(): void {
    this.state.replyTo = undefined;
    this.state.editingMessage = undefined;
    this.postState();
  }

  public clearState(): void {
    console.log('[MessagesInputPanel] clearState called');

    // Stop any pending typing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = undefined;
    }

    // Clear all state - no target means placeholder will be shown
    this.state = {
      target: undefined,
      replyTo: undefined,
      editingMessage: undefined,
      loading: false,
      messages: undefined,
      wsChannel: undefined,
      typingUsers: []
    };
    console.log('[MessagesInputPanel] State cleared, calling postState. View exists:', !!this.view);

    // Force webview to re-render by updating HTML (ensures fresh JS context)
    if (this.view) {
      this.updateHtml();
    }
  }

  public updateMessages(messages: MessageList[]): void {
    this.state.messages = messages;
  }

  public setWebSocketService(wsService: WebSocketService): void {
    this.wsService = wsService;
  }

  public setWebSocketChannel(channel: string): void {
    this.state.wsChannel = channel;
  }

  public updateTypingUser(userId: string, userName: string, isTyping: boolean): void {
    console.log('[MessagesInputPanel] updateTypingUser', { userId, userName, isTyping });
    let typingUsers = [...this.state.typingUsers];

    if (isTyping) {
      if (!typingUsers.find((u) => u.userId === userId)) {
        typingUsers.push({ userId, userName });
      }
    } else {
      typingUsers = typingUsers.filter((u) => u.userId !== userId);
    }

    this.state.typingUsers = typingUsers;
    console.log('[MessagesInputPanel] Updated typingUsers:', this.state.typingUsers);
    this.postTypingUpdate();
  }

  private postTypingUpdate(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.postMessage({
      command: 'typingUpdate',
      data: { typingUsers: this.state.typingUsers }
    });
  }

  public notifyTyping(): void {
    if (!this.wsService || !this.state.wsChannel) {
      return;
    }

    // Clear existing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    // Start typing indicator
    this.wsService.startTyping(this.state.wsChannel);

    // Auto-stop after 5 seconds of no input
    this.typingTimeout = setTimeout(() => {
      this.stopTyping();
    }, 5000);
  }

  public stopTyping(): void {
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = undefined;
    }

    if (this.wsService && this.state.wsChannel) {
      this.wsService.stopTyping(this.state.wsChannel);
    }
  }

  /**
   * Whether to render the subject input.
   *
   * A subject belongs to announcements only — it is what identifies one in a
   * list. Conversations are chat, and any reply is by definition inside one.
   * The backend enforces the same rule from the same scope set, and rejects
   * a subject on a conversation outright.
   *
   * When editing an existing message we can read `kind` straight off the DTO;
   * when composing a new one there is no message yet, so the scope is derived
   * from the target we are about to post to.
   */
  private shouldShowSubject(): boolean {
    if (this.state.replyTo) {
      return false;
    }
    if (this.state.editingMessage) {
      return this.state.editingMessage.kind === 'announcement';
    }
    const payload = this.state.target?.createPayload;
    if (!payload) {
      return true; // no target = global = announcement
    }
    return scopeHasSubject(deriveScopeFromCreatePayload(payload));
  }

  private postState(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.postMessage({
      command: 'updateState',
      data: {
        target: this.state.target,
        replyTo: this.state.replyTo,
        editingMessage: this.state.editingMessage,
        loading: this.state.loading,
        typingUsers: this.state.typingUsers,
        showSubject: this.shouldShowSubject()
      }
    });
  }

  private postLoading(loading: boolean): void {
    this.state.loading = loading;
    if (!this.view) {
      return;
    }
    this.view.webview.postMessage({
      command: 'setLoading',
      data: { loading }
    });
  }

  private async handleCreateMessage(data: { title?: string; content: string; parent_id?: string }): Promise<void> {
    const target = this.state.target;
    if (!target) {
      notify.warning('Unable to post message: target context missing.');
      return;
    }
    if (target.readOnly) {
      notify.warning(target.readOnlyReason || 'You do not have permission to post messages here.');
      return;
    }

    // Backend enforces a single-target invariant — only the most-specific
    // target is persisted, all other target columns are forced NULL. Send
    // exactly one to keep the wire payload honest.
    const filteredPayload = pickMostSpecificTarget(target.createPayload);

    const payload: MessageCreate = {
      content: data.content,
      parent_id: data.parent_id ?? null,
      ...filteredPayload
    } as MessageCreate;

    // Only carry a subject when there is one. Sending `title: ''` on a
    // conversational scope is now a 400, and it was never meaningful.
    if (data.title) {
      payload.title = data.title;
    }

    try {
      this.postLoading(true);
      await this.api.createMessage(payload);
      this.clearReplyAndEdit();
      // Only refresh via callback if no WebSocket — WS handles the update in real-time
      if (this.onMessageCreatedCallback && !this.state.wsChannel) {
        await this.onMessageCreatedCallback();
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      notify.error(`Failed to send message: ${errorMessage}`);
    } finally {
      this.postLoading(false);
    }
  }

  private async handleUpdateMessage(data: { messageId: string; title?: string; content: string }): Promise<void> {
    if (!data?.messageId) {
      return;
    }

    // An omitted title means "leave the subject alone". This used to send
    // `title: ''` unconditionally — including from conversational scopes,
    // where the input isn't even rendered — which erased the subject of any
    // message that had one.
    const updates: MessageUpdate = { content: data.content };
    if (data.title) {
      updates.title = data.title;
    }

    try {
      this.postLoading(true);
      await this.api.updateMessage(data.messageId, updates);
      this.clearReplyAndEdit();
      // Only refresh via callback if no WebSocket — WS handles the update in real-time
      if (this.onMessageCreatedCallback && !this.state.wsChannel) {
        await this.onMessageCreatedCallback();
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      notify.error(`Failed to update message: ${errorMessage}`);
    } finally {
      this.postLoading(false);
    }
  }

  // resolveMessageLevel() is gone: thread depth is derived server-side from
  // parent_id now. Guessing it from whatever happened to be in this panel's
  // in-memory page — and falling back to 1 when the parent wasn't loaded —
  // is exactly the wrong value the backend used to store verbatim.

  private updateHtml(): void {
    if (!this.view) {
      return;
    }

    this.view.webview.html = renderWebviewPage(this.view.webview, this.extensionUri, {
      title: 'New Message',
      bodyHtml: '<div id="app"></div>',
      cssFiles: ['shared/chat-shared.css', 'messaging/messages-input.css'],
      scriptFiles: ['vendor/marked.min.js', 'shared/mention.js', 'messaging/messages-input.js']
    });
  }
}

/**
 * The single target to send on the wire.
 *
 * The backend keeps exactly one target column and nulls the rest, so
 * sending more than one just invites the two sides to disagree about which
 * won. MESSAGE_TARGET_FIELDS is generated from the same tuple the backend
 * resolves with, so "most specific" means the same thing on both ends.
 *
 * user_id / course_member_id sit at the top and are forwarded even though
 * the backend rejects writes to them (NotImplementedException), so the user
 * sees the real error rather than a misleading global-post 403.
 */
function pickMostSpecificTarget(createPayload: Record<string, unknown>): Partial<MessageCreate> {
  for (const field of MESSAGE_TARGET_FIELDS) {
    const value = createPayload[field];
    if (typeof value === 'string' && value.length > 0) {
      return { [field]: value } as Partial<MessageCreate>;
    }
  }
  return {};
}
