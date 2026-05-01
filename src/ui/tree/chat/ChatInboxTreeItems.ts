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
    expanded: boolean,
    public readonly filterActive: boolean = false,
    /** When set, the scope renders course nodes as children instead of
     *  threads — used for the four course-grouped scopes (submission_group /
     *  course / course_content / course_group). The number is shown in the
     *  description and the row stays collapsible even with zero threads. */
    public readonly courseChildCount?: number
  ) {
    const isCourseGrouped = courseChildCount !== undefined;
    const childCount = isCourseGrouped ? courseChildCount! : threads.length;
    const childKind = isCourseGrouped ? 'course' : 'thread';
    super(
      SCOPE_LABELS[scope],
      childCount === 0
        ? vscode.TreeItemCollapsibleState.None
        : expanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `chat-scope-${scope}`;
    // contextValue carries the scope name and an unread suffix, so menus
    // can target either every scope (e.g. /\.unread$/), or a single scope
    // (e.g. /^chatScope\.submission_group/) without ambiguity.
    this.contextValue = unreadCount > 0
      ? `chatScope.${scope}.unread`
      : `chatScope.${scope}`;
    this.iconPath = new vscode.ThemeIcon(SCOPE_ICONS[scope]);
    const filterSuffix = filterActive ? ' · filter on' : '';
    this.description = unreadCount > 0
      ? `${unreadCount} unread · ${childCount}${filterSuffix}`
      : `${childCount}${filterSuffix}`;
    const tooltipBase = unreadCount > 0
      ? `${SCOPE_LABELS[scope]}: ${unreadCount} unread of ${childCount} ${childKind}(s)`
      : `${SCOPE_LABELS[scope]}: ${childCount} ${childKind}(s)`;
    this.tooltip = filterActive
      ? `${tooltipBase}\nFilter active — right-click to manage`
      : tooltipBase;
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

export class ChatCourseGroupItem extends vscode.TreeItem {
  constructor(
    public readonly scope: MessageScope,
    public readonly courseId: string,
    public readonly courseLabel: string,
    /** Aggregate unread for messages of `scope` belonging to `courseId` that
     *  have already been pulled. Zero when the course node hasn't been
     *  expanded yet. */
    public readonly unreadCount: number,
    /** Number of distinct threads for messages of `scope` × `courseId` that
     *  have already been pulled. */
    public readonly threadCount: number,
    /** Whether the backend reports more messages for (scope, courseId) than
     *  we've pulled so far — drives the trailing Load more visibility. */
    public readonly hasMore: boolean,
    expanded: boolean
  ) {
    super(courseLabel, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `chat-course-group-${scope}-${courseId}`;
    this.contextValue = unreadCount > 0
      ? `chatCourseGroup.${scope}.unread`
      : `chatCourseGroup.${scope}`;
    this.iconPath = new vscode.ThemeIcon('mortar-board');
    if (threadCount === 0) {
      this.description = expanded ? 'no messages' : 'click to load';
    } else {
      this.description = unreadCount > 0
        ? `${unreadCount} unread · ${threadCount}${hasMore ? ' · …' : ''}`
        : `${threadCount}${hasMore ? ' · …' : ''}`;
    }
    this.tooltip = unreadCount > 0
      ? `${courseLabel}: ${unreadCount} unread of ${threadCount} thread(s)`
      : `${courseLabel}: ${threadCount} thread(s)`;
  }
}

export class ChatFilterChipItem extends vscode.TreeItem {
  constructor(
    label: string,
    tooltip: string,
    removeCommand: string,
    removeArgs: unknown[] = []
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    // Stable per-label id so VS Code can diff the tree without flicker.
    this.id = `chat-filter-chip-${label}`;
    this.contextValue = 'chatFilterChip';
    this.iconPath = new vscode.ThemeIcon('close');
    this.tooltip = tooltip;
    this.command = {
      command: removeCommand,
      title: 'Remove Filter',
      arguments: removeArgs
    };
  }
}

export class ChatLoadMoreItem extends vscode.TreeItem {
  constructor(
    public readonly scope: MessageScope,
    loaded: number,
    total: number,
    public readonly courseId?: string
  ) {
    const remaining = Math.max(total - loaded, 0);
    super(`Load more (${loaded} of ${total})`, vscode.TreeItemCollapsibleState.None);
    this.id = courseId
      ? `chat-load-more-${scope}-${courseId}`
      : `chat-load-more-${scope}`;
    this.iconPath = new vscode.ThemeIcon('ellipsis');
    this.contextValue = 'chatLoadMore';
    this.description = remaining > 0 ? `${remaining} more` : '';
    this.tooltip = remaining > 0
      ? `Click to fetch the next batch (${remaining} more available).`
      : 'No more messages to load.';
    this.command = {
      command: 'computor.chat.loadMore',
      title: 'Load More Messages',
      arguments: courseId ? [scope, courseId] : [scope]
    };
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
