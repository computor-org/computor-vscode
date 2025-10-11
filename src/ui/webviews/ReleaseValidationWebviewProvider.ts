import * as vscode from 'vscode';
import { ComputorApiService } from '../../services/ComputorApiService';

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
  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService
  ) {
    void context; // Unused but kept for consistency
    void apiService; // Unused but kept for future use
  }

  async showValidationErrors(errors: ValidationResult, courseTitle: string): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'releaseValidation',
      '⚠️ Release Validation Failed',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    panel.webview.html = this.getHtmlContent(errors, courseTitle);

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'assignExample':
          // Trigger assign example command
          vscode.commands.executeCommand('computor.lecturer.assignExample', {
            courseContent: { id: message.courseContentId }
          });
          break;
        case 'viewContent':
          // Could navigate to the content in the tree
          vscode.window.showInformationMessage(`Navigate to assignment: ${message.courseContentId}`);
          break;
        case 'close':
          panel.dispose();
          break;
      }
    });
  }

  private getHtmlContent(errors: ValidationResult, courseTitle: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
          }
          .error-summary {
            background: var(--vscode-inputValidation-errorBackground);
            border-left: 4px solid var(--vscode-inputValidation-errorBorder);
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 4px;
          }
          .error-summary h2 {
            margin: 0 0 10px 0;
            color: var(--vscode-errorForeground);
          }
          .error-summary p {
            margin: 5px 0;
          }
          .error-list {
            margin-top: 20px;
          }
          .error-item {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 20px;
            margin-bottom: 15px;
            border-radius: 6px;
          }
          .error-item h3 {
            margin: 0 0 10px 0;
            color: var(--vscode-foreground);
          }
          .error-item-content {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .info-row {
            display: flex;
            gap: 10px;
          }
          .label {
            font-weight: bold;
            color: var(--vscode-descriptionForeground);
            min-width: 120px;
          }
          .value {
            color: var(--vscode-foreground);
            flex: 1;
          }
          .code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
          }
          .actions {
            margin-top: 15px;
            display: flex;
            gap: 10px;
            padding-top: 15px;
            border-top: 1px solid var(--vscode-panel-border);
          }
          .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 14px;
          }
          .btn:hover {
            background: var(--vscode-button-hoverBackground);
          }
          .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }
          .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }
          .next-steps {
            margin-top: 30px;
            padding: 20px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
          }
          .next-steps h3 {
            margin: 0 0 15px 0;
          }
          .next-steps ol {
            margin: 10px 0;
            padding-left: 20px;
          }
          .next-steps li {
            margin: 8px 0;
          }
        </style>
      </head>
      <body>
        <div class="error-summary">
          <h2>⚠️ Cannot Release Course</h2>
          <p><strong>${this.escapeHtml(errors.error || 'Validation failed')}</strong></p>
          <p>Found ${errors.total_issues || 0} issue(s) that must be resolved before release.</p>
          <p style="margin-top: 10px; font-style: italic;">Course: ${this.escapeHtml(courseTitle)}</p>
        </div>

        <h3>Issues Found:</h3>
        <div class="error-list">
          ${(errors.validation_errors || []).map((error, index) => `
            <div class="error-item">
              <h3>${index + 1}. ${this.escapeHtml(error.title)}</h3>
              <div class="error-item-content">
                <div class="info-row">
                  <span class="label">Path:</span>
                  <span class="value"><span class="code">${this.escapeHtml(error.path)}</span></span>
                </div>
                <div class="info-row">
                  <span class="label">Issue:</span>
                  <span class="value">${this.escapeHtml(error.issue)}</span>
                </div>
                <div class="info-row">
                  <span class="label">Content ID:</span>
                  <span class="value"><span class="code">${this.escapeHtml(error.course_content_id)}</span></span>
                </div>
              </div>
              <div class="actions">
                <button class="btn" onclick="assignExample('${error.course_content_id}')">
                  Assign Example
                </button>
                <button class="btn btn-secondary" onclick="viewContent('${error.course_content_id}')">
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
            <li>Click "Assign Example" to assign an example and version to each assignment</li>
            <li>After assigning all examples, try releasing again</li>
          </ol>
          <p><strong>Need help?</strong> Each assignment must have an example assigned before you can release the course to students.</p>
        </div>

        <div style="margin-top: 20px; text-align: right;">
          <button class="btn btn-secondary" onclick="closePanel()">Close</button>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          function assignExample(courseContentId) {
            vscode.postMessage({
              command: 'assignExample',
              courseContentId: courseContentId
            });
          }

          function viewContent(courseContentId) {
            vscode.postMessage({
              command: 'viewContent',
              courseContentId: courseContentId
            });
          }

          function closePanel() {
            vscode.postMessage({
              command: 'close'
            });
          }
        </script>
      </body>
      </html>
    `;
  }

  private escapeHtml(text: string | undefined): string {
    if (!text) {
      return '';
    }
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m] || m);
  }
}
