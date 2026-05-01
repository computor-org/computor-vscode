import * as vscode from 'vscode';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { UserList } from '../../../types/generated/users';

const STATE_KEY = 'computor.userManager.filterState';

interface FilterState {
  search: string;
  showArchived: boolean;
  showService: boolean;
}

export class UserTreeItem extends vscode.TreeItem {
  constructor(
    public readonly user: UserList,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    const familyName = user.family_name || '';
    const givenName = user.given_name || '';
    const displayName = familyName && givenName
      ? `${familyName}, ${givenName}`
      : familyName || givenName || user.username || user.email || user.id;

    super(displayName, collapsibleState);

    this.contextValue = user.is_service ? 'user.service' : 'user';
    this.tooltip = this.buildTooltip();
    this.description = user.email || user.username || '';
    // Robot icon for service accounts, human icon for real users.
    this.iconPath = new vscode.ThemeIcon(user.is_service ? 'robot' : 'account');
    this.command = {
      command: 'computor.userManager.openUserDetails',
      title: 'Open User Details',
      arguments: [this]
    };
  }

  private buildTooltip(): string {
    const parts: string[] = [];

    if (this.user.given_name || this.user.family_name) {
      parts.push(`${this.user.given_name || ''} ${this.user.family_name || ''}`.trim());
    }

    if (this.user.email) {
      parts.push(`Email: ${this.user.email}`);
    }

    if (this.user.username) {
      parts.push(`Username: ${this.user.username}`);
    }

    if (this.user.archived_at) {
      parts.push('⚠️ ARCHIVED');
    }

    if (this.user.is_service) {
      parts.push('🤖 Service Account');
    }

    return parts.join('\n');
  }
}

class UserManagerLoadingItem extends vscode.TreeItem {
  constructor() {
    super('Loading users…', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.contextValue = 'userManagerLoading';
  }
}

class UserManagerEmptyItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('inbox');
    this.contextValue = 'userManagerEmpty';
  }
}

class UserManagerStatItem extends vscode.TreeItem {
  constructor(visible: number, total: number) {
    const suffix = visible !== total ? ` of ${total}` : '';
    super(`${visible}${suffix} user${visible === 1 ? '' : 's'}`, vscode.TreeItemCollapsibleState.None);
    this.id = 'userManagerStat';
    this.iconPath = new vscode.ThemeIcon('list-unordered');
    this.contextValue = 'userManagerStat';
  }
}

class UserManagerFilterChipItem extends vscode.TreeItem {
  constructor(
    label: string,
    icon: string,
    tooltip: string,
    clickCommand: string,
    chipKind: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `userManagerChip:${chipKind}`;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.tooltip = tooltip;
    this.contextValue = `userManagerFilter.${chipKind}`;
    this.command = { command: clickCommand, title: tooltip };
  }
}

type TreeItem = UserTreeItem | vscode.TreeItem;

