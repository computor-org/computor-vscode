import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseFamilyGet, OrganizationList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { SHARED_STYLES } from './shared/webviewStyles';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, textareaInput, pageShell } from './shared/webviewHelpers';

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
      return this.getBaseHtml('Course Family', '<p>No course family data available</p>');
    }

    const { courseFamily, organization } = data;
    const nonce = this.getNonce();

    let coursesCount = 0;
    try {
      const courses = await this.apiService.getCourses(courseFamily.id);
      coursesCount = courses.length;
    } catch (error) {
      console.error('Failed to get courses:', error);
    }

    const headerHtml = `
      <h1>${escapeHtml(courseFamily.title || courseFamily.path)}</h1>
      <p>Course Family in ${escapeHtml(organization?.title || organization?.path)}</p>`;

    const infoHtml = section('Information', `
      ${infoRowCode('ID', courseFamily.id)}
      ${infoRowCode('Path', courseFamily.path)}
      ${infoRowText('Title', courseFamily.title)}
      ${infoRowText('Description', courseFamily.description)}
      ${infoRowText('Organization', organization?.title || organization?.path)}
      ${infoRowText('Courses', String(coursesCount))}
    `);

    const editHtml = section('Edit Course Family', `
      <form id="editForm">
        ${formGroup('Title', textInput('title', courseFamily.title, { required: true, placeholder: 'Course family title' }))}
        ${formGroup('Description', textareaInput('description', courseFamily.description, { placeholder: 'Course family description' }))}
        <div class="actions">
          <button type="submit">Save Changes</button>
          <button type="button" class="btn-secondary" onclick="refreshData()">Refresh</button>
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

      window.addEventListener('message', function(event) {
        if (event.data.command === 'updateState') { location.reload(); }
      });
    `;

    return pageShell(nonce, 'Course Family', headerHtml, infoHtml + editHtml, scriptHtml, SHARED_STYLES);
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateCourseFamily':
        try {
          await this.apiService.updateCourseFamily(message.data.familyId, message.data.updates);
          vscode.window.showInformationMessage('Course family updated successfully');

          if (this.treeDataProvider) {
            this.treeDataProvider.updateNode('courseFamily', message.data.familyId, message.data.updates);
          } else {
            vscode.commands.executeCommand('computor.lecturer.refresh');
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to update course family: ${error}`);
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
            vscode.window.showErrorMessage(`Failed to refresh: ${error}`);
          }
        }
        break;
    }
  }
}
