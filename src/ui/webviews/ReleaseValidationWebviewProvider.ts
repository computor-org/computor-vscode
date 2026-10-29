import * as vscode from 'vscode';
import { ComputorApiService } from '../../services/ComputorApiService';
import { escapeHtml } from './shared/webviewHelpers';
import { renderWebviewPage } from './shared/webviewPage';
import { notify } from '../../utils/notify';
import { say } from '../../utils/uiLanguage';

interface ValidationError {
  course_content_id: string;
  title: string;
  path: string;
  issue: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  validation_errors?: ValidationError[];
  total_issues?: number;
}

export class ReleaseValidationWebviewProvider {
  private readonly extensionUri: vscode.Uri;

  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService
  ) {
    this.extensionUri = context.extensionUri;
    void apiService; // Unused but kept for future use
  }

  async showValidationErrors(errors: ValidationResult, courseTitle: string): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'releaseValidation',
      say('⚠️ Release Validation Failed', '⚠️ Prüfung vor der Freigabe fehlgeschlagen'),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'webview-ui')]
      }
    );

    panel.webview.html = this.getHtmlContent(panel.webview, errors, courseTitle);

    panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'viewContent':
          // Could navigate to the content in the tree
          notify.info(say(`Navigate to assignment: ${message.data?.courseContentId}`, `Zur Aufgabe wechseln: ${message.data?.courseContentId}`));
          break;
        case 'close':
          panel.dispose();
          break;
      }
    });
  }

  private getHtmlContent(webview: vscode.Webview, errors: ValidationResult, courseTitle: string): string {
    const bodyHtml = `
      <div class="error-summary">
        <h2>⚠️ ${say('Cannot Release Course', 'Kurs kann nicht freigegeben werden')}</h2>
        <p><strong>${escapeHtml(errors.error || say('Validation failed', 'Prüfung fehlgeschlagen'))}</strong></p>
        <p>${say(`Found ${errors.total_issues || 0} issue(s) that must be resolved before release.`, `${errors.total_issues || 0} Problem(e) gefunden, die vor der Freigabe behoben werden müssen.`)}</p>
        <p style="margin-top: 10px; font-style: italic;">${say('Course', 'Kurs')}: ${escapeHtml(courseTitle)}</p>
      </div>

      <h3>${say('Issues Found:', 'Gefundene Probleme:')}</h3>
      <div class="error-list">
        ${(errors.validation_errors || []).map((error, index) => `
          <div class="error-item">
            <h3>${index + 1}. ${escapeHtml(error.title)}</h3>
            <div class="error-item-content">
              <div class="info-row">
                <span class="label">${say('Path:', 'Pfad:')}</span>
                <span class="value"><span class="code">${escapeHtml(error.path)}</span></span>
              </div>
              <div class="info-row">
                <span class="label">${say('Issue:', 'Problem:')}</span>
                <span class="value">${escapeHtml(error.issue)}</span>
              </div>
              <div class="info-row">
                <span class="label">${say('Content ID:', 'Inhalts-ID:')}</span>
                <span class="value"><span class="code">${escapeHtml(error.course_content_id)}</span></span>
              </div>
            </div>
            <div class="actions">
              <button class="btn-secondary" data-action="viewContent" data-id="${escapeHtml(error.course_content_id)}">
                ${say('View in Tree', 'Im Baum anzeigen')}
              </button>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="next-steps">
        <h3>📝 ${say('Next Steps:', 'Nächste Schritte:')}</h3>
        <ol>
          <li>${say('Review each assignment listed above', 'Prüfe jede oben aufgeführte Aufgabe')}</li>
          <li>${say('Recreate assignments with examples assigned from the course tree', 'Lege die Aufgaben im Kursbaum mit zugewiesenem Beispiel neu an')}</li>
          <li>${say('After all assignments have examples, try releasing again', 'Sobald alle Aufgaben ein Beispiel haben, gib den Kurs erneut frei')}</li>
        </ol>
        <p><strong>${say('Need help?', 'Hilfe gefällig?')}</strong> ${say('Each assignment must have an example assigned before you can release the course to students.', 'Jeder Aufgabe muss ein Beispiel zugewiesen sein, bevor du den Kurs für Studierende freigeben kannst.')}</p>
      </div>

      <div class="close-row">
        <button class="btn-secondary" data-action="close">${say('Close', 'Schließen')}</button>
      </div>`;

    const inlineScript = `
      ComputorWebview.registerActions({
        viewContent: (d) => vscode.postMessage({ command: 'viewContent', data: { courseContentId: d.id } }),
        close: () => vscode.postMessage({ command: 'close' })
      });`;

    return renderWebviewPage(webview, this.extensionUri, {
      title: say('Release Validation Failed', 'Prüfung vor der Freigabe fehlgeschlagen'),
      bodyHtml,
      cssFiles: ['content/release-validation.css'],
      inlineScript
    });
  }
}
