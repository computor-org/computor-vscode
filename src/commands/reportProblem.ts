import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import { ComputorApiService } from '../services/ComputorApiService';
import { performanceMonitor } from '../services/PerformanceMonitoringService';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { notify } from '../utils/notify';

const screenshotTypes: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};
const maxScreenshotBytes = 5 * 1024 * 1024;

type ScreenshotAttachment = { buffer: Buffer; fileName: string; contentType: string };

function extensionVersion(): string | undefined {
  return vscode.extensions.all.find((extension) => extension.packageJSON?.name === 'computor')
    ?.packageJSON?.version;
}

function backendOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

function diagnosticContext(baseUrl: string): Record<string, unknown> {
  const editor = vscode.window.activeTextEditor;
  const selection = editor?.selection;
  let performance: unknown;
  try {
    performance = JSON.parse(performanceMonitor.exportMetrics());
  } catch {
    performance = 'Performance metrics unavailable';
  }

  return {
    client: 'computor-vscode',
    client_version: extensionVersion() || 'unknown',
    backend_origin: backendOrigin(baseUrl),
    workspace_folder_count: vscode.workspace.workspaceFolders?.length || 0,
    editor: editor
      ? {
          language_id: editor.document.languageId,
          has_selection: !!selection && !selection.isEmpty,
          active_line: selection ? selection.active.line + 1 : undefined
        }
      : null,
    performance
  };
}

async function selectScreenshot(): Promise<ScreenshotAttachment | undefined> {
  const selected = await vscode.window.showOpenDialog({
    title: 'Attach a screenshot (optional)',
    canSelectMany: false,
    openLabel: 'Attach screenshot',
    filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }
  });
  const uri = selected?.[0];
  if (!uri) {
    return undefined;
  }

  const fileName = path.basename(uri.fsPath);
  const contentType = screenshotTypes[path.extname(fileName).toLowerCase()];
  if (!contentType) {
    throw new Error('Unsupported screenshot format');
  }
  const stats = await fs.stat(uri.fsPath);
  if (stats.size > maxScreenshotBytes) {
    throw new Error('Screenshot is larger than 5 MiB');
  }
  return { buffer: await fs.readFile(uri.fsPath), fileName, contentType };
}

export async function reportProblem(
  context: vscode.ExtensionContext,
  api: ComputorApiService | undefined
): Promise<void> {
  if (!api) {
    await notify.warning('Sign in to Computor before submitting a problem report.');
    return;
  }

  const description = await vscode.window.showInputBox({
    title: 'Report a problem',
    prompt: 'What happened?',
    placeHolder: 'Describe the problem you encountered',
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : 'Please describe the problem.'
  });
  if (!description) {
    return;
  }

  const expected = await vscode.window.showInputBox({
    title: 'Report a problem (optional)',
    prompt: 'What did you expect to happen? Leave blank to skip.',
    ignoreFocusOut: true
  });
  const steps = await vscode.window.showInputBox({
    title: 'Report a problem (optional)',
    prompt: 'How can we reproduce it? Leave blank to skip.',
    ignoreFocusOut: true
  });

  let screenshot: ScreenshotAttachment | undefined;
  try {
    screenshot = await selectScreenshot();
  } catch (error) {
    await notify.error(`Could not read the screenshot: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const settings = new ComputorSettingsManager(context);
  const baseUrl = await settings.getBaseUrl();
  const payload = {
    title: (description.split('\n')[0] || '').trim().slice(0, 140),
    description: description.trim(),
    expected: expected?.trim() || undefined,
    steps: steps?.trim() || undefined,
    context: diagnosticContext(baseUrl)
  };

  try {
    const result = await notify.progress('Submitting problem report…', () =>
      api.submitIssueReport(payload, screenshot)
    );
    const action = await notify.info(`Problem report submitted as #${result.issue_number}.`, 'Open issue');
    if (action === 'Open issue') {
      await vscode.env.openExternal(vscode.Uri.parse(result.issue_url));
    }
  } catch (error) {
    await notify.error(`Could not submit the problem report: ${error instanceof Error ? error.message : String(error)}`);
  }
}
