import * as vscode from 'vscode';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { UserList } from '../../../types/generated/users';

class UserTreeItem extends vscode.TreeItem {
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

    this.contextValue = 'user';
    this.tooltip = this.buildTooltip();
    this.description = user.email || user.username || '';
    this.iconPath = new vscode.ThemeIcon('account');
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

export class UserManagerTreeProvider implements vscode.TreeDataProvider<UserTreeItem> {
  private onDidChangeTreeDataEmitter = new vscode.EventEmitter<UserTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private users: UserList[] = [];

  constructor(
    private readonly apiService: ComputorApiService,
    context: vscode.ExtensionContext
  ) {
    void context;
  }

  refresh(): void {
    this.users = [];
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: UserTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: UserTreeItem): Promise<UserTreeItem[]> {
    if (element) {
      return [];
    }

    try {
      if (this.users.length === 0) {
        await this.loadUsers();
      }

      return this.users.map(user => new UserTreeItem(
        user,
        vscode.TreeItemCollapsibleState.None
      ));
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to load users: ${error?.message || error}`);
      return [];
    }
  }

  private async loadUsers(): Promise<void> {
    try {
      const allUsers = await this.apiService.getUsers({ force: true });

      if (!allUsers || allUsers.length === 0) {
        this.users = [];
        return;
      }

      this.users = allUsers.sort((a, b) => {
        const aFamily = (a.family_name || '').toLowerCase();
        const bFamily = (b.family_name || '').toLowerCase();

        if (aFamily !== bFamily) {
          return aFamily.localeCompare(bFamily);
        }

        const aGiven = (a.given_name || '').toLowerCase();
        const bGiven = (b.given_name || '').toLowerCase();

        return aGiven.localeCompare(bGiven);
      });
    } catch (error) {
      console.error('[UserManagerTreeProvider] Failed to load users:', error);
      throw error;
    }
  }

  getUserById(userId: string): UserList | undefined {
    return this.users.find(u => u.id === userId);
  }
}
