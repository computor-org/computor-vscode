import * as vscode from 'vscode';
import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, infoRow, section, detailGrid, badge, deploymentBadge, formGroup, textInput, textareaInput } from '../shared/webviewHelpers';
import { notify } from '../../../utils/notify';

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

    const deploymentStatus = (courseContent as any).deployment_status || 'unassigned';

    // Timestamps, message and paths only exist on the deployment record, not on
    // the course content. This used to be a whole second webview ("View
    // Deployment Info") for these few fields; it now lives in the section
    // below. Failing to load it must not take the whole page down.
    const deployment = await this.apiService
      .lecturerGetDeployment(courseContent.id)
      .catch(() => null);

    const headerHtml = `
      <h1>${escapeHtml(courseContent.title || courseContent.path)}</h1>
      <p>Assignment in ${escapeHtml(course?.title || course?.path)}</p>`;

    const infoHtml = section('Assignment Information', detailGrid(`
      ${infoRowCode('ID', courseContent.id)}
      ${infoRowText('Type', contentType?.title || courseContent.course_content_type_id)}
      ${infoRowText('Position', String(courseContent.position ?? ''))}
      ${infoRow('Max Group Size', String(courseContent.max_group_size ?? 1))}
      ${courseContent.max_test_runs !== undefined && courseContent.max_test_runs !== null ? infoRowText('Max Test Runs', String(courseContent.max_test_runs)) : ''}
      ${courseContent.max_submissions !== undefined && courseContent.max_submissions !== null ? infoRowText('Max Submissions', String(courseContent.max_submissions)) : ''}
      ${infoRow('Submittable', badge('Yes', 'success'))}
    `));

    const formatTimestamp = (value?: string | null): string =>
      value ? new Date(value).toLocaleString() : '';

    // Unassigning is rejected server-side once a deployment is live, so say so
    // rather than letting the user find out from an error.
    const unassignNote = deploymentStatus === 'deployed' || deploymentStatus === 'deploying'
      ? `<div class="notice warning">Cannot unassign while the status is
         <strong>${escapeHtml(deploymentStatus)}</strong>. Unassignment is only
         allowed for pending or failed deployments.</div>`
      : '';

    const deploymentHtml = section('Deployment', `
      ${detailGrid(`
        ${infoRow('Status', deploymentBadge(deploymentStatus))}
        ${exampleInfo?.title ? infoRowText('Example', exampleInfo.title) : infoRowText('Example', 'Not assigned')}
        ${deployment?.assigned_at ? infoRowText('Assigned', formatTimestamp(deployment.assigned_at)) : ''}
        ${deployment?.deployed_at ? infoRowText('Deployed', formatTimestamp(deployment.deployed_at)) : ''}
        ${exampleInfo?.identifier ? infoRowCode('Identifier', exampleInfo.identifier) : ''}
        ${exampleVersionInfo?.version_tag ? infoRowCode('Version', exampleVersionInfo.version_tag) : ''}
        ${deployment?.deployment_path ? infoRowCode('Deployment Path', deployment.deployment_path) : ''}
        ${deployment?.example_id ? infoRowCode('Example ID', deployment.example_id) : ''}
        ${deployment?.deployment_message ? infoRowText('Message', deployment.deployment_message, { wide: true }) : ''}
      `)}
      ${unassignNote}
      <div class="actions">
        ${exampleInfo ? `
          <button class="btn-secondary" data-action="updateExampleVersion">Update Version</button>
          <button data-action="deployAssignment">Deploy</button>
        ` : ''}
        <button class="btn-secondary" data-action="refreshData">Refresh</button>
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

      function deleteContent() {
        vscode.postMessage({ command: 'deleteContent', data: { courseId: courseId, contentId: contentId } });
      }

      ComputorWebview.registerActions({ refreshData: refreshData, deleteContent: deleteContent, updateExampleVersion: updateExampleVersion, deployAssignment: deployAssignment });
      ComputorWebview.onCommand('updateState', function() { location.reload(); });
    `;

    return this.renderPage({ title: 'Assignment', headerHtml, bodyHtml: infoHtml + deploymentHtml + editHtml, inlineScript: scriptHtml });
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
          notify.error(`Failed to deploy assignment: ${error}`);
        }
        break;


      case 'openRemoteRepo':
        await vscode.commands.executeCommand('computor.lecturer.openRemoteRepository', message.data);
        break;
    }
  }
}
