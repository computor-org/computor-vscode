import * as vscode from 'vscode';
import { ComputorApiService } from '../../services/ComputorApiService';
import { escapeHtml, statusBadge, deploymentStatusColor, section, infoRow } from './shared/webviewHelpers';
import { renderWebviewPage } from './shared/webviewPage';

export class DeploymentInfoWebviewProvider {
  private readonly extensionUri: vscode.Uri;

  constructor(
    context: vscode.ExtensionContext,
    private apiService: ComputorApiService
  ) {
    this.extensionUri = context.extensionUri;
  }

  async showDeploymentInfo(courseContentId: string, courseContentTitle: string): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'deploymentInfo',
      `Deployment: ${courseContentTitle}`,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'webview-ui')]
      }
    );

    try {
      const deployment = await this.apiService.lecturerGetDeployment(courseContentId);

      panel.webview.html = this.getHtmlContent(panel.webview, deployment, courseContentTitle);

      panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
          case 'refresh':
            try {
              const updatedDeployment = await this.apiService.lecturerGetDeployment(courseContentId);
              panel.webview.html = this.getHtmlContent(panel.webview, updatedDeployment, courseContentTitle);
            } catch (error: any) {
              vscode.window.showErrorMessage(`Failed to refresh deployment: ${error.message}`);
            }
            break;
        }
      });

    } catch (error: any) {
      panel.webview.html = this.getErrorHtml(panel.webview, error.message || 'Failed to load deployment information');
    }
  }

  private getHtmlContent(webview: vscode.Webview, deployment: any, courseContentTitle: string): string {
    const headerHtml = `
      <h1>📦 Deployment Information</h1>
      <p>Assignment: <strong>${escapeHtml(courseContentTitle)}</strong></p>`;

    const bodyHtml = `
      ${deployment ? this.getDeploymentSection(deployment) : this.getEmptyState()}
      <div class="actions">
        <button data-action="refresh">🔄 Refresh</button>
      </div>`;

    const inlineScript = `
      ComputorWebview.registerActions({
        refresh: () => vscode.postMessage({ command: 'refresh' })
      });`;

    return renderWebviewPage(webview, this.extensionUri, {
      title: `Deployment: ${courseContentTitle}`,
      headerHtml,
      bodyHtml,
      inlineScript
    });
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

    const statusHtml = section('Status', `
      ${infoRow('Current Status', statusBadge(`${statusIcon} ${status.toUpperCase()}`, deploymentStatusColor(status)))}
      ${deployment.assigned_at ? infoRow('Assigned', escapeHtml(new Date(deployment.assigned_at).toLocaleString())) : ''}
      ${deployment.deployed_at ? infoRow('Deployed', escapeHtml(new Date(deployment.deployed_at).toLocaleString())) : ''}
      ${deployment.deployment_message ? infoRow('Message', escapeHtml(deployment.deployment_message)) : ''}
    `);

    const exampleHtml = deployment.example_id ? section('Assigned Example', `
      ${infoRow('Example ID', `<span class="code">${escapeHtml(deployment.example_id)}</span>`)}
      ${deployment.version_tag ? infoRow('Version Tag', `<span class="code">${escapeHtml(deployment.version_tag)}</span>`) : ''}
      ${deployment.deployment_path ? infoRow('Deployment Path', `<span class="code">${escapeHtml(deployment.deployment_path)}</span>`) : ''}
    `) : '';

    const noteHtml = status === 'deployed' || status === 'deploying'
      ? `<div class="notice warning">⚠️ <strong>Note:</strong> Cannot unassign while status is "${escapeHtml(status)}". Unassignment is only allowed for pending or failed deployments.</div>`
      : '';

    return statusHtml + exampleHtml + noteHtml;
  }

  private getEmptyState(): string {
    return `
      <div class="empty-state">
        <p>⚠️ No deployment information available</p>
        <p>This assignment has not been assigned an example yet.</p>
      </div>`;
  }

  private getErrorHtml(webview: vscode.Webview, errorMessage: string): string {
    return renderWebviewPage(webview, this.extensionUri, {
      title: 'Deployment Information',
      bodyHtml: `
        <div class="empty-state">
          <div class="empty-state-icon">❌</div>
          <div class="empty-state-title">Error</div>
          <p>${escapeHtml(errorMessage)}</p>
        </div>`
    });
  }
}
