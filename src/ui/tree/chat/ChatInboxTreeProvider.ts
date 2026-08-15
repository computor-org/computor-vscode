import * as vscode from 'vscode';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { kindForScope } from '../../../services/MessagePermissions';
import { MessageLabelResolver, shortId } from '../../../services/MessageLabelResolver';
import { buildTargetContext } from '../../../services/messageTargets';
import { WebSocketService } from '../../../services/WebSocketService';
import { MessagesWebviewProvider, MessageTargetContext } from '../../webviews/MessagesWebviewProvider';
import type { MessageCountsGet, MessageList } from '../../../types/generated';
import { notify } from '../../../utils/notify';

const GLOBAL_CHANNEL = 'global';
import {
  ChatScopeItem,
  ChatThreadItem,
  ChatThread,
  ChatCounts,
  ChatCourseItem,
  ChatCourseSectionItem,
  ChatEmptyItem,
  ChatLoadingItem,
  ChatErrorItem,
  ChatLoadMoreItem,
  ChatSectionKind,
  ChatTopAnnouncementsItem,
  formatCountsDescription,
  MessageScope,
  scopeLabel
} from './ChatInboxTreeItems';
import { BaseTreeDataProvider } from '../BaseTreeDataProvider';

/** Scopes rendered under a course node (lazy-fetched per course).
 *  Everything else is fetched eagerly per scope. */
const COURSE_GROUPED_SCOPES = new Set<MessageScope>([
  'submission_group',
  'course',
  'course_content',
  'course_group'
]);

function isCourseGroupedScope(scope: MessageScope): boolean {
  return COURSE_GROUPED_SCOPES.has(scope);
}

/** Scopes folded into the root "Announcements" node. */
const TOP_SCOPES: MessageScope[] = ['global', 'organization', 'course_family'];

/** Direct-message scopes — rendered as flat sections, only when non-empty
 *  (their write path is not implemented on the backend). */
const DM_SCOPES: MessageScope[] = ['user', 'course_member'];

/** The scopes a course's "Announcements" section merges. */
const COURSE_ANNOUNCEMENT_SCOPES: MessageScope[] = ['course', 'course_group', 'course_content'];

const SCOPE_ORDER: MessageScope[] = [
  'user',
  'course_member',
  'submission_group',
  'course_group',
  'course_content',
  'course',
  'course_family',
  'organization',
  'global'
];

const STATE_KEY = 'computor.chat.inbox.state';

/** Pre-course-first shape, read once for migration. */
interface PersistedStateV1 {
  expandedScopes: MessageScope[];
  unreadOnly: boolean;
  mutedScopes?: MessageScope[];
  expandedCourseGroups?: string[];
}

interface PersistedStateV2 {
  version: 2;
  unreadOnly: boolean;
  /** Course ids whose node is open. */
  expandedCourses: string[];
  /** 'top', `${kind}::${courseId}` for course sections, `scope::${scope}`
   *  for the flat DM sections. */
  expandedSections: string[];
  mutedCourses: string[];
  muteTopAnnouncements: boolean;
}

type AnyTreeItem =
  | ChatScopeItem
  | ChatThreadItem
  | ChatEmptyItem
  | ChatLoadingItem
  | ChatErrorItem
  | ChatLoadMoreItem
  | ChatTopAnnouncementsItem
  | ChatCourseItem
  | ChatCourseSectionItem;

interface ScopeFetchState {
  /** Accumulated messages for this scope; grows on each Load more. */
  messages: MessageList[];
  /** How many we've fetched (sum across pages, and across courses for the
   *  filtered submission_group case). */
  fetched: number;
  /** Backend's reported total for this scope under the current filter (sum
   *  of per-course X-Total-Count when fan-out applies). */
  total: number;
}

export class ChatInboxTreeProvider extends BaseTreeDataProvider<AnyTreeItem> {
  private readonly _onDidChangeUnread = new vscode.EventEmitter<number>();
  readonly onDidChangeUnread = this._onDidChangeUnread.event;

  private readonly api: ComputorApiService;
  private readonly context: vscode.ExtensionContext;
  private readonly messagesProvider: MessagesWebviewProvider;

