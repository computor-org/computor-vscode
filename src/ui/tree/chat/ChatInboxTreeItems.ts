import * as vscode from 'vscode';
import type { MessageList } from '../../../types/generated';

export type MessageScope =
  | 'user'
  | 'course_member'
  | 'submission_group'
  | 'course_group'
  | 'course_content'
  | 'course'
  | 'course_family'
  | 'organization'
  | 'global';

export interface ChatThread {
  scope: MessageScope;
  /** Target id for the scope (null for global). */
  targetId: string | null;
  /** Display title for the thread row. */
  title: string;
  /** Optional secondary text under the title. */
  subtitle?: string;
  /** Last message in the thread (for preview + sort key). */
  lastMessage?: MessageList;
  /** Per-thread unread count. */
  unreadCount: number;
  /** Total message count. */
  messageCount: number;
  /** All messages belonging to this thread (kept for the open-thread handler). */
  messages: MessageList[];
}

const SCOPE_LABELS: Record<MessageScope, string> = {
  user: 'Direct Messages',
  course_member: 'Course Member DMs',
  submission_group: 'Submission Groups',
  course_group: 'Course Groups',
  course_content: 'Course Content',
  course: 'Courses',
  course_family: 'Course Families',
  organization: 'Organizations',
  global: 'Global'
};

const SCOPE_ICONS: Record<MessageScope, string> = {
  user: 'mail',
  course_member: 'account',
  submission_group: 'beaker',
  course_group: 'organization',
  course_content: 'symbol-file',
  course: 'mortar-board',
  course_family: 'folder-library',
  organization: 'organization',
  global: 'globe'
};

export function scopeLabel(scope: MessageScope): string {
  return SCOPE_LABELS[scope];
}

export class ChatScopeItem extends vscode.TreeItem {
  constructor(
    public readonly scope: MessageScope,
    public readonly threads: ChatThread[],
    public readonly unreadCount: number,
    expanded: boolean
  ) {
    super(
      SCOPE_LABELS[scope],
      threads.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : expanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `chat-scope-${scope}`;
    this.contextValue = unreadCount > 0 ? 'chatScope.unread' : 'chatScope';
    this.iconPath = new vscode.ThemeIcon(SCOPE_ICONS[scope]);
    this.description = unreadCount > 0
      ? `${unreadCount} unread · ${threads.length}`
      : `${threads.length}`;
    this.tooltip = unreadCount > 0
      ? `${SCOPE_LABELS[scope]}: ${unreadCount} unread of ${threads.length} thread(s)`
      : `${SCOPE_LABELS[scope]}: ${threads.length} thread(s)`;
  }
}

export class ChatThreadItem extends vscode.TreeItem {
  constructor(public readonly thread: ChatThread) {
    super(thread.title, vscode.TreeItemCollapsibleState.None);
    this.id = `chat-thread-${thread.scope}-${thread.targetId ?? 'none'}`;
    this.contextValue = thread.unreadCount > 0 ? 'chatThread.unread' : 'chatThread';

    if (thread.unreadCount > 0) {
      this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
      // Bold-ish emphasis via leading marker; VS Code TreeItem doesn't expose font-weight.
      this.label = {
        label: thread.title,
        highlights: [[0, thread.title.length]]
      };
    } else {
      this.iconPath = new vscode.ThemeIcon('comment');
    }

    const subtitle = thread.subtitle ? `${thread.subtitle} · ` : '';
    const preview = thread.lastMessage ? formatPreview(thread.lastMessage) : '';
    this.description = thread.unreadCount > 0
      ? `(${thread.unreadCount}) ${subtitle}${preview}`
      : `${subtitle}${preview}`;

    this.tooltip = buildTooltip(thread);

    this.command = {
      command: 'computor.chat.openThread',
      title: 'Open Conversation',
      arguments: [this]
    };
  }
}

export class ChatEmptyItem extends vscode.TreeItem {
  constructor(message: string = 'No messages.') {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.id = 'chat-empty';
    this.iconPath = new vscode.ThemeIcon('inbox');
    this.contextValue = 'chatEmpty';
  }
}

export class ChatLoadingItem extends vscode.TreeItem {
  constructor() {
    super('Loading…', vscode.TreeItemCollapsibleState.None);
    this.id = 'chat-loading';
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.contextValue = 'chatLoading';
  }
}

export class ChatErrorItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.id = 'chat-error';
    this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    this.contextValue = 'chatError';
  }
}

function formatPreview(message: MessageList): string {
  const author = formatAuthor(message);
  const text = (message.content || '').replace(/\s+/g, ' ').trim();
  const snippet = text.length > 80 ? `${text.slice(0, 77)}…` : text;
  return author ? `${author}: ${snippet}` : snippet;
}

function formatAuthor(message: MessageList): string {
  const a = message.author;
  if (!a) { return ''; }
  const given = a.given_name || '';
  const family = a.family_name || '';
  const full = `${given} ${family}`.trim();
  return full || (a as any).username || (a as any).email || '';
}

function buildTooltip(thread: ChatThread): string {
  const parts: string[] = [thread.title];
  if (thread.subtitle) { parts.push(thread.subtitle); }
  parts.push(`Scope: ${scopeLabel(thread.scope)}`);
  if (thread.unreadCount > 0) {
    parts.push(`Unread: ${thread.unreadCount} of ${thread.messageCount}`);
  } else {
    parts.push(`Messages: ${thread.messageCount}`);
  }
  if (thread.lastMessage?.created_at) {
    try {
      parts.push(`Last activity: ${new Date(thread.lastMessage.created_at).toLocaleString()}`);
    } catch { /* ignore parse errors */ }
  }
  return parts.join('\n');
}
