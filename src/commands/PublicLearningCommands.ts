import * as vscode from 'vscode';

const REPOSITORY = 'https://github.com/computor-org/data-science-python';
const CODESPACES = 'https://codespaces.new/computor-org/data-science-python?quickstart=1';

/** Public entry points never instantiate an authenticated API or a workspace job. */
export function registerPublicLearning(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('computor.publicCourses', async () => {
      const choice = await vscode.window.showQuickPick([
        { label: 'Read the public courses and examples', action: 'read', detail: 'No login. Three bilingual Python courses.' },
        { label: 'Work in desktop VS Code', action: 'clone', detail: 'Clone public material; execute code on your computer.' },
        { label: 'Work in GitHub Codespaces', action: 'codespaces', detail: 'GitHub account and quota required.' },
      ], { title: 'Computor: public learning', placeHolder: 'Hosted capacity is independent of these options.' });
      if (!choice) return;
      if (choice.action === 'clone') {
        await vscode.commands.executeCommand('git.clone', `${REPOSITORY}.git`);
      } else {
        const url = choice.action === 'codespaces' ? CODESPACES : REPOSITORY;
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }),
  );
}