export class UserManagerTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeItem | undefined | null>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private users: UserList[] = [];
  private filterState: FilterState;
  private loading = false;
  private loadError: string | undefined;
  private hasLoaded = false;

  constructor(
    private readonly apiService: ComputorApiService,
    private readonly context: vscode.ExtensionContext
  ) {
    this.filterState = this.loadFilterState();
    void this.applyContextKeys();
  }

  // ----- Filter state -----

  getSearchQuery(): string {
    return this.filterState.search;
  }

  setSearchQuery(query: string): void {
    this.filterState.search = query;
    void this.persistFilterState();
    this.fireChange();
  }

  clearSearch(): void {
    this.filterState.search = '';
    void this.persistFilterState();
    this.fireChange();
  }

  isShowingArchived(): boolean {
    return this.filterState.showArchived;
  }

  toggleShowArchived(): void {
    this.filterState.showArchived = !this.filterState.showArchived;
    void this.persistFilterState();
    this.fireChange();
  }

  isShowingService(): boolean {
    return this.filterState.showService;
  }

  toggleShowService(): void {
    this.filterState.showService = !this.filterState.showService;
    void this.persistFilterState();
    this.fireChange();
  }

  // ----- Tree data -----

  refresh(): void {
    this.users = [];
    this.hasLoaded = false;
    this.loadError = undefined;
    this.fireChange();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (element) {
      return [];
    }

    if (!this.hasLoaded && !this.loading) {
      await this.loadUsers();
    }

    if (this.loading) {
      return [new UserManagerLoadingItem()];
    }

    if (this.loadError) {
      const errorItem = new vscode.TreeItem(this.loadError, vscode.TreeItemCollapsibleState.None);
      errorItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      errorItem.contextValue = 'userManagerError';
      return [errorItem];
    }

    const { matched, scopeTotal } = this.applyFilters(this.users);
    const items: TreeItem[] = [];

    // `scopeTotal` is the size of the toggle-filtered user list (i.e. how
    // many users currently *qualify* for display given the show-archived /
    // show-service toggles). Only the search filter narrows the visible
    // count below `scopeTotal`. The "Showing …" chips themselves never
    // factor into either count.
    items.push(new UserManagerStatItem(matched.length, scopeTotal));
    items.push(...this.buildActiveFilterChips());

    if (matched.length === 0) {
      items.push(new UserManagerEmptyItem(
        this.users.length === 0
          ? 'No users.'
          : 'No users match the current filters.'
      ));
      return items;
    }

    for (const user of matched) {
      items.push(new UserTreeItem(user, vscode.TreeItemCollapsibleState.None));
    }

    return items;
  }

  getUserById(userId: string): UserList | undefined {
    return this.users.find(u => u.id === userId);
  }

  // ----- Internals -----

  private async loadUsers(): Promise<void> {
    this.loading = true;
    this.loadError = undefined;
    this.fireChange();
    try {
      const all = await this.apiService.getUsers({ force: true });
      this.users = (all || []).slice().sort((a, b) => {
        const aFamily = (a.family_name || '').toLowerCase();
        const bFamily = (b.family_name || '').toLowerCase();
        if (aFamily !== bFamily) {
          return aFamily.localeCompare(bFamily);
        }
        const aGiven = (a.given_name || '').toLowerCase();
        const bGiven = (b.given_name || '').toLowerCase();
        return aGiven.localeCompare(bGiven);
      });
      this.hasLoaded = true;
    } catch (error: any) {
      console.error('[UserManagerTreeProvider] Failed to load users:', error);
      this.loadError = `Failed to load users: ${error?.message || error}`;
      this.users = [];
    } finally {
      this.loading = false;
      this.fireChange();
    }
  }

  private applyFilters(users: UserList[]): { matched: UserList[]; scopeTotal: number } {
    let result = users;
    if (!this.filterState.showArchived) {
      result = result.filter(u => !u.archived_at);
    }
    if (!this.filterState.showService) {
      result = result.filter(u => !u.is_service);
    }
    // `scopeTotal` snapshots how many users qualify under the toggles alone;
    // search is layered on top so "m of n" reflects search hits within the
    // current toggle scope, not against the unfiltered user list.
    const scopeTotal = result.length;
    if (this.filterState.search) {
      const q = this.filterState.search.toLowerCase();
      result = result.filter(u =>
        (u.family_name || '').toLowerCase().includes(q) ||
        (u.given_name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q)
      );
    }
    return { matched: result, scopeTotal };
  }

  private buildActiveFilterChips(): TreeItem[] {
    const chips: TreeItem[] = [];

    if (this.filterState.search) {
      chips.push(new UserManagerFilterChipItem(
        `Search: "${this.filterState.search}"`,
        'search',
        'Clear search filter',
        'computor.userManager.clearSearch',
        'search'
      ));
    }

    if (this.filterState.showArchived) {
      chips.push(new UserManagerFilterChipItem(
        'Showing archived users',
        'archive',
        'Hide archived users',
        'computor.userManager.toggleArchived',
        'archived'
      ));
    }

    if (this.filterState.showService) {
      chips.push(new UserManagerFilterChipItem(
        'Showing service accounts',
        // Filter icon, not 'robot' — using the same icon as service-account
        // user rows made the chip look like another service account in the list.
        'eye',
        'Hide service accounts',
        'computor.userManager.toggleService',
        'service'
      ));
    }

    return chips;
  }

  private fireChange(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  private loadFilterState(): FilterState {
    try {
      const stored = this.context.globalState.get<FilterState>(STATE_KEY);
      return {
        search: typeof stored?.search === 'string' ? stored.search : '',
        showArchived: stored?.showArchived === true,
        showService: stored?.showService === true
      };
    } catch (err) {
      console.warn('[UserManagerTreeProvider] Failed to load filter state:', err);
      return { search: '', showArchived: false, showService: false };
    }
  }

  private async persistFilterState(): Promise<void> {
    try {
      await this.context.globalState.update(STATE_KEY, this.filterState);
    } catch (err) {
      console.warn('[UserManagerTreeProvider] Failed to persist filter state:', err);
    }
    await this.applyContextKeys();
  }

  private async applyContextKeys(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'computor.userManager.showArchived', this.filterState.showArchived);
    await vscode.commands.executeCommand('setContext', 'computor.userManager.showService', this.filterState.showService);
  }
}
