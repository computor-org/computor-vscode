import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';
import { SHARED_STYLES } from '../shared/webviewStyles';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, textareaInput, pageShell } from '../shared/webviewHelpers';

export class GenericContentWebviewProvider extends BaseCourseContentWebviewProvider {
  constructor(
    context: import('vscode').ExtensionContext,
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
    const nonce = this.getNonce();

    const headerHtml = `
      <h1>${escapeHtml(courseContent.title || courseContent.path)}</h1>
      <p>Content in ${escapeHtml(course?.title || course?.path)}</p>`;

    const infoHtml = section('Content Information', `
      ${infoRowCode('ID', courseContent.id)}
      ${infoRowCode('Path', courseContent.path)}
      ${infoRowText('Type', contentType?.title || courseContent.course_content_type_id)}
      ${infoRowText('Position', String(courseContent.position ?? ''))}
    `);

    const editHtml = section('Edit Content', `
      <form id="editForm">
        ${formGroup('Title', textInput('title', courseContent.title, { placeholder: 'Content title' }))}
        ${formGroup('Description', textareaInput('description', courseContent.description, { placeholder: 'Content description' }))}
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

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        vscode.postMessage({
          command: 'updateContent',
          data: {
            courseId: courseId,
            contentId: contentId,
            updates: {
              title: document.getElementById('title').value,
              description: document.getElementById('description').value
            }
          }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { contentId: contentId } });
      }

      function deleteContent() {
        if (confirm('Are you sure you want to delete this content?')) {
          vscode.postMessage({ command: 'deleteContent', data: { courseId: courseId, contentId: contentId } });
        }
      }

      window.addEventListener('message', function(event) {
        if (event.data.command === 'updateState') { location.reload(); }
      });
    `;

    return pageShell(nonce, 'Content', headerHtml, infoHtml + editHtml, scriptHtml, SHARED_STYLES);
  }
}
