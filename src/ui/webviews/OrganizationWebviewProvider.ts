import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { OrganizationGet } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';

export class OrganizationWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService, treeDataProvider?: LecturerTreeDataProvider) {
    super(context, 'computor.organizationView');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  protected async getWebviewContent(data?: {
    organization: OrganizationGet;
  }): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Organization', '<p>Loading…</p>');
    }

    if (!data) {
      return this.getBaseHtml('Organization', '<p>No organization data available</p>');
    }

    const { organization } = data;

    // Get course families count
    let courseFamiliesCount = 0;
    try {
      const families = await this.apiService.getCourseFamilies(organization.id);
      courseFamiliesCount = families.length;
    } catch (error) {
      console.error('Failed to get course families:', error);
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify({ organization, courseFamiliesCount });
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'organization-details.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'organization-details.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Organization Details</title>
      <link rel="stylesheet" href="${componentsCssUri}">
      <link rel="stylesheet" href="${stylesUri}">
    </head>
    <body>
      <div id="app" class="view-root"></div>
      <script nonce="${nonce}">
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${nonce}" src="${componentsJsUri}"></script>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateOrganization':
        try {
          await this.apiService.updateOrganization(message.data.organizationId, message.data.updates);
          vscode.window.showInformationMessage('Organization updated successfully');
          
          // Update tree with changes
          if (this.treeDataProvider) {
            this.treeDataProvider.updateNode('organization', message.data.organizationId, message.data.updates);
          } else {
            vscode.commands.executeCommand('computor.lecturer.refresh');
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to update organization: ${error}`);
        }
        break;

      case 'refresh':
        if (message.data.organizationId) {
          try {
            const organization = await this.apiService.getOrganization(message.data.organizationId);
            if (organization && this.currentData) {
              this.currentData.organization = organization;

              // Get updated course families count
              let courseFamiliesCount = 0;
              try {
                const families = await this.apiService.getCourseFamilies(organization.id);
                courseFamiliesCount = families.length;
              } catch (error) {
                console.error('Failed to get course families:', error);
              }

              this.panel?.webview.postMessage({
                command: 'updateState',
                data: { organization, courseFamiliesCount }
              });
              vscode.window.showInformationMessage('Organization refreshed');
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh: ${error}`);
          }
        }
        break;
    }
  }
}