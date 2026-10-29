import * as vscode from 'vscode';
import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, detailGrid } from '../shared/webviewHelpers';
import { say } from '../../../utils/uiLanguage';
import { notify } from '../../../utils/notify';

export class UnitContentWebviewProvider extends BaseCourseContentWebviewProvider {
  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService,
    treeDataProvider?: LecturerTreeDataProvider
  ) {
    super(context, 'computor.unitContentView', apiService, treeDataProvider);
  }

  protected async getWebviewContent(data?: CourseContentWebviewData): Promise<string> {
    if (!data?.courseContent) {
      return this.getBaseHtml(say('Unit', 'Einheit'), say('<p>No unit data available</p>', '<p>Keine Daten zur Einheit verfügbar</p>'));
    }

    const { courseContent, course, contentType } = data;

    let childCount = 0;
    try {
      const allContents = await this.apiService.getCourseContents(course.id, false, false);
      childCount = allContents.filter(c =>
        c.path.startsWith(courseContent.path + '.') &&
        c.path.split('.').length === courseContent.path.split('.').length + 1
      ).length;
    } catch (error) {
      console.error('Failed to count children:', error);
    }

    const headerHtml = `
      <h1>${escapeHtml(courseContent.title || courseContent.path)}</h1>
      <p>${say('Unit in', 'Einheit in')} ${escapeHtml(course?.title || course?.path)}</p>`;

    const detailsHtml = section(say('Unit', 'Einheit'), `
      ${detailGrid(`
      ${infoRowCode('ID', courseContent.id)}
      ${infoRowCode(say('Path', 'Pfad'), courseContent.path)}
      ${infoRowText(say('Type', 'Typ'), contentType?.title || courseContent.course_content_type_id)}
      ${infoRowText('Position', String(courseContent.position ?? ''))}
      ${infoRowText(say('Children', 'Untereinträge'), String(childCount))}
    `)}
      <form id="editForm">
        ${formGroup(say('Title', 'Titel'), textInput('title', courseContent.title, { placeholder: say('Unit title', 'Titel der Einheit') }))}
        <div class="actions">
          <button type="submit">${say('Save Changes', 'Änderungen speichern')}</button>
          <button type="button" class="btn-secondary" data-action="refreshData">${say('Refresh', 'Aktualisieren')}</button>
          <button type="button" class="btn-secondary" data-action="editDescription">${say('Edit Description...', 'Beschreibung bearbeiten …')}</button>
        </div>
      </form>
    `);


    const scriptHtml = `
      var contentId = ${JSON.stringify(courseContent.id)};
      var courseId = ${JSON.stringify(course.id)};

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        vscode.postMessage({
          command: 'updateContent',
          data: {
            courseId: courseId,
            contentId: contentId,
            updates: {
              title: document.getElementById('title').value
            }
          }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { contentId: contentId } });
      }

      function editDescription() {
        vscode.postMessage({ command: 'editDescription' });
      }

      ComputorWebview.registerActions({ refreshData: refreshData, editDescription: editDescription });
      ComputorWebview.onCommand('updateState', function() { location.reload(); });
    `;

    return this.renderPage({ title: say('Unit', 'Einheit'), headerHtml, bodyHtml: detailsHtml, inlineScript: scriptHtml });
  }

  protected async handleCustomMessage(message: { command: string; data?: Record<string, unknown> }): Promise<void> {
    switch (message.command) {
      case 'loadChildren':
        await this.handleLoadChildren(message.data);
        break;
    }
  }

  private async handleLoadChildren(data?: Record<string, unknown>): Promise<void> {
    if (!data) { return; }
    try {
      const allContents = await this.apiService.getCourseContents(data.courseId as string, false, false);
      const parentPath = (data.parentPath as string) || '';

      const children = allContents.filter(c => {
        if (!parentPath) { return !c.path.includes('.'); }
        return c.path.startsWith(parentPath + '.') &&
               c.path.split('.').length === parentPath.split('.').length + 1;
      });

      if (this.panel) {
        this.panel.webview.postMessage({ command: 'childrenLoaded', data: { children } });
      }
    } catch (error) {
      notify.error(say(`Failed to load children: ${error}`, `Die Untereinträge konnten nicht geladen werden: ${error}`));
    }
  }
}
