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
import type { RoleList } from '../../types/generated/roles';
import { notify } from '../../utils/notify';

interface UserManagementViewState {
  user?: UserGet;
  profile?: ProfileGet | null;
  studentProfiles: StudentProfileGet[];
  isAdmin: boolean;
  availableRoles: RoleList[];
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
      notify.error(`Failed to open user details: ${error?.message || error}`);
    }
  }

  protected async getWebviewContent(data?: UserManagementViewState): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('User Details', '<p>Loading…</p>');
    }

    return this.renderPage({
      title: 'User Management',
      bodyHtml: '<div id="app" class="page-root"></div>',
      cssFiles: ['admin/user-management.css'],
      scriptFiles: ['admin/user-management.js'],
      initialState: data ?? {}
    });
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
      case 'archiveUser':
        await this.handleArchiveToggle(true);
        break;
      case 'unarchiveUser':
        await this.handleArchiveToggle(false);
        break;
      case 'banUser':
        await this.handleBanToggle(true, message.data?.reason);
        break;
      case 'unbanUser':
        await this.handleBanToggle(false);
        break;
      case 'assignRole':
        await this.handleAssignRole(message.data);
        break;
      case 'revokeRole':
        await this.handleRevokeRole(message.data);
        break;
      default:
        break;
    }
  }

  private async loadState(userId: string, options?: { force?: boolean }): Promise<UserManagementViewState> {
    const [user, scopes, roles] = await Promise.all([
      this.apiService.getUserById(userId, options),
      this.apiService.getUserScopes(options).catch(() => undefined),
      this.apiService.listRoles().catch(() => [])
    ]);

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    return {
      user: user,
      profile: user.profile ?? null,
      studentProfiles: user.student_profiles ?? [],
      isAdmin: scopes?.is_admin === true,
      availableRoles: roles ?? []
    };
  }

  private async refreshState(options?: { force?: boolean; notice?: NoticeMessage }): Promise<void> {
    if (!this.panel || !this.currentUserId) {
      return;
    }

    try {
      const state = await this.loadState(this.currentUserId, { force: options?.force });
      this.currentData = state;
      this.panel.webview.postMessage({ command: 'updateState', data: state });
      if (options?.notice) { this.postNotice(options.notice); }

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

  private async handleAssignRole(raw: any): Promise<void> {
    if (!raw || typeof raw !== 'object' || !this.currentUserId) {
      return;
    }
    const roleId = typeof raw.role_id === 'string' ? raw.role_id.trim() : '';
    if (!roleId) {
      return;
    }
    try {
      await this.apiService.assignUserRole(this.currentUserId, roleId);
      await this.refreshState({ force: true, notice: { type: 'success', message: `Role "${roleId}" assigned.` } });
    } catch (error: any) {
      this.handleError(`Failed to assign role "${roleId}"`, error);
    }
  }

  private async handleRevokeRole(raw: any): Promise<void> {
    if (!raw || typeof raw !== 'object' || !this.currentUserId) {
      return;
    }
    const roleId = typeof raw.role_id === 'string' ? raw.role_id.trim() : '';
    if (!roleId) {
      return;
    }
    const confirmation = await notify.confirm(
      `Remove role "${roleId}" from this user?`,
      'Remove'
    );
    if (!confirmation) {
      return;
    }
    try {
      await this.apiService.revokeUserRole(this.currentUserId, roleId);
      await this.refreshState({ force: true, notice: { type: 'success', message: `Role "${roleId}" removed.` } });
    } catch (error: any) {
      this.handleError(`Failed to remove role "${roleId}"`, error);
    }
  }

  private async handleArchiveToggle(archive: boolean): Promise<void> {
    if (!this.currentUserId) {
      return;
    }

    const action = archive ? 'archive' : 'unarchive';
    const confirmation = await notify.confirm(
      archive
        ? 'Archive this user? They will be hidden from default lists and unable to authenticate.'
        : 'Unarchive this user? They will reappear in lists and regain access.',
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

  private async handleBanToggle(ban: boolean, reason?: string): Promise<void> {
    if (!this.currentUserId) {
      return;
    }

    const action = ban ? 'ban' : 'unban';
    const confirmation = await notify.confirm(
      ban
        ? 'Ban this user? They will be signed out and blocked from authenticating until unbanned.'
        : 'Unban this user? They will be able to sign in again.',
      ban ? 'Ban' : 'Unban'
    );

    if (!confirmation) {
      return;
    }

    try {
      if (ban) {
        await this.apiService.banUser(this.currentUserId, typeof reason === 'string' ? reason : undefined);
      } else {
        await this.apiService.unbanUser(this.currentUserId);
      }
      await this.refreshState({
        force: true,
        notice: { type: 'success', message: `User ${action}ned.` }
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
      this.postNotice({ type: 'error', message: 'Only administrators can edit name.' });
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

  private getUserDisplayName(user?: UserGet): string {
    if (!user) {
      return 'Unknown User';
    }

    if (user.given_name || user.family_name) {
      return `${user.given_name || ''} ${user.family_name || ''}`.trim();
    }

    return user.email || user.id;
  }

  private handleError(prefix: string, error: any): void {
    const detail = error?.message || error?.response?.data?.detail || error?.response?.data?.message || String(error);
    console.error(`[UserManagementWebview] ${prefix}:`, error);
    notify.error(`${prefix}: ${detail}`);
    this.postNotice({ type: 'error', message: `${prefix}: ${detail}` });
  }

  // Route in-page feedback through the unified native-notification helper
  // instead of an in-webview banner. Page-state banners (archived/banned) and
  // client-side inline validation remain in the webview.
  private postNotice(notice: NoticeMessage): void {
    if (notice.type === 'error') { notify.error(notice.message); }
    else if (notice.type === 'warning') { notify.warning(notice.message); }
    else { notify.info(notice.message); }
  }
}
