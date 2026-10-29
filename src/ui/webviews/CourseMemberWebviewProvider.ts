import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseMemberGet, CourseList, CourseGroupGet, CourseRoleList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, selectInput, detailGrid } from './shared/webviewHelpers';
import { notify } from '../../utils/notify';
import { say } from '../../utils/uiLanguage';
import { localizedRoleTitle } from '../../utils/roleLabels';

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
      return this.getBaseHtml(say('Course Member', 'Kursmitglied'), say('<p>No course member data available</p>', '<p>Keine Daten zum Kursmitglied verfügbar</p>'));
    }

    const { member, course, availableGroups, availableRoles } = data;
    const user = member.user;
    const displayName = user ? `${user.given_name || ''} ${user.family_name || ''}`.trim() || user.email : member.user_id;

    const headerHtml = `
      <h1>${escapeHtml(displayName)}</h1>
      <p>${say('Course Member', 'Kursmitglied')}${course ? ` ${say('in', 'in')} ${escapeHtml(course.title || course.path)}` : ''}</p>`;

    const roleOptions = (availableRoles || []).map(r => ({ value: r.id, label: localizedRoleTitle(r.id, r.title) }));
    const groupOptions = [
      { value: '', label: say('No Group', 'Ohne Gruppe') },
      ...(availableGroups || []).map(g => ({ value: g.id, label: g.title || g.id }))
    ];

    // Role and Group are editable below, so they are not repeated as facts.
    const detailsHtml = section(say('Member', 'Mitglied'), `
      ${detailGrid(`
        ${infoRowCode('ID', member.id)}
        ${user ? infoRowText(say('Email', 'E-Mail'), user.email) : ''}
        ${course ? infoRowText(say('Course', 'Kurs'), course.title || course.path) : ''}
      `)}
      <form id="editForm">
        ${formGroup(say('Role', 'Rolle'), selectInput('courseRoleId', roleOptions, member.course_role_id))}
        ${formGroup(say('Group', 'Gruppe'), selectInput('courseGroupId', groupOptions, member.course_group_id || ''))}
        <div class="actions">
          <button type="submit">${say('Save Changes', 'Änderungen speichern')}</button>
          <button type="button" class="btn-secondary" data-action="refreshData">${say('Refresh', 'Aktualisieren')}</button>
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

    return this.renderPage({ title: say('Course Member', 'Kursmitglied'), headerHtml, bodyHtml: detailsHtml, inlineScript: scriptHtml });
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateCourseMember':
        try {
          await this.apiService.updateCourseMember(message.data.memberId, message.data.updates);
          notify.info(say('Course member updated successfully', 'Das Kursmitglied wurde aktualisiert.'));

          if (this.treeDataProvider) {
            await this.treeDataProvider.refresh();
          }
        } catch (error) {
          notify.error(say(`Failed to update course member: ${error}`, `Das Kursmitglied konnte nicht aktualisiert werden: ${error}`));
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
            notify.error(say(`Failed to refresh: ${error}`, `Aktualisieren fehlgeschlagen: ${error}`));
          }
        }
        break;
    }
  }
}
