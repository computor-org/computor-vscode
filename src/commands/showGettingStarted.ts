import * as vscode from 'vscode';
import * as path from 'path';

export async function showGettingStarted(context: vscode.ExtensionContext): Promise<void> {
  try {
    // Get the extension path and construct the markdown file path
    const gettingStartedPath = path.join(context.extensionPath, 'docs', 'help', 'getting-started.md');
    const gettingStartedUri = vscode.Uri.file(gettingStartedPath);

    // Open the markdown preview
    if (vscode.window.activeTextEditor) {
      await vscode.commands.executeCommand('markdown.showPreviewToSide', gettingStartedUri);
    } else {
      await vscode.commands.executeCommand('markdown.showPreview', gettingStartedUri);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to open Getting Started guide: ${error instanceof Error ? error.message : String(error)}`);
  }
}
