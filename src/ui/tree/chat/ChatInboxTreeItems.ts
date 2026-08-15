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

// Human names for scopes, used in tooltips, toasts and the flat DM
// sections. The old system names ("Submission Groups", "Course Content")
// told users nothing about who reads such a message (issue #322 §3).
const SCOPE_LABELS: Record<MessageScope, string> = {
  user: 'Direct Messages',
  course_member: 'Course Member DMs',
  submission_group: 'Assignment conversation',
  course_group: 'Group announcement',
  course_content: 'Assignment announcement',
  course: 'Course announcement',
  course_family: 'Course family announcement',
  organization: 'Organization announcement',
  global: 'System announcement'
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

    // A scope with children expands on click — that is what the arrow is for.
    // A childless one (Global before anyone has posted) would otherwise do
    // nothing at all, so it opens instead. This replaces the synthetic
    // placeholder thread that used to be injected to give it something
    // clickable; the command is on the context menu either way.
    if (childCount === 0) {
      this.command = {
        command: 'computor.chat.openMessages',
        title: 'Open Messages',
        arguments: [this]
      };
    }
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
    // The kind is part of the contextValue so menus can target just
    // assignment threads (jump-to-assignment) or just announcements.
    const base = thread.scope === 'submission_group'
      ? 'chatThread.assignment'
      : announcement ? 'chatThread.announcement' : 'chatThread.dm';
    this.contextValue = thread.unreadCount > 0 ? `${base}.unread` : base;

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

/** Real message/unread totals for a tree row, from the counts endpoint or
 *  (as a fallback) from the pages fetched so far. `undefined` means the
 *  numbers are genuinely unknown — nothing fetched and no counts API. */
export interface ChatCounts {
  total: number;
  unread: number;
}

export type ChatSectionKind = 'announcements' | 'assignments';

/** "{unread} unread · {total}" / "{total}" / "no messages" — the one format
 *  every level of the tree uses, so the numbers always mean the same thing
 *  (messages and unread messages, never child-node counts — issue #322 §2). */
export function formatCountsDescription(counts: ChatCounts | undefined): string {
  if (!counts) { return ''; }
  if (counts.unread > 0) { return `${counts.unread} unread · ${counts.total}`; }
  if (counts.total > 0) { return `${counts.total}`; }
  return 'no messages';
}

/** Root "Announcements" node: global + organization + course_family notices. */
export class ChatTopAnnouncementsItem extends vscode.TreeItem {
  constructor(
    public readonly threads: ChatThread[],
    public readonly unreadCount: number,
    counts: ChatCounts | undefined,
    expanded: boolean,
    muted: boolean
  ) {
    const label = muted ? '🔕 Announcements' : 'Announcements';
    const canExpand = threads.length > 0;
    super(
      label,
      canExpand
        ? (expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None
    );
    this.id = 'chat-top-announcements';
    const suffixes: string[] = [];
    if (unreadCount > 0) { suffixes.push('unread'); }
    if (muted) { suffixes.push('muted'); }
    this.contextValue = ['chatTop', 'announcements', ...suffixes].join('.');
    this.iconPath = new vscode.ThemeIcon('megaphone');
    this.description = formatCountsDescription(counts);
    const baseTooltip = 'System, organization and course-family announcements';
    this.tooltip = muted ? `${baseTooltip}\nNotifications muted.` : baseTooltip;
    // A childless row would otherwise do nothing on click — open the global
    // announcements panel instead (also the only route to posting the first).
    if (!canExpand) {
      this.command = {
        command: 'computor.chat.openMessages',
        title: 'Open Messages',
        arguments: [this]
      };
    }
  }
}

/** One node per enrolled course; expands into Announcements + Assignments. */
export class ChatCourseItem extends vscode.TreeItem {
  constructor(
    public readonly courseId: string,
    public readonly courseLabel: string,
    public readonly unreadCount: number,
    counts: ChatCounts | undefined,
    expanded: boolean,
    muted: boolean
  ) {
    super(
      muted ? `🔕 ${courseLabel}` : courseLabel,
      expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `chat-course-${courseId}`;
    const suffixes: string[] = [];
    if (unreadCount > 0) { suffixes.push('unread'); }
    if (muted) { suffixes.push('muted'); }
    this.contextValue = ['chatCourse', ...suffixes].join('.');
    this.iconPath = new vscode.ThemeIcon('mortar-board');
    this.description = formatCountsDescription(counts);
    const baseTooltip = counts
      ? `${courseLabel}: ${counts.unread} unread of ${counts.total} message(s)`
      : courseLabel;
    this.tooltip = muted ? `${baseTooltip}\nNotifications muted for this course.` : baseTooltip;
  }
}

/** "Announcements" / "Assignments" under a course node. */
export class ChatCourseSectionItem extends vscode.TreeItem {
  constructor(
    public readonly kind: ChatSectionKind,
    public readonly courseId: string,
    public readonly courseLabel: string,
    public readonly unreadCount: number,
    counts: ChatCounts | undefined,
    expanded: boolean
  ) {
    const label = kind === 'announcements' ? 'Announcements' : 'Assignments';
    // A section the counts endpoint says is empty renders as a leaf with
    // "no messages" — never the dead "click to load" (issue #322 §4). With
    // unknown counts it stays expandable and loads lazily on expand.
    const knownEmpty = counts !== undefined && counts.total === 0;
    super(
      label,
      knownEmpty
        ? vscode.TreeItemCollapsibleState.None
        : (expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
    );
    this.id = `chat-section-${kind}-${courseId}`;
    this.contextValue = unreadCount > 0 ? `chatSection.${kind}.unread` : `chatSection.${kind}`;
    this.iconPath = new vscode.ThemeIcon(kind === 'announcements' ? 'megaphone' : 'comment-discussion');
    this.description = formatCountsDescription(counts);
    this.tooltip = counts
      ? `${courseLabel} · ${label}: ${counts.unread} unread of ${counts.total} message(s)`
      : `${courseLabel} · ${label}`;
    // An empty section still needs a way in — to read nothing is pointless,
    // but to write the first message is exactly what an empty section is for.
    if (knownEmpty) {
      this.command = {
        command: 'computor.chat.openMessages',
        title: 'Open Messages',
        arguments: [this]
      };
    }
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
