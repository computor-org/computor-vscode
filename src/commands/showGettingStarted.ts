import * as vscode from 'vscode';
import * as path from 'path';
import { showMarkdownPreview } from '../ui/webviews/markdownPreview';

export async function showGettingStarted(context: vscode.ExtensionContext): Promise<void> {
  try {
    const gettingStartedPath = path.join(context.extensionPath, 'README.md');
    await showMarkdownPreview(context, gettingStartedPath, { title: 'Getting Started' });
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to open Getting Started guide: ${error instanceof Error ? error.message : String(error)}`);
  }
}
