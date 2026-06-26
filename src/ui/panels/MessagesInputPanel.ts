import * as vscode from 'vscode';
import { ComputorApiService } from '../../services/ComputorApiService';
import { MessageCreate, MessageUpdate, MessageList, MessageMentionRef, MentionableQuery } from '../../types/generated';
import { MessageTargetContext } from '../webviews/MessagesWebviewProvider';
import { WebSocketService } from '../../services/WebSocketService';

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
            vscode.window.showWarningMessage(String(message.data));
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
    for (const field of TARGET_FIELDS_BY_SPECIFICITY) {
      const value = payload[field];
      if (typeof value === 'string' && value.length > 0) {
        return { [field]: value } as MentionableQuery;
      }
    }
    return undefined;
  }

  private async fetchAndPostMentionable(search?: string): Promise<void> {
    const query = this.buildMentionScope();
    if (!query || !this.view) {
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
      // Non-fatal — the autocomplete just won't have suggestions.
      console.warn('[MessagesInputPanel] failed to fetch mentionable users', error);
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

  // Subject (title) only belongs on announcement scopes. Conversational scopes
  // (user / course_member / submission_group) and any reply are chats — no
  // subject. Mirrors CONVERSATIONAL_TARGET_FIELDS in the backend.
  private shouldShowSubject(): boolean {
    if (this.state.replyTo) {
      return false;
    }
    const source = (this.state.editingMessage
      ? this.state.editingMessage
      : this.state.target?.createPayload) as Record<string, unknown> | undefined;
    if (!source) {
      return true; // global / no target = announcement
    }
    const conversational = ['user_id', 'course_member_id', 'submission_group_id'];
    for (const field of TARGET_FIELDS_BY_SPECIFICITY) {
      const value = source[field];
      if (typeof value === 'string' && value.length > 0) {
        return !conversational.includes(field);
      }
    }
    return true; // no target set = global = announcement
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

  private async handleCreateMessage(data: { title: string; content: string; parent_id?: string }): Promise<void> {
    const target = this.state.target;
    if (!target) {
      vscode.window.showWarningMessage('Unable to post message: target context missing.');
      return;
    }
    if (target.readOnly) {
      vscode.window.showWarningMessage(target.readOnlyReason || 'You do not have permission to post messages here.');
      return;
    }

    const level = this.resolveMessageLevel(data.parent_id);
    // Backend enforces a single-target invariant — only the most-specific
    // target is persisted, all other target columns are forced NULL. Send
    // exactly one to keep the wire payload honest.
    const filteredPayload = pickMostSpecificTarget(target.createPayload);

    const payload: MessageCreate = {
      title: data.title,
      content: data.content,
      parent_id: data.parent_id ?? null,
      level,
      ...filteredPayload
    } as MessageCreate;

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
      vscode.window.showErrorMessage(`Failed to send message: ${errorMessage}`);
    } finally {
      this.postLoading(false);
    }
  }

  private async handleUpdateMessage(data: { messageId: string; title: string; content: string }): Promise<void> {
    if (!data?.messageId) {
      return;
    }

    const updates: MessageUpdate = {
      title: data.title,
      content: data.content
    };

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
      vscode.window.showErrorMessage(`Failed to update message: ${errorMessage}`);
    } finally {
      this.postLoading(false);
    }
  }

  private resolveMessageLevel(parentId?: string): number {
    if (!parentId) {
      return 0;
    }

    const messages = this.state.messages ?? [];
    const parent = messages.find((message) => message.id === parentId);
    if (!parent) {
      return 1;
    }
    return (parent.level ?? 0) + 1;
  }

  private updateHtml(): void {
    if (!this.view) {
      return;
    }

    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const webview = this.view.webview;
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'messages-input.css'));
    const componentsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'components', 'components.css'));
    const componentsJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'components.js'));
    const markedJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'lib', 'marked.min.js'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'messages-input.js'));

    this.view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${componentsUri}" rel="stylesheet" />
  <link href="${stylesUri}" rel="stylesheet" />
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
  </script>
  <script nonce="${nonce}" src="${markedJsUri}"></script>
  <script nonce="${nonce}" src="${componentsJsUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// Most-specific first; the first match is the only target sent on the wire.
// user_id / course_member_id sit at the top: backend currently rejects writes
// to those scopes (NotImplementedException), but we forward them so the user
// sees the real error rather than a misleading global-post 403.
const TARGET_FIELDS_BY_SPECIFICITY = [
  'user_id',
  'course_member_id',
  'submission_group_id',
  'course_content_id',
  'course_group_id',
  'course_id',
  'course_family_id',
  'organization_id'
] as const;

function pickMostSpecificTarget(createPayload: Record<string, unknown>): Partial<MessageCreate> {
  for (const field of TARGET_FIELDS_BY_SPECIFICITY) {
    const value = createPayload[field];
    if (typeof value === 'string' && value.length > 0) {
      return { [field]: value } as Partial<MessageCreate>;
    }
  }
  return {};
}
