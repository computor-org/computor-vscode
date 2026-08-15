import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseGet, CourseFamilyList, OrganizationList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, textareaInput, detailGrid } from './shared/webviewHelpers';
import { notify } from '../../utils/notify';

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
    // Shown, not edited. A course's git binding is fixed once the repositories
    // are materialised, and this field never reached the server anyway —
    // CourseUpdate carries no git fields, so anything typed here was dropped
    // (computor-org/issues#326). Configure git via "Configure Course Git".
    const gitUrl = (course as any).properties?.gitlab?.url || '';

    const headerHtml = `
      <h1>${escapeHtml(course.title || course.path)}</h1>
      <p>Course in ${escapeHtml(courseFamily?.title || courseFamily?.path)} / ${escapeHtml(organization?.title || organization?.path)}</p>`;

    const detailsHtml = section('Course', `
      ${detailGrid(`
      ${infoRowCode('ID', course.id)}
      ${infoRowCode('Path', course.path)}
      ${infoRowText('Course Family', courseFamily?.title || courseFamily?.path)}
      ${infoRowText('Organization', organization?.title || organization?.path)}
      ${gitUrl ? infoRowCode('Git Repository', gitUrl) : ''}
    `)}
      <form id="editForm">
        ${formGroup('Title', textInput('title', course.title, { placeholder: 'Course title' }))}
        ${formGroup('Description', textareaInput('description', course.description, { placeholder: 'Course description' }))}
        <div class="actions">
          <button type="submit">Save Changes</button>
          <button type="button" class="btn-secondary" data-action="refreshData">Refresh</button>
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
              description: document.getElementById('description').value
            }
          }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { courseId: courseId } });
      }

      ComputorWebview.registerActions({ refreshData: refreshData });
      ComputorWebview.onCommand('updateState', function() { location.reload(); });
    `;

    return this.renderPage({ title: 'Course', headerHtml, bodyHtml: detailsHtml, inlineScript: scriptHtml });
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateCourse':
        try {
          await this.apiService.updateCourse(message.data.courseId, message.data.updates);
          notify.info('Course updated successfully');

          if (this.treeDataProvider) {
            this.treeDataProvider.updateNode('course', message.data.courseId, message.data.updates);
          }
        } catch (error) {
          notify.error(`Failed to update course: ${error}`);
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
            notify.error(`Failed to refresh: ${error}`);
          }
        }
        break;
    }
  }
}
