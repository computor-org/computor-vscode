import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerExampleTreeProvider } from '../tree/lecturer/LecturerExampleTreeProvider';
import { writeExampleFiles } from '../../utils/exampleFileWriter';
import { bumpVersion, normalizeSemVer } from '../../utils/versionHelpers';
import { readMetaYamlVersion, updateMetaYamlVersion } from '../../utils/metaYamlHelpers';
import { writeCheckoutMetadata, getWorkingPath, getVersionPath } from '../../utils/checkedOutExampleManager';
import { WorkspaceStructureManager } from '../../utils/workspaceStructure';
import type { ExampleList, ExampleRepositoryList, ExampleVersionList } from '../../types/generated';
import type { BumpPart } from '../../utils/versionHelpers';
import * as fs from 'fs';

interface ExampleDetailData {
  example: ExampleList;
  repository: ExampleRepositoryList;
  isDownloaded: boolean;
  downloadPath?: string;
  currentVersion?: string;
}

export class ExampleDetailWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeProvider: LecturerExampleTreeProvider;

  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService,
    treeProvider: LecturerExampleTreeProvider
  ) {
    super(context, 'computor.exampleDetailView');
    this.apiService = apiService;
    this.treeProvider = treeProvider;
  }

  protected async getWebviewContent(data?: ExampleDetailData): Promise<string> {
    if (!this.panel || !data) {
      return this.getBaseHtml('Example', '<p>Loading...</p>');
    }

    const versions = await this.apiService.getExampleVersions(data.example.id);
    const latestVersion = this.getLatestVersion(versions);

    let localVersion: string | undefined;
    if (data.downloadPath && fs.existsSync(data.downloadPath)) {
      localVersion = readMetaYamlVersion(data.downloadPath);
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'example-details.js');

    const initialState = JSON.stringify({
      example: data.example,
      repository: data.repository,
      versions,
      latestVersion,
      isDownloaded: data.isDownloaded,
      downloadPath: data.downloadPath,
      localVersion: localVersion ? normalizeSemVer(localVersion) : undefined,
      currentVersion: data.currentVersion
    });

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Example: ${data.example.title}</title>
      <style>
        body { padding: 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
        h2 { margin-top: 0; color: var(--vscode-titleBar-activeForeground); }
        .section { margin-bottom: 20px; }
        .section-title { font-weight: 600; margin-bottom: 8px; font-size: 13px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
        .field { margin-bottom: 8px; }
        .field-label { font-weight: 500; color: var(--vscode-descriptionForeground); font-size: 12px; }
        .field-value { margin-top: 2px; }
        .tag { display: inline-block; padding: 2px 8px; margin: 2px; border-radius: 10px; font-size: 12px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .version-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--vscode-widget-border); }
        .version-row.latest { font-weight: 600; }
        .version-tag { min-width: 80px; }
        .version-number { color: var(--vscode-descriptionForeground); font-size: 12px; }
        .version-date { color: var(--vscode-descriptionForeground); font-size: 12px; margin-left: auto; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; border-radius: 4px; font-size: 13px; }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
        .btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .btn:disabled { opacity: 0.5; cursor: default; }
        .bump-group { display: flex; gap: 4px; }
        .bump-group .btn { padding: 4px 10px; font-size: 12px; }
        .info-box { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); padding: 10px 14px; margin: 8px 0; font-size: 13px; }
        .status-downloaded { color: var(--vscode-testing-iconPassed); }
        .status-not-downloaded { color: var(--vscode-descriptionForeground); }
      </style>
    </head>
    <body>
      <div id="app"></div>
      <script nonce="${nonce}">
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'checkoutVersion':
        await this.handleCheckout(message.data.versionId);
        break;
      case 'checkoutLatest':
        await this.handleCheckout();
        break;
      case 'bumpVersion':
        await this.handleBumpVersion(message.data.part);
        break;
      case 'upload':
        await this.handleUpload();
        break;
      case 'refresh':
        await this.refreshData();
        break;
    }
  }

  private getExamplesPath(): string | undefined {
    try {
      return WorkspaceStructureManager.getInstance().getExamplesPath();
    } catch {
      return undefined;
    }
  }

  private getVersionsPath(): string | undefined {
    try {
      return WorkspaceStructureManager.getInstance().getExampleVersionsPath();
    } catch {
      return undefined;
    }
  }

  private async handleCheckout(versionId?: string): Promise<void> {
    const data = this.currentData as ExampleDetailData | undefined;
    if (!data) { return; }

    const examplesPath = this.getExamplesPath();
    if (!examplesPath) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }

    try {
      const exampleData = versionId
        ? await this.apiService.downloadExampleVersion(versionId)
        : await this.apiService.downloadExample(data.example.id, false);

      if (!exampleData) {
        vscode.window.showErrorMessage('Failed to download example');
        return;
      }

      const resolvedTag = exampleData.version_tag;
      const metadata = {
        exampleId: data.example.id,
        repositoryId: data.repository.id,
        directory: data.example.directory,
        versionId: versionId || exampleData.version_id || '',
        versionTag: resolvedTag,
        versionNumber: 0,
        checkedOutAt: new Date().toISOString()
      };

      // Create working directory
      const workingDir = getWorkingPath(examplesPath, data.example.directory);
      if (fs.existsSync(workingDir)) {
        const overwrite = await vscode.window.showWarningMessage(
          `Working copy of '${data.example.directory}' already exists. Overwrite?`, 'Yes', 'No'
        );
        if (overwrite !== 'Yes') { return; }
        fs.rmSync(workingDir, { recursive: true, force: true });
      }

      fs.mkdirSync(workingDir, { recursive: true });
      writeExampleFiles(exampleData.files, workingDir);
      writeCheckoutMetadata(workingDir, metadata);

      // Also create version snapshot in example_versions/
      const versionsPath = this.getVersionsPath();
      if (versionsPath) {
        const versionDir = getVersionPath(versionsPath, data.example.directory, resolvedTag);
        if (fs.existsSync(versionDir)) {
          fs.rmSync(versionDir, { recursive: true, force: true });
        }
        fs.mkdirSync(versionDir, { recursive: true });
        fs.cpSync(workingDir, versionDir, { recursive: true });
      }

      data.isDownloaded = true;
      data.downloadPath = workingDir;
      data.currentVersion = resolvedTag;

      this.treeProvider.refresh();
      vscode.window.showInformationMessage(`Checked out '${data.example.title}' [${resolvedTag}]`);
      await this.refreshData();
    } catch (error) {
      vscode.window.showErrorMessage(`Checkout failed: ${error}`);
    }
  }

  private async handleBumpVersion(part: BumpPart): Promise<void> {
    const data = this.currentData as ExampleDetailData | undefined;
    if (!data?.downloadPath || !fs.existsSync(data.downloadPath)) {
      vscode.window.showErrorMessage('Example not checked out locally');
      return;
    }

    try {
      const currentVersion = readMetaYamlVersion(data.downloadPath);
      if (!currentVersion) {
        vscode.window.showErrorMessage('No version field found in meta.yaml');
        return;
      }

      const newVersion = bumpVersion(currentVersion, part);
      updateMetaYamlVersion(data.downloadPath, newVersion);

      this.treeProvider.refresh();
      vscode.window.showInformationMessage(`Version bumped: ${normalizeSemVer(currentVersion)} -> ${newVersion}`);
      await this.refreshData();
    } catch (error) {
      vscode.window.showErrorMessage(`Version bump failed: ${error}`);
    }
  }

  private async handleUpload(): Promise<void> {
    const data = this.currentData as ExampleDetailData | undefined;
    if (!data?.downloadPath || !fs.existsSync(data.downloadPath)) {
      vscode.window.showErrorMessage('Example not checked out locally');
      return;
    }

    const confirm = await vscode.window.showInformationMessage(
      `Upload example "${data.example.title}" from local directory?`, 'Yes', 'No'
    );
    if (confirm !== 'Yes') { return; }

    await vscode.commands.executeCommand('computor.lecturer.uploadExample', {
      example: data.example,
      repository: data.repository,
      isDownloaded: true,
      downloadPath: data.downloadPath
    });
  }

  private async refreshData(): Promise<void> {
    const data = this.currentData as ExampleDetailData | undefined;
    if (!data || !this.panel) { return; }

    const versions = await this.apiService.getExampleVersions(data.example.id);
    const latestVersion = this.getLatestVersion(versions);

    let localVersion: string | undefined;
    if (data.downloadPath && fs.existsSync(data.downloadPath)) {
      localVersion = readMetaYamlVersion(data.downloadPath);
    }

    this.panel.webview.postMessage({
      command: 'update',
      data: {
        example: data.example,
        repository: data.repository,
        versions,
        latestVersion,
        isDownloaded: data.isDownloaded,
        downloadPath: data.downloadPath,
        localVersion: localVersion ? normalizeSemVer(localVersion) : undefined,
        currentVersion: data.currentVersion
      }
    });
  }

  private getLatestVersion(versions: ExampleVersionList[]): ExampleVersionList | undefined {
    if (versions.length === 0) { return undefined; }
    return versions.reduce((latest, current) =>
      current.version_number > latest.version_number ? current : latest
    );
  }
}
