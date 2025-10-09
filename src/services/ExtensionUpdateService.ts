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
      const url = new URL(`/extensions/${this.extensionId}/versions`, baseUrl);
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
    const downloadUrl = new URL(`/extensions/${this.extensionId}/download`, baseUrl);
    downloadUrl.searchParams.set('version', versionLabel);

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

      const response = await fetch(downloadUrl.toString(), { redirect: 'follow', headers });
      if (!response.ok) {
        throw new Error(`Failed to download VSIX: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'computor-update-'));
      const vsixPath = path.join(tempDir, `${this.extensionId.replace(/\./g, '-')}-${versionLabel}.vsix`);

      try {
        await fs.promises.writeFile(vsixPath, buffer);
        progress.report({ message: 'Installing…' });
        await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath));
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    });

    const choice = await vscode.window.showInformationMessage(
      `Computor extension updated to ${versionLabel}. Reload VS Code to apply changes.`,
      'Reload Now',
      'Later'
    );

    if (choice === 'Reload Now') {
      void vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }

  private async buildAuthHeaders(extraHeaders: Record<string, string> = {}): Promise<Record<string, string> | undefined> {
    try {
      const secretRaw = await this.context.secrets.get('computor.auth');
      if (!secretRaw) {
        return undefined;
      }
      const auth = JSON.parse(secretRaw) as { type?: string; username?: string; password?: string } | undefined;
      if (!auth || auth.type !== 'basic' || !auth.username || !auth.password) {
        return undefined;
      }

      const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      return {
        ...extraHeaders,
        Authorization: `Basic ${credentials}`
      };
    } catch (error) {
      console.warn('Failed to build auth headers for extension update check:', error);
      return undefined;
    }
  }
}
