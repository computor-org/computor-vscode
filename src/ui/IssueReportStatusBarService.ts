import * as vscode from 'vscode';

/** Persistent entry point for reports, independent of the active Computor role. */
export class IssueReportStatusBarService implements vscode.Disposable {
  private static instance: IssueReportStatusBarService | undefined;
  private readonly item: vscode.StatusBarItem;

  private constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.item.text = '$(bug) Report problem';
    this.item.tooltip = 'Report a problem to the Computor maintainers';
    this.item.command = 'computor.reportProblem';
    this.item.show();
  }

  static initialize(): IssueReportStatusBarService {
    if (!IssueReportStatusBarService.instance) {
      IssueReportStatusBarService.instance = new IssueReportStatusBarService();
    }
    return IssueReportStatusBarService.instance;
  }

  dispose(): void {
    this.item.dispose();
    IssueReportStatusBarService.instance = undefined;
  }
}
