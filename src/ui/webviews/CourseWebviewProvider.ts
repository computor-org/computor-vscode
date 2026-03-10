import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseGet, CourseFamilyList, OrganizationList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { SHARED_STYLES } from './shared/webviewStyles';
import { escapeHtml, infoRowText, infoRowCode, infoRow, section, formGroup, textInput, textareaInput, pageShell } from './shared/webviewHelpers';

export class CourseWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService, treeDataProvider?: LecturerTreeDataProvider) {
    super(context, 'computor.courseView');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  protected async getWebviewContent(data?: {
    course: CourseGet;
    courseFamily: CourseFamilyList;
    organization: OrganizationList;
  }): Promise<string> {
    if (!data?.course) {
      return this.getBaseHtml('Course', '<p>No course data available</p>');
    }

    const { course, courseFamily, organization } = data;
    const nonce = this.getNonce();
    const gitlabUrl = (course as any).properties?.gitlab?.url || '';

    const headerHtml = `
      <h1>${escapeHtml(course.title || course.path)}</h1>
      <p>Course in ${escapeHtml(courseFamily?.title || courseFamily?.path)} / ${escapeHtml(organization?.title || organization?.path)}</p>`;

    const gitlabRow = gitlabUrl
      ? infoRow('GitLab Repository', `<a href="${escapeHtml(gitlabUrl)}" title="${escapeHtml(gitlabUrl)}">${escapeHtml(gitlabUrl)}</a>`)
      : infoRowText('GitLab Repository', null);

    const infoHtml = section('Information', `
      ${infoRowCode('ID', course.id)}
      ${infoRowCode('Path', course.path)}
      ${infoRowText('Title', course.title)}
      ${infoRowText('Description', course.description)}
      ${infoRowText('Course Family', courseFamily?.title || courseFamily?.path)}
      ${infoRowText('Organization', organization?.title || organization?.path)}
      ${gitlabRow}
    `);

    const editHtml = section('Edit Course', `
      <form id="editForm">
        ${formGroup('Title', textInput('title', course.title, { placeholder: 'Course title' }))}
        ${formGroup('Description', textareaInput('description', course.description, { placeholder: 'Course description' }))}
        ${formGroup('GitLab Repository URL', textInput('gitlabUrl', gitlabUrl, { type: 'url', placeholder: 'https://gitlab.example.com/...' }))}
        <div class="actions">
          <button type="submit">Save Changes</button>
          <button type="button" class="btn-secondary" onclick="refreshData()">Refresh</button>
        </div>
      </form>
    `);

    const scriptHtml = `
      const courseId = ${JSON.stringify(course.id)};

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        vscode.postMessage({
          command: 'updateCourse',
          data: {
            courseId: courseId,
            updates: {
              title: document.getElementById('title').value,
              description: document.getElementById('description').value,
              gitlabUrl: document.getElementById('gitlabUrl').value
            }
          }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { courseId: courseId } });
      }

      window.addEventListener('message', function(event) {
        if (event.data.command === 'updateState') { location.reload(); }
      });
    `;

    return pageShell(nonce, 'Course', headerHtml, infoHtml + editHtml, scriptHtml, SHARED_STYLES);
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateCourse':
        try {
          await this.apiService.updateCourse(message.data.courseId, message.data.updates);
          vscode.window.showInformationMessage('Course updated successfully');

          if (this.treeDataProvider) {
            this.treeDataProvider.updateNode('course', message.data.courseId, message.data.updates);
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to update course: ${error}`);
        }
        break;

      case 'refresh':
        if (message.data.courseId) {
          try {
            const course = await this.apiService.getCourse(message.data.courseId);
            if (course && this.panel) {
              this.currentData = { ...this.currentData, course };
              this.panel.webview.html = await this.getWebviewContent(this.currentData);
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh: ${error}`);
          }
        }
        break;
    }
  }
}
