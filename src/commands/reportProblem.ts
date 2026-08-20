import * as vscode from 'vscode';

import { ComputorApiService } from '../services/ComputorApiService';
import { IssueReportWebviewProvider } from '../ui/webviews/IssueReportWebviewProvider';
import { IssueReportStatusBarService } from '../ui/IssueReportStatusBarService';
import { notify } from '../utils/notify';

let provider: IssueReportWebviewProvider | undefined;

/**
 * Open the problem-report form.
 *
 * Two shapes, decided by the deployment's tracker. A *public* repository is one
 * the user can post to themselves, and doing so with their own GitHub account
 * gets them the notifications and the follow-up conversation — so we just open
 * it. Only a *private* maintainer board, which they must not reach, is worth
 * proxying through the backend, and that is what the form is for.
 */
export async function reportProblem(
  context: vscode.ExtensionContext,
  api: ComputorApiService | undefined
): Promise<void> {
  if (!api) {
    await notify.warning('Sign in to Computor before submitting a problem report.');
    return;
  }

  const reporting = IssueReportStatusBarService.current();
  if (!reporting?.enabled) {
    await notify.warning('This Computor deployment does not accept problem reports.');
    return;
  }

  if (reporting.visibility === 'public' && reporting.issues_url) {
    await vscode.env.openExternal(vscode.Uri.parse(reporting.issues_url));
    return;
  }

  if (!provider) {
    provider = new IssueReportWebviewProvider(context, api);
  }
  await provider.show('Report a Problem');
}
