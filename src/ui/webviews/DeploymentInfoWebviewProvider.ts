import * as vscode from 'vscode';
import { ComputorApiService } from '../../services/ComputorApiService';

export class DeploymentInfoWebviewProvider {
  constructor(
    context: vscode.ExtensionContext,
    private apiService: ComputorApiService
  ) {
    void context; // Unused but kept for consistency with other webview providers
  }

  async showDeploymentInfo(courseContentId: string, courseContentTitle: string): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'deploymentInfo',
      `Deployment: ${courseContentTitle}`,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    try {
      const deployment = await this.apiService.lecturerGetDeployment(courseContentId);

      panel.webview.html = this.getHtmlContent(deployment, courseContentTitle);

      // Handle messages from webview
      panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
          case 'refresh':
            try {
              const updatedDeployment = await this.apiService.lecturerGetDeployment(courseContentId);
              panel.webview.postMessage({
                type: 'deploymentUpdate',
                deployment: updatedDeployment
              });
            } catch (error: any) {
              vscode.window.showErrorMessage(`Failed to refresh deployment: ${error.message}`);
            }
            break;
        }
      });

    } catch (error: any) {
      panel.webview.html = this.getErrorHtml(error.message || 'Failed to load deployment information');
    }
  }

  private getHtmlContent(deployment: any, courseContentTitle: string): string {
    const statusColors: Record<string, string> = {
      pending: '#FFA500',
      deployed: '#107c10',
      failed: '#d13438',
      deploying: '#0078d4',
      unassigned: '#666666'
    };

    const status = deployment?.deployment_status || 'unassigned';
    const statusColor = statusColors[status] || '#666666';

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
          .header {
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          h1 {
            margin: 0;
            font-size: 24px;
            color: var(--vscode-foreground);
          }
          .section {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 20px;
            border-radius: 6px;
            margin-bottom: 20px;
          }
          .section h2 {
            margin-top: 0;
            font-size: 18px;
            color: var(--vscode-foreground);
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .label {
            font-weight: bold;
            color: var(--vscode-descriptionForeground);
          }
          .value {
            color: var(--vscode-foreground);
          }
          .status-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 4px;
            font-weight: bold;
            background-color: ${statusColor};
            color: white;
          }
          .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
          }
          .actions {
            margin-top: 20px;
            display: flex;
            gap: 10px;
          }
          button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 14px;
          }
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          .code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📦 Deployment Information</h1>
          <p>Assignment: <strong>${this.escapeHtml(courseContentTitle)}</strong></p>
        </div>

        ${deployment ? this.getDeploymentSection(deployment) : this.getEmptyState()}

        <div class="actions">
          <button onclick="refreshDeployment()">🔄 Refresh</button>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          function refreshDeployment() {
            vscode.postMessage({ command: 'refresh' });
          }

          window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'deploymentUpdate') {
              // Reload the page with new data
              location.reload();
            }
          });
        </script>
      </body>
      </html>
    `;
  }

  private getDeploymentSection(deployment: any): string {
    const statusIcons: Record<string, string> = {
      pending: '⏳',
      deployed: '✅',
      failed: '❌',
      deploying: '🚀',
      unassigned: '⚠️'
    };

    const status = deployment.deployment_status || 'unassigned';
    const statusIcon = statusIcons[status] || '❓';

    return `
      <div class="section">
        <h2>Status</h2>
        <div class="info-row">
          <span class="label">Current Status:</span>
          <span class="value"><span class="status-badge">${statusIcon} ${status.toUpperCase()}</span></span>
        </div>
        ${deployment.assigned_at ? `
        <div class="info-row">
          <span class="label">Assigned:</span>
          <span class="value">${new Date(deployment.assigned_at).toLocaleString()}</span>
        </div>
        ` : ''}
        ${deployment.deployed_at ? `
        <div class="info-row">
          <span class="label">Deployed:</span>
          <span class="value">${new Date(deployment.deployed_at).toLocaleString()}</span>
        </div>
        ` : ''}
        ${deployment.deployment_message ? `
        <div class="info-row">
          <span class="label">Message:</span>
          <span class="value">${this.escapeHtml(deployment.deployment_message)}</span>
        </div>
        ` : ''}
      </div>

      ${deployment.example_id ? `
      <div class="section">
        <h2>Assigned Example</h2>
        <div class="info-row">
          <span class="label">Example ID:</span>
          <span class="value"><span class="code">${this.escapeHtml(deployment.example_id)}</span></span>
        </div>
        ${deployment.version_tag ? `
        <div class="info-row">
          <span class="label">Version Tag:</span>
          <span class="value"><span class="code">${this.escapeHtml(deployment.version_tag)}</span></span>
        </div>
        ` : ''}
        ${deployment.deployment_path ? `
        <div class="info-row">
          <span class="label">Deployment Path:</span>
          <span class="value"><span class="code">${this.escapeHtml(deployment.deployment_path)}</span></span>
        </div>
        ` : ''}
      </div>
      ` : ''}

      ${status === 'deployed' || status === 'deploying' ? `
      <div class="section">
        <p class="value">⚠️ <strong>Note:</strong> Cannot unassign while status is "${status}". Unassignment is only allowed for pending or failed deployments.</p>
      </div>
      ` : ''}
    `;
  }

  private getEmptyState(): string {
    return `
      <div class="empty-state">
        <p>⚠️ No deployment information available</p>
        <p>This assignment has not been assigned an example yet.</p>
      </div>
    `;
  }

  private getErrorHtml(errorMessage: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: var(--vscode-font-family);
            padding: 40px;
            text-align: center;
            color: var(--vscode-errorForeground);
          }
        </style>
      </head>
      <body>
        <h2>❌ Error</h2>
        <p>${this.escapeHtml(errorMessage)}</p>
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
