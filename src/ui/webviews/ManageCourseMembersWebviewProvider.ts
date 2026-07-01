import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseMemberList, CourseGroupList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';

// Course role hierarchy mirrored from the backend (permissions/roles.py +
// principal.py). Used for UI gating only — the backend still enforces the
// assignment ceiling on every create/update/delete.
const COURSE_ROLES = ['_student', '_tutor', '_lecturer', '_maintainer', '_owner'];
const ROLE_RANK: Record<string, number> = {
  _student: 1,
  _tutor: 2,
  _lecturer: 3,
  _maintainer: 4,
  _owner: 5,
};
const ROLE_LABEL: Record<string, string> = {
  _student: 'Student',
  _tutor: 'Tutor',
  _lecturer: 'Lecturer',
  _maintainer: 'Maintainer',
  _owner: 'Owner',
};

const USERS_PAGE_SIZE = 10;

function rank(roleId?: string | null): number {
  return roleId ? ROLE_RANK[roleId] ?? 0 : 0;
}

function highestRole(roleIds: string[]): string | null {
  let best: string | null = null;
  for (const r of roleIds) {
    if (rank(r) > rank(best)) best = r;
  }
  return best;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface MemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  group: string;
  isSelf: boolean;
  manageable: boolean;
}

/**
 * "Manage Members" panel for a course (lecturer tree → course node). Shows the
 * roster with inline role change + remove, plus an add section (searchable,
 * paged user table and an add-by-email form). Distinct from the Groups-folder
 * "Show Members" bulk importer, which is left untouched.
 */
