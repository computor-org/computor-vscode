import * as vscode from 'vscode';

import { ComputorApiService } from '../../services/ComputorApiService';
import { ComputorSettingsManager } from '../../settings/ComputorSettingsManager';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import type { IssueReportingMode } from '../IssueReportStatusBarService';

/** Mirrors what the backend accepts; kept small so nothing implicit is sent. */
interface SubmitMessage {
  title?: string;
  description?: string;
  expected?: string;
  steps?: string;
  screenshot?: { dataUrl: string; fileName: string } | null;
  log?: { text: string; fileName: string } | null;
}

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
/** Matches the backend's default SUPPORT_REPORT_MAX_LOG_BYTES. */
export const MAX_LOG_BYTES = 1024 * 1024;

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
  private mode: IssueReportingMode = 'github';

  constructor(context: vscode.ExtensionContext, api: ComputorApiService) {
    super(context, 'computor.issueReportView');
    this.api = api;
  }

  /** Tickets mode adds the log upload and a ticket receipt. */
  setMode(mode: IssueReportingMode): void {
    this.mode = mode;
  }

  protected async getWebviewContent(): Promise<string> {
    return this.renderPage({
      title: 'Report a Problem',
      bodyHtml: '<div id="app" class="page-root"></div>',
      cssFiles: ['support/issue-report.css'],
      scriptFiles: ['support/issue-report.js'],
      initialState: {
        maxScreenshotBytes: MAX_SCREENSHOT_BYTES,
        maxLogBytes: MAX_LOG_BYTES,
        mode: this.mode
      }
    });
  }

  protected async handleMessage(message: any): Promise<void> {
    if (message?.command === 'openReport') {
      await this.openReport(String(message.data?.ticketId || ''));
      return;
    }
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

    const tickets = this.mode === 'tickets';
    let log;
    try {
      // The log field exists only on ticket backends; never sent otherwise.
      log = tickets ? encodeLog(message.log) : undefined;
    } catch (error) {
      this.postError(error instanceof Error ? error.message : String(error));
      return;
    }

    const settings = new ComputorSettingsManager(this.context);
    const payload = {
      channel: tickets ? ('vscode' as const) : undefined,
      title: (message.title || '').trim() || description.split('\n')[0]!.trim().slice(0, 140),
      description,
      expected: (message.expected || '').trim() || undefined,
      steps: (message.steps || '').trim() || undefined,
      context: diagnosticContext(await settings.getBaseUrl())
    };

    try {
      const result = await this.api.submitIssueReport(payload, screenshot, log);
      const webUrl = tickets ? (await this.api.getInstanceInfo())?.web_url : undefined;
      this.post('submitted', {
        ticketId: result.ticket_id ?? null,
        ticketNumber: result.ticket_number ?? null,
        canOpen: !!(webUrl && result.ticket_id),
        logDropped: !!log && result.log_attached === false,
        reportId: result.report_id,
        issueNumber: result.issue_number,
        issueUrl: result.issue_url ?? null,
        // A screenshot can be dropped while the report itself goes through, so
        // say which happened rather than let them assume it arrived.
        screenshotDropped: !!screenshot && result.screenshot_attached === false
      });
    } catch (error) {
      this.postError(submitFailureMessage(error));
    }
  }

  private async openReport(ticketId: string): Promise<void> {
    const webUrl = (await this.api.getInstanceInfo())?.web_url;
    if (!webUrl || !/^[0-9a-f-]{36}$/i.test(ticketId)) {
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(`${webUrl}/support/${ticketId}`));
  }
}

/** The webview's text log as an upload; refuses oversized or empty logs. */
export function encodeLog(
  log: SubmitMessage['log']
): { buffer: Buffer; fileName: string } | undefined {
  if (!log || typeof log.text !== 'string' || log.text.length === 0) {
    return undefined;
  }
  const buffer = Buffer.from(log.text, 'utf8');
  if (buffer.length > MAX_LOG_BYTES) {
    throw new Error('The attached log is larger than 1 MB.');
  }
  return { buffer, fileName: 'computor.log' };
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
    command: 'computor.reportProblem',
    backend_origin: backendOrigin(baseUrl),
    workspace_folder_count: vscode.workspace.workspaceFolders?.length || 0,
    editor: editor ? { language_id: editor.document.languageId } : null
  };
}
