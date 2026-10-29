import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { OrganizationGet } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, section, formGroup, textInput, textareaInput, detailGrid } from './shared/webviewHelpers';
import { notify } from '../../utils/notify';
import { say } from '../../utils/uiLanguage';

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
      return this.getBaseHtml(say('Organization', 'Organisation'), say('<p>No organization data available</p>', '<p>Keine Daten zur Organisation verfügbar</p>'));
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
      <p>${say('Organization', 'Organisation')}</p>`;

    const detailsHtml = section(say('Organization', 'Organisation'), `
      ${detailGrid(`
      ${infoRowCode('ID', organization.id)}
      ${infoRowCode(say('Path', 'Pfad'), organization.path)}
      ${infoRowText(say('Course Families', 'Kursfamilien'), String(courseFamiliesCount))}
    `)}
      <form id="editForm">
        ${formGroup(say('Title', 'Titel'), textInput('title', organization.title, { required: true, placeholder: say('Organization title', 'Titel der Organisation') }))}
        ${formGroup(say('Description', 'Beschreibung'), textareaInput('description', organization.description, { placeholder: say('Organization description', 'Beschreibung der Organisation') }))}
        <div class="actions">
          <button type="submit">${say('Save Changes', 'Änderungen speichern')}</button>
          <button type="button" class="btn-secondary" data-action="refreshData">${say('Refresh', 'Aktualisieren')}</button>
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

    return this.renderPage({ title: say('Organization', 'Organisation'), headerHtml, bodyHtml: detailsHtml, inlineScript: scriptHtml });
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateOrganization':
        try {
          await this.apiService.updateOrganization(message.data.organizationId, message.data.updates);
          notify.info(say('Organization updated successfully', 'Die Organisation wurde aktualisiert.'));

          if (this.treeDataProvider) {
            this.treeDataProvider.updateNode('organization', message.data.organizationId, message.data.updates);
          } else {
            vscode.commands.executeCommand('computor.lecturer.refresh');
          }
        } catch (error) {
          notify.error(say(`Failed to update organization: ${error}`, `Die Organisation konnte nicht aktualisiert werden: ${error}`));
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
            notify.error(say(`Failed to refresh: ${error}`, `Aktualisieren fehlgeschlagen: ${error}`));
          }
        }
        break;
    }
  }
}
