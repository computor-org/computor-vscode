import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { OrganizationGet } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, textareaInput } from './shared/webviewHelpers';
import { notify } from '../../utils/notify';

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
    if (!data?.organization) {
      return this.getBaseHtml('Organization', '<p>No organization data available</p>');
    }

    const { organization } = data;

    let courseFamiliesCount = 0;
    try {
      const families = await this.apiService.getCourseFamilies(organization.id);
      courseFamiliesCount = families.length;
    } catch (error) {
      console.error('Failed to get course families:', error);
    }

    const headerHtml = `
      <h1>${escapeHtml(organization.title || organization.path)}</h1>
      <p>Organization</p>`;

    const infoHtml = section('Information', `
      ${infoRowCode('ID', organization.id)}
      ${infoRowCode('Path', organization.path)}
      ${infoRowText('Title', organization.title)}
      ${infoRowText('Description', organization.description)}
      ${infoRowText('Course Families', String(courseFamiliesCount))}
    `);

    const editHtml = section('Edit Organization', `
      <form id="editForm">
        ${formGroup('Title', textInput('title', organization.title, { required: true, placeholder: 'Organization title' }))}
        ${formGroup('Description', textareaInput('description', organization.description, { placeholder: 'Organization description' }))}
        <div class="actions">
          <button type="submit">Save Changes</button>
          <button type="button" class="btn-secondary" data-action="refreshData">Refresh</button>
        </div>
      </form>
    `);

    const scriptHtml = `
      const orgId = ${JSON.stringify(organization.id)};

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        vscode.postMessage({
          command: 'updateOrganization',
          data: {
            organizationId: orgId,
            updates: {
              title: document.getElementById('title').value,
              description: document.getElementById('description').value
            }
          }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { organizationId: orgId } });
      }

      ComputorWebview.registerActions({ refreshData: refreshData });
      ComputorWebview.onCommand('updateState', function() { location.reload(); });
    `;

    return this.renderPage({ title: 'Organization', headerHtml, bodyHtml: infoHtml + editHtml, inlineScript: scriptHtml });
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateOrganization':
        try {
          await this.apiService.updateOrganization(message.data.organizationId, message.data.updates);
          notify.info('Organization updated successfully');

          if (this.treeDataProvider) {
            this.treeDataProvider.updateNode('organization', message.data.organizationId, message.data.updates);
          } else {
            vscode.commands.executeCommand('computor.lecturer.refresh');
          }
        } catch (error) {
          notify.error(`Failed to update organization: ${error}`);
        }
        break;

      case 'refresh':
        if (message.data.organizationId) {
          try {
            const organization = await this.apiService.getOrganization(message.data.organizationId);
            if (organization && this.panel) {
              this.currentData = { organization };
              this.panel.webview.html = await this.getWebviewContent(this.currentData);
            }
          } catch (error) {
            notify.error(`Failed to refresh: ${error}`);
          }
        }
        break;
    }
  }
}
