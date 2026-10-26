import * as vscode from 'vscode';
import { beginMarkdownPreviewRequest, MarkdownPreviewOptions, showMarkdownTextPreview } from './webviews/markdownPreview';
import { isRestoringSelection } from './treeRestore';
import { isCourseWelcomeContent } from '../services/WorkspaceCourseLanding';
import type { CourseContentStudentList } from '../types/generated';
import { descriptionInLanguage } from '../utils/contentLanguage';

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
export const PREVIEW_STUDENT_DESCRIPTION_COMMAND = 'computor.student.previewDescription';

interface StudentDescriptionTreeItem extends Partial<vscode.TreeItem & DescribedTreeItem> {
  courseContent?: unknown;
  node?: { courseContent?: CourseContentStudentList };
}

/** A course welcome is a reading destination, rather than instructions beside code. */
function descriptionOptions(item: StudentDescriptionTreeItem): MarkdownPreviewOptions {
  const content = (item.courseContent ?? item.node?.courseContent) as CourseContentStudentList | undefined;
  return /^studentCourseUnit(?:\.|$)/.test(item.contextValue ?? '')
    && content && isCourseWelcomeContent(content)
    ? { studentReading: true, welcomeContentId: content.id }
    : /^studentCourseUnit(?:\.|$)/.test(item.contextValue ?? '') ? { studentReading: true } : {};
}

type DescriptionLanguageResolver = (item: object) => Promise<string>;
let descriptionLanguage: DescriptionLanguageResolver | undefined;

/** How the description views find the reading language once the API is available. */
export function setDescriptionLanguageResolver(resolver: DescriptionLanguageResolver | undefined): void {
  descriptionLanguage = resolver;
}

/** The item's description in the reading language (see descriptionInLanguage). */
async function localizedDescription(item: object, markdown: string): Promise<string> {
  if (!descriptionLanguage) return markdown;
  try {
    return descriptionInLanguage(markdown, await descriptionLanguage(item));
  } catch (error) {
    console.warn('[StudentDescription] Could not resolve the reading language:', error);
    return markdown;
  }
}

/** Preview real student selections without replaying a restored highlight. */
export function createStudentDescriptionSelectionHandler(
  context: vscode.ExtensionContext,
  previewAssignment?: (item: StudentDescriptionTreeItem, options: MarkdownPreviewOptions) => Promise<void>,
  previewUnit?: (item: StudentDescriptionTreeItem, options: MarkdownPreviewOptions) => Promise<void>
): (item?: StudentDescriptionTreeItem, explicit?: boolean) => Promise<void> {
  let revision = 0;
  let pending: { item: StudentDescriptionTreeItem; promise: Promise<void>; isCurrent: () => boolean } | undefined;
  return async (item, explicit = false) => {
    // Expanding/highlighting a container must leave the reading task and its pending request alone.
    if (!explicit && /^studentCourseUnit(?:\.|$)/.test(item?.contextValue ?? '')) return;
    if (item && pending?.item === item && pending.isCurrent() && (explicit || !isRestoringSelection())) return pending.promise;
    const selected = ++revision;
    pending = undefined;
    if (!item || (!explicit && isRestoringSelection())) return;
    const unit = /^studentCourseUnit(?:\.|$)/.test(item.contextValue ?? '') && hasDescription(item.descriptionMarkdown);
    const assignment = item.contextValue?.startsWith('studentCourseContent.assignment') && previewAssignment;
    if (!unit && !assignment) return;
    const request = beginMarkdownPreviewRequest();
    const isCurrent = () => selected === revision && request.isCurrent();
    const options: MarkdownPreviewOptions = {
      ...descriptionOptions(item),
      preserveFocus: true,
      isCurrent,
      request
    };
    const show = async () => {
      try {
        if (unit && previewUnit) {
          await previewUnit(item, options);
        } else if (unit) {
          let markdown = item.descriptionMarkdown as string;
          if (descriptionLanguage) {
            markdown = await localizedDescription(item, markdown);
            if (!isCurrent()) return;
          }
          await showMarkdownTextPreview(context, markdown, item.descriptionTitle || 'Description', options);
        } else if (assignment) {
          await assignment(item, options);
        }
      } catch (error) {
        console.warn('[StudentDescription] Could not show the selected description:', error);
      }
    };
    const promise = show();
    pending = { item, promise, isCurrent };
    await promise;
    if (pending?.promise === promise) pending = undefined;
  };
}

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
  const text = descriptionInLanguage(description, '').trim();
  if (text.length <= limit) {
    return text;
  }
  const cut = text.slice(0, limit);
  const boundary = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, boundary > 0 ? boundary : limit).trimEnd()}…`;
}

export function registerContentDescription(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_DESCRIPTION_COMMAND, async (item?: StudentDescriptionTreeItem) => {
      if (!item?.descriptionMarkdown) {
        void vscode.window.showInformationMessage('Nothing has been described here yet.');
        return;
      }
      const request = beginMarkdownPreviewRequest();
      await showMarkdownTextPreview(
        context,
        await localizedDescription(item, item.descriptionMarkdown),
        item.descriptionTitle || 'Description',
        { ...descriptionOptions(item), request }
      );
    })
  );
}
