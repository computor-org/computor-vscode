import * as vscode from 'vscode';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { canPostGlobal, canPostToCourseFamily, canPostToOrganization } from '../../../services/MessagePermissions';
import { WebSocketService } from '../../../services/WebSocketService';
import { MessagesWebviewProvider, MessageTargetContext } from '../../webviews/MessagesWebviewProvider';
import type { MessageList } from '../../../types/generated';

const GLOBAL_CHANNEL = 'global';
import {
  ChatScopeItem,
  ChatThreadItem,
  ChatThread,
  ChatEmptyItem,
  ChatLoadingItem,
  ChatErrorItem,
  ChatLoadMoreItem,
  ChatCourseGroupItem,
  MessageScope,
  scopeLabel
} from './ChatInboxTreeItems';

/** Scopes that are rendered as Course → threads inside the inbox tree.
 *  All other scopes keep the original flat-per-scope rendering. */
const COURSE_GROUPED_SCOPES = new Set<MessageScope>([
  'submission_group',
  'course',
  'course_content',
  'course_group'
]);

function isCourseGroupedScope(scope: MessageScope): boolean {
  return COURSE_GROUPED_SCOPES.has(scope);
}

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

interface PersistedState {
  expandedScopes: MessageScope[];
  unreadOnly: boolean;
}

type AnyTreeItem = ChatScopeItem | ChatThreadItem | ChatEmptyItem | ChatLoadingItem | ChatErrorItem | ChatLoadMoreItem | ChatCourseGroupItem;

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