export class ManageCourseMembersWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;
  private courseId?: string;
  private groups: CourseGroupList[] = [];
  private ceiling: string | null = null;
  private assignableRoles: string[] = [];
  private canManage = false;
  private currentUserId?: string;

  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService,
    treeDataProvider?: LecturerTreeDataProvider
  ) {
    super(context, 'computor.manageCourseMembers');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  async open(courseId: string, courseName?: string): Promise<void> {
    this.courseId = courseId;

    // Compute the caller's assignment ceiling for this course (admin and
    // organization managers are uncapped → _owner; otherwise their highest
    // course role). Mirrors the backend rule; used only for UI gating.
    try {
      const [scopes, account] = await Promise.all([
        this.apiService.getUserScopes(),
        this.apiService.getUserAccount(),
      ]);
      const userRoleIds = (account?.user_roles ?? []).map((r) => r.role_id);
      const isAdmin = !!scopes?.is_admin || userRoleIds.includes('_admin');
      const isOrgManager = userRoleIds.includes('_organization_manager');
      const courseRoleIds = scopes?.course?.[courseId] ?? [];
      this.ceiling = isAdmin || isOrgManager ? '_owner' : highestRole(courseRoleIds);
      this.currentUserId = account?.id || this.apiService.getCurrentUserId();
    } catch {
      this.ceiling = null;
      this.currentUserId = this.apiService.getCurrentUserId();
    }
    this.canManage = rank(this.ceiling) >= rank('_lecturer');
    this.assignableRoles = this.canManage
      ? COURSE_ROLES.filter((r) => rank(r) <= rank(this.ceiling))
      : [];

    const members = await this.loadMembers();

    await this.show(`Members: ${courseName || 'Course'}`, {
      courseId,
      courseName: courseName || 'Course',
      members,
      canManage: this.canManage,
      assignableRoles: this.assignableRoles,
      roleLabels: ROLE_LABEL,
      usersPageSize: USERS_PAGE_SIZE,
    });
  }

  private async loadMembers(): Promise<MemberRow[]> {
    if (!this.courseId) return [];
    const [membersRes, groupsRes] = await Promise.allSettled([
      this.apiService.getCourseMembers(this.courseId),
      this.apiService.getCourseGroups(this.courseId),
    ]);
    const raw: CourseMemberList[] = membersRes.status === 'fulfilled' ? membersRes.value : [];
    this.groups = groupsRes.status === 'fulfilled' ? groupsRes.value : [];
    return raw
      .map((m) => this.toRow(m))
      .sort((a, b) => rank(b.roleId) - rank(a.roleId) || a.name.localeCompare(b.name));
  }

  private toRow(m: CourseMemberList): MemberRow {
    const name =
      `${m.user?.given_name ?? ''} ${m.user?.family_name ?? ''}`.trim() ||
      m.user?.email ||
      m.user_id;
    let group = '';
    if (m.course_group_id) {
      group = this.groups.find((g) => g.id === m.course_group_id)?.title || '';
    }
    const isSelf = !!this.currentUserId && this.currentUserId === m.user_id;
    // Mirror the backend: you can only manage members strictly below your ceiling.
    const manageable = this.canManage && !isSelf && rank(m.course_role_id) < rank(this.ceiling);
    return {
      id: m.id,
      userId: m.user_id,
      name,
      email: m.user?.email || '',
      roleId: m.course_role_id,
      group,
      isSelf,
      manageable,
    };
  }

  private async refreshAndPostMembers(): Promise<void> {
    const members = await this.loadMembers();
    await this.panel?.webview.postMessage({ command: 'membersUpdated', data: { members } });
    this.treeDataProvider?.refresh();
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message?.command) {
      case 'searchUsers':
        return this.handleSearchUsers(message.data);
      case 'addMember':
        return this.handleAddMember(message.data);
      case 'changeRole':
        return this.handleChangeRole(message.data);
      case 'removeMember':
        return this.handleRemoveMember(message.data);
      case 'importByEmail':
        return this.handleImportByEmail(message.data);
      case 'pickImportFile':
        return this.handlePickImportFile();
      case 'importFileRow':
        return this.handleImportFileRow(message.data);
      case 'refresh':
        return this.refreshAndPostMembers();
      case 'showError':
        vscode.window.showErrorMessage(message.data?.message || 'Error');
        return;
      default:
        return;
    }
  }

  private async handleSearchUsers(data: any): Promise<void> {
    const page = Math.max(0, Number(data?.page) || 0);
    const search = (data?.search || '').trim();
    try {
      const users = await this.apiService.searchUsers({
        search: search || undefined,
        skip: page * USERS_PAGE_SIZE,
        limit: USERS_PAGE_SIZE,
      });
      await this.panel?.webview.postMessage({
        command: 'usersResult',
        data: {
          search,
          page,
          hasNext: users.length === USERS_PAGE_SIZE,
          users: users.map((u) => ({
            id: u.id,
            name: `${u.given_name ?? ''} ${u.family_name ?? ''}`.trim() || u.email || u.id,
            email: u.email || '',
          })),
        },
      });
    } catch (e) {
      await this.panel?.webview.postMessage({
        command: 'usersResult',
        data: { search, page, hasNext: false, users: [], error: errMessage(e) },
      });
    }
  }

  private async handleAddMember(data: any): Promise<void> {
    if (!this.courseId || !data?.userId || !data?.roleId) return;
    try {
      await this.apiService.createCourseMember({
        user_id: data.userId,
        course_id: this.courseId,
        course_role_id: data.roleId,
      });
      await this.panel?.webview.postMessage({
        command: 'addResult',
        data: { userId: data.userId, ok: true },
      });
      await this.refreshAndPostMembers();
    } catch (e) {
      await this.panel?.webview.postMessage({
        command: 'addResult',
        data: { userId: data.userId, ok: false, message: errMessage(e) },
      });
    }
  }

  private async handleChangeRole(data: any): Promise<void> {
    if (!data?.memberId || !data?.roleId) return;
    try {
      await this.apiService.updateCourseMember(data.memberId, { course_role_id: data.roleId });
      await this.refreshAndPostMembers();
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to change role: ${errMessage(e)}`);
      // Re-sync the UI to the server's truth.
      await this.refreshAndPostMembers();
    }
  }

  private async handleRemoveMember(data: any): Promise<void> {
    if (!data?.memberId) return;
    const confirm = await vscode.window.showWarningMessage(
      `Remove ${data.name || 'this member'} from the course? Their account is not affected.`,
      { modal: true },
      'Remove'
    );
    if (confirm !== 'Remove') return;
    try {
      await this.apiService.deleteCourseMember(data.memberId);
      await this.refreshAndPostMembers();
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to remove member: ${errMessage(e)}`);
    }
  }

  private async handleImportByEmail(data: any): Promise<void> {
    if (!this.courseId || !data?.email) return;
    try {
      const res = await this.apiService.importSingleCourseMember(
        this.courseId,
        {
          email: String(data.email).trim(),
          given_name: data.given_name?.trim() || null,
          family_name: data.family_name?.trim() || null,
          course_group_title: data.course_group_title?.trim() || null,
          course_role_id: data.course_role_id,
        },
        { createMissingGroup: true, updateIfExists: true }
      );
      await this.panel?.webview.postMessage({
        command: 'importResult',
        data: {
          ok: !!res.success,
          message: res.message || (res.success ? 'Member added.' : 'Import failed.'),
          workflowId: res.workflow_id,
        },
      });
      if (res.success) await this.refreshAndPostMembers();
    } catch (e) {
      await this.panel?.webview.postMessage({
        command: 'importResult',
        data: { ok: false, message: errMessage(e) },
      });
    }
  }

  private async handlePickImportFile(): Promise<void> {
    if (!this.courseId) return;
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Select member file',
      filters: { 'Member lists': ['csv', 'tsv', 'txt', 'json', 'xlsx', 'xls', 'xml'] },
    });
    const uri = picked && picked[0];
    if (!uri) return;
    const filename = uri.path.split('/').pop() || 'members';
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const contentBase64 = Buffer.from(bytes).toString('base64');
      const res = await this.apiService.parseCourseMemberFile(this.courseId, filename, contentBase64);
      await this.panel?.webview.postMessage({
        command: 'parsedRows',
        data: { filename, rows: res.rows || [] },
      });
    } catch (e) {
      await this.panel?.webview.postMessage({
        command: 'parsedRows',
        data: { filename, rows: [], error: errMessage(e) },
      });
    }
  }

  private async handleImportFileRow(data: any): Promise<void> {
    const member = data?.member;
    if (!this.courseId || !member?.email) return;
    try {
      const res = await this.apiService.importSingleCourseMember(
        this.courseId,
        {
          email: String(member.email).trim(),
          given_name: member.given_name?.trim() || null,
          family_name: member.family_name?.trim() || null,
          course_group_title: member.course_group_title?.trim() || null,
          course_role_id: member.course_role_id,
        },
        { createMissingGroup: true, updateIfExists: true }
      );
      await this.panel?.webview.postMessage({
        command: 'fileRowResult',
        data: { index: data.index, ok: !!res.success, message: res.message },
      });
    } catch (e) {
      await this.panel?.webview.postMessage({
        command: 'fileRowResult',
        data: { index: data.index, ok: false, message: errMessage(e) },
      });
    }
  }

  protected async getWebviewContent(data?: any): Promise<string> {
    if (!this.panel) return '';
    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? {});
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'manage-course-members.css');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'manage-course-members.js');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Manage Members</title>
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
  <div id="app" class="members-container">
    <div class="loading">Loading members…</div>
  </div>
  <script nonce="${nonce}">
    window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
    window.__INITIAL_STATE__ = ${initialState};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
