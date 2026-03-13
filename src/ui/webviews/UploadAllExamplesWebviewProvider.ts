import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerExampleTreeProvider } from '../tree/lecturer/LecturerExampleTreeProvider';
import { WorkspaceStructureManager } from '../../utils/workspaceStructure';
import { scanCheckedOutExamples, readCheckoutMetadata, writeCheckoutMetadata, getVersionPath, snapshotWorkingToVersion } from '../../utils/checkedOutExampleManager';
import { writeExampleFiles } from '../../utils/exampleFileWriter';
import { readMetaYamlVersion, updateMetaYamlVersion } from '../../utils/metaYamlHelpers';
import { bumpVersion, normalizeSemVer } from '../../utils/versionHelpers';
import { shouldExcludeExampleEntry } from '../../utils/exampleExcludePatterns';
import { hasExampleChanged } from '../../utils/exampleDiffHelper';
import type { BumpPart } from '../../utils/versionHelpers';
import type { ExampleUploadRequest } from '../../types/generated';

interface ExampleInfo {
  directory: string;
  title: string;
  localVersion: string;
  remoteVersion?: string;
  exampleId: string;
  repositoryId: string;
  dirPath: string;
  hasChanges: boolean;
}

interface ExampleUploadResult {
  directory: string;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'skipped';
  uploadedVersion?: string;
  error?: string;
}

