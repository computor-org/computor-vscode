import * as vscode from 'vscode';
import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, detailGrid } from '../shared/webviewHelpers';

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
      return this.getBaseHtml('Content', '<p>No content data available</p>');
    }

    const { courseContent, course, contentType } = data;

    const headerHtml = `
      <h1>${escapeHtml(courseContent.title || courseContent.path)}</h1>
      <p>Content in ${escapeHtml(course?.title || course?.path)}</p>`;

    const detailsHtml = section('Content', `
      ${detailGrid(`
      ${infoRowCode('ID', courseContent.id)}
      ${infoRowCode('Path', courseContent.path)}
      ${infoRowText('Type', contentType?.title || courseContent.course_content_type_id)}
      ${infoRowText('Position', String(courseContent.position ?? ''))}
    `)}
      <form id="editForm">
        ${formGroup('Title', textInput('title', courseContent.title, { placeholder: 'Content title' }))}
        <div class="actions">
          <button type="submit">Save Changes</button>
          <button type="button" class="btn-secondary" data-action="refreshData">Refresh</button>
          <button type="button" class="btn-secondary" data-action="editDescription">Edit Description...</button>
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

    return this.renderPage({ title: 'Content', headerHtml, bodyHtml: detailsHtml, inlineScript: scriptHtml });
  }
}
