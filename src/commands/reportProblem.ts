import * as vscode from 'vscode';

import { ComputorApiService } from '../services/ComputorApiService';
import { IssueReportWebviewProvider } from '../ui/webviews/IssueReportWebviewProvider';
import { IssueReportStatusBarService, issueReportingMode } from '../ui/IssueReportStatusBarService';
import { notify } from '../utils/notify';
import { say } from '../utils/uiLanguage';

let provider: IssueReportWebviewProvider | undefined;

/**
 * Open the problem-report form.
 *
 * Three shapes, decided by the deployment (`issue_reporting` on
 * `GET /instance-info`):
 *
 * - `tickets` (computor-org/issues#520): the form files a support ticket; the
 *   reporter follows it in the web app.
 * - `github` (also every 2026.10 backend, which has no `mode`): a *public*
 *   repository is opened directly so the user posts with their own account; a
 *   *private* board is proxied through the backend by the same form.
 * - `off`: nothing to report to.
 */
export async function reportProblem(
  context: vscode.ExtensionContext,
  api: ComputorApiService | undefined
): Promise<void> {
  if (!api) {
    await notify.warning(say('Sign in to Computor before submitting a problem report.', 'Melde dich bei Computor an, bevor du ein Problem meldest.'));
    return;
  }

  const reporting = IssueReportStatusBarService.current();
  const mode = issueReportingMode(reporting);
  if (mode === 'off') {
    await notify.warning(say('This Computor deployment does not accept problem reports.', 'Diese Computor-Installation nimmt keine Problemmeldungen an.'));
    return;
  }

  if (mode === 'github' && reporting?.visibility === 'public' && reporting.issues_url) {
    await vscode.env.openExternal(vscode.Uri.parse(reporting.issues_url));
    return;
  }

  if (!provider) {
    provider = new IssueReportWebviewProvider(context, api);
  }
  provider.setMode(mode);
  await provider.show(say('Report a Problem', 'Problem melden'));
}

/** Open the reporter's own reports in the web app (tickets mode only). */
export async function openMyProblemReports(api: ComputorApiService | undefined): Promise<void> {
  if (!api || issueReportingMode(IssueReportStatusBarService.current()) !== 'tickets') {
    await notify.warning(say('This Computor deployment does not keep problem reports as tickets.', 'Diese Computor-Installation führt Problemmeldungen nicht als Tickets.'));
    return;
  }
  const webUrl = (await api.getInstanceInfo())?.web_url;
  if (!webUrl) {
    await notify.warning(say('This server has no public web address configured.', 'Für diesen Server ist keine öffentliche Webadresse eingerichtet.'));
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(`${webUrl}/support`));
}
