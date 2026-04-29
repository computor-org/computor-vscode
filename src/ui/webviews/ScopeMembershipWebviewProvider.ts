import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { canManageScopeMembership } from '../../services/ScopePermissions';
import type { UserList } from '../../types/generated/users';

export type ScopeKind = 'organization' | 'course_family';

export interface ScopeMembershipTarget {
  kind: ScopeKind;
  scopeId: string;
  scopeTitle: string;
  /** Optional secondary line for the header (e.g. parent organization name). */
  scopeSubtitle?: string;
}

interface NormalizedMember {
  id: string;
  user_id: string;
  role_id: string;
  user?: UserList | null;
}

interface NormalizedRole {
  id: string;
  title?: string | null;
}

interface ScopeMembershipViewState {
  target: ScopeMembershipTarget;
  members: NormalizedMember[];
  availableRoles: NormalizedRole[];
  canManage: boolean;
}

type NoticeType = 'info' | 'success' | 'warning' | 'error';

interface NoticeMessage {
  type: NoticeType;
  message: string;
}

export class ScopeMembershipWebviewProvider extends BaseWebviewProvider {
  private currentTarget?: ScopeMembershipTarget;

  constructor(context: vscode.ExtensionContext, private readonly apiService: ComputorApiService) {
    super(context, 'computor.usermanager.scopeMembershipView');
  }

