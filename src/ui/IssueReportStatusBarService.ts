import * as vscode from 'vscode';

import type { IssueReportingInfo } from '../types/generated/common';

/** Context key gating every problem-reporting entry point in `package.json`. */
export const ISSUE_REPORTING_CONTEXT_KEY = 'computor.issueReporting.enabled';

/**
 * Persistent entry point for reports, independent of the active Computor role.
 *
 * Visibility follows the backend: a deployment that has not configured an issue
 * tracker — or whose tracker is failing its connectivity probe — reports
 * `issue_reporting.enabled: false` on `GET /instance-info`, and then there is
 * nothing here to click. Showing the button anyway would offer a feature every
 * use of which ends in an error.
 */
export class IssueReportStatusBarService implements vscode.Disposable {
  private static instance: IssueReportStatusBarService | undefined;
  private readonly item: vscode.StatusBarItem;
  private info: IssueReportingInfo | undefined;

  private constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.item.text = '$(bug) Report problem';
    this.item.tooltip = 'Report a problem to the Computor maintainers';
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
    const enabled = info?.enabled === true;
    if (enabled) {
      service.item.show();
    } else {
      service.item.hide();
    }
    await vscode.commands.executeCommand('setContext', ISSUE_REPORTING_CONTEXT_KEY, enabled);
  }

  dispose(): void {
    this.item.dispose();
    IssueReportStatusBarService.instance = undefined;
  }
}
