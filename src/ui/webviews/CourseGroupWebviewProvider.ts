import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { CourseGroupGet, CourseList } from '../../types/generated';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, textareaInput, detailGrid } from './shared/webviewHelpers';
import { notify } from '../../utils/notify';
import { say } from '../../utils/uiLanguage';

export class CourseGroupWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService, treeDataProvider?: LecturerTreeDataProvider) {
    super(context, 'computor.courseGroupView');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  protected async getWebviewContent(data?: {
    group: CourseGroupGet;
    course?: CourseList;
    membersCount?: number;
  }): Promise<string> {
    if (!data?.group) {
      return this.getBaseHtml(say('Course Group', 'Kursgruppe'), say('<p>No course group data available</p>', '<p>Keine Daten zur Kursgruppe verfügbar</p>'));
    }

    const { group, course, membersCount } = data;

    const headerHtml = `
      <h1>${escapeHtml(group.title || group.id)}</h1>
      <p>${say('Course Group', 'Kursgruppe')}${course ? ` ${say('in', 'in')} ${escapeHtml(course.title || course.path)}` : ''}</p>`;

    const detailsHtml = section(say('Course Group', 'Kursgruppe'), `
      ${detailGrid(`
      ${infoRowCode('ID', group.id)}
      ${course ? infoRowText(say('Course', 'Kurs'), course.title || course.path) : ''}
      ${infoRowText(say('Members', 'Mitglieder'), String(membersCount || 0))}
    `)}
      <form id="editForm">
        ${formGroup(say('Title', 'Titel'), textInput('title', group.title, { required: true, placeholder: say('Group title', 'Titel der Gruppe') }))}
        ${formGroup(say('Description', 'Beschreibung'), textareaInput('description', group.description, { placeholder: say('Group description', 'Beschreibung der Gruppe') }))}
        <div class="actions">
          <button type="submit">${say('Save Changes', 'Änderungen speichern')}</button>
          <button type="button" class="btn-secondary" data-action="refreshData">${say('Refresh', 'Aktualisieren')}</button>
        </div>
      </form>
    `);


    const scriptHtml = `
      const groupId = ${JSON.stringify(group.id)};

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        vscode.postMessage({
          command: 'updateCourseGroup',
          data: {
            groupId: groupId,
            updates: {
              title: document.getElementById('title').value,
              description: document.getElementById('description').value
            }
          }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { groupId: groupId } });
      }

      ComputorWebview.registerActions({ refreshData: refreshData });
      ComputorWebview.onCommand('updateState', function() { location.reload(); });
    `;

    return this.renderPage({ title: say('Course Group', 'Kursgruppe'), headerHtml, bodyHtml: detailsHtml, inlineScript: scriptHtml });
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateCourseGroup':
        try {
          await this.apiService.updateCourseGroup(message.data.groupId, message.data.updates);
          notify.info(say('Course group updated successfully', 'Die Kursgruppe wurde aktualisiert.'));

          if (this.treeDataProvider) {
            await this.treeDataProvider.refresh();
          }
        } catch (error) {
          notify.error(say(`Failed to update course group: ${error}`, `Die Kursgruppe konnte nicht aktualisiert werden: ${error}`));
        }
        break;

      case 'refresh':
        if (message.data.groupId && this.panel) {
          try {
            const group = await this.apiService.getCourseGroup(message.data.groupId);
            if (group) {
              let membersCount = 0;
              try {
                const members = await this.apiService.getCourseMembers(group.course_id, group.id);
                membersCount = members.length;
              } catch (error) {
                console.error('Failed to get members count:', error);
              }

              this.currentData = { ...this.currentData, group, membersCount };
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
