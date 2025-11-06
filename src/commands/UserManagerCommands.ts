import * as vscode from 'vscode';
import { ComputorApiService } from '../services/ComputorApiService';
import { UserManagerTreeProvider } from '../ui/tree/user-manager/UserManagerTreeProvider';
import { UserManagementWebviewProvider } from '../ui/webviews/UserManagementWebviewProvider';

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
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.userManager.refresh', async () => {
        await this.handleRefresh();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.userManager.openUserDetails', async (item?: any) => {
        await this.handleOpenUserDetails(item);
      })
    );
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
