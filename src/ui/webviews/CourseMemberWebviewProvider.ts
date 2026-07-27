import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseMemberGet, CourseList, CourseGroupGet, CourseRoleList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, selectInput, detailGrid } from './shared/webviewHelpers';
import { notify } from '../../utils/notify';

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

    const { member, course, availableGroups, availableRoles } = data;
    const user = member.user;
    const displayName = user ? `${user.given_name || ''} ${user.family_name || ''}`.trim() || user.email : member.user_id;

    const headerHtml = `
      <h1>${escapeHtml(displayName)}</h1>
      <p>Course Member${course ? ` in ${escapeHtml(course.title || course.path)}` : ''}</p>`;

    const roleOptions = (availableRoles || []).map(r => ({ value: r.id, label: r.title || r.id }));
    const groupOptions = [
      { value: '', label: 'No Group' },
      ...(availableGroups || []).map(g => ({ value: g.id, label: g.title || g.id }))
    ];

    // Role and Group are editable below, so they are not repeated as facts.
    const detailsHtml = section('Member', `
      ${detailGrid(`
        ${infoRowCode('ID', member.id)}
        ${user ? infoRowText('Email', user.email) : ''}
        ${course ? infoRowText('Course', course.title || course.path) : ''}
      `)}
      <form id="editForm">
        ${formGroup('Role', selectInput('courseRoleId', roleOptions, member.course_role_id))}
        ${formGroup('Group', selectInput('courseGroupId', groupOptions, member.course_group_id || ''))}
        <div class="actions">
          <button type="submit">Save Changes</button>
          <button type="button" class="btn-secondary" data-action="refreshData">Refresh</button>
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

      ComputorWebview.registerActions({ refreshData: refreshData });
      ComputorWebview.onCommand('updateState', function() { location.reload(); });
    `;

    return this.renderPage({ title: 'Course Member', headerHtml, bodyHtml: detailsHtml, inlineScript: scriptHtml });
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateCourseMember':
        try {
          await this.apiService.updateCourseMember(message.data.memberId, message.data.updates);
          notify.info('Course member updated successfully');

          if (this.treeDataProvider) {
            await this.treeDataProvider.refresh();
          }
        } catch (error) {
          notify.error(`Failed to update course member: ${error}`);
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
            notify.error(`Failed to refresh: ${error}`);
          }
        }
        break;
    }
  }
}
