import * as vscode from 'vscode';
import { ComputorApiService } from '../../services/ComputorApiService';
import { MessageCreate, MessageUpdate, MessageList } from '../../types/generated';
import { MessageTargetContext } from '../webviews/MessagesWebviewProvider';
import { WebSocketService } from '../../services/WebSocketService';

interface InputPanelState {
  target?: MessageTargetContext;
  replyTo?: MessageList;
  editingMessage?: MessageList;
  loading: boolean;
  messages?: MessageList[];
  wsChannel?: string;
}

export class MessagesInputPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'computor.messagesInputPanel';
  private view?: vscode.WebviewView;
  private state: InputPanelState = { loading: false };
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

  public clearReplyAndEdit(): void {
    this.state.replyTo = undefined;
    this.state.editingMessage = undefined;
    this.postState();
  }

  public clearState(): void {
    this.state = { loading: false };
    this.postState();
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
        loading: this.state.loading
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

    const level = this.resolveMessageLevel(data.parent_id);
    const targetFields = ['user_id', 'course_member_id', 'submission_group_id', 'course_group_id', 'course_content_id', 'course_id'] as const;
    const filteredPayload: Partial<MessageCreate> = {};
    for (const field of targetFields) {
      const value = target.createPayload[field];
      if (typeof value === 'string') {
        filteredPayload[field] = value;
      }
    }

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
      if (this.onMessageCreatedCallback) {
        await this.onMessageCreatedCallback();
      }
      vscode.window.showInformationMessage('Message sent.');
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
      if (this.onMessageCreatedCallback) {
        await this.onMessageCreatedCallback();
      }
      vscode.window.showInformationMessage('Message updated.');
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
