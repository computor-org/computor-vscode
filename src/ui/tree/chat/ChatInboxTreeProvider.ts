import * as vscode from 'vscode';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { canPostGlobal, canPostToCourseFamily, canPostToOrganization } from '../../../services/MessagePermissions';
import { WebSocketService } from '../../../services/WebSocketService';
import { MessagesWebviewProvider, MessageTargetContext } from '../../webviews/MessagesWebviewProvider';
import type { MessageList, MessageQuery } from '../../../types/generated';

const GLOBAL_CHANNEL = 'global';
import {
  ChatScopeItem,
  ChatThreadItem,
  ChatThread,
  ChatEmptyItem,
  ChatLoadingItem,
  ChatErrorItem,
  ChatLoadMoreItem,
  ChatFilterChipItem,
  MessageScope,
  scopeLabel
} from './ChatInboxTreeItems';

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
  submissionCourseFilter?: string[];
}

type AnyTreeItem = ChatScopeItem | ChatThreadItem | ChatEmptyItem | ChatLoadingItem | ChatErrorItem | ChatLoadMoreItem | ChatFilterChipItem;

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
  /** Last assembled inbox payload (= unfilteredBase ± submission filter
   *  results) used by groupMessages + buildScopeItems. */
  private cachedMessages: MessageList[] = [];
  /** Pristine accumulating page-1+ result of the unfiltered /messages query.
   *  Grows as the user clicks "Load more". Used as the source for assembled. */
  private unfilteredBase: MessageList[] = [];
  /** X-Total-Count from the unfiltered /messages query — drives Load more
   *  visibility. */
  private unfilteredTotal: number | undefined;
  /** How many unfiltered messages we've fetched (effectively the next skip). */
  private unfilteredFetched = 0;
  /** Page size for the unfiltered inbox fetch + each Load more click. */
  private static readonly INBOX_PAGE_SIZE = 200;
  /** Set during loadMoreInboxMessages so the user can't double-click and fan
   *  out duplicate skip values. */
  private loadingMore = false;
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
  /** Course IDs to keep when rendering the submission_group scope. Empty = all. */
  private submissionCourseFilter: Set<string> = new Set();

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

  /** Sets is_read=true on every cached copy of the given message ids — both
   *  in cachedMessages and in unfilteredBase. They share refs for most
   *  scopes, but diverge for submission_group when the filter is active, so
   *  marking only cachedMessages would lose the read state next time we
   *  re-assemble from base (e.g. when the filter is cleared). */
  private markIdsReadLocally(ids: string[]): void {
    if (ids.length === 0) { return; }
    const set = new Set(ids);
    for (const m of this.cachedMessages) {
      if (set.has(m.id)) { m.is_read = true; }
    }
    for (const m of this.unfilteredBase) {
      if (set.has(m.id)) { m.is_read = true; }
    }
  }

  // ----- Submission-group filters -----

  /** Returns the courses that currently have at least one submission_group
   *  message in the cached inbox payload, with resolved labels. */
  getSubmissionFilterCourses(): Array<{ id: string; label: string; selected: boolean }> {
    const ids = new Set<string>();
    for (const m of this.cachedMessages) {
      if (m.scope !== 'submission_group') { continue; }
      if (typeof m.course_id === 'string' && m.course_id) {
        ids.add(m.course_id);
      }
    }
    const list = Array.from(ids).map(id => ({
      id,
      label: this.courseLabels.get(id) || shortId(id),
      selected: this.submissionCourseFilter.has(id)
    }));
    list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
  }

  setSubmissionCourseFilter(ids: string[]): void {
    this.submissionCourseFilter = new Set(ids);
    void this.persistState();
    this.applySubmissionFiltersContextKey();
    // Filter is enforced server-side, so re-fetch the submission-group slice
    // with the new params; non-sub scopes don't change.
    this.refresh();
  }

  removeSubmissionCourse(courseId: string): void {
    if (!this.submissionCourseFilter.has(courseId)) { return; }
    this.submissionCourseFilter.delete(courseId);
    void this.persistState();
    this.applySubmissionFiltersContextKey();
    this.refresh();
  }

  clearSubmissionFilters(): void {
    if (this.submissionCourseFilter.size === 0) { return; }
    this.submissionCourseFilter = new Set();
    void this.persistState();
    this.applySubmissionFiltersContextKey();
    this.refresh();
  }

  private hasSubmissionFilter(): boolean {
    return this.submissionCourseFilter.size > 0;
  }

  /**
   * Fetches submission-group messages matching the active backend-driven
   * filters. Currently only the course filter goes to the backend; title is
   * a client-side substring narrow applied during buildScopeItems, because
   * MessageQuery doesn't support a title-substring filter (tag_scope only
   * matches `#tag` prefixes inside the title, which is the wrong tool for
   * arbitrary title text).
   *
   * Multi-course is fanned out per course because MessageQuery takes one
   * course_id at a time. course_id_all_messages=true makes the backend walk
   * the relations so submission_group messages with course_id=null still
   * match the requested course.
   */
  private async fetchFilteredSubmissionMessages(): Promise<MessageList[]> {
    const courseIds = Array.from(this.submissionCourseFilter);

    if (courseIds.length === 0) {
      // No course filter: pull all submission_group messages so the client-
      // side title narrow has data to work on.
      return await this.api.listMessages({ scope: 'submission_group' });
    }

    // course_id_all_messages tells the backend to walk the relations so
    // submission_group messages with a null course_id column still match.
    // The generated MessageQuery type doesn't list it (out-of-date typegen),
    // so cast through unknown.
    const fetches = courseIds.map(courseId =>
      this.api.listMessages({
        scope: 'submission_group',
        course_id: courseId,
        course_id_all_messages: true
      } as unknown as MessageQuery)
    );
    const results = await Promise.all(fetches);
    const seen = new Set<string>();
    const merged: MessageList[] = [];
    for (const list of results) {
      for (const m of list) {
        if (seen.has(m.id)) { continue; }
        seen.add(m.id);
        merged.push(m);
      }
    }
    return merged;
  }

  private applySubmissionFiltersContextKey(): void {
    void vscode.commands.executeCommand('setContext', 'computor.chat.submissionFiltersActive', this.hasSubmissionFilter());
  }

  /** One chip per active course filter; clicking a chip removes that course
   *  from the filter set (and triggers a refresh of the submission_group
   *  slice). Empty array when no filter is active. */
  private buildSubmissionFilterChips(): ChatFilterChipItem[] {
    const chips: ChatFilterChipItem[] = [];
    for (const courseId of this.submissionCourseFilter) {
      const label = this.courseLabels.get(courseId) || shortId(courseId);
      chips.push(new ChatFilterChipItem(
        `Course: ${label}`,
        `Click to remove "${label}" from the Submission Groups filter.`,
        'computor.chat.removeSubmissionCourse',
        [courseId]
      ));
    }
    return chips;
  }

  /**
   * Builds the assembled cachedMessages from unfilteredBase (+ filtered
   * submission_group slice when the submission filter is on), then refreshes
   * the scope items + tree.
   */
  private async applyAssembledFromBase(): Promise<void> {
    let assembled = this.unfilteredBase;
    if (this.hasSubmissionFilter()) {
      try {
        const filteredSub = await this.fetchFilteredSubmissionMessages();
        const nonSub = assembled.filter(m => m.scope !== 'submission_group');
        assembled = [...nonSub, ...filteredSub];
      } catch (err) {
        console.warn('[ChatInbox] Failed to fetch filtered submission messages, falling back to unfiltered:', err);
      }
    }
    this.cachedMessages = assembled;
    const grouped = this.groupMessages(this.cachedMessages);
    await this.resolveLabels(grouped);
    this.scopeItems = this.buildScopeItems(grouped);
  }

  /** Fetches the next page of unfiltered messages and merges into the cache. */
  async loadMoreInboxMessages(): Promise<void> {
    if (this.loadingMore) { return; }
    if (this.unfilteredTotal !== undefined && this.unfilteredFetched >= this.unfilteredTotal) {
      return;
    }
    this.loadingMore = true;
    try {
      const page = await this.api.listMessagesPage({
        skip: this.unfilteredFetched,
        limit: ChatInboxTreeProvider.INBOX_PAGE_SIZE
      });
      // Dedupe in case a WS-triggered insert added a message we'd otherwise
      // see again at this offset.
      const seen = new Set(this.unfilteredBase.map(m => m.id));
      for (const m of page.items) {
        if (!seen.has(m.id)) {
          this.unfilteredBase.push(m);
          seen.add(m.id);
        }
      }
      // Track skip on the request size, not the dedupe survivors, so we don't
      // get stuck re-querying the same offset forever if the backend grew.
      this.unfilteredFetched += page.items.length;
      this.unfilteredTotal = page.total;

      await this.applyAssembledFromBase();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load more messages: ${err?.message || err}`);
    } finally {
      this.loadingMore = false;
      this._onDidChangeTreeData.fire(undefined);
      this._onDidChangeUnread.fire(this.getTotalUnread());
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
      const items: AnyTreeItem[] = this.scopeItems.length === 0
        ? [new ChatEmptyItem(this.unreadOnly ? 'No unread messages.' : 'No messages.')]
        : [...this.scopeItems];
      // Show "Load more" when the backend reported more unfiltered messages
      // than we've fetched. Keep it visible regardless of unread/filter state
      // so the user can always pull the rest down.
      if (this.unfilteredTotal !== undefined && this.unfilteredFetched < this.unfilteredTotal) {
        items.push(new ChatLoadMoreItem(this.unfilteredFetched, this.unfilteredTotal));
      }
      return items;
    }

    if (element instanceof ChatScopeItem) {
      const items: AnyTreeItem[] = [];
      // Submission Groups gets per-active-filter chips up top — click a chip
      // to remove that one filter, mirroring the examples-tree pattern.
      if (element.scope === 'submission_group') {
        items.push(...this.buildSubmissionFilterChips());
      }
      items.push(...element.threads.map(t => new ChatThreadItem(t)));
      return items;
    }

    return [];
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
      // Page 1 only — Load more (rendered as a tree leaf) walks the rest.
      const [identity, page, scopes] = await Promise.all([
        this.api.getCurrentUser().catch(() => undefined),
        this.api.listMessagesPage({ skip: 0, limit: ChatInboxTreeProvider.INBOX_PAGE_SIZE }),
        this.api.getUserScopes().catch(() => undefined)
      ]);
      this.currentUserId = identity?.id;
      this.userScopes = scopes;
      this.maybeSubscribeUserChannels();

      this.unfilteredBase = page.items;
      this.unfilteredTotal = page.total;
      this.unfilteredFetched = page.items.length;

      await this.applyAssembledFromBase();
    } catch (error: any) {
      this.loadError = `Failed to load messages: ${error?.message || error}`;
      this.scopeItems = [];
      this.cachedMessages = [];
      this.unfilteredBase = [];
      this.unfilteredTotal = undefined;
      this.unfilteredFetched = 0;
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
      const byTarget = grouped.get(scope);

      // Submission Groups stays visible when its filter is active, even if
      // the filtered fetch returned zero messages — otherwise the user has
      // nowhere to right-click to clear the filter.
      const filterActive = scope === 'submission_group' && this.submissionCourseFilter.size > 0;

      if ((!byTarget || byTarget.size === 0) && !filterActive) { continue; }

      const threads: ChatThread[] = [];
      for (const [targetId, msgs] of (byTarget ?? new Map<string, MessageList[]>())) {
        // Submission-group filters are now enforced server-side: when the
        // filter is active, the cached payload's submission_group slice is
        // already the result of a filtered fetch, so nothing else to do here.
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

      // Already handled the empty-and-no-filter case above; here we just
      // need to skip non-submission-group empty scopes (which can't happen
      // given the early continue, but keep belt-and-braces for clarity).
      if (threads.length === 0 && !filterActive) { continue; }

      threads.sort((a, b) => {
        if ((b.unreadCount > 0 ? 1 : 0) !== (a.unreadCount > 0 ? 1 : 0)) {
          return (b.unreadCount > 0 ? 1 : 0) - (a.unreadCount > 0 ? 1 : 0);
        }
        return compareThreadRecency(b, a);
      });

      const totalUnread = threads.reduce((acc, t) => acc + t.unreadCount, 0);
      const expanded = this.expandedScopes.has(scope) || totalUnread > 0;
      result.push(new ChatScopeItem(scope, threads, totalUnread, expanded, filterActive));
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

    switch (scope) {
      case 'global':
        // Global threads carry no target IDs, so /messages without a scope
        // filter returns the user's full inbox — not just globals. Pin the
        // scope explicitly so the panel only shows global announcements.
        baseQuery.scope = 'global';
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
        const contentInfo = this.contentLabels.get(targetId);
        if (contentInfo) {
          // Course content lookup may have set the course relation; surface it for create payloads.
          // We don't have direct course_id here unless the message carried it, so leave as is.
        }
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
        if (Array.isArray(stored.submissionCourseFilter)) {
          this.submissionCourseFilter = new Set(stored.submissionCourseFilter);
        }
      }
    } catch (err) {
      console.warn('[ChatInbox] Failed to load persisted state:', err);
    }
    void vscode.commands.executeCommand('setContext', 'computor.chat.unreadOnly', this.unreadOnly);
    this.applySubmissionFiltersContextKey();
  }

  private async persistState(): Promise<void> {
    const state: PersistedState = {
      expandedScopes: Array.from(this.expandedScopes),
      unreadOnly: this.unreadOnly,
      submissionCourseFilter: Array.from(this.submissionCourseFilter)
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
