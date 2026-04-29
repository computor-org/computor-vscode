import * as vscode from 'vscode';
import { ComputorApiService } from '../services/ComputorApiService';
import { UserManagerTreeProvider } from '../ui/tree/user-manager/UserManagerTreeProvider';
import { UserManagementWebviewProvider } from '../ui/webviews/UserManagementWebviewProvider';
import { commandRegistrar } from './commandHelpers';

export class UserManagerCommands {
  private userManagementWebviewProvider: UserManagementWebviewProvider;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly treeProvider: UserManagerTreeProvider,
    apiService: ComputorApiService
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
  }

  private async handleRefresh(): Promise<void> {
    try {
      console.log('[UserManagerCommands] Refreshing user list...');
      this.treeProvider.refresh();
      vscode.window.showInformationMessage('User list refreshed');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to refresh users: ${error?.message || error}`);
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
        vscode.window.showWarningMessage('No user selected');
        return;
      }

      await this.userManagementWebviewProvider.open(userId);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open user details: ${error?.message || error}`);
    }
  }
}
