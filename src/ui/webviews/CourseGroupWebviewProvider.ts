import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { CourseGroupGet, CourseList } from '../../types/generated';
import { SHARED_STYLES } from './shared/webviewStyles';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, textareaInput, pageShell } from './shared/webviewHelpers';

export class CourseGroupWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService, treeDataProvider?: LecturerTreeDataProvider) {
    super(context, 'computor.courseGroupView');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  protected async getWebviewContent(data?: {
    group: CourseGroupGet;
    course?: CourseList;
    membersCount?: number;
  }): Promise<string> {
    if (!data?.group) {
      return this.getBaseHtml('Course Group', '<p>No course group data available</p>');
    }

    const { group, course, membersCount } = data;
    const nonce = this.getNonce();

    const headerHtml = `
      <h1>${escapeHtml(group.title || group.id)}</h1>
      <p>Course Group${course ? ` in ${escapeHtml(course.title || course.path)}` : ''}</p>`;

    const infoHtml = section('Information', `
      ${infoRowCode('ID', group.id)}
      ${infoRowText('Title', group.title)}
      ${infoRowText('Description', group.description)}
      ${course ? infoRowText('Course', course.title || course.path) : ''}
      ${infoRowText('Members', String(membersCount || 0))}
    `);

    const editHtml = section('Edit Course Group', `
      <form id="editForm">
        ${formGroup('Title', textInput('title', group.title, { required: true, placeholder: 'Group title' }))}
        ${formGroup('Description', textareaInput('description', group.description, { placeholder: 'Group description' }))}
        <div class="actions">
          <button type="submit">Save Changes</button>
          <button type="button" class="btn-secondary" onclick="refreshData()">Refresh</button>
        </div>
      </form>
    `);

    const scriptHtml = `
      const groupId = ${JSON.stringify(group.id)};

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        vscode.postMessage({
          command: 'updateCourseGroup',
          data: {
            groupId: groupId,
            updates: {
              title: document.getElementById('title').value,
              description: document.getElementById('description').value
            }
          }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { groupId: groupId } });
      }

      window.addEventListener('message', function(event) {
        if (event.data.command === 'updateState') { location.reload(); }
      });
    `;

    return pageShell(nonce, 'Course Group', headerHtml, infoHtml + editHtml, scriptHtml, SHARED_STYLES);
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateCourseGroup':
        try {
          await this.apiService.updateCourseGroup(message.data.groupId, message.data.updates);
          vscode.window.showInformationMessage('Course group updated successfully');

          if (this.treeDataProvider) {
            await this.treeDataProvider.refresh();
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to update course group: ${error}`);
        }
        break;

      case 'refresh':
        if (message.data.groupId && this.panel) {
          try {
            const group = await this.apiService.getCourseGroup(message.data.groupId);
            if (group) {
              let membersCount = 0;
              try {
                const members = await this.apiService.getCourseMembers(group.course_id, group.id);
                membersCount = members.length;
              } catch (error) {
                console.error('Failed to get members count:', error);
              }

              this.currentData = { ...this.currentData, group, membersCount };
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
