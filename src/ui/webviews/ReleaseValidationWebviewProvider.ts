import * as vscode from 'vscode';
import { ComputorApiService } from '../../services/ComputorApiService';
import { escapeHtml } from './shared/webviewHelpers';
import { renderWebviewPage } from './shared/webviewPage';

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
      '⚠️ Release Validation Failed',
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
          vscode.window.showInformationMessage(`Navigate to assignment: ${message.data?.courseContentId}`);
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
        <h2>⚠️ Cannot Release Course</h2>
        <p><strong>${escapeHtml(errors.error || 'Validation failed')}</strong></p>
        <p>Found ${errors.total_issues || 0} issue(s) that must be resolved before release.</p>
        <p style="margin-top: 10px; font-style: italic;">Course: ${escapeHtml(courseTitle)}</p>
      </div>

      <h3>Issues Found:</h3>
      <div class="error-list">
        ${(errors.validation_errors || []).map((error, index) => `
          <div class="error-item">
            <h3>${index + 1}. ${escapeHtml(error.title)}</h3>
            <div class="error-item-content">
              <div class="info-row">
                <span class="label">Path:</span>
                <span class="value"><span class="code">${escapeHtml(error.path)}</span></span>
              </div>
              <div class="info-row">
                <span class="label">Issue:</span>
                <span class="value">${escapeHtml(error.issue)}</span>
              </div>
              <div class="info-row">
                <span class="label">Content ID:</span>
                <span class="value"><span class="code">${escapeHtml(error.course_content_id)}</span></span>
              </div>
            </div>
            <div class="actions">
              <button class="btn-secondary" data-action="viewContent" data-id="${escapeHtml(error.course_content_id)}">
                View in Tree
              </button>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="next-steps">
        <h3>📝 Next Steps:</h3>
        <ol>
          <li>Review each assignment listed above</li>
          <li>Recreate assignments with examples assigned from the course tree</li>
          <li>After all assignments have examples, try releasing again</li>
        </ol>
        <p><strong>Need help?</strong> Each assignment must have an example assigned before you can release the course to students.</p>
      </div>

      <div class="close-row">
        <button class="btn-secondary" data-action="close">Close</button>
      </div>`;

    const inlineScript = `
      ComputorWebview.registerActions({
        viewContent: (d) => vscode.postMessage({ command: 'viewContent', data: { courseContentId: d.id } }),
        close: () => vscode.postMessage({ command: 'close' })
      });`;

    return renderWebviewPage(webview, this.extensionUri, {
      title: 'Release Validation Failed',
      bodyHtml,
      cssFiles: ['release-validation.css'],
      inlineScript
    });
  }
}
