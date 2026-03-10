import * as vscode from 'vscode';
import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';
import { SHARED_STYLES } from '../shared/webviewStyles';
import { escapeHtml, infoRowText, infoRowCode, infoRow, section, badge, statusBadge, formGroup, textInput, textareaInput, pageShell } from '../shared/webviewHelpers';

export class AssignmentContentWebviewProvider extends BaseCourseContentWebviewProvider {
  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService,
    treeDataProvider?: LecturerTreeDataProvider
  ) {
    super(context, 'computor.assignmentContentView', apiService, treeDataProvider);
  }

  protected async getWebviewContent(data?: CourseContentWebviewData): Promise<string> {
    if (!data?.courseContent) {
      return this.getBaseHtml('Assignment', '<p>No assignment data available</p>');
    }

    const { courseContent, course, contentType, exampleInfo, exampleVersionInfo } = data;
    const nonce = this.getNonce();

    const statusColors: Record<string, string> = {
      pending: '#FFA500',
      deployed: '#107c10',
      failed: '#d13438',
      deploying: '#0078d4',
      unassigned: '#666666'
    };

    const deploymentStatus = (courseContent as any).deployment_status || 'unassigned';
    const statusColor = statusColors[deploymentStatus] || '#666666';

    const headerHtml = `
      <h1>${escapeHtml(courseContent.title || courseContent.path)}</h1>
      <p>Assignment in ${escapeHtml(course?.title || course?.path)}</p>`;

    const infoHtml = section('Assignment Information', `
      ${infoRowCode('ID', courseContent.id)}
      ${infoRowText('Type', contentType?.title || courseContent.course_content_type_id)}
      ${infoRowText('Position', String(courseContent.position ?? ''))}
      ${infoRow('Max Group Size', String(courseContent.max_group_size ?? 1))}
      ${courseContent.max_test_runs !== undefined && courseContent.max_test_runs !== null ? infoRowText('Max Test Runs', String(courseContent.max_test_runs)) : ''}
      ${courseContent.max_submissions !== undefined && courseContent.max_submissions !== null ? infoRowText('Max Submissions', String(courseContent.max_submissions)) : ''}
      ${infoRow('Submittable', badge('Yes', 'success'))}
    `);

    const deploymentHtml = section('Deployment', `
      ${infoRow('Status', statusBadge(deploymentStatus.toUpperCase(), statusColor))}
      ${exampleInfo?.title ? infoRowText('Example', exampleInfo.title) : infoRowText('Example', 'Not assigned')}
      ${exampleInfo?.identifier ? infoRowCode('Identifier', exampleInfo.identifier) : ''}
      ${exampleVersionInfo?.version_tag ? infoRowCode('Version', exampleVersionInfo.version_tag) : ''}
      <div class="actions">
        ${exampleInfo ? `
          <button class="btn-secondary" onclick="updateExampleVersion()">Update Version</button>
          <button onclick="deployAssignment()">Deploy</button>
        ` : ''}
        <button class="btn-secondary" onclick="viewDeployment()">View Deployment Info</button>
      </div>
    `);

    const editHtml = section('Edit Assignment', `
      <form id="editForm">
        ${formGroup('Path', textInput('path', courseContent.path, { placeholder: 'e.g. unit_1.assignment_1', pattern: '[a-z0-9_]+(\\.[a-z0-9_]+)*' }), 'Lowercase alphanumeric segments separated by dots')}
        ${formGroup('Title', textInput('title', courseContent.title, { placeholder: 'Assignment title' }))}
        ${formGroup('Description', textareaInput('description', courseContent.description, { placeholder: 'Assignment description' }))}
        ${formGroup('Max Group Size', textInput('maxGroupSize', String(courseContent.max_group_size ?? 1), { type: 'number', min: 1 }))}
        ${courseContent.max_test_runs !== undefined ? formGroup('Max Test Runs', textInput('maxTestRuns', String(courseContent.max_test_runs ?? ''), { type: 'number', min: 0 })) : ''}
        ${courseContent.max_submissions !== undefined ? formGroup('Max Submissions', textInput('maxSubmissions', String(courseContent.max_submissions ?? ''), { type: 'number', min: 0 })) : ''}
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
          description: document.getElementById('description').value,
          max_group_size: parseInt(document.getElementById('maxGroupSize').value) || 1
        };
        var testRunsEl = document.getElementById('maxTestRuns');
        if (testRunsEl) { updates.max_test_runs = parseInt(testRunsEl.value) || null; }
        var submissionsEl = document.getElementById('maxSubmissions');
        if (submissionsEl) { updates.max_submissions = parseInt(submissionsEl.value) || null; }

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

      function updateExampleVersion() {
        vscode.postMessage({ command: 'updateExampleVersion', data: { courseId: courseId, contentId: contentId } });
      }

      function deployAssignment() {
        vscode.postMessage({ command: 'deployAssignment', data: { courseId: courseId, contentId: contentId } });
      }

      function viewDeployment() {
        vscode.postMessage({ command: 'viewDeployment', data: { courseId: courseId, contentId: contentId } });
      }

      function deleteContent() {
        if (confirm('Are you sure you want to delete this assignment?')) {
          vscode.postMessage({ command: 'deleteContent', data: { courseId: courseId, contentId: contentId } });
        }
      }

      window.addEventListener('message', function(event) {
        if (event.data.command === 'updateState') { location.reload(); }
      });
    `;

    return pageShell(nonce, 'Assignment', headerHtml, infoHtml + deploymentHtml + editHtml, scriptHtml, SHARED_STYLES);
  }

  protected async handleCustomMessage(message: { command: string; data?: Record<string, unknown> }): Promise<void> {
    switch (message.command) {
      case 'updateExampleVersion':
        await vscode.commands.executeCommand('computor.lecturer.updateExampleVersion', message.data);
        break;

      case 'deployAssignment':
        try {
          await vscode.commands.executeCommand('computor.lecturer.releaseCourseContent', {
            courseId: message.data?.courseId,
            contentId: message.data?.contentId
          });
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to deploy assignment: ${error}`);
        }
        break;

      case 'viewDeployment':
        try {
          const contentData = this.currentData as CourseContentWebviewData;
          await vscode.commands.executeCommand('computor.lecturer.viewDeploymentInfo', {
            courseContentId: message.data?.contentId,
            courseContentTitle: contentData?.courseContent?.title || ''
          });
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to view deployment: ${error}`);
        }
        break;

      case 'openGitLabRepo':
        await vscode.commands.executeCommand('computor.lecturer.openGitLabRepo', message.data);
        break;
    }
  }
}
