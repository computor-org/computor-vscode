import * as vscode from 'vscode';

import { ComputorApiService } from '../../services/ComputorApiService';
import { ComputorSettingsManager } from '../../settings/ComputorSettingsManager';
import { BaseWebviewProvider } from './BaseWebviewProvider';

/** Mirrors what the backend accepts; kept small so nothing implicit is sent. */
interface SubmitMessage {
  title?: string;
  description?: string;
  expected?: string;
  steps?: string;
  screenshot?: { dataUrl: string; fileName: string } | null;
}

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

/**
 * The problem-report form.
 *
 * Everything is typed by the user — there are no dropdowns and, deliberately,
 * no automatic capture of anything. An earlier revision grabbed the whole
 * desktop on the user's behalf; on a machine that also shows mail, chat and
 * other students' names that quietly exports third-party personal data into an
 * issue tracker. A screenshot now only exists if the user made one and attached
 * it, having read what the form says about it.
 */
export class IssueReportWebviewProvider extends BaseWebviewProvider {
  private readonly api: ComputorApiService;

  constructor(context: vscode.ExtensionContext, api: ComputorApiService) {
    super(context, 'computor.issueReportView');
    this.api = api;
  }

  protected async getWebviewContent(): Promise<string> {
    return this.renderPage({
      title: 'Report a Problem',
      bodyHtml: '<div id="app" class="page-root"></div>',
      cssFiles: ['support/issue-report.css'],
      scriptFiles: ['support/issue-report.js'],
      initialState: { maxScreenshotBytes: MAX_SCREENSHOT_BYTES }
    });
  }

  protected async handleMessage(message: any): Promise<void> {
    if (message?.command !== 'submit') {
      if (message?.command === 'cancel') {
        this.panel?.dispose();
      }
      return;
    }
    await this.submit((message.data || {}) as SubmitMessage);
  }

  private post(command: string, data?: unknown): void {
    void this.panel?.webview.postMessage({ command, data });
  }

  private postError(message: string): void {
    this.post('error', { message });
  }

  private async submit(message: SubmitMessage): Promise<void> {
    const description = (message.description || '').trim();
    if (!description) {
      this.postError('Please describe the problem before submitting.');
      return;
    }

    let screenshot;
    try {
      screenshot = decodeScreenshot(message.screenshot);
    } catch (error) {
      this.postError(error instanceof Error ? error.message : String(error));
      return;
    }

    const settings = new ComputorSettingsManager(this.context);
    const payload = {
      title: (message.title || '').trim() || description.split('\n')[0]!.trim().slice(0, 140),
      description,
      expected: (message.expected || '').trim() || undefined,
      steps: (message.steps || '').trim() || undefined,
      context: diagnosticContext(await settings.getBaseUrl())
    };

    try {
      const result = await this.api.submitIssueReport(payload, screenshot);
      this.post('submitted', {
        reportId: result.report_id,
        issueNumber: result.issue_number,
        issueUrl: result.issue_url ?? null
      });
    } catch (error) {
      this.postError(submitFailureMessage(error));
    }
  }
}

/** Turn a submission failure into something the user can act on. */
export function submitFailureMessage(error: unknown): string {
  const status = (error as { status?: number } | undefined)?.status;
  if (status === 429) {
    return 'You have already sent a problem report. Please wait a few minutes before sending another.';
  }
  if (status === 503) {
    return 'Problem reporting is temporarily unavailable. Please try again later.';
  }
  if (status === 404) {
    return 'This Computor deployment does not accept problem reports.';
  }
  return `Could not submit the problem report: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Turn the webview's data URL back into an upload.
 *
 * The webview is untrusted input, so the type is taken from the data URL and
 * checked against the formats the backend accepts rather than trusted from the
 * file name.
 */
function decodeScreenshot(
  screenshot: SubmitMessage['screenshot']
): { buffer: Buffer; fileName: string; contentType: string } | undefined {
  if (!screenshot?.dataUrl) {
    return undefined;
  }
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(screenshot.dataUrl);
  if (!match) {
    throw new Error('The attached screenshot could not be read.');
  }
  const contentType = (match[1] || '').toLowerCase();
  const extension = ALLOWED_IMAGE_TYPES[contentType];
  if (!extension) {
    throw new Error('Screenshots must be PNG, JPEG, GIF, or WebP.');
  }
  const buffer = Buffer.from(match[2] || '', 'base64');
  if (buffer.length === 0) {
    throw new Error('The attached screenshot is empty.');
  }
  if (buffer.length > MAX_SCREENSHOT_BYTES) {
    throw new Error('The attached screenshot is larger than 5 MB.');
  }
  return { buffer, fileName: `screenshot.${extension}`, contentType };
}

function extensionVersion(): string | undefined {
  return vscode.extensions.all.find((extension) => extension.packageJSON?.name === 'computor')
    ?.packageJSON?.version;
}

function backendOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return 'unknown';
  }
}

/**
 * Machine-readable detail that helps a maintainer place the report.
 *
 * Kept to facts about the client, never about the person using it — no file
 * paths, no workspace names, no account details. The backend redacts identity-
 * and credential-shaped keys again on its way to the issue, but nothing should
 * be relying on that.
 */
function diagnosticContext(baseUrl: string): Record<string, unknown> {
  const editor = vscode.window.activeTextEditor;
  return {
    client: 'computor-vscode',
    client_version: extensionVersion() || 'unknown',
    vscode_version: vscode.version,
    platform: process.platform,
    backend_origin: backendOrigin(baseUrl),
    workspace_folder_count: vscode.workspace.workspaceFolders?.length || 0,
    editor: editor ? { language_id: editor.document.languageId } : null
  };
}
