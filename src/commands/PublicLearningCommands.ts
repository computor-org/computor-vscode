import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { courseAssistantBridge } from '../services/CourseAssistantBridge';
import { reviewSelectedFigure } from './FigureReviewCommand';

const REPOSITORY = 'https://github.com/computor-org/data-science-python';
const CODESPACES = 'https://codespaces.new/computor-org/data-science-python?quickstart=1';
const MARKETPLACE = 'https://marketplace.visualstudio.com/items?itemName=computor-org.hackl';

/** Public entry points never instantiate an authenticated API or a workspace job. */
export function registerPublicLearning(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('computor.publicCourses', async () => {
      const choice = await vscode.window.showQuickPick([
        { label: 'Read the public courses and examples', action: 'read', detail: 'No login. Three bilingual Python courses.' },
        { label: 'Work in desktop VS Code', action: 'clone', detail: 'Clone public material; execute code on your computer.' },
        { label: 'Work in GitHub Codespaces', action: 'codespaces', detail: 'GitHub account and quota required. AI uses your external provider key.' },
        { label: 'Set up the Hackl tutor', action: 'hackl', detail: 'Ask-only course mode; bring your own key or use a desktop local model.' },
      ], { title: 'Computor: public learning', placeHolder: 'Hosted capacity is independent of these options.' });
      if (!choice) return;
      if (choice.action === 'clone') {
        await vscode.commands.executeCommand('git.clone', `${REPOSITORY}.git`);
      } else {
        const url = choice.action === 'codespaces' ? CODESPACES : choice.action === 'hackl' ? MARKETPLACE : REPOSITORY;
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }),
    vscode.commands.registerCommand('computor.openTutor', async () => courseAssistantBridge.openChat()),
    vscode.commands.registerCommand('computor.reviewFigure', reviewSelectedFigure),
    vscode.workspace.onDidChangeWorkspaceFolders(() => courseAssistantBridge.clear()),
    { dispose: () => courseAssistantBridge.clear() },
  );
  // The public repository declares this marker; it contains no backend token.
  if (vscode.workspace.workspaceFolders?.some(folder =>
    fs.existsSync(path.join(folder.uri.fsPath, '.computor-public.json')))) {
    void courseAssistantBridge.apply({ id: 'public', course_id: 'python', title: 'Public Data Science with Python' });
  }
}
