import * as vscode from 'vscode';
import { say } from '../utils/uiLanguage';

import type { IssueReportingInfo } from '../types/generated/common';

/** Context key gating every problem-reporting entry point in `package.json`. */
export const ISSUE_REPORTING_CONTEXT_KEY = 'computor.issueReporting.enabled';
/** Context key for entry points that exist only when reports become tickets. */
export const ISSUE_REPORTING_TICKETS_CONTEXT_KEY = 'computor.issueReporting.tickets';

export type IssueReportingMode = 'tickets' | 'github' | 'off';

/**
 * Where a report goes on this deployment.
 *
 * Backends from computor-org/issues#520 step 2 on say so in
 * `issue_reporting.mode`. The 2026.10 line (code.tugraz.at) predates that field
 * and only reports `enabled`/`visibility`/`issues_url` for its GitHub path, so a
 * missing mode means "github if enabled". Unknown future modes are treated as
 * off rather than guessed at.
 */
export function issueReportingMode(info: IssueReportingInfo | null | undefined): IssueReportingMode {
  if (!info || info.enabled !== true) {
    return 'off';
  }
  const mode = info.mode;
  if (mode === undefined || mode === null) {
    return 'github';
  }
  return mode === 'tickets' || mode === 'github' ? mode : 'off';
}

/**
 * Persistent entry point for reports, independent of the active Computor role.
 *
 * Visibility follows the backend: in tickets mode the button no longer depends
 * on GitHub at all; on the GitHub path a deployment without a working tracker
 * reports `enabled: false` and there is nothing here to click.
 */
export class IssueReportStatusBarService implements vscode.Disposable {
  private static instance: IssueReportStatusBarService | undefined;
  private readonly item: vscode.StatusBarItem;
  private info: IssueReportingInfo | undefined;

  private constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.item.command = 'computor.reportProblem';
    // Deliberately not shown yet: nothing is known about the deployment until
    // the first authenticated /instance-info call.
  }

  static initialize(): IssueReportStatusBarService {
    if (!IssueReportStatusBarService.instance) {
      IssueReportStatusBarService.instance = new IssueReportStatusBarService();
    }
    return IssueReportStatusBarService.instance;
  }

  /** What the backend last said about reporting, or undefined before sign-in. */
  static current(): IssueReportingInfo | undefined {
    return IssueReportStatusBarService.instance?.info;
  }

  /** Show or hide every entry point to match the deployment's capability. */
  static async apply(info: IssueReportingInfo | undefined): Promise<void> {
    const service = IssueReportStatusBarService.initialize();
    service.info = info;
    // Set here, after sign-in, when the learner's language is known.
    service.item.text = `$(bug) ${say('Report problem', 'Problem melden')}`;
    service.item.tooltip = say('Report a problem to the Computor team', 'Ein Problem an das Computor-Team melden');
    const mode = issueReportingMode(info);
    if (mode !== 'off') {
      service.item.show();
    } else {
      service.item.hide();
    }
    await vscode.commands.executeCommand('setContext', ISSUE_REPORTING_CONTEXT_KEY, mode !== 'off');
    await vscode.commands.executeCommand('setContext', ISSUE_REPORTING_TICKETS_CONTEXT_KEY, mode === 'tickets');
  }

  dispose(): void {
    this.item.dispose();
    IssueReportStatusBarService.instance = undefined;
  }
}
