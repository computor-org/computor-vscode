import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { UserManagerTreeProvider } from '../tree/user-manager/UserManagerTreeProvider';
import {
  UserGet,
  UserUpdate,
  ProfileGet,
  StudentProfileGet
} from '../../types/generated';

interface UserManagementViewState {
  user?: UserGet;
  profile?: ProfileGet | null;
  studentProfiles: StudentProfileGet[];
  canResetPassword: boolean;
  isAdmin: boolean;
}

type NoticeType = 'info' | 'success' | 'warning' | 'error';

interface NoticeMessage {
  type: NoticeType;
  message: string;
}

export class UserManagementWebviewProvider extends BaseWebviewProvider {
  private currentUserId?: string;

  constructor(
    context: vscode.ExtensionContext,
    private readonly apiService: ComputorApiService,
    private readonly treeProvider: UserManagerTreeProvider
  ) {
    super(context, 'computor.usermanager.userDetailsView');
  }

  async open(userId: string): Promise<void> {
    try {
      if (this.currentUserId !== userId && this.panel) {
        this.panel.dispose();
        this.panel = undefined;
      }

      this.currentUserId = userId;
      const state = await this.loadState(userId);
      const userDisplayName = this.getUserDisplayName(state.user);
      await this.show(`User: ${userDisplayName}`, state);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open user details: ${error?.message || error}`);
    }
  }

  protected async getWebviewContent(data?: UserManagementViewState): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('User Details', '<p>Loading…</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? {});
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'user-management.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'user-management.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>User Management</title>
      <link rel="stylesheet" href="${componentsCssUri}">
      <link rel="stylesheet" href="${stylesUri}">
    </head>
    <body>
      <div id="app" class="user-management-root"></div>
      <script nonce="${nonce}">
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${nonce}" src="${componentsJsUri}"></script>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }

  protected async handleMessage(message: any): Promise<void> {
    if (!message) {
      return;
    }

    switch (message.command) {
      case 'refresh':
        await this.refreshState({ force: true });
        break;
      case 'updateEmail':
        await this.handleUpdateEmail(message.data);
        break;
      case 'updateIdentity':
        await this.handleUpdateIdentity(message.data);
        break;
      case 'resetPassword':
        await this.handleResetPassword(message.data);
        break;
      case 'archiveUser':
        await this.handleArchiveToggle(true);
        break;
      case 'unarchiveUser':
        await this.handleArchiveToggle(false);
        break;
      default:
        break;
    }
  }

  private async loadState(userId: string, options?: { force?: boolean }): Promise<UserManagementViewState> {
    const [user, scopes] = await Promise.all([
      this.apiService.getUserById(userId, options),
      this.apiService.getUserScopes(options).catch(() => undefined)
    ]);

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    return {
      user: user,
      profile: user.profile ?? null,
      studentProfiles: user.student_profiles ?? [],
      canResetPassword: true,
      isAdmin: scopes?.is_admin === true
    };
  }

  private async refreshState(options?: { force?: boolean; notice?: NoticeMessage }): Promise<void> {
    if (!this.panel || !this.currentUserId) {
      return;
    }

    try {
      const state = await this.loadState(this.currentUserId, { force: options?.force });
      this.currentData = state;
      this.panel.webview.postMessage({ command: 'updateState', data: state, notice: options?.notice });

      this.treeProvider.refresh();
    } catch (error: any) {
      this.handleError('Failed to refresh user data', error);
    }
  }

  private async handleUpdateEmail(raw: any): Promise<void> {
    if (!raw || typeof raw !== 'object' || !this.currentUserId) {
      return;
    }

    const newEmail = raw.email?.trim();

    if (!newEmail) {
      this.postNotice({ type: 'warning', message: 'Email address cannot be empty.' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      this.postNotice({ type: 'warning', message: 'Please enter a valid email address.' });
      return;
    }

    try {
      const updates: UserUpdate = {
        email: newEmail
      };

      await this.apiService.updateUser(this.currentUserId, updates);
      await this.refreshState({ force: true, notice: { type: 'success', message: 'Email updated successfully.' } });
    } catch (error: any) {
      this.handleError('Failed to update email', error);
    }
  }

  private async handleArchiveToggle(archive: boolean): Promise<void> {
    if (!this.currentUserId) {
      return;
    }

    const action = archive ? 'archive' : 'unarchive';
    const confirmation = await vscode.window.showWarningMessage(
      archive
        ? 'Archive this user? They will be hidden from default lists and unable to authenticate.'
        : 'Unarchive this user? They will reappear in lists and regain access.',
      { modal: true },
      archive ? 'Archive' : 'Unarchive'
    );

    if (!confirmation) {
      return;
    }

    try {
      if (archive) {
        await this.apiService.archiveUser(this.currentUserId);
      } else {
        await this.apiService.unarchiveUser(this.currentUserId);
      }
      await this.refreshState({
        force: true,
        notice: { type: 'success', message: `User ${action}d.` }
      });
    } catch (error: any) {
      this.handleError(`Failed to ${action} user`, error);
    }
  }

  private async handleUpdateIdentity(raw: any): Promise<void> {
    if (!raw || typeof raw !== 'object' || !this.currentUserId) {
      return;
    }

    // Server enforces admin-only on these fields. We pre-gate the form so
    // non-admins never see editable inputs, but defend here too.
    const scopes = await this.apiService.getUserScopes().catch(() => undefined);
    if (!scopes?.is_admin) {
      this.postNotice({ type: 'error', message: 'Only administrators can edit name and username.' });
      return;
    }

    const updates: UserUpdate = {};
    let touched = false;
    if (typeof raw.given_name === 'string') {
      const value = raw.given_name.trim();
      updates.given_name = value || null;
      touched = true;
    }
    if (typeof raw.family_name === 'string') {
      const value = raw.family_name.trim();
      updates.family_name = value || null;
      touched = true;
    }
    if (typeof raw.username === 'string') {
      const value = raw.username.trim();
      if (!value) {
        this.postNotice({ type: 'warning', message: 'Username cannot be empty.' });
        return;
      }
      updates.username = value;
      touched = true;
    }

    if (!touched) {
      return;
    }

    try {
      await this.apiService.updateUser(this.currentUserId, updates);
      await this.refreshState({ force: true, notice: { type: 'success', message: 'Identity updated.' } });
    } catch (error: any) {
      this.handleError('Failed to update identity', error);
    }
  }

  private async handleResetPassword(raw: any): Promise<void> {
    if (!raw || typeof raw !== 'object' || !this.currentUserId) {
      return;
    }

    const managerPassword = raw.managerPassword?.trim();

    if (!managerPassword) {
      this.postNotice({ type: 'warning', message: 'Your password is required to perform this action.' });
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      'Are you sure you want to reset this user\'s password? This will set their password to NULL and they will need to set a new password.',
      { modal: true },
      'Yes, Reset Password',
      'Cancel'
    );

    if (confirmation !== 'Yes, Reset Password') {
      return;
    }

    try {
      await this.apiService.resetUserPassword(this.currentUserId, managerPassword);
      await this.refreshState({ force: true, notice: { type: 'success', message: 'Password reset successfully. User needs to set a new password.' } });
      vscode.window.showInformationMessage('Password reset successfully.');
    } catch (error: any) {
      this.handleError('Failed to reset password', error);
    }
  }

  private getUserDisplayName(user?: UserGet): string {
    if (!user) {
      return 'Unknown User';
    }

    if (user.given_name || user.family_name) {
      return `${user.given_name || ''} ${user.family_name || ''}`.trim();
    }

    return user.email || user.username || user.id;
  }

  private handleError(prefix: string, error: any): void {
    const detail = error?.message || error?.response?.data?.detail || error?.response?.data?.message || String(error);
    console.error(`[UserManagementWebview] ${prefix}:`, error);
    vscode.window.showErrorMessage(`${prefix}: ${detail}`);
    this.postNotice({ type: 'error', message: `${prefix}: ${detail}` });
  }

  private postNotice(notice: NoticeMessage): void {
    if (this.panel) {
      this.panel.webview.postMessage({ command: 'notice', notice });
    }
  }
}
