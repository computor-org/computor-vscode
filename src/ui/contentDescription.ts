import * as vscode from 'vscode';
import { showMarkdownTextPreview } from './webviews/markdownPreview';

/**
 * Showing the description a lecturer wrote for a course or a unit.
 *
 * Courses and units have carried a description all along, but only the person
 * who typed it ever saw it: it lived in the lecturer's "Show Details" form and
 * appeared in no tree, no tooltip and no view a student or tutor could open
 * (computor-org/issues#324). An assignment's description has always been one
 * click away — this gives courses and units the same treatment, from the same
 * field, rendered as markdown.
 *
 * A tree item opts in by carrying these two properties; the command and the
 * `when` clauses key off them rather than off each provider's own item shapes.
 */
export interface DescribedTreeItem {
  /** Heading for the preview tab — the course or unit name. */
  descriptionTitle: string;
  /** The markdown itself. Only set when there is something to show. */
  descriptionMarkdown: string;
}

export const SHOW_DESCRIPTION_COMMAND = 'computor.showContentDescription';

/** Whether `description` holds anything worth opening a preview for. */
export function hasDescription(description?: string | null): boolean {
  return typeof description === 'string' && description.trim().length > 0;
}

/**
 * Mark a tree item as having a description, and suffix its context value so
 * the icon only appears on items that actually have one.
 */
export function withDescription<T extends vscode.TreeItem>(
  item: T,
  title: string,
  description: string | null | undefined
): T {
  if (!hasDescription(description)) {
    return item;
  }
  const described = item as T & DescribedTreeItem;
  described.descriptionTitle = title;
  described.descriptionMarkdown = description as string;
  if (typeof item.contextValue === 'string') {
    item.contextValue = `${item.contextValue}.hasDescription`;
  }
  return item;
}

/**
 * A tooltip carrying the description under the facts.
 *
 * Markdown, so the lecturer's formatting survives the hover; the full text
 * stays behind the icon, since a tooltip is no place for three paragraphs.
 */
export function tooltipWithDescription(
  lines: string[],
  description?: string | null
): string | vscode.MarkdownString {
  if (!hasDescription(description)) {
    return lines.join('\n');
  }
  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown(lines.map((line) => escapeMarkdown(line)).join('\n\n'));
  tooltip.appendMarkdown('\n\n---\n\n');
  tooltip.appendMarkdown(summarise(description as string));
  return tooltip;
}

/** Markdown special characters in plain facts like "3 items" or "a_b". */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
}

/**
 * The opening of a description, for the hover. Long text is cut at a sentence
 * or word boundary rather than mid-word, with the rest behind the icon.
 */
function summarise(description: string, limit = 400): string {
  const text = description.trim();
  if (text.length <= limit) {
    return text;
  }
  const cut = text.slice(0, limit);
  const boundary = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, boundary > 0 ? boundary : limit).trimEnd()}…`;
}

export function registerContentDescription(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_DESCRIPTION_COMMAND, async (item?: Partial<DescribedTreeItem>) => {
      if (!item?.descriptionMarkdown) {
        void vscode.window.showInformationMessage('Nothing has been described here yet.');
        return;
      }
      await showMarkdownTextPreview(
        context,
        item.descriptionMarkdown,
        item.descriptionTitle || 'Description'
      );
    })
  );
}
