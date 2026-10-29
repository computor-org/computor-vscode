import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseGet, CourseFamilyList, OrganizationList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, detailGrid } from './shared/webviewHelpers';
import { notify } from '../../utils/notify';
import { say } from '../../utils/uiLanguage';
import { EDIT_DESCRIPTION_COMMAND } from '../descriptionEditor';

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
      return this.getBaseHtml(say('Course', 'Kurs'), say('<p>No course data available</p>', '<p>Keine Kursdaten verfügbar</p>'));
    }

    const { course, courseFamily, organization } = data;
    // Shown, not edited. A course's git binding is fixed once the repositories
    // are materialised, and this field never reached the server anyway —
    // CourseUpdate carries no git fields, so anything typed here was dropped
    // (computor-org/issues#326). Configure git via "Configure Course Git".
    const gitUrl = (course as any).properties?.gitlab?.url || '';

    const headerHtml = `
      <h1>${escapeHtml(course.title || course.path)}</h1>
      <p>${say('Course in', 'Kurs in')} ${escapeHtml(courseFamily?.title || courseFamily?.path)} / ${escapeHtml(organization?.title || organization?.path)}</p>`;

    const detailsHtml = section(say('Course', 'Kurs'), `
      ${detailGrid(`
      ${infoRowCode('ID', course.id)}
      ${infoRowCode(say('Path', 'Pfad'), course.path)}
      ${infoRowText(say('Course Family', 'Kursfamilie'), courseFamily?.title || courseFamily?.path)}
      ${infoRowText(say('Organization', 'Organisation'), organization?.title || organization?.path)}
      ${gitUrl ? infoRowCode(say('Git Repository', 'Git-Repository'), gitUrl) : ''}
    `)}
      <form id="editForm">
        ${formGroup(say('Title', 'Titel'), textInput('title', course.title, { placeholder: say('Course title', 'Titel des Kurses') }))}
        ${formGroup(
          say('Default Max Test Runs', 'Standard-Höchstzahl der Testläufe'),
          textInput('maxTestRuns', String((course as any).max_test_runs ?? ''), { type: 'number', min: 0, placeholder: say('empty = unlimited', 'leer = unbegrenzt') }),
          say('Applies to assignments that set no limit of their own.', 'Gilt für Aufgaben ohne eigenes Limit.')
        )}
        ${formGroup(
          say('Default Max Submissions', 'Standard-Höchstzahl der Abgaben'),
          textInput('maxSubmissions', String((course as any).max_submissions ?? ''), { type: 'number', min: 0, placeholder: say('empty = unlimited', 'leer = unbegrenzt') }),
          say('Applies to assignments that set no limit of their own. A tutor can still grant one student extra attempts.', 'Gilt für Aufgaben ohne eigenes Limit. Tutor:innen können einzelnen Studierenden weiterhin zusätzliche Versuche gewähren.')
        )}
        <div class="actions">
          <button type="submit">${say('Save Changes', 'Änderungen speichern')}</button>
          <button type="button" class="btn-secondary" data-action="refreshData">${say('Refresh', 'Aktualisieren')}</button>
          <button type="button" class="btn-secondary" data-action="editDescription">${say('Edit Description...', 'Beschreibung bearbeiten …')}</button>
        </div>
      </form>
    `);


    const scriptHtml = `
      const courseId = ${JSON.stringify(course.id)};

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        // Empty means unlimited, 0 means zero: \`parseInt(v) || null\` conflates
        // the two and silently turns a deliberate 0 into unlimited.
        function limitValue(el) {
          if (!el) { return null; }
          var raw = String(el.value).trim();
          if (raw === '') { return null; }
          var parsed = parseInt(raw, 10);
          return isNaN(parsed) ? null : parsed;
        }
        vscode.postMessage({
          command: 'updateCourse',
          data: {
            courseId: courseId,
            updates: {
              title: document.getElementById('title').value,
              max_test_runs: limitValue(document.getElementById('maxTestRuns')),
              max_submissions: limitValue(document.getElementById('maxSubmissions'))
            }
          }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { courseId: courseId } });
      }

      function editDescription() {
        vscode.postMessage({ command: 'editDescription' });
      }

      ComputorWebview.registerActions({ refreshData: refreshData, editDescription: editDescription });
      ComputorWebview.onCommand('updateState', function() { location.reload(); });
    `;

    return this.renderPage({ title: say('Course', 'Kurs'), headerHtml, bodyHtml: detailsHtml, inlineScript: scriptHtml });
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateCourse':
        try {
          await this.apiService.updateCourse(message.data.courseId, message.data.updates);
          notify.info(say('Course updated successfully', 'Der Kurs wurde aktualisiert.'));

          if (this.treeDataProvider) {
            this.treeDataProvider.updateNode('course', message.data.courseId, message.data.updates);
          }
        } catch (error) {
          notify.error(say(`Failed to update course: ${error}`, `Der Kurs konnte nicht aktualisiert werden: ${error}`));
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
            notify.error(say(`Failed to refresh: ${error}`, `Aktualisieren fehlgeschlagen: ${error}`));
          }
        }
        break;

      // The description is markdown and belongs in an editor with a preview,
      // not in a textarea on this form (computor-org/issues#356).
      case 'editDescription': {
        const course = (this.currentData as any)?.course;
        if (course?.id) {
          await vscode.commands.executeCommand(EDIT_DESCRIPTION_COMMAND, { course });
        }
        break;
      }
    }
  }
}
