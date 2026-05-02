import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import fetch from 'node-fetch';
import semver from 'semver';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { ExtensionVersionListItem, ExtensionVersionListResponse } from '../types/generated';

/**
 * Handles backend-driven extension updates by polling the Computor backend for new versions.
 */
export class ExtensionUpdateService {
  private readonly extensionId: string;
  private checking = false;

  constructor(private readonly context: vscode.ExtensionContext, private readonly settings: ComputorSettingsManager) {
    const pkg = context.extension.packageJSON as { name?: string; publisher?: string };
    const publisher = pkg.publisher ?? '-';
    const name = pkg.name ?? '-';
    this.extensionId = `${publisher}.${name}`;
  }

  async checkForUpdates(): Promise<void> {
    if (process.env.COMPUTOR_SUPPRESS_AUTO_UPDATE === 'true') {
      return;
    }

    if (this.checking) {
      return;
    }

    this.checking = true;
    let attemptedInstall = false;

    try {
      const baseUrl = await this.getBaseUrl();
      if (!baseUrl) {
        return;
      }

      const availableVersions = await this.fetchAvailableVersions(baseUrl);
      if (!availableVersions.length) {
        return;
      }

      const latest = this.pickLatestVersion(availableVersions);
      if (!latest) {
        return;
      }

      const currentVersion = this.getCurrentVersion();
      const current = semver.coerce(currentVersion);
      const target = semver.coerce(latest.version);
      if (!current || !target) {
        console.warn(`Unable to parse extension versions: current=${currentVersion}, target=${latest.version}`);
        return;
      }

      if (semver.gte(current, target)) {
        return;
      }

      const vscodeVersion = semver.coerce(vscode.version);
      if (latest.engine_range && vscodeVersion && !semver.satisfies(vscodeVersion, latest.engine_range, { includePrerelease: true })) {
        console.warn(`Skipping auto-update: latest version ${latest.version} requires VS Code ${latest.engine_range}, current ${vscodeVersion.version}`);
        return;
      }

      const choice = await vscode.window.showInformationMessage(
        `Computor extension update available: ${currentVersion} → ${latest.version}`,
        'Update Now',
        'Later'
      );

      if (choice !== 'Update Now') {
        return;
      }

      attemptedInstall = true;
      await this.installVersion(baseUrl, latest);
    } catch (error) {
      console.error('Failed to complete Computor auto-update check', error);
      if (attemptedInstall) {
        void vscode.window.showWarningMessage('Computor auto-update failed. Check logs for details.');
      }
    } finally {
      this.checking = false;
    }
  }

  private async getBaseUrl(): Promise<string | undefined> {
    try {
      const url = await this.settings.getBaseUrl();
      return url.replace(/\/$/, '');
    } catch (error) {
      console.warn('Unable to resolve Computor backend URL for update checks', error);
      return undefined;
    }
  }

  private async fetchAvailableVersions(baseUrl: string): Promise<ExtensionVersionListItem[]> {
    try {
      const url = new URL(`${baseUrl}/extensions/${this.extensionId}/versions`);
      url.searchParams.set('include_yanked', 'false');
      url.searchParams.set('limit', '100');

      const headers = await this.buildAuthHeaders({ Accept: 'application/json' });
      if (!headers) {
        return [];
      }

      const response = await fetch(url.toString(), { headers });
      if (!response.ok) {
        throw new Error(`Unexpected response ${response.status}`);
      }

      const payload = (await response.json()) as ExtensionVersionListItem[] | ExtensionVersionListResponse | Record<string, unknown>;
      if (Array.isArray(payload)) {
        return payload;
      }

      if (payload && Array.isArray((payload as ExtensionVersionListResponse).items)) {
        return (payload as ExtensionVersionListResponse).items ?? [];
      }

      const legacy = payload as { versions?: unknown; data?: unknown };
      if (Array.isArray(legacy?.versions)) {
        return legacy.versions as ExtensionVersionListItem[];
      }
      if (Array.isArray(legacy?.data)) {
        return legacy.data as ExtensionVersionListItem[];
      }

      return [];
    } catch (error) {
      console.warn('Failed to fetch Computor extension versions', error);
      return [];
    }
  }

  private pickLatestVersion(versions: ExtensionVersionListItem[]): ExtensionVersionListItem | undefined {
    let latest: { raw: ExtensionVersionListItem; parsed: semver.SemVer } | undefined;

    for (const candidate of versions) {
      if (!candidate || typeof candidate.version !== 'string') {
        continue;
      }
      if (candidate.yanked) {
        continue;
      }

      const parsed = semver.coerce(candidate.version);
      if (!parsed) {
        continue;
      }

      if (!latest || semver.gt(parsed, latest.parsed)) {
        latest = { raw: candidate, parsed };
      }
    }

    return latest?.raw;
  }