export class UploadAllExamplesWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeProvider: LecturerExampleTreeProvider;
  private isUploading = false;

  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService,
    treeProvider: LecturerExampleTreeProvider
  ) {
    super(context, 'computor.uploadAllExamples');
    this.apiService = apiService;
    this.treeProvider = treeProvider;
  }

  protected async getWebviewContent(): Promise<string> {
    const nonce = this.getNonce();
    const webview = this.panel!.webview;
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'upload-all-examples.js');
    const cssUri = this.getWebviewUri(webview, 'webview-ui', 'upload-all-examples.css');

    const examples = await this.collectExamples();
    const initialState = JSON.stringify(examples);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Upload All Examples</title>
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Upload All Examples</h1>
      <p>Upload all local working examples to the server.</p>
    </div>

    <div class="policy-section">
      <h2>Version Bump Policy</h2>
      <div class="policy-options">
        <label class="radio-option">
          <input type="radio" name="bumpPolicy" value="patch" checked>
          <span>Patch <span class="hint">(x.y.Z+1)</span></span>
        </label>
        <label class="radio-option">
          <input type="radio" name="bumpPolicy" value="minor">
          <span>Minor <span class="hint">(x.Y+1.0)</span></span>
        </label>
        <label class="radio-option">
          <input type="radio" name="bumpPolicy" value="major">
          <span>Major <span class="hint">(X+1.0.0)</span></span>
        </label>
      </div>
    </div>

    <div class="examples-section">
      <h2>Examples <span id="exampleCount" class="count-badge"></span></h2>
      <div id="exampleList" class="example-list"></div>
    </div>

    <div class="actions">
      <button id="uploadBtn" class="btn-primary">Upload Changed</button>
      <button id="uploadSelectedBtn" class="btn-secondary">Upload Selected</button>
    </div>

    <div id="summary" class="summary" style="display:none;"></div>
  </div>
  <script nonce="${nonce}">window.__INITIAL_STATE__ = ${initialState};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  protected async handleMessage(message: { command: string; data?: Record<string, unknown> }): Promise<void> {
    switch (message.command) {
      case 'uploadAll':
        await this.uploadExamples(
          message.data!['bumpPolicy'] as BumpPart,
          message.data!['directories'] as string[]
        );
        break;
      case 'refresh':
        await this.refreshExamples();
        break;
    }
  }

  private async collectExamples(): Promise<ExampleInfo[]> {
    const groups = scanCheckedOutExamples();
    const examples: ExampleInfo[] = [];

    for (const group of groups) {
      const working = group.workingVersion;
      if (!working) { continue; }

      const metadata = working.metadata;
      const localVersion = readMetaYamlVersion(working.fullPath) || metadata.versionTag || '0.1.0';

      let title = group.directory;
      try {
        const yaml = require('js-yaml');
        const metaPath = path.join(working.fullPath, 'meta.yaml');
        if (fs.existsSync(metaPath)) {
          const metaData = yaml.load(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
          if (typeof metaData?.title === 'string') {
            title = metaData.title;
          }
        }
      } catch { /* use directory as title */ }

      let remoteVersion: string | undefined;
      if (metadata.exampleId) {
        try {
          const versions = await this.apiService.getExampleVersions(metadata.exampleId);
          if (versions && versions.length > 0) {
            const latest = versions.reduce((a, b) =>
              b.version_number > a.version_number ? b : a
            );
            remoteVersion = normalizeSemVer(latest.version_tag);
          }
        } catch { /* no remote version info */ }
      }

      const dirs = WorkspaceStructureManager.getInstance().getDirectories();
      const snapshotDir = getVersionPath(dirs.exampleVersions, group.directory, metadata.versionTag);
      const hasChanges = hasExampleChanged(working.fullPath, snapshotDir);

      examples.push({
        directory: group.directory,
        title,
        localVersion,
        remoteVersion,
        exampleId: metadata.exampleId || '',
        repositoryId: metadata.repositoryId || '',
        dirPath: working.fullPath,
        hasChanges,
      });
    }

    return examples;
  }

  private async refreshExamples(): Promise<void> {
    const examples = await this.collectExamples();
    this.panel?.webview.postMessage({ command: 'update', data: examples });
  }

  private async uploadExamples(bumpPolicy: BumpPart, directories: string[]): Promise<void> {
    if (this.isUploading) { return; }
    this.isUploading = true;

    const examples = await this.collectExamples();
    const toUpload = examples.filter(e => directories.includes(e.directory));

    // If any examples are missing a repositoryId, prompt the user to select one
    const needsRepo = toUpload.some(e => !e.repositoryId);
    if (needsRepo) {
      const repos = await this.apiService.getExampleRepositories();
      if (!repos || repos.length === 0) {
        vscode.window.showErrorMessage('No example repositories found. Please create one first.');
        this.isUploading = false;
        return;
      }

      let fallbackRepoId: string;
      if (repos.length === 1) {
        fallbackRepoId = repos[0]!.id;
      } else {
        const picked = await vscode.window.showQuickPick(
          repos.map(r => ({ label: r.name, description: r.source_url, id: r.id })),
          { placeHolder: 'Select a repository for new examples not yet on the server' }
        );
        if (!picked) {
          this.isUploading = false;
          return;
        }
        fallbackRepoId = picked.id;
      }

      for (const example of toUpload) {
        if (!example.repositoryId) {
          example.repositoryId = fallbackRepoId;
        }
      }
    }

    const results: ExampleUploadResult[] = toUpload.map(e => ({
      directory: e.directory,
      status: 'pending' as const
    }));

    this.panel?.webview.postMessage({ command: 'uploadStarted', data: results });

    for (let i = 0; i < toUpload.length; i++) {
      const example = toUpload[i]!;
      results[i]!.status = 'uploading';
      this.panel?.webview.postMessage({ command: 'uploadProgress', data: results });

      try {
        const isNew = !example.remoteVersion;
        const uploadVersion = isNew
          ? normalizeSemVer(example.localVersion)
          : bumpVersion(example.remoteVersion!, bumpPolicy);

        await this.uploadSingleExample(example, uploadVersion);

        results[i]!.status = 'success';
        results[i]!.uploadedVersion = uploadVersion;
      } catch (error) {
        results[i]!.status = 'error';
        results[i]!.error = error instanceof Error ? error.message : String(error);
      }

      this.panel?.webview.postMessage({ command: 'uploadProgress', data: results });
    }

    this.panel?.webview.postMessage({ command: 'uploadComplete', data: results });
    this.treeProvider.refresh();
    vscode.commands.executeCommand('computor.lecturer.refresh');
    this.isUploading = false;
  }

  private async uploadSingleExample(example: ExampleInfo, uploadVersion: string): Promise<void> {
    const dirPath = example.dirPath;

    updateMetaYamlVersion(dirPath, uploadVersion);

    const zipper = new JSZip();
    const addToZip = (currentDir: string, basePath: string) => {
      const entries = fs.readdirSync(currentDir);
      for (const entry of entries) {
        if (shouldExcludeExampleEntry(entry)) { continue; }
        const fullPath = path.join(currentDir, entry);
        const stat = fs.statSync(fullPath);
        const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
        if (stat.isFile()) {
          zipper.file(relativePath, fs.readFileSync(fullPath));
        } else if (stat.isDirectory()) {
          addToZip(fullPath, basePath);
        }
      }
    };
    addToZip(dirPath, dirPath);

    const base64Zip = await zipper.generateAsync({ type: 'base64', compression: 'DEFLATE' });

    const uploadRequest: ExampleUploadRequest = {
      repository_id: example.repositoryId,
      directory: example.directory,
      files: { [`${example.directory}.zip`]: base64Zip }
    };

    const result = await this.apiService.uploadExample(uploadRequest);
    if (!result) {
      throw new Error('Upload returned no result');
    }

    const exampleId = result.id || example.exampleId;
    let uploadedVersionId = '';
    let uploadedVersionNumber = 0;

    // Create version snapshot
    try {
      const versions = await this.apiService.getExampleVersions(exampleId);
      const uploadedVersion = versions?.find((v: { version_tag: string }) =>
        normalizeSemVer(v.version_tag) === uploadVersion
      );

      if (uploadedVersion) {
        uploadedVersionId = uploadedVersion.id;
        uploadedVersionNumber = uploadedVersion.version_number;
      }

      const dirs = WorkspaceStructureManager.getInstance().getDirectories();

      if (uploadedVersion) {
        const downloadedData = await this.apiService.downloadExampleVersion(uploadedVersion.id);
        if (downloadedData) {
          const versionDir = getVersionPath(dirs.exampleVersions, example.directory, uploadVersion);
          if (fs.existsSync(versionDir)) {
            fs.rmSync(versionDir, { recursive: true, force: true });
          }
          fs.mkdirSync(versionDir, { recursive: true });
          writeExampleFiles(downloadedData.files, versionDir);

          const existingMeta = readCheckoutMetadata(dirPath);
          if (existingMeta) {
            writeCheckoutMetadata(versionDir, {
              ...existingMeta,
              exampleId,
              versionTag: uploadVersion,
              versionId: uploadedVersion.id,
              versionNumber: uploadedVersion.version_number,
              checkedOutAt: new Date().toISOString()
            });
          }
        }
      } else {
        snapshotWorkingToVersion(dirs.examples, dirs.exampleVersions, example.directory, uploadVersion);
      }
    } catch (snapshotError) {
      console.warn('Failed to create version snapshot after upload:', snapshotError);
    }

    // Update working copy metadata
    const existingMeta = readCheckoutMetadata(dirPath);
    if (existingMeta) {
      writeCheckoutMetadata(dirPath, {
        ...existingMeta,
        exampleId,
        repositoryId: example.repositoryId || existingMeta.repositoryId,
        versionTag: uploadVersion,
        versionId: uploadedVersionId || existingMeta.versionId,
        versionNumber: uploadedVersionNumber || existingMeta.versionNumber,
        checkedOutAt: new Date().toISOString()
      });
    }
  }
}
