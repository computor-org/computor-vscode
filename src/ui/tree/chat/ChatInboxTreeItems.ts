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
  /**
   * Set when this row is one individual announcement rather than a whole
   * conversation.
   *
   * Announcements share a target — every notice in a course carries the same
   * `course_id` — so grouping by target collapsed a semester of them into a
   * single row labelled with the course name. Each is its own item, and this
   * is the message it stands for (also what keeps the row ids distinct).
   */
  anchorMessageId?: string;
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
    options?: {
      /** When set, the scope renders course nodes as children instead of
       *  threads — used for the four course-grouped scopes (submission_group /
       *  course / course_content / course_group). The number is shown in the
       *  description and the row stays collapsible even with zero threads. */
      courseChildCount?: number;
      /** When true, this scope's notifications are muted. Reflected in the
       *  description, tooltip, and contextValue (so menus can swap between
       *  mute/unmute commands). */
      muted?: boolean;
    }
  ) {
    const courseChildCount = options?.courseChildCount;
    const muted = options?.muted === true;
    const isCourseGrouped = courseChildCount !== undefined;
    const childCount = isCourseGrouped ? courseChildCount! : threads.length;
    const childKind = isCourseGrouped ? 'course' : 'thread';
    // Prefix the label (not the description) with the muted bell so the
    // glyph sits at the same column on every muted row, vertically aligned.
    const baseLabel = SCOPE_LABELS[scope];
    const label = muted ? `🔕 ${baseLabel}` : baseLabel;
    super(
      label,
      childCount === 0
        ? vscode.TreeItemCollapsibleState.None
        : expanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `chat-scope-${scope}`;
    // contextValue carries the scope name plus optional ".unread" / ".muted"
    // suffixes so menus can target either every scope (e.g. /\.unread$/) or a
    // single scope (e.g. /^chatScope\.submission_group/) without ambiguity.
    const suffixes: string[] = [];
    if (unreadCount > 0) { suffixes.push('unread'); }
    if (muted) { suffixes.push('muted'); }
    this.contextValue = ['chatScope', scope, ...suffixes].join('.');
    this.iconPath = new vscode.ThemeIcon(SCOPE_ICONS[scope]);
    this.description = unreadCount > 0 ? `${unreadCount} unread · ${childCount}` : `${childCount}`;
    const baseTooltip = unreadCount > 0
      ? `${baseLabel}: ${unreadCount} unread of ${childCount} ${childKind}(s)`
      : `${baseLabel}: ${childCount} ${childKind}(s)`;
    this.tooltip = muted ? `${baseTooltip}\nNotifications muted for this scope.` : baseTooltip;
  }
}

export class ChatThreadItem extends vscode.TreeItem {
  constructor(public readonly thread: ChatThread) {
    super(thread.title, vscode.TreeItemCollapsibleState.None);
    const announcement = Boolean(thread.anchorMessageId);
    // Announcements share a target id, so the anchor is what keeps sibling
    // rows distinct — without it they would all collide on one tree id.
    this.id = announcement
      ? `chat-announcement-${thread.scope}-${thread.anchorMessageId}`
      : `chat-thread-${thread.scope}-${thread.targetId ?? 'none'}`;
    this.contextValue = thread.unreadCount > 0 ? 'chatThread.unread' : 'chatThread';

    if (thread.unreadCount > 0) {
      this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
      // Bold-ish emphasis via leading marker; VS Code TreeItem doesn't expose font-weight.
      this.label = {
        label: thread.title,
        highlights: [[0, thread.title.length]]
      };
    } else {
      this.iconPath = new vscode.ThemeIcon(announcement ? 'megaphone' : 'comment');
    }

    const subtitle = thread.subtitle ? `${thread.subtitle} · ` : '';
    // An announcement's own subject is already the label, so repeating the
    // body as a preview says nothing; who posted it and when does.
    const preview = announcement
      ? formatByline(thread.lastMessage)
      : (thread.lastMessage ? formatPreview(thread.lastMessage) : '');
    this.description = thread.unreadCount > 0 && !announcement
      ? `(${thread.unreadCount}) ${subtitle}${preview}`
      : `${subtitle}${preview}`;

    this.tooltip = buildTooltip(thread);

    this.command = {
      command: 'computor.chat.openThread',
      title: announcement ? 'Open Announcement' : 'Open Conversation',
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

/** "Ada Lovelace · 11 Aug" — attribution for a single announcement row. */
function formatByline(message?: MessageList): string {
  if (!message) { return ''; }
  const author = formatAuthor(message);
  let when = '';
  if (message.created_at) {
    try {
      when = new Date(message.created_at).toLocaleDateString();
    } catch { /* ignore parse errors */ }
  }
  return [author, when].filter(Boolean).join(' · ');
}

function buildTooltip(thread: ChatThread): string {
  const parts: string[] = [thread.title];
  if (thread.subtitle) { parts.push(thread.subtitle); }
  parts.push(`Scope: ${scopeLabel(thread.scope)}`);
  if (thread.anchorMessageId) {
    // One announcement — a message count would always read "1".
    parts.push(thread.unreadCount > 0 ? 'Unread' : 'Read');
  } else if (thread.unreadCount > 0) {
    parts.push(`Unread: ${thread.unreadCount} of ${thread.messageCount}`);
  } else {
    parts.push(`Messages: ${thread.messageCount}`);
  }
  if (thread.lastMessage?.created_at) {
    const label = thread.anchorMessageId ? 'Posted' : 'Last activity';
    try {
      parts.push(`${label}: ${new Date(thread.lastMessage.created_at).toLocaleString()}`);
    } catch { /* ignore parse errors */ }
  }
  return parts.join('\n');
}
