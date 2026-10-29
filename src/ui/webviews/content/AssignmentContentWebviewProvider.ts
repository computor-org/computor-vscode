import * as vscode from 'vscode';
import { BaseCourseContentWebviewProvider, CourseContentWebviewData } from './BaseCourseContentWebviewProvider';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, infoRow, section, detailGrid, badge, deploymentBadge, deploymentStatusLabel, formGroup, textInput } from '../shared/webviewHelpers';
import { say, uiLocale } from '../../../utils/uiLanguage';
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
      return this.getBaseHtml(say('Assignment', 'Aufgabe'), say('<p>No assignment data available</p>', '<p>Keine Daten zur Aufgabe verfügbar</p>'));
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
      <p>${say('Assignment in', 'Aufgabe in')} ${escapeHtml(course?.title || course?.path)}</p>`;

    // Group size and the run/submission limits are editable in the form below,
    // so they appear once, as inputs, rather than also as read-only facts.
    const detailsHtml = section(say('Assignment', 'Aufgabe'), `
      ${detailGrid(`
        ${infoRowCode('ID', courseContent.id)}
        ${infoRowCode(say('Path', 'Pfad'), courseContent.path)}
        ${infoRowText(say('Type', 'Typ'), contentType?.title || courseContent.course_content_type_id)}
        ${infoRowText('Position', String(courseContent.position ?? ''))}
        ${infoRow(say('Submittable', 'Mit Abgabe'), badge(say('Yes', 'Ja'), 'success'))}
      `)}
      <form id="editForm">
        ${formGroup(say('Title', 'Titel'), textInput('title', courseContent.title, { placeholder: say('Assignment title', 'Titel der Aufgabe') }))}
        ${formGroup(say('Max Group Size', 'Höchste Gruppengröße'), textInput('maxGroupSize', String(courseContent.max_group_size ?? 1), { type: 'number', min: 1 }))}
        ${formGroup(say('Max Test Runs', 'Höchstzahl der Testläufe'), textInput('maxTestRuns', String(courseContent.max_test_runs ?? ''), { type: 'number', min: 0, placeholder: say('empty = unlimited', 'leer = unbegrenzt') }))}
        ${formGroup(say('Max Submissions', 'Höchstzahl der Abgaben'), textInput('maxSubmissions', String(courseContent.max_submissions ?? ''), { type: 'number', min: 0, placeholder: say('empty = unlimited', 'leer = unbegrenzt') }))}
        <div class="actions">
          <button type="submit">${say('Save Changes', 'Änderungen speichern')}</button>
          <button type="button" class="btn-secondary" data-action="refreshData">${say('Refresh', 'Aktualisieren')}</button>
          <button type="button" class="btn-secondary" data-action="editDescription">${say('Edit Description...', 'Beschreibung bearbeiten …')}</button>
        </div>
      </form>
    `);

    const formatTimestamp = (value?: string | null): string =>
      value ? new Date(value).toLocaleString(uiLocale()) : '';

    // Unassigning is rejected server-side once a deployment is live, so say so
    // rather than letting the user find out from an error.
    const unassignNote = deploymentStatus === 'deployed' || deploymentStatus === 'deploying'
      ? say(
        `<div class="notice warning">Cannot unassign while the status is
         <strong>${escapeHtml(deploymentStatusLabel(deploymentStatus))}</strong>. Unassignment is only
         allowed for pending or failed deployments.</div>`,
        `<div class="notice warning">Solange der Status
         <strong>${escapeHtml(deploymentStatusLabel(deploymentStatus))}</strong> ist, lässt sich die Zuweisung nicht aufheben.
         Das geht nur bei ausstehenden oder fehlgeschlagenen Bereitstellungen.</div>`
      )
      : '';

    const deploymentHtml = section(say('Deployment', 'Bereitstellung'), `
      ${detailGrid(`
        ${infoRow('Status', deploymentBadge(deploymentStatus))}
        ${exampleInfo?.title ? infoRowText(say('Example', 'Beispiel'), exampleInfo.title) : infoRowText(say('Example', 'Beispiel'), say('Not assigned', 'Nicht zugewiesen'))}
        ${deployment?.assigned_at ? infoRowText(say('Assigned', 'Zugewiesen'), formatTimestamp(deployment.assigned_at)) : ''}
        ${deployment?.deployed_at ? infoRowText(say('Deployed', 'Bereitgestellt'), formatTimestamp(deployment.deployed_at)) : ''}
        ${exampleInfo?.identifier ? infoRowCode(say('Identifier', 'Kennung'), exampleInfo.identifier) : ''}
        ${exampleVersionInfo?.version_tag ? infoRowCode('Version', exampleVersionInfo.version_tag) : ''}
        ${deployment?.deployment_path ? infoRowCode(say('Deployment Path', 'Bereitstellungspfad'), deployment.deployment_path) : ''}
        ${deployment?.example_id ? infoRowCode(say('Example ID', 'Beispiel-ID'), deployment.example_id) : ''}
        ${deployment?.deployment_message ? infoRowText(say('Message', 'Meldung'), deployment.deployment_message, { wide: true }) : ''}
      `)}
      ${unassignNote}
      <div class="actions">
        ${exampleInfo ? `
          <button class="btn-secondary" data-action="updateExampleVersion">${say('Update Version', 'Version aktualisieren')}</button>
          <button data-action="deployAssignment">${say('Deploy', 'Bereitstellen')}</button>
        ` : ''}
        <button class="btn-secondary" data-action="refreshData">${say('Refresh', 'Aktualisieren')}</button>
      </div>
    `);

    const scriptHtml = `
      var contentId = ${JSON.stringify(courseContent.id)};
      var courseId = ${JSON.stringify(course.id)};
      var contentPath = ${JSON.stringify(courseContent.path)};
      var contentTitle = ${JSON.stringify(courseContent.title || courseContent.path)};

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        var updates = {
          title: document.getElementById('title').value,
          max_group_size: parseInt(document.getElementById('maxGroupSize').value) || 1
        };
        // An empty field means "unlimited"; 0 means zero. \`parseInt(v) || null\`
        // conflated the two and silently turned a 0 into unlimited
        // (computor-org/issues#356).
        function limitValue(el) {
          if (!el) { return undefined; }
          var raw = String(el.value).trim();
          if (raw === '') { return null; }
          var parsed = parseInt(raw, 10);
          return isNaN(parsed) ? null : parsed;
        }
        var testRunsEl = document.getElementById('maxTestRuns');
        if (testRunsEl) { updates.max_test_runs = limitValue(testRunsEl); }
        var submissionsEl = document.getElementById('maxSubmissions');
        if (submissionsEl) { updates.max_submissions = limitValue(submissionsEl); }

        vscode.postMessage({
          command: 'updateContent',
          data: { courseId: courseId, contentId: contentId, updates: updates }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { contentId: contentId } });
      }

      function updateExampleVersion() {
        vscode.postMessage({ command: 'updateExampleVersion', data: { courseId: courseId, contentId: contentId } });
      }

      function deployAssignment() {
        vscode.postMessage({ command: 'deployAssignment', data: { courseId: courseId, contentId: contentId, path: contentPath, title: contentTitle } });
      }

      function editDescription() {
        vscode.postMessage({ command: 'editDescription' });
      }

      ComputorWebview.registerActions({ refreshData: refreshData, editDescription: editDescription, updateExampleVersion: updateExampleVersion, deployAssignment: deployAssignment });
      ComputorWebview.onCommand('updateState', function() { location.reload(); });
    `;

    return this.renderPage({ title: say('Assignment', 'Aufgabe'), headerHtml, bodyHtml: detailsHtml + deploymentHtml, inlineScript: scriptHtml });
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
            contentId: message.data?.contentId,
            path: message.data?.path,
            title: message.data?.title
          });
        } catch (error) {
          notify.error(say(`Failed to deploy assignment: ${error}`, `Die Aufgabe konnte nicht bereitgestellt werden: ${error}`));
        }
        break;


      case 'openRemoteRepo':
        await vscode.commands.executeCommand('computor.lecturer.openRemoteRepository', message.data);
        break;
    }
  }
}
