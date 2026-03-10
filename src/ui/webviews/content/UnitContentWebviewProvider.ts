import * as vscode from 'vscode';
import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';
import { SHARED_STYLES } from '../shared/webviewStyles';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, textareaInput, pageShell } from '../shared/webviewHelpers';

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
      return this.getBaseHtml('Unit', '<p>No unit data available</p>');
    }

    const { courseContent, course, contentType } = data;
    const nonce = this.getNonce();

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
      <p>Unit in ${escapeHtml(course?.title || course?.path)}</p>`;

    const infoHtml = section('Unit Information', `
      ${infoRowCode('ID', courseContent.id)}
      ${infoRowText('Type', contentType?.title || courseContent.course_content_type_id)}
      ${infoRowText('Position', String(courseContent.position ?? ''))}
      ${infoRowText('Children', String(childCount))}
    `);

    const editHtml = section('Edit Unit', `
      <form id="editForm">
        ${formGroup('Path', textInput('path', courseContent.path, { placeholder: 'e.g. unit_1', pattern: '[a-z0-9_]+(\\.[a-z0-9_]+)*' }), 'Lowercase alphanumeric segments separated by dots. Changing this will also update all children.')}
        ${formGroup('Title', textInput('title', courseContent.title, { placeholder: 'Unit title' }))}
        ${formGroup('Description', textareaInput('description', courseContent.description, { placeholder: 'Unit description' }))}
        <div class="actions">
          <button type="submit">Save Changes</button>
          <button type="button" class="btn-secondary" onclick="refreshData()">Refresh</button>
          <button type="button" class="btn-danger" onclick="deleteContent()">Delete</button>
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
        if (confirm('Are you sure you want to delete this unit and all its children?')) {
          vscode.postMessage({ command: 'deleteContent', data: { courseId: courseId, contentId: contentId } });
        }
      }

      window.addEventListener('message', function(event) {
        if (event.data.command === 'updateState') { location.reload(); }
      });
    `;

    return pageShell(nonce, 'Unit', headerHtml, infoHtml + editHtml, scriptHtml, SHARED_STYLES);
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
      vscode.window.showErrorMessage(`Failed to load children: ${error}`);
    }
  }
}
