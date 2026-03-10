import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseMemberGet, CourseList, CourseGroupGet, CourseRoleList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { SHARED_STYLES } from './shared/webviewStyles';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, selectInput, pageShell } from './shared/webviewHelpers';

export class CourseMemberWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService, treeDataProvider?: LecturerTreeDataProvider) {
    super(context, 'computor.courseMemberView');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  protected async getWebviewContent(data?: {
    member: CourseMemberGet;
    course?: CourseList;
    group?: CourseGroupGet | null;
    role?: CourseRoleList;
    availableGroups?: CourseGroupGet[];
    availableRoles?: CourseRoleList[];
  }): Promise<string> {
    if (!data?.member) {
      return this.getBaseHtml('Course Member', '<p>No course member data available</p>');
    }

    const { member, course, group, role, availableGroups, availableRoles } = data;
    const nonce = this.getNonce();
    const user = member.user;
    const displayName = user ? `${user.given_name || ''} ${user.family_name || ''}`.trim() || user.username : member.user_id;

    const headerHtml = `
      <h1>${escapeHtml(displayName)}</h1>
      <p>Course Member${course ? ` in ${escapeHtml(course.title || course.path)}` : ''}</p>`;

    const infoHtml = section('Member Information', `
      ${infoRowCode('ID', member.id)}
      ${user ? infoRowText('Username', user.username) : ''}
      ${user ? infoRowText('Email', user.email) : ''}
      ${infoRowText('Role', role?.title || member.course_role_id)}
      ${infoRowText('Group', group?.title || (member.course_group_id ? member.course_group_id : 'No Group'))}
      ${course ? infoRowText('Course', course.title || course.path) : ''}
    `);

    const roleOptions = (availableRoles || []).map(r => ({ value: r.id, label: r.title || r.id }));
    const groupOptions = [
      { value: '', label: 'No Group' },
      ...(availableGroups || []).map(g => ({ value: g.id, label: g.title || g.id }))
    ];

    const editHtml = section('Edit Member', `
      <form id="editForm">
        ${formGroup('Role', selectInput('courseRoleId', roleOptions, member.course_role_id))}
        ${formGroup('Group', selectInput('courseGroupId', groupOptions, member.course_group_id || ''))}
        <div class="actions">
          <button type="submit">Save Changes</button>
          <button type="button" class="btn-secondary" onclick="refreshData()">Refresh</button>
        </div>
      </form>
    `);

    const scriptHtml = `
      const memberId = ${JSON.stringify(member.id)};

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        var groupVal = document.getElementById('courseGroupId').value;
        vscode.postMessage({
          command: 'updateCourseMember',
          data: {
            memberId: memberId,
            updates: {
              course_role_id: document.getElementById('courseRoleId').value,
              course_group_id: groupVal || null
            }
          }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { memberId: memberId } });
      }

      window.addEventListener('message', function(event) {
        if (event.data.command === 'updateState') { location.reload(); }
      });
    `;

    return pageShell(nonce, 'Course Member', headerHtml, infoHtml + editHtml, scriptHtml, SHARED_STYLES);
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateCourseMember':
        try {
          await this.apiService.updateCourseMember(message.data.memberId, message.data.updates);
          vscode.window.showInformationMessage('Course member updated successfully');

          if (this.treeDataProvider) {
            await this.treeDataProvider.refresh();
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to update course member: ${error}`);
        }
        break;

      case 'refresh':
        if (message.data.memberId && this.panel) {
          try {
            const member = await this.apiService.getCourseMember(message.data.memberId);
            if (member) {
              this.currentData = { ...this.currentData, member };
              this.panel.webview.html = await this.getWebviewContent(this.currentData);
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh: ${error}`);
          }
        }
        break;
    }
  }
}
