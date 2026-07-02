import * as vscode from 'vscode';
import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, textareaInput } from '../shared/webviewHelpers';

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

    const infoHtml = section('Content Information', `
      ${infoRowCode('ID', courseContent.id)}
      ${infoRowText('Type', contentType?.title || courseContent.course_content_type_id)}
      ${infoRowText('Position', String(courseContent.position ?? ''))}
    `);

    const editHtml = section('Edit Content', `
      <form id="editForm">
        ${formGroup('Path', textInput('path', courseContent.path, { placeholder: 'e.g. unit_1.content_1', pattern: '[a-z0-9_]+(\\.[a-z0-9_]+)*' }), 'Lowercase alphanumeric segments separated by dots')}
        ${formGroup('Title', textInput('title', courseContent.title, { placeholder: 'Content title' }))}
        ${formGroup('Description', textareaInput('description', courseContent.description, { placeholder: 'Content description' }))}
        <div class="actions">
          <button type="submit">Save Changes</button>
          <button type="button" class="btn-secondary" data-action="refreshData">Refresh</button>
          <button type="button" class="btn-danger" data-action="deleteContent">Delete</button>
        </div>
      </form>
    `);

    const scriptHtml = `
      var contentId = ${JSON.stringify(courseContent.id)};
      var courseId = ${JSON.stringify(course.id)};
      var originalPath = ${JSON.stringify(courseContent.path)};
      var currentPosition = ${JSON.stringify(courseContent.position)};

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        var newPath = document.getElementById('path').value.trim();
        var updates = {
          title: document.getElementById('title').value,
          description: document.getElementById('description').value
        };

        if (newPath !== originalPath) {
          vscode.postMessage({
            command: 'moveContent',
            data: {
              courseId: courseId,
              contentId: contentId,
              path: newPath,
              position: currentPosition,
              updates: updates
            }
          });
        } else {
          vscode.postMessage({
            command: 'updateContent',
            data: { courseId: courseId, contentId: contentId, updates: updates }
          });
        }
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { contentId: contentId } });
      }

      function deleteContent() {
        vscode.postMessage({ command: 'deleteContent', data: { courseId: courseId, contentId: contentId } });
      }

      ComputorWebview.registerActions({ refreshData: refreshData, deleteContent: deleteContent });
      ComputorWebview.onCommand('updateState', function() { location.reload(); });
    `;

    return this.renderPage({ title: 'Content', headerHtml, bodyHtml: infoHtml + editHtml, inlineScript: scriptHtml });
  }
}
