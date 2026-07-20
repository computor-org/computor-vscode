import * as vscode from 'vscode';
import { ComputorApiService } from '../services/ComputorApiService';
import { UserManagerTreeProvider } from '../ui/tree/user-manager/UserManagerTreeProvider';
import { UserManagementWebviewProvider } from '../ui/webviews/UserManagementWebviewProvider';
import { commandRegistrar } from './commandHelpers';
import { notify } from '../utils/notify';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class UserManagerCommands {
  private userManagementWebviewProvider: UserManagementWebviewProvider;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly treeProvider: UserManagerTreeProvider,
    private readonly apiService: ComputorApiService
  ) {
    this.userManagementWebviewProvider = new UserManagementWebviewProvider(
      context,
      apiService,
      treeProvider
    );
  }

  registerCommands(): void {

    const register = commandRegistrar(this.context);
    register('computor.userManager.refresh', async () => {
      await this.handleRefresh();
    });

    register('computor.userManager.openUserDetails', async (item?: any) => {
      await this.handleOpenUserDetails(item);
    });

    register('computor.userManager.searchUsers', async () => {
      const currentQuery = this.treeProvider.getSearchQuery();
      const query = await vscode.window.showInputBox({
        prompt: 'Search users by name, email, or username',
        placeHolder: 'Enter search query',
        value: currentQuery
      });
      if (query !== undefined) {
        this.treeProvider.setSearchQuery(query);
      }
    });

    register('computor.userManager.clearSearch', () => {
      this.treeProvider.clearSearch();
    });

    register('computor.userManager.toggleArchived', () => {
      this.treeProvider.toggleShowArchived();
    });

    register('computor.userManager.toggleService', () => {
      this.treeProvider.toggleShowService();
    });

    register('computor.userManager.createUser', async () => {
      await this.handleCreateUser();
    });
  }

  private async handleCreateUser(): Promise<void> {
    const email = await vscode.window.showInputBox({
      title: 'New user (1/3): Email',
      prompt: 'Required. Must be a valid email.',
      validateInput: (value) => {
        const trimmed = (value ?? '').trim();
        if (!trimmed) { return 'Email is required.'; }
        if (!EMAIL_REGEX.test(trimmed)) { return 'Enter a valid email address.'; }
        return undefined;
      }
    });
    if (email === undefined) { return; }

    const givenName = await vscode.window.showInputBox({
      title: 'New user (2/3): Given name',
      prompt: 'Optional.'
    });
    if (givenName === undefined) { return; }

    const familyName = await vscode.window.showInputBox({
      title: 'New user (3/3): Family name',
      prompt: 'Optional.'
    });
    if (familyName === undefined) { return; }

    try {
      const created = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: false,
          title: `Creating user ${email.trim()}…`
        },
        () => this.apiService.createUser({
          email: email.trim(),
          given_name: givenName.trim() || null,
          family_name: familyName.trim() || null
        })
      );
      notify.info(`User ${created.email || created.id} created.`);
      this.treeProvider.refresh();
      await this.userManagementWebviewProvider.open(created.id);
    } catch (error: any) {
      const detail = error?.message || error?.response?.data?.detail || String(error);
      notify.error(`Failed to create user: ${detail}`);
    }
  }

  private async handleRefresh(): Promise<void> {
    try {
      console.log('[UserManagerCommands] Refreshing user list...');
      this.treeProvider.refresh();
      notify.info('User list refreshed');
    } catch (error: any) {
      notify.error(`Failed to refresh users: ${error?.message || error}`);
    }
  }

  private async handleOpenUserDetails(item?: any): Promise<void> {
    try {
      let userId: string | undefined;

      if (item?.user?.id) {
        userId = item.user.id;
      } else if (typeof item === 'string') {
        userId = item;
      }

      if (!userId) {
        notify.warning('No user selected');
        return;
      }

      await this.userManagementWebviewProvider.open(userId);
    } catch (error: any) {
      notify.error(`Failed to open user details: ${error?.message || error}`);
    }
  }
}
