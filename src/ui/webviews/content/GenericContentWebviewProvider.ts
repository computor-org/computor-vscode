import * as vscode from 'vscode';
import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, detailGrid } from '../shared/webviewHelpers';
import { say } from '../../../utils/uiLanguage';

export class GenericContentWebviewProvider extends BaseCourseContentWebviewProvider {
  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService,
    treeDataProvider?: LecturerTreeDataProvider
  ) {
    super(context, 'computor.genericContentView', apiService, treeDataProvider);
  }

  protected async getWebviewContent(data?: CourseContentWebviewData): Promise<string> {
    if (!data?.courseContent) {
      return this.getBaseHtml(say('Content', 'Inhalt'), say('<p>No content data available</p>', '<p>Keine Daten zum Inhalt verfügbar</p>'));
    }

    const { courseContent, course, contentType } = data;

    const headerHtml = `
      <h1>${escapeHtml(courseContent.title || courseContent.path)}</h1>
      <p>${say('Content in', 'Inhalt in')} ${escapeHtml(course?.title || course?.path)}</p>`;

    const detailsHtml = section(say('Content', 'Inhalt'), `
      ${detailGrid(`
      ${infoRowCode('ID', courseContent.id)}
      ${infoRowCode(say('Path', 'Pfad'), courseContent.path)}
      ${infoRowText(say('Type', 'Typ'), contentType?.title || courseContent.course_content_type_id)}
      ${infoRowText('Position', String(courseContent.position ?? ''))}
    `)}
      <form id="editForm">
        ${formGroup(say('Title', 'Titel'), textInput('title', courseContent.title, { placeholder: say('Content title', 'Titel des Inhalts') }))}
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

    return this.renderPage({ title: say('Content', 'Inhalt'), headerHtml, bodyHtml: detailsHtml, inlineScript: scriptHtml });
  }
}