  private getCurrentVersion(): string {
    const pkg = this.context.extension.packageJSON as { version?: string };
    return pkg.version ?? '0.0.0';
  }

  private async installVersion(baseUrl: string, versionInfo: ExtensionVersionListItem): Promise<void> {
    const versionLabel = versionInfo.version;
    const downloadUrl = new URL(`${baseUrl}/extensions/${this.extensionId}/download`);
    downloadUrl.searchParams.set('version', versionLabel);

    let savedVsixPath: string | undefined;
    let installSucceeded = false;
    let installError: unknown;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Computor: Installing update ${versionLabel}`,
      cancellable: false
    }, async (progress) => {
      progress.report({ message: 'Downloading…' });

      const headers = await this.buildAuthHeaders();
      if (!headers) {
        throw new Error('Authentication required for extension download.');
      }

      // Backend may stream the VSIX bytes directly (200) or redirect to a
      // presigned storage URL (302). Handle both.
      const initialResponse = await fetch(downloadUrl.toString(), { redirect: 'manual', headers });

      let buffer: Buffer;
      if (initialResponse.status === 200) {
        const arrayBuffer = await initialResponse.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } else if (initialResponse.status === 302) {
        const presignedUrl = initialResponse.headers.get('location');
        if (!presignedUrl) {
          throw new Error('Download redirect missing location header');
        }
        const storageResponse = await fetch(presignedUrl, { redirect: 'follow' });
        if (!storageResponse.ok) {
          throw new Error(`Failed to download VSIX from storage: ${storageResponse.status}`);
        }
        const arrayBuffer = await storageResponse.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } else {
        throw new Error(`Failed to download VSIX: ${initialResponse.status}`);
      }

      // Save into a durable location (Downloads, or the extension's
      // globalStorage as fallback) so that if VS Code refuses to auto-install
      // we can hand the user a working file path for manual drag-and-drop.
      const targetDir = await this.resolveVsixOutputDir();
      const vsixPath = path.join(
        targetDir,
        `${this.extensionId.replace(/\./g, '-')}-${versionLabel}.vsix`
      );
      await fs.promises.writeFile(vsixPath, buffer);
      savedVsixPath = vsixPath;

      progress.report({ message: 'Installing…' });
      try {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath));
        installSucceeded = true;
      } catch (err) {
        installError = err;
      }
    });

    if (installSucceeded) {
      // Drop the staged VSIX once VS Code has picked it up; nothing left to clean up if it was already deleted.
      if (savedVsixPath) {
        await fs.promises.rm(savedVsixPath, { force: true }).catch(() => undefined);
      }
      const choice = await vscode.window.showInformationMessage(
        `Computor extension updated to ${versionLabel}. Reload VS Code to apply changes.`,
        'Reload Now',
        'Later'
      );
      if (choice === 'Reload Now') {
        void vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
      return;
    }

    // Install was blocked (signature policy, managed extension, etc.) but the
    // download succeeded. Surface the saved file so the user can install it
    // manually by dragging into the Extensions view.
    console.warn('Computor auto-install rejected by VS Code:', installError);
    if (!savedVsixPath) {
      void vscode.window.showWarningMessage('Computor auto-update failed. Check logs for details.');
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Computor auto-install was blocked, but the update was downloaded to ${savedVsixPath}. Reveal the file and drop it into the Extensions view to install manually.`,
      'Reveal VSIX',
      'Open Extensions View'
    );
    if (choice === 'Reveal VSIX') {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(savedVsixPath));
    } else if (choice === 'Open Extensions View') {
      await vscode.commands.executeCommand('workbench.view.extensions');
    }
  }

  private async resolveVsixOutputDir(): Promise<string> {
    const downloads = path.join(os.homedir(), 'Downloads');
    try {
      const stat = await fs.promises.stat(downloads);
      if (stat.isDirectory()) {
        return downloads;
      }
    } catch {
      // fall through to the global-storage fallback
    }
    const fallback = this.context.globalStorageUri.fsPath;
    await fs.promises.mkdir(fallback, { recursive: true });
    return fallback;
  }

  private async buildAuthHeaders(extraHeaders: Record<string, string> = {}): Promise<Record<string, string> | undefined> {
    try {
      const secretRaw = await this.context.secrets.get('computor.auth');
      if (secretRaw) {
        const auth = JSON.parse(secretRaw) as { accessToken?: string } | undefined;
        if (auth?.accessToken) {
          return {
            ...extraHeaders,
            Authorization: `Bearer ${auth.accessToken}`
          };
        }
      }

      const apiToken = process.env.COMPUTOR_AUTH_TOKEN;
      if (apiToken) {
        return {
          ...extraHeaders,
          'X-API-Token': apiToken
        };
      }

      return undefined;
    } catch (error) {
      console.warn('Failed to build auth headers for extension update check:', error);
      return undefined;
    }
  }
}
