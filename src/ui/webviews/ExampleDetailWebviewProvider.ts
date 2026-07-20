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
import { notify } from '../../utils/notify';

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

    return this.renderPage({
      title: `Example: ${data.example.title}`,
      bodyHtml: '<div id="app"></div>',
      cssFiles: ['example-details.css'],
      scriptFiles: ['example-details.js'],
      initialState: {
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
      notify.error('No workspace folder open.');
      return;
    }

    try {
      const exampleData = versionId
        ? await this.apiService.downloadExampleVersion(versionId)
        : await this.apiService.downloadExample(data.example.id, false);

      if (!exampleData) {
        notify.error('Failed to download example');
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

      // Resolve both destructive targets up front so a single confirmation can
      // gate every fs.rmSync below.
      const workingDir = getWorkingPath(examplesPath, data.example.directory);
      const versionsPath = this.getVersionsPath();
      const versionDir = versionsPath
        ? getVersionPath(versionsPath, data.example.directory, resolvedTag)
        : undefined;

      // A modal confirmation (Cancel is added automatically) so an existing
      // local copy is never deleted by a dismissible, easily-missed popup.
      const willOverwrite = fs.existsSync(workingDir) || (versionDir ? fs.existsSync(versionDir) : false);
      if (willOverwrite) {
        const overwrite = await notify.confirm(
          `A local copy of '${data.example.directory}' already exists and will be replaced.`,
          'Overwrite'
        );
        if (!overwrite) { return; }
      }

      // Create working directory
      if (fs.existsSync(workingDir)) {
        fs.rmSync(workingDir, { recursive: true, force: true });
      }
      fs.mkdirSync(workingDir, { recursive: true });
      writeExampleFiles(exampleData.files, workingDir);
      writeCheckoutMetadata(workingDir, metadata);

      // Also create version snapshot in example_versions/
      if (versionDir) {
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
      notify.info(`Checked out '${data.example.title}' [${resolvedTag}]`);
      await this.refreshData();
    } catch (error) {
      notify.error(`Checkout failed: ${error}`);
    }
  }

  private async handleBumpVersion(part: BumpPart): Promise<void> {
    const data = this.currentData as ExampleDetailData | undefined;
    if (!data?.downloadPath || !fs.existsSync(data.downloadPath)) {
      notify.error('Example not checked out locally');
      return;
    }

    try {
      const currentVersion = readMetaYamlVersion(data.downloadPath);
      if (!currentVersion) {
        notify.error('No version field found in meta.yaml');
        return;
      }

      const newVersion = bumpVersion(currentVersion, part);
      updateMetaYamlVersion(data.downloadPath, newVersion);

      this.treeProvider.refresh();
      notify.info(`Version bumped: ${normalizeSemVer(currentVersion)} -> ${newVersion}`);
      await this.refreshData();
    } catch (error) {
      notify.error(`Version bump failed: ${error}`);
    }
  }

  private async handleUpload(): Promise<void> {
    const data = this.currentData as ExampleDetailData | undefined;
    if (!data?.downloadPath || !fs.existsSync(data.downloadPath)) {
      notify.error('Example not checked out locally');
      return;
    }

    const confirm = await notify.confirm(
      `Upload example "${data.example.title}" from local directory?`,
      'Upload'
    );
    if (!confirm) { return; }

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
