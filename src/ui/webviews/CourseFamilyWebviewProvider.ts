import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseFamilyGet, OrganizationList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, textareaInput, detailGrid } from './shared/webviewHelpers';
import { notify } from '../../utils/notify';
import { say } from '../../utils/uiLanguage';

export class CourseFamilyWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService, treeDataProvider?: LecturerTreeDataProvider) {
    super(context, 'computor.courseFamilyView');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  protected async getWebviewContent(data?: {
    courseFamily: CourseFamilyGet;
    organization: OrganizationList;
  }): Promise<string> {
    if (!data?.courseFamily) {
      return this.getBaseHtml(say('Course Family', 'Kursfamilie'), say('<p>No course family data available</p>', '<p>Keine Daten zur Kursfamilie verfügbar</p>'));
    }

    const { courseFamily, organization } = data;

    let coursesCount = 0;
    try {
      const courses = await this.apiService.getCourses(courseFamily.id);
      coursesCount = courses.length;
    } catch (error) {
      console.error('Failed to get courses:', error);
    }

    const headerHtml = `
      <h1>${escapeHtml(courseFamily.title || courseFamily.path)}</h1>
      <p>${say('Course Family in', 'Kursfamilie in')} ${escapeHtml(organization?.title || organization?.path)}</p>`;

    const detailsHtml = section(say('Course Family', 'Kursfamilie'), `
      ${detailGrid(`
      ${infoRowCode('ID', courseFamily.id)}
      ${infoRowCode(say('Path', 'Pfad'), courseFamily.path)}
      ${infoRowText(say('Organization', 'Organisation'), organization?.title || organization?.path)}
      ${infoRowText(say('Courses', 'Kurse'), String(coursesCount))}
    `)}
      <form id="editForm">
        ${formGroup(say('Title', 'Titel'), textInput('title', courseFamily.title, { required: true, placeholder: say('Course family title', 'Titel der Kursfamilie') }))}
        ${formGroup(say('Description', 'Beschreibung'), textareaInput('description', courseFamily.description, { placeholder: say('Course family description', 'Beschreibung der Kursfamilie') }))}
        <div class="actions">
          <button type="submit">${say('Save Changes', 'Änderungen speichern')}</button>
          <button type="button" class="btn-secondary" data-action="refreshData">${say('Refresh', 'Aktualisieren')}</button>
        </div>
      </form>
    `);


    const scriptHtml = `
      const familyId = ${JSON.stringify(courseFamily.id)};

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        vscode.postMessage({
          command: 'updateCourseFamily',
          data: {
            familyId: familyId,
            updates: {
              title: document.getElementById('title').value,
              description: document.getElementById('description').value
            }
          }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { familyId: familyId } });
      }

      ComputorWebview.registerActions({ refreshData: refreshData });
      ComputorWebview.onCommand('updateState', function() { location.reload(); });
    `;

    return this.renderPage({ title: say('Course Family', 'Kursfamilie'), headerHtml, bodyHtml: detailsHtml, inlineScript: scriptHtml });
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateCourseFamily':
        try {
          await this.apiService.updateCourseFamily(message.data.familyId, message.data.updates);
          notify.info(say('Course family updated successfully', 'Die Kursfamilie wurde aktualisiert.'));

          if (this.treeDataProvider) {
            this.treeDataProvider.updateNode('courseFamily', message.data.familyId, message.data.updates);
          } else {
            vscode.commands.executeCommand('computor.lecturer.refresh');
          }
        } catch (error) {
          notify.error(say(`Failed to update course family: ${error}`, `Die Kursfamilie konnte nicht aktualisiert werden: ${error}`));
        }
        break;

      case 'refresh':
        if (message.data.familyId) {
          try {
            const courseFamily = await this.apiService.getCourseFamily(message.data.familyId);
            if (courseFamily && this.panel) {
              this.currentData = { ...this.currentData, courseFamily };
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