export class ChatInboxTreeProvider implements vscode.TreeDataProvider<AnyTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<AnyTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly _onDidChangeUnread = new vscode.EventEmitter<number>();
  readonly onDidChangeUnread = this._onDidChangeUnread.event;

  private readonly api: ComputorApiService;
  private readonly context: vscode.ExtensionContext;
  private readonly messagesProvider: MessagesWebviewProvider;

  private loading = false;
  private loadError: string | undefined;
  private scopeItems: ChatScopeItem[] = [];
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
  /** Course nodes the user has expanded at least once — used both to drive
   *  initial-collapse-state and to know whether to lazy-fetch on render. */
  private expandedCourseGroups: Set<string> = new Set();
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
  private reloadInFlight?: Promise<void>;
  private reloadQueued = false;
  private wsService?: WebSocketService;
  private wsSubscribedForUserId?: string;
  private readonly wsHandlerId = `chat-inbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private wsReloadTimer?: ReturnType<typeof setTimeout>;
  private static readonly WS_RELOAD_DEBOUNCE_MS = 250;
  /** Cap on concurrent mark-read API calls to avoid flooding the backend. */
  private static readonly MARK_READ_CONCURRENCY = 4;
  /** When we mark messages read locally, suppress WS-driven reloads for this
   *  window — every server-side broadcast otherwise re-paginates the inbox. */
  private static readonly MARK_READ_WS_SUPPRESS_MS = 4000;
  private suppressWsReloadUntil = 0;

  // Persisted UI state
  private expandedScopes: Set<MessageScope> = new Set();
  private unreadOnly = false;

  // Label caches keyed by id
  private readonly orgLabels = new Map<string, string>();
  private readonly familyLabels = new Map<string, string>();
  private readonly courseLabels = new Map<string, string>();
  private readonly contentLabels = new Map<string, { title: string; subtitle?: string }>();
  private readonly groupLabels = new Map<string, { title: string; subtitle?: string }>();
  private readonly memberLabels = new Map<string, { title: string; subtitle?: string }>();

  constructor(
    context: vscode.ExtensionContext,
    api: ComputorApiService,
    messagesProvider: MessagesWebviewProvider
  ) {
    this.context = context;
    this.api = api;
    this.messagesProvider = messagesProvider;
    this.loadPersistedState();
  }

  // ----- Public API -----

  setWebSocketService(wsService: WebSocketService): void {
    this.wsService = wsService;
    // If we already know who we are, subscribe immediately. Otherwise the
    // subscription happens at the end of the next reload, when currentUserId
    // is set.
    this.maybeSubscribeUserChannels();
  }

  refresh(): void {
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
    return this.scopeItems.reduce((sum, item) => sum + item.unreadCount, 0);
  }

  isUnreadOnly(): boolean {
    return this.unreadOnly;
  }

  setUnreadOnly(value: boolean): void {
    if (this.unreadOnly === value) { return; }
    this.unreadOnly = value;
    void this.persistState();
    void vscode.commands.executeCommand('setContext', 'computor.chat.unreadOnly', value);
    // Toggle is a pure client-side filter (buildScopeItems already excludes
    // threads with no unread messages when unreadOnly is on). Rebuilding from
    // the cached payload avoids re-paginating the entire inbox on every flip.
    this.rebuildScopeItemsFromCache();
  }

  recordExpanded(scope: MessageScope, expanded: boolean): void {
    if (expanded) {
      this.expandedScopes.add(scope);
    } else {
      this.expandedScopes.delete(scope);
    }
    void this.persistState();
  }

  async openThread(threadItem: ChatThreadItem): Promise<void> {
    const ctx = await this.buildTargetContext(threadItem.thread);
    if (!ctx) {
      vscode.window.showWarningMessage('Cannot open this conversation: target context unavailable.');
      return;
    }

    // Optimistically clear unread for this thread. The backend only broadcasts
    // read:update on submission_group channels, so non-submission-group threads
    // never receive a WS event when MessagesWebview marks their messages as
    // read — the badge would otherwise stay until a manual refresh. Mutating
    // the cached MessageList objects in place updates both the per-thread and
    // per-scope counts on the next rebuild. The mark-read API call is fired
    // here too; if MessagesWebview also fires it the call is idempotent.
    const unread = threadItem.thread.messages.filter(
      m => !m.is_read && m.author_id !== this.currentUserId
    );
    if (unread.length > 0) {
      const ids = unread.map(m => m.id);
      this.markIdsReadLocally(ids);
      this.rebuildScopeItemsFromCache();
      // Fire-and-forget but throttled — see markMessagesReadOnBackend.
      void this.markMessagesReadOnBackend(ids);
    }

    await this.messagesProvider.showMessages(ctx);
  }

  /**
   * Re-groups + re-builds scope items from the cached message list without
   * re-fetching from the backend. Used when local read state changes
   * optimistically (e.g. opening a thread).
   */
  private rebuildScopeItemsFromCache(): void {
    if (this.cachedMessages.length === 0) {
      this.scopeItems = [];
    } else {
      const grouped = this.groupMessages(this.cachedMessages);
      this.scopeItems = this.buildScopeItems(grouped);
    }
    this._onDidChangeTreeData.fire(undefined);
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
    const ids = unread.map(m => m.id);
    this.markIdsReadLocally(ids);
    this.rebuildScopeItemsFromCache();
    await this.markMessagesReadOnBackend(ids);
  }

  async markScopeRead(scopeItem: ChatScopeItem): Promise<void> {
    const unread = scopeItem.threads.flatMap(t =>
      t.messages.filter(m => !m.is_read && m.author_id !== this.currentUserId)
    );
    if (unread.length === 0) { return; }
    const ids = unread.map(m => m.id);
    this.markIdsReadLocally(ids);
    this.rebuildScopeItemsFromCache();
    await this.markMessagesReadOnBackend(ids);
  }

  /** Sets is_read=true on every cached copy of the given message ids, across
   *  cachedMessages and every per-scope / per-course state's messages array. */
  private markIdsReadLocally(ids: string[]): void {
    if (ids.length === 0) { return; }
    const set = new Set(ids);
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
    await this.resolveLabels(grouped);
    this.scopeItems = this.buildScopeItems(grouped);
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
      vscode.window.showErrorMessage(`Failed to load more messages: ${err?.message || err}`);
    } finally {
      this.scopeLoadingMore.delete(scope);
      this._onDidChangeTreeData.fire(undefined);
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
      vscode.window.showErrorMessage(`Failed to load more messages: ${err?.message || err}`);
    } finally {
      this.courseScopeLoadingMore.delete(key);
      this._onDidChangeTreeData.fire(undefined);
      this._onDidChangeUnread.fire(this.getTotalUnread());
    }
  }

  /** Track expand/collapse for a course node so a refresh can keep the user's
   *  open courses open. */
  recordCourseGroupExpanded(scope: MessageScope, courseId: string, expanded: boolean): void {
    const key = `${scope}::${courseId}`;
    if (expanded) {
      this.expandedCourseGroups.add(key);
    } else {
      this.expandedCourseGroups.delete(key);
    }
  }

  /**
   * Posts mark-read for many message ids without flooding the backend.
   * - Caps in-flight requests at MARK_READ_CONCURRENCY (workers).
   * - Suppresses WS-driven reloads while it runs, so each backend
   *   read:update broadcast we triggered ourselves doesn't kick off a fresh
   *   re-paginated GET /messages of the entire inbox.
   * - Errors per-id are swallowed (best-effort; the optimistic local state
   *   is already applied, and the next manual refresh will re-confirm).
   */
  private async markMessagesReadOnBackend(ids: string[]): Promise<void> {
    if (ids.length === 0) { return; }
    this.suppressWsReloadUntil = Date.now() + ChatInboxTreeProvider.MARK_READ_WS_SUPPRESS_MS;
    if (this.wsReloadTimer) {
      clearTimeout(this.wsReloadTimer);
      this.wsReloadTimer = undefined;
    }
    try {
      let cursor = 0;
      const workers: Promise<void>[] = [];
      for (let w = 0; w < ChatInboxTreeProvider.MARK_READ_CONCURRENCY; w += 1) {
        workers.push((async () => {
          while (true) {
            const i = cursor;
            cursor += 1;
            if (i >= ids.length) { return; }
            try {
              await this.api.markMessageRead(ids[i]!);
            } catch {
              // best-effort
            }
          }
        })());
      }
      await Promise.all(workers);
    } finally {
      // Extend the WS suppression window slightly past now so the burst of
      // server-side read:update broadcasts that lag behind our last request
      // doesn't immediately trigger a re-pagination.
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
      if (this.scopeItems.length === 0) {
        return [new ChatEmptyItem(this.unreadOnly ? 'No unread messages.' : 'No messages.')];
      }
      return [...this.scopeItems];
    }

    if (element instanceof ChatScopeItem) {
      const items: AnyTreeItem[] = [];
      if (isCourseGroupedScope(element.scope)) {
        items.push(...this.buildCourseGroupItems(element.scope));
        return items;
      }
      items.push(...element.threads.map(t => new ChatThreadItem(t)));
      // Per-scope Load more: shown as the last child when the backend
      // reports more messages for this scope than we've pulled. Hidden when
      // the user collapses the scope row.
      const state = this.scopeFetchStates.get(element.scope);
      if (state && state.fetched < state.total) {
        items.push(new ChatLoadMoreItem(element.scope, state.fetched, state.total));
      }
      return items;
    }

    if (element instanceof ChatCourseGroupItem) {
      return await this.getCourseGroupChildren(element);
    }

    return [];
  }

  /** One ChatCourseGroupItem per course the user has access to. */
  private buildCourseGroupItems(scope: MessageScope): ChatCourseGroupItem[] {
    const inner = this.courseScopeStates.get(scope);
    if (!inner) { return []; }
    const courseIds = Array.from(inner.keys());
    // Sort: courses with unread first, then alphabetical by label.
    const decorated = courseIds.map(id => {
      const state = inner.get(id)!;
      const unread = state.messages.reduce(
        (acc, m) => acc + ((!m.is_read && m.author_id !== this.currentUserId) ? 1 : 0),
        0
      );
      const threadCount = new Set(
        state.messages.map(m => this.targetIdFor(scope, m) ?? '__none__')
      ).size;
      return {
        id,
        label: this.courseLabels.get(id) || shortId(id),
        unread,
        threadCount,
        // total === -1 means we haven't fetched yet — show the "click to load" hint
        // by reporting hasMore=false until expand triggers a fetch.
        hasMore: state.total >= 0 && state.fetched < state.total
      };
    });
    decorated.sort((a, b) => {
      if ((b.unread > 0 ? 1 : 0) !== (a.unread > 0 ? 1 : 0)) {
        return (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0);
      }
      return a.label.localeCompare(b.label);
    });
    return decorated.map(d => {
      const expanded = this.expandedCourseGroups.has(`${scope}::${d.id}`) || d.unread > 0;
      return new ChatCourseGroupItem(
        scope,
        d.id,
        d.label,
        d.unread,
        d.threadCount,
        d.hasMore,
        expanded
      );
    });
  }

  /** Lazy-fetch the first page on first expand, then return threads + a
   *  per-course Load more. */
  private async getCourseGroupChildren(element: ChatCourseGroupItem): Promise<AnyTreeItem[]> {
    const { scope, courseId } = element;
    const inner = this.courseScopeStates.get(scope);
    const state = inner?.get(courseId);
    if (!inner || !state) { return []; }
    this.expandedCourseGroups.add(`${scope}::${courseId}`);

    // First-time fetch: state.total === -1 means we haven't asked the backend
    // for this (scope, course) yet. Pull the first page now.
    if (state.total < 0) {
      try {
        const page = await this.api.listMessagesPage({
          scope,
          course_id: courseId,
          skip: 0,
          limit: ChatInboxTreeProvider.SCOPE_PAGE_SIZE
        });
        state.messages = page.items;
        state.fetched = page.items.length;
        state.total = page.total;
        await this.rebuildAssembled();
        this._onDidChangeUnread.fire(this.getTotalUnread());
      } catch (err: any) {
        return [new ChatErrorItem(`Failed to load messages: ${err?.message || err}`)];
      }
    }

    const items: AnyTreeItem[] = [];
    // Group this course's messages into threads by target id.
    const byTarget = new Map<string, MessageList[]>();
    for (const m of state.messages) {
      const targetId = this.targetIdFor(scope, m) ?? '__none__';
      if (!byTarget.has(targetId)) { byTarget.set(targetId, []); }
      byTarget.get(targetId)!.push(m);
    }
    const threads: ChatThread[] = [];
    for (const [targetId, msgs] of byTarget) {
      const sortedMessages = msgs.slice().sort((a, b) => compareCreated(a, b));
      const lastMessage = sortedMessages[sortedMessages.length - 1];
      const unreadCount = msgs.filter(m => !m.is_read && m.author_id !== this.currentUserId).length;
      if (this.unreadOnly && unreadCount === 0) { continue; }
      const { title, subtitle } = this.threadLabels(scope, targetId === '__none__' ? null : targetId, msgs);
      threads.push({
        scope,
        targetId: targetId === '__none__' ? null : targetId,
        title,
        subtitle,
        lastMessage,
        unreadCount,
        messageCount: msgs.length,
        messages: sortedMessages
      });
    }
    threads.sort((a, b) => {
      if ((b.unreadCount > 0 ? 1 : 0) !== (a.unreadCount > 0 ? 1 : 0)) {
        return (b.unreadCount > 0 ? 1 : 0) - (a.unreadCount > 0 ? 1 : 0);
      }
      return compareThreadRecency(b, a);
    });
    items.push(...threads.map(t => new ChatThreadItem(t)));
    if (state.fetched < state.total) {
      items.push(new ChatLoadMoreItem(scope, state.fetched, state.total, courseId));
    }
    if (items.length === 0) {
      items.push(new ChatEmptyItem('No messages.'));
    }
    return items;
  }

  // ----- Internals -----

  private async reload(): Promise<void> {
    // Only show the loading spinner on initial load. On subsequent reloads,
    // keep the current scope items visible so the tree doesn't flicker to
    // "Loading…" between the user's click and the new data arriving.
    const showSpinner = this.scopeItems.length === 0 && !this.loadError;
    this.loading = true;
    this.loadError = undefined;
    if (showSpinner) {
      this._onDidChangeTreeData.fire(undefined);
    }

    try {
      // Identity + scopes once; per-scope inbox pages in parallel. Each scope
      // has its own pagination, so a Load more click at the end of e.g.
      // Submission Groups only advances *that* scope's window.
      const [identity, scopes] = await Promise.all([
        this.api.getCurrentUser().catch(() => undefined),
        this.api.getUserScopes().catch(() => undefined)
      ]);
      this.currentUserId = identity?.id;
      this.userScopes = scopes;
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

      // Resolve labels for every accessible course up front, so the
      // ChatCourseGroupItem rows can show real titles instead of short ids.
      await Promise.all(courseIds.map(id => this.resolveCourseLabelLazy(id).catch(() => undefined)));

      await this.rebuildAssembled();
    } catch (error: any) {
      this.loadError = `Failed to load messages: ${error?.message || error}`;
      this.scopeItems = [];
      this.cachedMessages = [];
      this.scopeFetchStates.clear();
      this.courseScopeStates.clear();
    } finally {
      this.loading = false;
      this._onDidChangeTreeData.fire(undefined);
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

  private async resolveLabels(grouped: Map<MessageScope, Map<string, MessageList[]>>): Promise<void> {
    // Best-effort batched lookups; failures fall back to id truncation.
    const tasks: Promise<unknown>[] = [];

    for (const [scope, byTarget] of grouped) {
      for (const [targetId] of byTarget) {
        if (targetId === '__none__') { continue; }
        tasks.push(this.ensureLabel(scope, targetId).catch(() => undefined));
      }
    }
    await Promise.all(tasks);
  }

  private async ensureLabel(scope: MessageScope, targetId: string): Promise<void> {
    switch (scope) {
      case 'organization':
        if (!this.orgLabels.has(targetId)) {
          const org = await this.api.getOrganization(targetId);
          this.orgLabels.set(targetId, org?.title || org?.path || shortId(targetId));
        }
        break;
      case 'course_family':
        if (!this.familyLabels.has(targetId)) {
          const fam = await this.api.getCourseFamily(targetId);
          this.familyLabels.set(targetId, fam?.title || fam?.path || shortId(targetId));
        }
        break;
      case 'course':
        if (!this.courseLabels.has(targetId)) {
          const course = await this.api.getCourse(targetId);
          this.courseLabels.set(targetId, course?.title || course?.path || shortId(targetId));
        }
        break;
      case 'course_content':
        if (!this.contentLabels.has(targetId)) {
          const content = await this.api.getCourseContent(targetId);
          if (content) {
            const courseLabel = content.course_id
              ? await this.resolveCourseLabelLazy(content.course_id)
              : undefined;
            this.contentLabels.set(targetId, {
              title: content.title || content.path || shortId(targetId),
              subtitle: courseLabel
            });
          } else {
            this.contentLabels.set(targetId, { title: shortId(targetId) });
          }
        }
        break;
      case 'course_group':
        if (!this.groupLabels.has(targetId)) {
          const group = await this.api.getCourseGroup(targetId);
          if (group) {
            const courseLabel = group.course_id
              ? await this.resolveCourseLabelLazy(group.course_id)
              : undefined;
            this.groupLabels.set(targetId, {
              title: group.title || `Group ${shortId(targetId)}`,
              subtitle: courseLabel
            });
          } else {
            this.groupLabels.set(targetId, { title: `Group ${shortId(targetId)}` });
          }
        }
        break;
      case 'course_member':
        if (!this.memberLabels.has(targetId)) {
          const member = await this.api.getCourseMember(targetId);
          if (member) {
            const user = (member as any).user;
            const name = user
              ? `${user.given_name || ''} ${user.family_name || ''}`.trim() || user.username || user.email
              : `Member ${shortId(targetId)}`;
            const courseLabel = member.course_id
              ? await this.resolveCourseLabelLazy(member.course_id)
              : undefined;
            this.memberLabels.set(targetId, { title: name, subtitle: courseLabel });
          } else {
            this.memberLabels.set(targetId, { title: `Member ${shortId(targetId)}` });
          }
        }
        break;
      default:
        // user / submission_group: derived from the message data inline.
        break;
    }
  }

  private async resolveCourseLabelLazy(courseId: string): Promise<string | undefined> {
    if (this.courseLabels.has(courseId)) { return this.courseLabels.get(courseId); }
    try {
      const course = await this.api.getCourse(courseId);
      const label = course?.title || course?.path || shortId(courseId);
      this.courseLabels.set(courseId, label);
      return label;
    } catch {
      return undefined;
    }
  }

  private buildScopeItems(grouped: Map<MessageScope, Map<string, MessageList[]>>): ChatScopeItem[] {
    const result: ChatScopeItem[] = [];

    for (const scope of SCOPE_ORDER) {
      // Course-grouped scopes always render — children are course nodes, not
      // threads, so the row stays collapsible even when no messages have been
      // pulled yet.
      if (isCourseGroupedScope(scope)) {
        const inner = this.courseScopeStates.get(scope);
        if (!inner || inner.size === 0) { continue; }
        let totalUnread = 0;
        for (const state of inner.values()) {
          for (const m of state.messages) {
            if (!m.is_read && m.author_id !== this.currentUserId) { totalUnread += 1; }
          }
        }
        if (this.unreadOnly && totalUnread === 0) { continue; }
        const expanded = this.expandedScopes.has(scope) || totalUnread > 0;
        result.push(new ChatScopeItem(scope, [], totalUnread, expanded, inner.size));
        continue;
      }

      const byTarget = grouped.get(scope);
      // Global stays visible even with zero messages so users always have a
      // way to read announcements (and admins always have a place to post
      // from).
      const alwaysShow = scope === 'global';
      if ((!byTarget || byTarget.size === 0) && !alwaysShow) { continue; }

      const threads: ChatThread[] = [];
      for (const [targetId, msgs] of (byTarget ?? new Map<string, MessageList[]>())) {
        const sortedMessages = msgs.slice().sort((a, b) => compareCreated(a, b));
        const lastMessage = sortedMessages[sortedMessages.length - 1];
        // Exclude the user's own messages — backend doesn't auto-stamp authors
        // as readers of their own posts, so without this they'd show as
        // permanently unread to themselves.
        const unreadCount = msgs.filter(m => !m.is_read && m.author_id !== this.currentUserId).length;
        if (this.unreadOnly && unreadCount === 0) { continue; }

        const { title, subtitle } = this.threadLabels(scope, targetId === '__none__' ? null : targetId, msgs);
        threads.push({
          scope,
          targetId: targetId === '__none__' ? null : targetId,
          title,
          subtitle,
          lastMessage,
          unreadCount,
          messageCount: msgs.length,
          messages: sortedMessages
        });
      }

      if (threads.length === 0 && !alwaysShow) { continue; }

      threads.sort((a, b) => {
        if ((b.unreadCount > 0 ? 1 : 0) !== (a.unreadCount > 0 ? 1 : 0)) {
          return (b.unreadCount > 0 ? 1 : 0) - (a.unreadCount > 0 ? 1 : 0);
        }
        return compareThreadRecency(b, a);
      });

      const totalUnread = threads.reduce((acc, t) => acc + t.unreadCount, 0);
      const expanded = this.expandedScopes.has(scope) || totalUnread > 0;
      result.push(new ChatScopeItem(scope, threads, totalUnread, expanded));
    }

    return result;
  }

  private threadLabels(scope: MessageScope, targetId: string | null, msgs: MessageList[]): { title: string; subtitle?: string } {
    switch (scope) {
      case 'global':
        return { title: 'Global Announcements' };
      case 'organization': {
        const label = targetId ? this.orgLabels.get(targetId) || shortId(targetId) : 'Organization';
        return { title: label };
      }
      case 'course_family': {
        const label = targetId ? this.familyLabels.get(targetId) || shortId(targetId) : 'Course Family';
        return { title: label };
      }
      case 'course': {
        const label = targetId ? this.courseLabels.get(targetId) || shortId(targetId) : 'Course';
        return { title: label };
      }
      case 'course_content': {
        const info = targetId ? this.contentLabels.get(targetId) : undefined;
        return { title: info?.title || (targetId ? shortId(targetId) : 'Course Content'), subtitle: info?.subtitle };
      }
      case 'course_group': {
        const info = targetId ? this.groupLabels.get(targetId) : undefined;
        return { title: info?.title || (targetId ? `Group ${shortId(targetId)}` : 'Course Group'), subtitle: info?.subtitle };
      }
      case 'course_member': {
        const info = targetId ? this.memberLabels.get(targetId) : undefined;
        return { title: info?.title || (targetId ? `Member ${shortId(targetId)}` : 'Course Member'), subtitle: info?.subtitle };
      }
      case 'submission_group': {
        // Try to find a useful subtitle from any message that carries course_content_id (sibling field).
        const sample = msgs[0];
        const contentId = sample?.course_content_id;
        const contentLabel = contentId ? this.contentLabels.get(contentId)?.title : undefined;
        return {
          title: contentLabel || (targetId ? `Submission Group ${shortId(targetId)}` : 'Submission Group'),
          subtitle: contentLabel ? 'Submission group' : undefined
        };
      }
      case 'user': {
        // DM target: pick the "other person" from the messages.
        const other = msgs
          .map(m => m.author)
          .find(a => a && this.currentUserId && (a as any).id !== this.currentUserId);
        if (other) {
          const name = `${other.given_name || ''} ${other.family_name || ''}`.trim()
            || (other as any).username
            || (other as any).email
            || (targetId ? shortId(targetId) : 'User');
          return { title: name };
        }
        return { title: targetId ? `User ${shortId(targetId)}` : 'User' };
      }
    }
  }

  private async buildTargetContext(thread: ChatThread): Promise<MessageTargetContext | undefined> {
    const { scope, targetId } = thread;
    const labels = this.threadLabels(scope, targetId, thread.messages);
    const titleSegments: string[] = [];
    if (labels.subtitle) { titleSegments.push(labels.subtitle); }
    titleSegments.push(labels.title);
    const title = titleSegments.join(' / ');

    const baseQuery: Record<string, string> = {};
    const basePayload: Record<string, unknown> = {};
    let wsChannel: string | undefined;
    let readOnly = false;
    let readOnlyReason: string | undefined;

    await this.ensureUserScopes();

    // Always pin scope on the panel query — without it the backend matches
    // every message that shares the target id, which leaks cross-scope
    // messages (e.g. submission_group messages also carry course_content_id).
    baseQuery.scope = scope;

    switch (scope) {
      case 'global':
        readOnly = !canPostGlobal(this.userScopes);
        readOnlyReason = readOnly ? 'Only administrators can post global announcements.' : undefined;
        // wsChannel intentionally undefined — no per-target channel for global.
        break;
      case 'organization':
        if (!targetId) { return undefined; }
        baseQuery.organization_id = targetId;
        basePayload.organization_id = targetId;
        wsChannel = `organization:${targetId}`;
        readOnly = !canPostToOrganization(this.userScopes, targetId);
        readOnlyReason = readOnly ? 'Posting to this organization requires manager or owner role.' : undefined;
        break;
      case 'course_family':
        if (!targetId) { return undefined; }
        baseQuery.course_family_id = targetId;
        basePayload.course_family_id = targetId;
        wsChannel = `course_family:${targetId}`;
        readOnly = !canPostToCourseFamily(this.userScopes, targetId);
        readOnlyReason = readOnly ? 'Posting to this course family requires manager or owner role.' : undefined;
        break;
      case 'course':
        if (!targetId) { return undefined; }
        baseQuery.course_id = targetId;
        basePayload.course_id = targetId;
        wsChannel = `course:${targetId}`;
        break;
      case 'course_content': {
        if (!targetId) { return undefined; }
        baseQuery.course_content_id = targetId;
        basePayload.course_content_id = targetId;
        wsChannel = `course_content:${targetId}`;
        break;
      }
      case 'course_group':
        if (!targetId) { return undefined; }
        baseQuery.course_group_id = targetId;
        basePayload.course_group_id = targetId;
        wsChannel = `course_group:${targetId}`;
        break;
      case 'submission_group':
        if (!targetId) { return undefined; }
        baseQuery.submission_group_id = targetId;
        basePayload.submission_group_id = targetId;
        wsChannel = `submission_group:${targetId}`;
        break;
      case 'course_member':
        if (!targetId) { return undefined; }
        baseQuery.course_member_id = targetId;
        basePayload.course_member_id = targetId;
        wsChannel = `course_member:${targetId}`;
        break;
      case 'user':
        if (!targetId) { return undefined; }
        baseQuery.user_id = targetId;
        basePayload.user_id = targetId;
        wsChannel = `user:${targetId}`;
        break;
    }

    return {
      title,
      subtitle: scopeLabel(scope),
      query: baseQuery,
      createPayload: basePayload,
      wsChannel,
      readOnly,
      readOnlyReason
    };
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
    void this.showNewMessageToast(inner);
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
    const scopeText = scopeLabel(scope);
    const text = author
      ? `${author} (${scopeText}): ${preview}`
      : `${scopeText}: ${preview}`;

    const choice = await vscode.window.showInformationMessage(text, 'Open');
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
      const stored = this.context.globalState.get<PersistedState>(STATE_KEY);
      if (stored) {
        if (Array.isArray(stored.expandedScopes)) {
          this.expandedScopes = new Set(stored.expandedScopes);
        }
        if (typeof stored.unreadOnly === 'boolean') {
          this.unreadOnly = stored.unreadOnly;
        }
      }
    } catch (err) {
      console.warn('[ChatInbox] Failed to load persisted state:', err);
    }
    void vscode.commands.executeCommand('setContext', 'computor.chat.unreadOnly', this.unreadOnly);
  }

  private async persistState(): Promise<void> {
    const state: PersistedState = {
      expandedScopes: Array.from(this.expandedScopes),
      unreadOnly: this.unreadOnly
    };
    try {
      await this.context.globalState.update(STATE_KEY, state);
    } catch (err) {
      console.warn('[ChatInbox] Failed to persist state:', err);
    }
  }
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
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