  async open(target: ScopeMembershipTarget): Promise<void> {
    try {
      // Re-create the panel if the scope changed so cached state doesn't bleed across panels.
      if (this.panel && this.currentTarget && (this.currentTarget.kind !== target.kind || this.currentTarget.scopeId !== target.scopeId)) {
        this.panel.dispose();
        this.panel = undefined;
      }
      this.currentTarget = target;
      const state = await this.loadState(target);
      const title = `${target.kind === 'organization' ? 'Organization' : 'Course Family'} members: ${target.scopeTitle}`;
      await this.show(title, state);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open members panel: ${error?.message || error}`);
    }
  }

  protected async getWebviewContent(data?: ScopeMembershipViewState): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Members', '<p>Loading…</p>');
    }
    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? null);
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'scope-membership.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'scope-membership.js');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
  <title>Members</title>
  <link rel="stylesheet" href="${componentsCssUri}">
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
  <div id="app" class="scope-membership-root"></div>
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
    if (!message || !this.currentTarget) {
      return;
    }
    switch (message.command) {
      case 'refresh':
        await this.refreshState();
        break;
      case 'addMember':
        await this.handleAddMember(message.data);
        break;
      case 'browseAndAdd':
        await this.handleBrowseAndAdd(message.data);
        break;
      case 'changeRole':
        await this.handleChangeRole(message.data);
        break;
      case 'removeMember':
        await this.handleRemoveMember(message.data);
        break;
      default:
        break;
    }
  }

  // ----- State loading -----

  private async loadState(target: ScopeMembershipTarget): Promise<ScopeMembershipViewState> {
    const [members, roles, scopes, currentUser] = await Promise.all([
      this.fetchMembers(target),
      this.fetchRoles(target),
      this.apiService.getUserScopes().catch(() => undefined),
      this.apiService.getUserAccount().catch(() => undefined)
    ]);

    const globalRoles = new Set(
      (currentUser?.user_roles ?? [])
        .map(r => r?.role_id)
        .filter((id): id is string => typeof id === 'string')
    );
    const canManage = canManageScopeMembership(target.kind, target.scopeId, { scopes, globalRoles });

    return {
      target,
      members,
      availableRoles: roles,
      canManage
    };
  }

  private async refreshState(notice?: NoticeMessage): Promise<void> {
    if (!this.currentTarget || !this.panel) { return; }
    try {
      const state = await this.loadState(this.currentTarget);
      this.currentData = state;
      this.panel.webview.postMessage({ command: 'updateState', data: state, notice });
    } catch (error: any) {
      this.handleError('Failed to refresh members', error);
    }
  }

  private async fetchMembers(target: ScopeMembershipTarget): Promise<NormalizedMember[]> {
    if (target.kind === 'organization') {
      const list = await this.apiService.listOrganizationMembers(target.scopeId);
      return list.map(m => ({
        id: m.id,
        user_id: m.user_id,
        role_id: m.organization_role_id,
        user: m.user
      }));
    }
    const list = await this.apiService.listCourseFamilyMembers(target.scopeId);
    return list.map(m => ({
      id: m.id,
      user_id: m.user_id,
      role_id: m.course_family_role_id,
      user: m.user
    }));
  }

  private async fetchRoles(target: ScopeMembershipTarget): Promise<NormalizedRole[]> {
    if (target.kind === 'organization') {
      const list = await this.apiService.listOrganizationRoles();
      return list.map(r => ({ id: r.id, title: r.title }));
    }
    const list = await this.apiService.listCourseFamilyRoles();
    return list.map(r => ({ id: r.id, title: r.title }));
  }

  // ----- Mutations -----

  private async handleAddMember(raw: any): Promise<void> {
    if (!this.currentTarget || !raw || typeof raw !== 'object') { return; }
    const roleId = typeof raw.role_id === 'string' ? raw.role_id.trim() : '';
    if (!roleId) {
      this.postNotice({ type: 'warning', message: 'Pick a role.' });
      return;
    }

    let userId = typeof raw.user_id === 'string' ? raw.user_id.trim() : '';
    const identifier = typeof raw.identifier === 'string' ? raw.identifier.trim() : '';

    if (!userId && identifier) {
      try {
        userId = await this.resolveUserIdentifier(identifier) ?? '';
      } catch (error: any) {
        this.handleError('Failed to look up user', error);
        return;
      }
      if (!userId) {
        this.postNotice({ type: 'warning', message: `No user found for "${identifier}".` });
        return;
      }
    }

    if (!userId) {
      this.postNotice({ type: 'warning', message: 'Provide an email/username or pick from the list.' });
      return;
    }

    await this.createMember(userId, roleId);
  }

  private async handleBrowseAndAdd(raw: any): Promise<void> {
    if (!this.currentTarget || !raw || typeof raw !== 'object') { return; }
    const roleId = typeof raw.role_id === 'string' ? raw.role_id.trim() : '';
    if (!roleId) {
      this.postNotice({ type: 'warning', message: 'Pick a role first.' });
      return;
    }

    let users: UserList[] = [];
    try {
      users = await this.apiService.getUsers();
    } catch (error: any) {
      this.handleError('Cannot browse users (you may lack permission). Try email or username.', error);
      return;
    }
    if (!users || users.length === 0) {
      this.postNotice({ type: 'info', message: 'No users available to browse.' });
      return;
    }

    const memberUserIds = new Set((this.currentData as ScopeMembershipViewState | undefined)?.members.map(m => m.user_id) ?? []);
    const candidates = users
      .filter(u => !u.archived_at && !u.is_service && !memberUserIds.has(u.id))
      .sort((a, b) => formatUserLabel(a).localeCompare(formatUserLabel(b)));
    if (candidates.length === 0) {
      this.postNotice({ type: 'info', message: 'No additional users available to add.' });
      return;
    }

    const picked = await vscode.window.showQuickPick(
      candidates.map(u => ({
        label: formatUserLabel(u),
        description: u.email || u.username || '',
        detail: u.username && u.email ? `@${u.username}` : undefined,
        userId: u.id
      })),
      {
        placeHolder: 'Select a user to add',
        matchOnDescription: true,
        matchOnDetail: true
      }
    );
    if (!picked) { return; }

    await this.createMember(picked.userId, roleId);
  }

  private async resolveUserIdentifier(identifier: string): Promise<string | undefined> {
    // Try exact email then exact username via the standard /users filter
    // params. Both calls fail-soft — the Add Member flow surfaces a
    // friendly "no user found" notice if both come back empty.
    try {
      const matches = await this.apiService.findUsers({ email: identifier });
      if (matches.length > 0 && matches[0]?.id) {
        return matches[0].id;
      }
    } catch (err) {
      console.warn('[ScopeMembershipWebview] email lookup failed:', err);
    }
    try {
      const matches = await this.apiService.findUsers({ username: identifier });
      if (matches.length > 0 && matches[0]?.id) {
        return matches[0].id;
      }
    } catch (err) {
      console.warn('[ScopeMembershipWebview] username lookup failed:', err);
    }
    return undefined;
  }

  private async createMember(userId: string, roleId: string): Promise<void> {
    if (!this.currentTarget) { return; }
    try {
      if (this.currentTarget.kind === 'organization') {
        await this.apiService.createOrganizationMember({
          user_id: userId,
          organization_id: this.currentTarget.scopeId,
          organization_role_id: roleId
        });
      } else {
        await this.apiService.createCourseFamilyMember({
          user_id: userId,
          course_family_id: this.currentTarget.scopeId,
          course_family_role_id: roleId
        });
      }
      await this.refreshState({ type: 'success', message: 'Member added.' });
    } catch (error: any) {
      this.handleError('Failed to add member', error);
    }
  }

  private async handleChangeRole(raw: any): Promise<void> {
    if (!this.currentTarget || !raw || typeof raw !== 'object') { return; }
    const memberId = typeof raw.member_id === 'string' ? raw.member_id : '';
    const roleId = typeof raw.role_id === 'string' ? raw.role_id : '';
    if (!memberId || !roleId) { return; }
    try {
      if (this.currentTarget.kind === 'organization') {
        await this.apiService.updateOrganizationMember(memberId, { organization_role_id: roleId });
      } else {
        await this.apiService.updateCourseFamilyMember(memberId, { course_family_role_id: roleId });
      }
      await this.refreshState({ type: 'success', message: 'Role updated.' });
    } catch (error: any) {
      this.handleError('Failed to update role', error);
    }
  }

  private async handleRemoveMember(raw: any): Promise<void> {
    if (!this.currentTarget || !raw || typeof raw !== 'object') { return; }
    const memberId = typeof raw.member_id === 'string' ? raw.member_id : '';
    if (!memberId) { return; }

    const confirmation = await vscode.window.showWarningMessage(
      'Remove this user from the scope?',
      { modal: true },
      'Remove'
    );
    if (confirmation !== 'Remove') { return; }

    try {
      if (this.currentTarget.kind === 'organization') {
        await this.apiService.deleteOrganizationMember(memberId);
      } else {
        await this.apiService.deleteCourseFamilyMember(memberId);
      }
      await this.refreshState({ type: 'success', message: 'Member removed.' });
    } catch (error: any) {
      this.handleError('Failed to remove member', error);
    }
  }

  // ----- Helpers -----

  private handleError(prefix: string, error: any): void {
    const detail = error?.message || error?.response?.data?.detail || error?.response?.data?.message || String(error);
    console.error(`[ScopeMembershipWebview] ${prefix}:`, error);
    vscode.window.showErrorMessage(`${prefix}: ${detail}`);
    this.postNotice({ type: 'error', message: `${prefix}: ${detail}` });
  }

  private postNotice(notice: NoticeMessage): void {
    if (this.panel) {
      this.panel.webview.postMessage({ command: 'notice', notice });
    }
  }
}

function formatUserLabel(user: UserList): string {
  const family = user.family_name || '';
  const given = user.given_name || '';
  if (family && given) { return `${family}, ${given}`; }
  return family || given || user.username || user.email || user.id;
}
