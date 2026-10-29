import * as vscode from 'vscode';
import { showMarkdownPreview } from '../ui/webviews/markdownPreview';
import { notify } from '../utils/notify';
import { HELP_PAGES, helpPagePath } from '../utils/studentHelpPages';
import { say, sayFailed } from '../utils/uiLanguage';

/**
 * The course help page, which explains the view as a whole. The README is
 * written for developers and exists only in English.
 */
export async function showGettingStarted(context: vscode.ExtensionContext): Promise<void> {
  try {
    const helpPath = helpPagePath(context.extensionPath, HELP_PAGES.course);
    await showMarkdownPreview(context, helpPath, { title: say('Getting Started', 'Erste Schritte') });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    void notify.error(sayFailed(`Failed to open Getting Started guide`, `„Erste Schritte“ konnte nicht geöffnet werden`, detail));
  }
}