  private loading = false;
  private loadError: string | undefined;
  private rootItems: AnyTreeItem[] = [];
  /** Unread total for the view badge — server counts when available (they
   *  cover unfetched sections too), otherwise summed from fetched pages. */
  private totalUnread = 0;
  /** Server-side aggregates keyed `${scope}::${courseId ?? ''}`. Undefined
   *  against a backend without GET /messages/counts. Mutated locally on
   *  optimistic read/unread so badges track without a refetch. */
  private counts?: Map<string, ChatCounts>;
  private countsTotals?: { total: number; unread: number };
  /** Flat union of every scope's accumulated messages, used by groupMessages
   *  + buildScopeItems and shared by mark-read mutations. Rebuilt from
   *  scopeFetchStates whenever they change. */
  private cachedMessages: MessageList[] = [];
  /** Per-scope pagination + accumulation for non-course-grouped scopes
   *  (user / course_member / course_family / organization / global). */
  private scopeFetchStates: Map<MessageScope, ScopeFetchState> = new Map();
  /** Per-(scope, courseId) pagination + accumulation for the course-grouped
   *  scopes (submission_group, course, course_content, course_group). */
  private courseScopeStates: Map<MessageScope, Map<string, ScopeFetchState>> = new Map();
  /** Page size for every per-scope GET (initial + each Load more click). */
  private static readonly SCOPE_PAGE_SIZE = 200;
  /** Set of scopes whose Load more is in-flight, so a double-click doesn't
   *  fan out duplicate skip values. */
  private scopeLoadingMore: Set<MessageScope> = new Set();
  /** Same idea but keyed `${scope}::${courseId}` for the per-course
   *  pagination. */
  private courseScopeLoadingMore: Set<string> = new Set();
  private currentUserId?: string;
  private userScopes?: import('../../../types/generated').UserScopes;
  private userScopesPromise?: Promise<void>;
  /** Cached list of role-based views available to the current user (e.g.
   *  `student`, `tutor`, `lecturer`, `user_manager`). Used to gate global
   *  posting for `_user_manager` alongside `_admin`. */
  private userViews: string[] = [];
  private reloadInFlight?: Promise<void>;
  private reloadQueued = false;
  private wsService?: WebSocketService;
  private wsSubscribedForUserId?: string;
  private readonly wsHandlerId = `chat-inbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private wsReloadTimer?: ReturnType<typeof setTimeout>;
  private static readonly WS_RELOAD_DEBOUNCE_MS = 250;
  /** When we mark messages read locally, suppress WS-driven reloads for this
   *  window — every server-side broadcast otherwise re-paginates the inbox. */
  private static readonly MARK_READ_WS_SUPPRESS_MS = 4000;
  private suppressWsReloadUntil = 0;

  // Persisted UI state (v2 — course-first)
  private expandedCourses: Set<string> = new Set();
  /** 'top', `${kind}::${courseId}`, or `scope::${scope}` for DM sections. */
  private expandedSections: Set<string> = new Set();
  private unreadOnly = false;
  private mutedCourses: Set<string> = new Set();
  private muteTopAnnouncements = false;
  /** Set by the v1→v2 migration when every old scope was muted: the course
   *  list isn't known yet at load time, so the mute-all lands on first
   *  reload once it is. */
  private pendingMuteAllCourses = false;

  /** Shared with the messages browser — same lookups, same caches. */
  private readonly labels: MessageLabelResolver;

  constructor(
    context: vscode.ExtensionContext,
    api: ComputorApiService,
    messagesProvider: MessagesWebviewProvider
  ) {
    super();
    this.context = context;
    this.api = api;
    this.messagesProvider = messagesProvider;
    this.labels = new MessageLabelResolver(api);
    this.loadPersistedState();
  }

  // ----- Public API -----

  setWebSocketService(wsService: WebSocketService): void {
    this.wsService = wsService;
    // If we already know who we are, subscribe immediately. Otherwise the
    // subscription happens at the end of the next reload, when currentUserId
    // is set.
    this.maybeSubscribeUserChannels();
    // Resolve identity eagerly too: reload() only runs once the Chat view is
    // rendered, so a user who never opened it got no new-message toasts at
    // all (computor-org/issues#317).
    if (!this.currentUserId) {
      void this.api.getCurrentUser()
        .then((identity) => {
          if (identity?.id && !this.currentUserId) {
            this.currentUserId = identity.id;
            this.maybeSubscribeUserChannels();
          }
        })
        .catch(() => undefined);
    }
  }

  override refresh(): void {
    void this.requestReload();
  }

  private requestReload(): Promise<void> {
    if (this.reloadInFlight) {
      // Coalesce — at most one extra reload queued after the current one.
      this.reloadQueued = true;
      return this.reloadInFlight;
    }
    this.reloadInFlight = this.reload().finally(() => {
      this.reloadInFlight = undefined;
      if (this.reloadQueued) {
        this.reloadQueued = false;
        void this.requestReload();
      }
    });
    return this.reloadInFlight;
  }

  getTotalUnread(): number {
    return this.totalUnread;
  }

  getCurrentUserId(): string | undefined {
    return this.currentUserId;
  }

  isUnreadOnly(): boolean {
    return this.unreadOnly;
  }

  setUnreadOnly(value: boolean): void {
    if (this.unreadOnly === value) { return; }
    this.unreadOnly = value;
    void this.persistState();
    void vscode.commands.executeCommand('setContext', 'computor.chat.unreadOnly', value);
    // Toggle is a pure client-side filter. Rebuilding from the cached
    // payload avoids re-paginating the entire inbox on every flip.
    this.rebuildFromCache();
  }

  /** Every course the tree knows about (the enrolment list). */
  private knownCourseIds(): string[] {
    const inner = this.courseScopeStates.get('submission_group');
    return inner ? Array.from(inner.keys()) : [];
  }

  /** True when anything is still un-muted. The title-bar action uses this to
   *  pick between "mute all" (bell) and "unmute all" (bell-slash). */
  isAnyScopeUnmuted(): boolean {
    if (!this.muteTopAnnouncements) { return true; }
    return this.knownCourseIds().some(id => !this.mutedCourses.has(id));
  }

  isCourseMuted(courseId: string): boolean {
    return this.mutedCourses.has(courseId);
  }

  /** Flip everything at once. If anything is un-muted, mute all; otherwise
   *  unmute all. */
  toggleAllNotifications(): void {
    if (this.isAnyScopeUnmuted()) {
      this.muteTopAnnouncements = true;
      this.mutedCourses = new Set(this.knownCourseIds());
    } else {
      this.muteTopAnnouncements = false;
      this.mutedCourses.clear();
    }
    void this.persistState();
    void this.applyNotificationContextKeys();
    this.rebuildFromCache();
  }

  toggleCourseMuted(courseId: string): void {
    if (this.mutedCourses.has(courseId)) {
      this.mutedCourses.delete(courseId);
    } else {
      this.mutedCourses.add(courseId);
    }
    void this.persistState();
    void this.applyNotificationContextKeys();
    this.rebuildFromCache();
  }

  toggleTopAnnouncementsMuted(): void {
    this.muteTopAnnouncements = !this.muteTopAnnouncements;
    void this.persistState();
    void this.applyNotificationContextKeys();
    this.rebuildFromCache();
  }

  recordCourseExpanded(courseId: string, expanded: boolean): void {
    if (expanded) {
      this.expandedCourses.add(courseId);
    } else {
      this.expandedCourses.delete(courseId);
    }
    void this.persistState();
  }

  recordSectionExpanded(key: string, expanded: boolean): void {
    if (expanded) {
      this.expandedSections.add(key);
    } else {
      this.expandedSections.delete(key);
    }
    void this.persistState();
  }

  // ----- Counts -----

  private static countsKey(scope: MessageScope, courseId: string | null): string {
    return `${scope}::${courseId ?? ''}`;
  }

  private applyCounts(response: MessageCountsGet | undefined): void {
    if (!response) {
      this.counts = undefined;
      this.countsTotals = undefined;
      return;
    }
    const map = new Map<string, ChatCounts>();
    for (const cell of response.counts ?? []) {
      map.set(ChatInboxTreeProvider.countsKey(cell.scope as MessageScope, cell.course_id ?? null), {
        total: cell.total ?? 0,
        unread: cell.unread ?? 0
      });
    }
    this.counts = map;
    this.countsTotals = { total: response.total ?? 0, unread: response.unread ?? 0 };
  }

  /** Sum of the server count cells for `scopes` within one course (or the
   *  course-less cells when `courseId` is null). Undefined without counts. */
  private countsFor(scopes: MessageScope[], courseId: string | null): ChatCounts | undefined {
    if (!this.counts) { return undefined; }
    let total = 0;
    let unread = 0;
    for (const scope of scopes) {
      const cell = this.counts.get(ChatInboxTreeProvider.countsKey(scope, courseId));
      if (cell) {
        total += cell.total;
        unread += cell.unread;
      }
    }
    return { total, unread };
  }

  /** Sum across every course for one scope (used by the flat DM sections,
   *  where course_member cells are spread over courses). */
  private countsForScopeAllCourses(scope: MessageScope): ChatCounts | undefined {
    if (!this.counts) { return undefined; }
    let total = 0;
    let unread = 0;
    const prefix = `${scope}::`;
    for (const [key, cell] of this.counts) {
      if (key.startsWith(prefix)) {
        total += cell.total;
        unread += cell.unread;
      }
    }
    return { total, unread };
  }

  /** The counts cell a message belongs to, for local badge adjustments. */
  private countsCellFor(m: MessageList): string {
    const scope = (m.scope || 'global') as MessageScope;
    const courseless = scope === 'global' || scope === 'organization'
      || scope === 'course_family' || scope === 'user';
    const courseId = courseless ? null : (m.context?.course_id ?? m.course_id ?? null);
    return ChatInboxTreeProvider.countsKey(scope, courseId);
  }

  /** Shift local unread counters after an optimistic read (+delta unread per
   *  message; -1 on read, +1 on unread). */
  private adjustCountsUnread(msgs: MessageList[], delta: number): void {
    if (!this.counts) { return; }
    for (const m of msgs) {
      const cell = this.counts.get(this.countsCellFor(m));
      if (cell) {
        cell.unread = Math.max(0, cell.unread + delta);
      }
      if (this.countsTotals) {
        this.countsTotals.unread = Math.max(0, this.countsTotals.unread + delta);
      }
    }
  }

  /**
   * Open the messages view for whatever chat row this was invoked on.
   *
   * A thread row already names its target, so it opens straight away. A scope
   * row or a course node does not — "Courses" is nine courses, and
   * "Submission Groups → Programmierung 1" is every group in that course — so
   * those ask which one.
   *
   * The picker is what makes an *empty* destination reachable. Rows are built
   * from messages that exist, so a course nobody has posted an announcement
   * to yet has no row to click, and there was no way to write the first one.
   * For course scopes the choices come from the user's actual enrolments
   * rather than from the message list, which covers exactly that case.
   */
  async openMessagesFor(
    item: ChatScopeItem | ChatTopAnnouncementsItem | ChatCourseItem | ChatCourseSectionItem
  ): Promise<void> {
    // The root Announcements node opens the global feed; a course node or an
    // announcements section opens the course's own announcements.
    if (item instanceof ChatTopAnnouncementsItem) {
      await this.openScopeTarget('global', null);
      return;
    }
    if (item instanceof ChatCourseItem) {
      await this.openScopeTarget('course', item.courseId);
      return;
    }
    if (item instanceof ChatCourseSectionItem && item.kind === 'announcements') {
      await this.openScopeTarget('course', item.courseId);
      return;
    }

    const scope: MessageScope = item instanceof ChatCourseSectionItem ? 'submission_group' : item.scope;
    const courseId = item instanceof ChatCourseSectionItem ? item.courseId : undefined;

    const choices = await this.targetChoices(scope, courseId);
    if (choices.length === 0) {
      notify.info(`No ${scopeLabel(scope).toLowerCase()} you can open here yet.`);
      return;
    }
    if (choices.length === 1) {
      await this.openScopeTarget(scope, choices[0]!.targetId);
      return;
    }

    const picked = await vscode.window.showQuickPick(
      choices.map(c => ({
        label: c.label,
        description: c.description,
        targetId: c.targetId
      })),
      { title: `Open ${scopeLabel(scope)}`, placeHolder: 'Pick a destination' }
    );
    if (!picked) { return; }
    await this.openScopeTarget(scope, picked.targetId);
  }

  /** Destinations offerable for a scope, optionally narrowed to one course. */
  private async targetChoices(
    scope: MessageScope,
    courseId?: string
  ): Promise<Array<{ targetId: string | null; label: string; description?: string }>> {
    await this.ensureUserScopes();

    // Courses come from enrolment, not from messages — otherwise a course with
    // no announcements yet is unreachable, which is precisely when someone
    // wants to write one.
    if (scope === 'course') {
      const ids = this.userScopes?.course ? Object.keys(this.userScopes.course) : [];
      await Promise.all(ids.map(id => this.labels.ensureCourseLabel(id).catch(() => undefined)));
      return ids.map(id => ({
        targetId: id,
        label: this.labels.courseLabel(id) || id
      }));
    }

    // Everything else is derived from the messages of that scope. Fetch them
    // rather than reading `cachedMessages`: the course-grouped scopes are
    // lazy, so the cache is empty until the user has expanded a course node,
    // and offering "nothing here" because of that would be a lie. The backend
    // walks down from `course_id`, so it narrows server-side when we have one.
    let messages: MessageList[] = [];
    try {
      const page = await this.api.listMessagesPage({
        scope,
        ...(courseId ? { course_id: courseId } : {}),
        skip: 0,
        limit: ChatInboxTreeProvider.SCOPE_PAGE_SIZE
      });
      messages = page.items;
    } catch (err: any) {
      notify.error(`Failed to load ${scopeLabel(scope).toLowerCase()}: ${err?.message || err}`);
      return [];
    }

    const seen = new Map<string, MessageList[]>();
    for (const m of messages) {
      const targetId = this.targetIdFor(scope, m);
      if (!targetId) { continue; }
      if (!seen.has(targetId)) { seen.set(targetId, []); }
      seen.get(targetId)!.push(m);
    }

    await Promise.all(
      [...seen.keys()].map(id => this.labels.ensureLabel(scope, id).catch(() => undefined))
    );

    return [...seen.entries()].map(([targetId, msgs]) => {
      const label = this.labels.label(scope, targetId, msgs, this.currentUserId);
      return { targetId, label: label.title, description: label.subtitle };
    });
  }

  /** Build the panel target for a scope+target and show it. */
  private async openScopeTarget(scope: MessageScope, targetId: string | null): Promise<void> {
    await this.ensureUserScopes();
    const ctx = await buildTargetContext({
      scope,
      targetId,
      labels: this.labels,
      userScopes: this.userScopes,
      userViews: this.userViews,
      currentUserId: this.currentUserId
    });
    if (!ctx) {
      notify.warning('Cannot open this view: target context unavailable.');
      return;
    }
    await this.messagesProvider.showMessages(ctx);
  }

  async openThread(threadItem: ChatThreadItem): Promise<void> {
    const ctx = await this.buildTargetContext(threadItem.thread);
    if (!ctx) {
      notify.warning('Cannot open this conversation: target context unavailable.');
      return;
    }

    // Optimistically clear unread for this row. Mutating the cached
    // MessageList objects in place updates both the per-thread and per-scope
    // counts on the next rebuild. The mark-read API call is fired here too;
    // if MessagesWebview also fires it the call is idempotent.
    //
    // For an announcement row this marks exactly that one notice, because the
    // row *is* one notice — clicking it is the reader explicitly choosing it,
    // which is the engagement signal the panel's scroll-into-view marking is
    // also looking for.
    const unread = threadItem.thread.messages.filter(
      m => !m.is_read && m.author_id !== this.currentUserId
    );
    if (unread.length > 0) {
      this.markReadLocally(unread);
      this.rebuildFromCache();
      // Fire-and-forget but throttled — see markMessagesReadOnBackend.
      void this.markMessagesReadOnBackend(unread.map(m => m.id));
    }

    await this.messagesProvider.showMessages(ctx);
  }

  /**
   * Re-groups + re-builds the tree from the cached message list without
   * re-fetching from the backend. Used when local read state changes
   * optimistically (e.g. opening a thread).
   */
  private rebuildFromCache(): void {
    const grouped = this.groupMessages(this.cachedMessages);
    this.rootItems = this.buildRootItems(grouped);
    this.onDidChangeTreeDataEmitter.fire(undefined);
    this._onDidChangeUnread.fire(this.getTotalUnread());
  }

  private async ensureUserScopes(): Promise<void> {
    if (this.userScopes !== undefined || this.userScopesPromise) {
      if (this.userScopesPromise) {
        await this.userScopesPromise;
      }
      return;
    }
    this.userScopesPromise = this.api.getUserScopes()
      .then(value => {
        this.userScopes = value;
      })
      .catch(() => {
        this.userScopes = undefined;
      })
      .finally(() => {
        this.userScopesPromise = undefined;
      });
    await this.userScopesPromise;
  }

  async markThreadRead(threadItem: ChatThreadItem): Promise<void> {
    const unread = threadItem.thread.messages.filter(m => !m.is_read && m.author_id !== this.currentUserId);
    if (unread.length === 0) { return; }
    this.markReadLocally(unread);
    this.rebuildFromCache();
    await this.markMessagesReadOnBackend(unread.map(m => m.id));
  }

  /** Mark every *fetched* unread message under a container row as read —
   *  works for the top Announcements node, a course, a section, and the
   *  flat DM scope rows. */
  async markContainerRead(
    item: ChatTopAnnouncementsItem | ChatCourseItem | ChatCourseSectionItem | ChatScopeItem
  ): Promise<void> {
    const isUnread = (m: MessageList) => !m.is_read && m.author_id !== this.currentUserId;
    let candidates: MessageList[] = [];
    if (item instanceof ChatTopAnnouncementsItem || item instanceof ChatScopeItem) {
      candidates = item.threads.flatMap(t => t.messages);
    } else {
      const scopes = item instanceof ChatCourseSectionItem
        ? (item.kind === 'assignments' ? ['submission_group'] as MessageScope[] : COURSE_ANNOUNCEMENT_SCOPES)
        : [...COURSE_ANNOUNCEMENT_SCOPES, 'submission_group' as MessageScope];
      for (const scope of scopes) {
        const state = this.courseScopeStates.get(scope)?.get(item.courseId);
        if (state) { candidates.push(...state.messages); }
      }
    }
    const unread = candidates.filter(isUnread);
    if (unread.length === 0) { return; }
    this.markReadLocally(unread);
    this.rebuildFromCache();
    await this.markMessagesReadOnBackend(unread.map(m => m.id));
  }

  /** Sets is_read=true on every cached copy of the given messages, across
   *  cachedMessages and every per-scope / per-course state's messages array,
   *  and shifts the local unread counters to match. */
  private markReadLocally(msgs: MessageList[]): void {
    if (msgs.length === 0) { return; }
    const affected = msgs.filter(m => !m.is_read);
    const set = new Set(msgs.map(m => m.id));
    for (const m of this.cachedMessages) {
      if (set.has(m.id)) { m.is_read = true; }
    }
    for (const state of this.scopeFetchStates.values()) {
      for (const m of state.messages) {
        if (set.has(m.id)) { m.is_read = true; }
      }
    }
    for (const inner of this.courseScopeStates.values()) {
      for (const state of inner.values()) {
        for (const m of state.messages) {
          if (set.has(m.id)) { m.is_read = true; }
        }
      }
    }
    this.adjustCountsUnread(affected, -1);
  }

  /** Inverse of markReadLocally — used by mark-as-unread. */
  markUnreadLocally(msgs: MessageList[]): void {
    if (msgs.length === 0) { return; }
    const affected = msgs.filter(m => m.is_read);
    const set = new Set(msgs.map(m => m.id));
    for (const m of this.cachedMessages) {
      if (set.has(m.id)) { m.is_read = false; }
    }
    for (const state of this.scopeFetchStates.values()) {
      for (const m of state.messages) {
        if (set.has(m.id)) { m.is_read = false; }
      }
    }
    for (const inner of this.courseScopeStates.values()) {
      for (const state of inner.values()) {
        for (const m of state.messages) {
          if (set.has(m.id)) { m.is_read = false; }
        }
      }
    }
    this.adjustCountsUnread(affected, +1);
  }

  /** Fetches one page for a non-course-grouped scope. Course-grouped scopes
   *  use per-course requests instead — see getCourseGroupChildren and
   *  loadMoreForCourseScope. */
  private async fetchScopePage(scope: MessageScope, skip: number, limit: number): Promise<{ items: MessageList[]; total: number }> {
    return await this.api.listMessagesPage({ scope, skip, limit });
  }

  /** Rebuilds cachedMessages as the flat union of every scope's accumulated
   *  messages (per-scope + per-course) and refreshes the tree. */
  private async rebuildAssembled(): Promise<void> {
    const flat: MessageList[] = [];
    for (const state of this.scopeFetchStates.values()) {
      flat.push(...state.messages);
    }
    for (const inner of this.courseScopeStates.values()) {
      for (const state of inner.values()) {
        flat.push(...state.messages);
      }
    }
    this.cachedMessages = flat;
    const grouped = this.groupMessages(this.cachedMessages);
    await this.labels.prefetch(grouped);
    this.rootItems = this.buildRootItems(grouped);
  }

  /** Fetches the next page for one scope and appends to its state. */
  async loadMoreForScope(scope: MessageScope): Promise<void> {
    if (this.scopeLoadingMore.has(scope)) { return; }
    const state = this.scopeFetchStates.get(scope);
    if (!state || state.fetched >= state.total) { return; }
    this.scopeLoadingMore.add(scope);
    try {
      const next = await this.fetchScopePage(scope, state.fetched, ChatInboxTreeProvider.SCOPE_PAGE_SIZE);
      const seen = new Set(state.messages.map(m => m.id));
      for (const m of next.items) {
        if (!seen.has(m.id)) {
          state.messages.push(m);
          seen.add(m.id);
        }
      }
      // Advance by request size (not survivors) so we don't loop forever if
      // the backend grew between pages and the same offset reappears.
      state.fetched += next.items.length;
      state.total = Math.max(state.total, next.total);
      await this.rebuildAssembled();
    } catch (err: any) {
      notify.error(`Failed to load more messages: ${err?.message || err}`);
    } finally {
      this.scopeLoadingMore.delete(scope);
      this.onDidChangeTreeDataEmitter.fire(undefined);
      this._onDidChangeUnread.fire(this.getTotalUnread());
    }
  }

  /** Fetches the next page for a (scope, course) bucket and appends to its
   *  per-course state. Used by the per-course Load more rendered inside each
   *  ChatCourseGroupItem. */
  async loadMoreForCourseScope(scope: MessageScope, courseId: string): Promise<void> {
    const key = `${scope}::${courseId}`;
    if (this.courseScopeLoadingMore.has(key)) { return; }
    const inner = this.courseScopeStates.get(scope);
    const state = inner?.get(courseId);
    if (!state || state.total < 0 || state.fetched >= state.total) { return; }
    this.courseScopeLoadingMore.add(key);
    try {
      const next = await this.api.listMessagesPage({
        scope,
        course_id: courseId,
        skip: state.fetched,
        limit: ChatInboxTreeProvider.SCOPE_PAGE_SIZE
      });
      const seen = new Set(state.messages.map(m => m.id));
      for (const m of next.items) {
        if (!seen.has(m.id)) {
          state.messages.push(m);
          seen.add(m.id);
        }
      }
      state.fetched += next.items.length;
      state.total = Math.max(state.total, next.total);
      await this.rebuildAssembled();
    } catch (err: any) {
      notify.error(`Failed to load more messages: ${err?.message || err}`);
    } finally {
      this.courseScopeLoadingMore.delete(key);
      this.onDidChangeTreeDataEmitter.fire(undefined);
      this._onDidChangeUnread.fire(this.getTotalUnread());
    }
  }

  /**
   * Posts mark-read for many message ids in a single request.
   *
   * This used to fan out one POST per id behind a 4-worker limiter, because
   * every one of them triggered a server-side read:update broadcast that
   * looped straight back here and re-paginated the whole inbox. The bulk
   * endpoint collapses that to one request and one broadcast per channel,
   * so the limiter is gone.
   *
   * The WS suppression window stays: even one broadcast comes back to us,
   * and we have already applied the state optimistically.
   *
   * Errors are swallowed — best-effort, and the next refresh re-confirms.
   */
  private async markMessagesReadOnBackend(ids: string[]): Promise<void> {
    if (ids.length === 0) { return; }
    this.suppressWsReloadUntil = Date.now() + ChatInboxTreeProvider.MARK_READ_WS_SUPPRESS_MS;
    if (this.wsReloadTimer) {
      clearTimeout(this.wsReloadTimer);
      this.wsReloadTimer = undefined;
    }
    try {
      await this.api.markMessagesRead(ids);
    } catch {
      // best-effort
    } finally {
      // Extend the window slightly past now so the broadcast that lags
      // behind our request doesn't immediately trigger a re-pagination.
      this.suppressWsReloadUntil = Date.now() + ChatInboxTreeProvider.MARK_READ_WS_SUPPRESS_MS;
    }
  }

  // ----- TreeDataProvider -----

  getTreeItem(element: AnyTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AnyTreeItem): Promise<AnyTreeItem[]> {
    if (!element) {
      if (this.loading) { return [new ChatLoadingItem()]; }
      if (this.loadError) { return [new ChatErrorItem(this.loadError)]; }
      if (this.rootItems.length === 0) {
        return [new ChatEmptyItem(this.unreadOnly ? 'No unread messages.' : 'No messages.')];
      }
      return [...this.rootItems];
    }

    if (element instanceof ChatTopAnnouncementsItem) {
      const items: AnyTreeItem[] = element.threads.map(t => new ChatThreadItem(t));
      for (const scope of TOP_SCOPES) {
        const state = this.scopeFetchStates.get(scope);
        if (state && state.fetched < state.total) {
          items.push(new ChatLoadMoreItem(scope, state.fetched, state.total));
        }
      }
      if (items.length === 0) {
        items.push(new ChatEmptyItem('No announcements.'));
      }
      return items;
    }

    if (element instanceof ChatCourseItem) {
      return this.buildCourseSections(element);
    }

    if (element instanceof ChatCourseSectionItem) {
      return await this.getSectionChildren(element);
    }

    if (element instanceof ChatScopeItem) {
      const items: AnyTreeItem[] = element.threads.map(t => new ChatThreadItem(t));
      const state = this.scopeFetchStates.get(element.scope);
      if (state && state.fetched < state.total) {
        items.push(new ChatLoadMoreItem(element.scope, state.fetched, state.total));
      }
      return items;
    }

    return [];
  }

  /** Fetched-page unread count for a set of scopes within one course. */
  private fetchedCourseUnread(scopes: MessageScope[], courseId: string): number {
    let unread = 0;
    for (const scope of scopes) {
      const state = this.courseScopeStates.get(scope)?.get(courseId);
      if (!state) { continue; }
      for (const m of state.messages) {
        if (!m.is_read && m.author_id !== this.currentUserId) { unread += 1; }
      }
    }
    return unread;
  }

  /** Fallback counts from fetched pages — defined only once every
   *  constituent (scope, course) bucket has been fetched. */
  private fetchedCourseCounts(scopes: MessageScope[], courseId: string): ChatCounts | undefined {
    let total = 0;
    for (const scope of scopes) {
      const state = this.courseScopeStates.get(scope)?.get(courseId);
      if (!state || state.total < 0) { return undefined; }
      total += state.total;
    }
    return { total, unread: this.fetchedCourseUnread(scopes, courseId) };
  }

  private sectionCounts(kind: ChatSectionKind, courseId: string): ChatCounts | undefined {
    const scopes = kind === 'assignments' ? (['submission_group'] as MessageScope[]) : COURSE_ANNOUNCEMENT_SCOPES;
    return this.countsFor(scopes, courseId) ?? this.fetchedCourseCounts(scopes, courseId);
  }

  private courseCounts(courseId: string): ChatCounts | undefined {
    const scopes = [...COURSE_ANNOUNCEMENT_SCOPES, 'submission_group' as MessageScope];
    return this.countsFor(scopes, courseId) ?? this.fetchedCourseCounts(scopes, courseId);
  }

  /** Announcements + one node per course (+ DM sections when non-empty). */
  private buildRootItems(grouped: Map<MessageScope, Map<string, MessageList[]>>): AnyTreeItem[] {
    const items: AnyTreeItem[] = [];
    let fetchedUnreadSum = 0;

    // Root Announcements: global + organization + course_family, each notice
    // one row, labelled by origin.
    const topThreads: ChatThread[] = [];
    for (const scope of TOP_SCOPES) {
      const byTarget = grouped.get(scope);
      if (!byTarget) { continue; }
      const rows = this.buildThreadRows(scope, byTarget);
      for (const t of rows) {
        t.subtitle = scope === 'global'
          ? 'System'
          : this.labels.label(scope, t.targetId, t.messages, this.currentUserId).title;
      }
      topThreads.push(...rows);
    }
    sortThreads(topThreads);
    const fetchedTopUnread = topThreads.reduce((acc, t) => acc + t.unreadCount, 0);
    let topCounts = this.countsFor(TOP_SCOPES, null);
    if (!topCounts) {
      let total = 0;
      for (const scope of TOP_SCOPES) {
        total += this.scopeFetchStates.get(scope)?.total ?? 0;
      }
      topCounts = { total, unread: fetchedTopUnread };
    }
    const topUnread = topCounts.unread;
    fetchedUnreadSum += topUnread;
    if (!(this.unreadOnly && topUnread === 0)) {
      const expanded = this.expandedSections.has('top') || topUnread > 0;
      items.push(new ChatTopAnnouncementsItem(
        topThreads, topUnread, topCounts, expanded, this.muteTopAnnouncements
      ));
    }

    // One node per enrolled course, unread first then alphabetical.
    const decorated = this.knownCourseIds().map(id => {
      const counts = this.courseCounts(id);
      const unread = counts?.unread
        ?? this.fetchedCourseUnread([...COURSE_ANNOUNCEMENT_SCOPES, 'submission_group'], id);
      return {
        id,
        label: this.labels.courseLabel(id) || shortId(id),
        counts,
        unread
      };
    });
    decorated.sort((a, b) => {
      if ((b.unread > 0 ? 1 : 0) !== (a.unread > 0 ? 1 : 0)) {
        return (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0);
      }
      return a.label.localeCompare(b.label);
    });
    for (const d of decorated) {
      fetchedUnreadSum += d.unread;
      if (this.unreadOnly && d.unread === 0) { continue; }
      const expanded = this.expandedCourses.has(d.id) || d.unread > 0;
      items.push(new ChatCourseItem(
        d.id, d.label, d.unread, d.counts, expanded, this.mutedCourses.has(d.id)
      ));
    }

    // Flat DM sections, only when they hold messages.
    for (const scope of DM_SCOPES) {
      const byTarget = grouped.get(scope);
      if (!byTarget || byTarget.size === 0) { continue; }
      const threads = this.buildThreadRows(scope, byTarget);
      if (threads.length === 0) { continue; }
      const counts = this.countsForScopeAllCourses(scope)
        ?? { total: this.scopeFetchStates.get(scope)?.total ?? 0,
             unread: threads.reduce((acc, t) => acc + t.unreadCount, 0) };
      fetchedUnreadSum += counts.unread;
      if (this.unreadOnly && counts.unread === 0) { continue; }
      const expanded = this.expandedSections.has(`scope::${scope}`) || counts.unread > 0;
      const item = new ChatScopeItem(scope, threads, counts.unread, expanded, {});
      item.description = formatCountsDescription(counts);
      items.push(item);
    }

    this.totalUnread = this.countsTotals ? this.countsTotals.unread : fetchedUnreadSum;
    return items;
  }

  /** The two fixed sections under a course node. */
  private buildCourseSections(course: ChatCourseItem): ChatCourseSectionItem[] {
    const sections: ChatCourseSectionItem[] = [];
    for (const kind of ['announcements', 'assignments'] as ChatSectionKind[]) {
      const scopes = kind === 'assignments' ? (['submission_group'] as MessageScope[]) : COURSE_ANNOUNCEMENT_SCOPES;
      const counts = this.sectionCounts(kind, course.courseId);
      const unread = counts?.unread ?? this.fetchedCourseUnread(scopes, course.courseId);
      if (this.unreadOnly && unread === 0) { continue; }
      const expanded = this.expandedSections.has(`${kind}::${course.courseId}`) || unread > 0;
      sections.push(new ChatCourseSectionItem(
        kind, course.courseId, course.courseLabel, unread, counts, expanded
      ));
    }
    return sections;
  }

  /** Lazy-fetch a section's scopes on first expand, then return its thread
   *  rows plus per-scope Load more entries. */
  private async getSectionChildren(element: ChatCourseSectionItem): Promise<AnyTreeItem[]> {
    const { kind, courseId } = element;
    const scopes = kind === 'assignments' ? (['submission_group'] as MessageScope[]) : COURSE_ANNOUNCEMENT_SCOPES;
    this.expandedSections.add(`${kind}::${courseId}`);

    // First-time fetch for any scope not asked for yet (total === -1).
    const toFetch = scopes.filter(scope => {
      const state = this.courseScopeStates.get(scope)?.get(courseId);
      return state !== undefined && state.total < 0;
    });
    if (toFetch.length > 0) {
      try {
        await Promise.all(toFetch.map(async scope => {
          const state = this.courseScopeStates.get(scope)!.get(courseId)!;
          const page = await this.api.listMessagesPage({
            scope,
            course_id: courseId,
            skip: 0,
            limit: ChatInboxTreeProvider.SCOPE_PAGE_SIZE
          });
          state.messages = page.items;
          state.fetched = page.items.length;
          state.total = page.total;
        }));
        await this.rebuildAssembled();
        // Repaint the whole tree once this render pass is over, so the
        // course/section descriptions above this node pick up the freshly
        // known numbers (the old tree left "click to load" standing).
        queueMicrotask(() => {
          this.onDidChangeTreeDataEmitter.fire(undefined);
          this._onDidChangeUnread.fire(this.getTotalUnread());
        });
      } catch (err: any) {
        return [new ChatErrorItem(`Failed to load messages: ${err?.message || err}`)];
      }
    }

    const items: AnyTreeItem[] = [];
    const rows: ChatThread[] = [];
    for (const scope of scopes) {
      const state = this.courseScopeStates.get(scope)?.get(courseId);
      if (!state) { continue; }
      const byTarget = new Map<string, MessageList[]>();
      for (const m of state.messages) {
        const targetId = this.targetIdFor(scope, m) ?? '__none__';
        if (!byTarget.has(targetId)) { byTarget.set(targetId, []); }
        byTarget.get(targetId)!.push(m);
      }
      const threads = this.buildThreadRows(scope, byTarget);
      for (const t of threads) {
        // Under a course node the course name is chrome; say what kind of
        // announcement it is (or which group/assignment it addresses).
        if (kind === 'announcements') {
          t.subtitle = scope === 'course'
            ? 'Course'
            : this.labels.label(scope, t.targetId, t.messages, this.currentUserId).title;
        } else {
          t.subtitle = undefined;
        }
      }
      rows.push(...threads);
    }
    sortThreads(rows);
    items.push(...rows.map(t => new ChatThreadItem(t)));
    for (const scope of scopes) {
      const state = this.courseScopeStates.get(scope)?.get(courseId);
      if (state && state.total >= 0 && state.fetched < state.total) {
        items.push(new ChatLoadMoreItem(scope, state.fetched, state.total, courseId));
      }
    }
    if (items.length === 0) {
      items.push(new ChatEmptyItem('No messages.'));
    }
    return items;
  }

  // ----- Internals -----

  private async reload(): Promise<void> {
    // Only show the loading spinner on initial load. On subsequent reloads,
    // keep the current items visible so the tree doesn't flicker to
    // "Loading…" between the user's click and the new data arriving.
    const showSpinner = this.rootItems.length === 0 && !this.loadError;
    this.loading = true;
    this.loadError = undefined;
    if (showSpinner) {
      this.onDidChangeTreeDataEmitter.fire(undefined);
    }

    try {
      // Identity + scopes + counts once; per-scope inbox pages in parallel.
      // Each scope has its own pagination, so a Load more click only
      // advances that scope's window.
      const [identity, scopes, views, countsResponse] = await Promise.all([
        this.api.getCurrentUser().catch(() => undefined),
        this.api.getUserScopes().catch(() => undefined),
        this.api.getUserViews().catch(() => [] as string[]),
        this.api.getMessageCounts()
      ]);
      this.currentUserId = identity?.id;
      this.userScopes = scopes;
      this.userViews = views ?? [];
      this.applyCounts(countsResponse);
      this.maybeSubscribeUserChannels();

      // For non-course-grouped scopes, fetch the first page in parallel.
      // Course-grouped scopes (submission_group / course / course_content /
      // course_group) skip the per-scope fan-out — a chat with even a few
      // courses produces hundreds of submission_group threads, so we lazy-load
      // per-course on tree expand instead.
      const flatScopes = SCOPE_ORDER.filter(s => !isCourseGroupedScope(s));
      const newStates = new Map<MessageScope, ScopeFetchState>();
      const pageResults = await Promise.all(
        flatScopes.map(async scope => {
          try {
            const page = await this.fetchScopePage(scope, 0, ChatInboxTreeProvider.SCOPE_PAGE_SIZE);
            return { scope, page };
          } catch (err) {
            console.warn(`[ChatInbox] Failed to fetch initial page for scope ${scope}:`, err);
            return { scope, page: { items: [] as MessageList[], total: 0 } };
          }
        })
      );
      for (const { scope, page } of pageResults) {
        newStates.set(scope, {
          messages: page.items,
          fetched: page.items.length,
          total: page.total
        });
      }
      this.scopeFetchStates = newStates;

      // Seed the per-(scope, course) maps from the user's accessible courses.
      // Each entry stays empty (`fetched: 0, total: -1`) until the user expands
      // the course node, at which point getChildren triggers the first fetch.
      const courseIds = scopes?.course ? Object.keys(scopes.course) : [];
      const newCourseStates = new Map<MessageScope, Map<string, ScopeFetchState>>();
      for (const scope of SCOPE_ORDER) {
        if (!isCourseGroupedScope(scope)) { continue; }
        const inner = new Map<string, ScopeFetchState>();
        // Preserve any state we already had so an in-flight Load more isn't
        // erased by a parallel reload.
        const previous = this.courseScopeStates.get(scope);
        for (const courseId of courseIds) {
          const prev = previous?.get(courseId);
          inner.set(courseId, prev ?? { messages: [], fetched: 0, total: -1 });
        }
        newCourseStates.set(scope, inner);
      }
      this.courseScopeStates = newCourseStates;

      // A v1 "everything muted" state maps onto the course list only once we
      // know it — finish that migration here.
      if (this.pendingMuteAllCourses) {
        this.pendingMuteAllCourses = false;
        this.mutedCourses = new Set(courseIds);
        void this.persistState();
        void this.applyNotificationContextKeys();
      }

      // Resolve labels for every accessible course up front, so the course
      // rows can show real titles instead of short ids.
      await Promise.all(courseIds.map(id => this.labels.ensureCourseLabel(id).catch(() => undefined)));

      await this.rebuildAssembled();
    } catch (error: any) {
      this.loadError = `Failed to load messages: ${error?.message || error}`;
      this.rootItems = [];
      this.cachedMessages = [];
      this.scopeFetchStates.clear();
      this.courseScopeStates.clear();
    } finally {
      this.loading = false;
      this.onDidChangeTreeDataEmitter.fire(undefined);
      this._onDidChangeUnread.fire(this.getTotalUnread());
    }
  }

  private groupMessages(messages: MessageList[]): Map<MessageScope, Map<string, MessageList[]>> {
    const grouped = new Map<MessageScope, Map<string, MessageList[]>>();
    for (const m of messages) {
      const scope = (m.scope || 'global') as MessageScope;
      const targetId = this.targetIdFor(scope, m) ?? '__none__';
      if (!grouped.has(scope)) { grouped.set(scope, new Map()); }
      const byTarget = grouped.get(scope)!;
      if (!byTarget.has(targetId)) { byTarget.set(targetId, []); }
      byTarget.get(targetId)!.push(m);
    }
    return grouped;
  }

  private targetIdFor(scope: MessageScope, m: MessageList): string | null {
    switch (scope) {
      case 'user': return m.user_id ?? null;
      case 'course_member': return m.course_member_id ?? null;
      case 'submission_group': return m.submission_group_id ?? null;
      case 'course_group': return m.course_group_id ?? null;
      case 'course_content': return m.course_content_id ?? null;
      case 'course': return m.course_id ?? null;
      case 'course_family': return m.course_family_id ?? null;
      case 'organization': return m.organization_id ?? null;
      case 'global': return null;
    }
  }

  /**
   * Turn a scope's messages, already grouped by target id, into tree rows.
   *
   * Conversations get one row per target: a submission group *is* one thread,
   * and its row shows the latest line with an unread count.
   *
   * Announcements get one row per announcement. They all share a target —
   * every notice in a course carries the same `course_id` — so grouping them
   * by target collapsed a whole semester into a single row labelled with the
   * course name and "40 unread". Each notice is its own item, labelled by its
   * subject, which is what a subject is for.
   *
   * Both are sorted unread-first, then most recent first.
   */
  private buildThreadRows(
    scope: MessageScope,
    byTarget: Map<string, MessageList[]>
  ): ChatThread[] {
    const isUnread = (m: MessageList) => !m.is_read && m.author_id !== this.currentUserId;
    const threads: ChatThread[] = [];

    for (const [rawTargetId, msgs] of byTarget) {
      const targetId = rawTargetId === '__none__' ? null : rawTargetId;

      if (kindForScope(scope) === 'announcement') {
        // Replies can't exist on an announcement scope (the backend refuses
        // them), but a legacy row could still carry a parent — fold those
        // under their root rather than listing them as notices of their own.
        const roots = msgs.filter(m => !m.parent_id);
        const repliesByRoot = new Map<string, MessageList[]>();
        for (const m of msgs) {
          if (!m.parent_id) { continue; }
          if (!repliesByRoot.has(m.parent_id)) { repliesByRoot.set(m.parent_id, []); }
          repliesByRoot.get(m.parent_id)!.push(m);
        }

        for (const root of roots) {
          const replies = repliesByRoot.get(root.id) ?? [];
          const messages = [root, ...replies].sort((a, b) => compareCreated(a, b));
          const unreadCount = messages.filter(isUnread).length;
          if (this.unreadOnly && unreadCount === 0) { continue; }
          const { subtitle } = this.labels.label(scope, targetId, msgs, this.currentUserId);
          threads.push({
            scope,
            targetId,
            // The subject identifies the announcement. Rows predating the
            // subject requirement fall back to the scope's own label.
            title: root.title?.trim()
              || this.labels.label(scope, targetId, [root], this.currentUserId).title,
            subtitle,
            lastMessage: root,
            unreadCount,
            messageCount: messages.length,
            messages,
            anchorMessageId: root.id
          });
        }
        continue;
      }

      const sortedMessages = msgs.slice().sort((a, b) => compareCreated(a, b));
      const lastMessage = sortedMessages[sortedMessages.length - 1];
      // Belt and braces on own messages: the backend stamps the author as a
      // reader at create time (mark_author_as_reader), so is_read is already
      // true for them — this also covers rows predating that.
      const unreadCount = msgs.filter(isUnread).length;
      if (this.unreadOnly && unreadCount === 0) { continue; }

      const { title, subtitle } = this.labels.label(scope, targetId, msgs, this.currentUserId);
      threads.push({
        scope,
        targetId,
        title,
        subtitle,
        lastMessage,
        unreadCount,
        messageCount: msgs.length,
        messages: sortedMessages
      });
    }

    sortThreads(threads);
    return threads;
  }

  private async buildTargetContext(thread: ChatThread): Promise<MessageTargetContext | undefined> {
    await this.ensureUserScopes();
    return buildTargetContext({
      scope: thread.scope,
      targetId: thread.targetId,
      messages: thread.messages,
      labels: this.labels,
      userScopes: this.userScopes,
      userViews: this.userViews,
      currentUserId: this.currentUserId
    });
  }

  // ----- WebSocket -----

  private maybeSubscribeUserChannels(): void {
    if (!this.wsService || !this.currentUserId) {
      return;
    }
    if (this.wsSubscribedForUserId === this.currentUserId) {
      return;
    }
    const userChannel = `user:${this.currentUserId}`;
    // Backend auto-subscribes both `user:<own_id>` and `global` on WS connect,
    // but we still register a local handler so events get dispatched here.
    this.wsService.subscribe([userChannel, GLOBAL_CHANNEL], this.wsHandlerId, {
      onMessageNew: (channel, data) => this.handleInboxNewMessage(channel, data),
      onMessageUpdate: (channel) => this.handleInboxEvent(channel),
      onMessageDelete: (channel) => this.handleInboxEvent(channel),
      onReadUpdate: (channel) => this.handleInboxEvent(channel)
    });
    this.wsSubscribedForUserId = this.currentUserId;
  }

  private isInboxChannel(channel: string): boolean {
    if (!this.currentUserId) { return false; }
    return channel === `user:${this.currentUserId}` || channel === GLOBAL_CHANNEL;
  }

  private handleInboxEvent(channel: string): void {
    if (!this.isInboxChannel(channel)) { return; }
    this.scheduleWsReload();
  }

  private handleInboxNewMessage(channel: string, data: Record<string, unknown>): void {
    if (!this.isInboxChannel(channel)) { return; }
    this.scheduleWsReload();
    // WS payload nests the MessageGet under `data` for message:new (see
    // MessagesWebviewProvider.handleWsMessageNew for the same unwrap).
    const inner = (data && typeof data === 'object' && 'data' in data ? (data as any).data : data) as Record<string, unknown> | undefined;
    if (!inner) { return; }
    if (inner.author_id && inner.author_id === this.currentUserId) {
      // Don't notify the user about their own posts.
      return;
    }
    if (this.messagesProvider.isShowingMessage(inner)) {
      // Panel is open on this exact thread — the panel itself will render the
      // new message, so the toast would be redundant.
      return;
    }
    const scope = (typeof inner.scope === 'string' ? inner.scope : 'global') as MessageScope;
    if (this.isMessageMuted(scope, inner)) {
      return;
    }
    void this.showNewMessageToast(inner);
  }

  /** Whether the mute settings suppress a toast for this broadcast. */
  private isMessageMuted(scope: MessageScope, message: Record<string, unknown>): boolean {
    if (TOP_SCOPES.includes(scope)) {
      return this.muteTopAnnouncements;
    }
    const ctx = (message.context ?? undefined) as { course_id?: string | null } | undefined;
    const courseId = (typeof ctx?.course_id === 'string' && ctx.course_id)
      || (typeof message.course_id === 'string' && message.course_id)
      || undefined;
    return Boolean(courseId && this.mutedCourses.has(courseId));
  }

  private scheduleWsReload(): void {
    // Bursts of WS events (e.g., N read:update events when opening a thread
    // with N unread messages) would otherwise produce N back-to-back reloads
    // and visible flicker as state converges. Debounce so the burst becomes
    // a single reload once events stop arriving. Additionally, drop reloads
    // entirely while we're applying our own mark-read mutations: every read
    // we post triggers a server-side broadcast that would loop us back into
    // re-paginating the whole inbox.
    if (Date.now() < this.suppressWsReloadUntil) {
      return;
    }
    if (this.wsReloadTimer) {
      clearTimeout(this.wsReloadTimer);
    }
    this.wsReloadTimer = setTimeout(() => {
      this.wsReloadTimer = undefined;
      if (Date.now() < this.suppressWsReloadUntil) { return; }
      void this.requestReload();
    }, ChatInboxTreeProvider.WS_RELOAD_DEBOUNCE_MS);
  }

  private async showNewMessageToast(message: Record<string, unknown>): Promise<void> {
    const scope = (typeof message.scope === 'string' ? message.scope : 'global') as MessageScope;
    const author = formatToastAuthor(message);
    const preview = formatToastPreview(message);
    // "Programming in MATLAB · Assignment conversation" beats a bare scope
    // name when the broadcast carries the resolved course.
    const ctx = (message.context ?? undefined) as { course_title?: string | null } | undefined;
    const scopeText = ctx?.course_title
      ? `${ctx.course_title} · ${scopeLabel(scope)}`
      : scopeLabel(scope);
    const text = author
      ? `${author} (${scopeText}): ${preview}`
      : `${scopeText}: ${preview}`;

    const choice = await notify.info(text, 'Open');
    if (choice !== 'Open') { return; }
    await this.openMessageInPanel(message, scope);
  }

  private async openMessageInPanel(message: Record<string, unknown>, scope: MessageScope): Promise<void> {
    const messageAsList = message as unknown as MessageList;
    const targetId = this.targetIdFor(scope, messageAsList);
    // Reveal the chat container alongside the panel for context.
    void vscode.commands.executeCommand('computor.chat.inbox.focus');
    const synthetic: ChatThread = {
      scope,
      targetId,
      title: '',
      lastMessage: messageAsList,
      unreadCount: 0,
      messageCount: 1,
      messages: [messageAsList]
    };
    const target = await this.buildTargetContext(synthetic);
    if (!target) { return; }
    await this.messagesProvider.showMessages(target);
  }

  // ----- Persistence -----

  private loadPersistedState(): void {
    try {
      const stored = this.context.globalState.get<PersistedStateV1 | PersistedStateV2>(STATE_KEY);
      if (stored && 'version' in stored && stored.version === 2) {
        if (typeof stored.unreadOnly === 'boolean') { this.unreadOnly = stored.unreadOnly; }
        if (Array.isArray(stored.expandedCourses)) { this.expandedCourses = new Set(stored.expandedCourses); }
        if (Array.isArray(stored.expandedSections)) { this.expandedSections = new Set(stored.expandedSections); }
        if (Array.isArray(stored.mutedCourses)) { this.mutedCourses = new Set(stored.mutedCourses); }
        if (typeof stored.muteTopAnnouncements === 'boolean') { this.muteTopAnnouncements = stored.muteTopAnnouncements; }
      } else if (stored) {
        // One-way v1 → v2 migration. The tree shape changed, so old
        // expansion state is dropped. Mutes carry over where they map:
        // everything muted stays everything muted (course ids are applied on
        // first reload, when the enrolment list is known); the three
        // announcement scopes map onto the top mute; per-scope course mutes
        // have no course-level equivalent and are dropped.
        const v1 = stored as PersistedStateV1;
        if (typeof v1.unreadOnly === 'boolean') { this.unreadOnly = v1.unreadOnly; }
        const muted = new Set(v1.mutedScopes ?? []);
        if (SCOPE_ORDER.every(scope => muted.has(scope))) {
          this.muteTopAnnouncements = true;
          this.pendingMuteAllCourses = true;
        } else if (TOP_SCOPES.every(scope => muted.has(scope))) {
          this.muteTopAnnouncements = true;
        }
        void this.persistState();
      }
    } catch (err) {
      console.warn('[ChatInbox] Failed to load persisted state:', err);
    }
    void vscode.commands.executeCommand('setContext', 'computor.chat.unreadOnly', this.unreadOnly);
    void this.applyNotificationContextKeys();
  }

  private async persistState(): Promise<void> {
    const state: PersistedStateV2 = {
      version: 2,
      unreadOnly: this.unreadOnly,
      expandedCourses: Array.from(this.expandedCourses),
      expandedSections: Array.from(this.expandedSections),
      mutedCourses: Array.from(this.mutedCourses),
      muteTopAnnouncements: this.muteTopAnnouncements
    };
    try {
      await this.context.globalState.update(STATE_KEY, state);
    } catch (err) {
      console.warn('[ChatInbox] Failed to persist state:', err);
    }
  }

  /** Mirrors the mute state into VS Code context keys so menu `when` clauses
   *  can pick the right icon variant.
   *    - `computor.chat.anyScopeUnmuted` — true if anything (top
   *      announcements or any course) still has notifications on. The
   *      title-bar action shows the bell (mute-all) variant when true and
   *      the bell-slash (unmute-all) variant when false.
   *    - `computor.chat.mutedScopes` — space-separated muted course ids.
   *      Row-level icons swap on the contextValue suffix (`.muted`)
   *      instead; kept for future use. */
  private async applyNotificationContextKeys(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'computor.chat.anyScopeUnmuted', this.isAnyScopeUnmuted());
    await vscode.commands.executeCommand('setContext', 'computor.chat.mutedScopes', Array.from(this.mutedCourses).join(' '));
  }
}


function compareCreated(a: MessageList, b: MessageList): number {
  const ta = a.created_at ? Date.parse(a.created_at) : 0;
  const tb = b.created_at ? Date.parse(b.created_at) : 0;
  return ta - tb;
}

function compareThreadRecency(a: ChatThread, b: ChatThread): number {
  const ta = a.lastMessage?.created_at ? Date.parse(a.lastMessage.created_at) : 0;
  const tb = b.lastMessage?.created_at ? Date.parse(b.lastMessage.created_at) : 0;
  return ta - tb;
}

/** Unread first, then most recent first — the one order every level uses. */
function sortThreads(threads: ChatThread[]): void {
  threads.sort((a, b) => {
    if ((b.unreadCount > 0 ? 1 : 0) !== (a.unreadCount > 0 ? 1 : 0)) {
      return (b.unreadCount > 0 ? 1 : 0) - (a.unreadCount > 0 ? 1 : 0);
    }
    return compareThreadRecency(b, a);
  });
}

function formatToastAuthor(message: Record<string, unknown>): string {
  const author = (message.author ?? {}) as Record<string, unknown>;
  const given = typeof author.given_name === 'string' ? author.given_name : '';
  const family = typeof author.family_name === 'string' ? author.family_name : '';
  const full = `${given} ${family}`.trim();
  if (full) { return full; }
  if (typeof author.username === 'string' && author.username) { return author.username; }
  if (typeof author.email === 'string' && author.email) { return author.email; }
  return '';
}

function formatToastPreview(message: Record<string, unknown>): string {
  const content = typeof message.content === 'string' ? message.content : '';
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) { return '(no content)'; }
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned;
}
