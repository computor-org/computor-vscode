import * as vscode from 'vscode';
import screenshotDesktop = require('screenshot-desktop');

import { ComputorApiService } from '../services/ComputorApiService';
import { performanceMonitor } from '../services/PerformanceMonitoringService';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { notify } from '../utils/notify';

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

async function chooseScreenshot(): Promise<boolean | undefined> {
  const selected = await vscode.window.showQuickPick([
    {
      label: '$(check) Include current screenshot',
      description: 'Recommended — attach the current desktop screen',
      value: true
    },
    {
      label: '$(circle-slash) Do not include screenshot',
      description: 'Opt out for this report',
      value: false
    }
  ], {
    title: 'Screenshot included by default',
    placeHolder: 'Choose whether to attach the current screen'
  });
  return selected?.value;
}

async function captureScreenshot(): Promise<ScreenshotAttachment> {
  const buffer = await screenshotDesktop({ format: 'jpg' });
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('The screenshot service did not return an image');
  }
  if (buffer.length > maxScreenshotBytes) {
    throw new Error('Screenshot is larger than 5 MiB');
  }
  return { buffer, fileName: 'computor-report.jpg', contentType: 'image/jpeg' };
}

export async function reportProblem(
  context: vscode.ExtensionContext,
  api: ComputorApiService | undefined
): Promise<void> {
  if (!api) {
    await notify.warning('Sign in to Computor before submitting a problem report.');
    return;
  }

  const includeScreenshot = await chooseScreenshot();
  if (includeScreenshot === undefined) {
    return;
  }

  let screenshot: ScreenshotAttachment | undefined;
  if (includeScreenshot) {
    try {
      screenshot = await captureScreenshot();
    } catch (error) {
      const action = await notify.warning(
        `Could not capture the current screenshot: ${error instanceof Error ? error.message : String(error)}`,
        'Submit without screenshot'
      );
      if (action !== 'Submit without screenshot') {
        return;
      }
    }
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
