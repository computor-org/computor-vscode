import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ComputorApiService } from '../services/ComputorApiService';
import { notify } from '../utils/notify';
import { SOURCE_COLUMN } from './editorLayout';
import { showMarkdownTextPreview } from './webviews/markdownPreview';

/**
 * Editing the description of a course or a piece of course content as markdown,
 * with the rendered result beside it.
 *
 * The description used to be a four-line textarea inside "Show Details", which
 * is a poor place to write the paragraphs a course introduction actually needs
 * and showed none of the formatting back (computor-org/issues#356). It is
 * markdown, so it is edited the way markdown is edited: a document in the
 * source column, the preview in the auxiliary one.
 *
 * The text lives in the database, not on disk. To still get a normal editor,
 * the document is a scratch file in the extension's own storage that is written
 * back to the API on save — the file is a means of transport, never the source
 * of truth, which is why nothing here reads it after the editor closes.
 */

export const EDIT_DESCRIPTION_COMMAND = 'computor.lecturer.editContentDescription';

type DescriptionTarget =
  | { kind: 'course'; courseId: string; label: string }
  | { kind: 'content'; courseId: string; contentId: string; label: string };

/** Scratch documents currently open for editing, by file path. */
const openDescriptions = new Map<string, DescriptionTarget>();

/** Debounce timers for the live preview, by file path. */
const previewTimers = new Map<string, NodeJS.Timeout>();

const PREVIEW_DEBOUNCE_MS = 400;

/**
 * What a tree item is describing, or undefined when the item carries neither a
 * course nor a course content.
 *
 * Duck-typed on purpose: student, tutor and lecturer trees build their own item
 * classes, and importing them here would tie this module to all three.
 */
function targetFromTreeItem(item: any): DescriptionTarget | undefined {
  const content = item?.courseContent;
  if (content?.id) {
    const courseId = content.course_id ?? item?.course?.id;
    if (!courseId) {
      return undefined;
    }
    return {
      kind: 'content',
      courseId: String(courseId),
      contentId: String(content.id),
      label: String(content.title || content.path || 'Content')
    };
  }

  const course = item?.course;
  if (course?.id) {
    return {
      kind: 'course',
      courseId: String(course.id),
      label: String(course.title || course.path || 'Course')
    };
  }

  return undefined;
}

/** The description as the server currently has it. */
async function fetchDescription(
  target: DescriptionTarget,
  apiService: ComputorApiService
): Promise<string> {
  if (target.kind === 'course') {
    const course = await apiService.getCourse(target.courseId);
    return (course as any)?.description ?? '';
  }
  const content = await apiService.getCourseContent(target.contentId);
  return (content as any)?.description ?? '';
}

/** Push an edited description back to the server. */
async function saveDescription(
  target: DescriptionTarget,
  description: string,
  apiService: ComputorApiService
): Promise<void> {
  // An emptied editor means "no description", which the API expresses as null
  // rather than as an empty string — the tree keys its icon off "has one".
  const value = description.trim().length > 0 ? description : null;

  if (target.kind === 'course') {
    await apiService.updateCourse(target.courseId, { description: value } as any);
    return;
  }
  await apiService.updateCourseContent(target.courseId, target.contentId, {
    description: value
  } as any);
}

/** A filename that survives a round trip through a file system. */
function sanitizeFilename(label: string): string {
  const cleaned = label
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/[. ]+$/, '');
  return cleaned.length > 0 ? cleaned : 'Description';
}

/**
 * Path of the scratch document for a target.
 *
 * One directory per entity, named by its id, holding one file named after the
 * entity — so the editor tab reads "Mechanics.md" rather than a UUID, while
 * reopening the same course always lands on the same document. A title change
 * leaves the previous filename behind; the directory is cleared when it does.
 */
function scratchPathFor(target: DescriptionTarget, context: vscode.ExtensionContext): string {
  const id = target.kind === 'course' ? target.courseId : target.contentId;
  const dir = path.join(context.globalStorageUri.fsPath, 'descriptions', id);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${sanitizeFilename(target.label)}.md`;
  for (const stale of fs.readdirSync(dir)) {
    if (stale !== filename) {
      try {
        fs.unlinkSync(path.join(dir, stale));
        openDescriptions.delete(path.join(dir, stale));
      } catch {
        // A file we cannot remove is only clutter; the editor still works.
      }
    }
  }

  return path.join(dir, filename);
}

/** Render the current editor content into the shared markdown preview. */
async function renderPreview(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  target: DescriptionTarget
): Promise<void> {
  const text = document.getText();
  await showMarkdownTextPreview(
    context,
    text.trim().length > 0 ? text : '*No description yet.*',
    target.label
  );
}

async function editDescription(
  context: vscode.ExtensionContext,
  apiService: ComputorApiService,
  item: any
): Promise<void> {
  const target = targetFromTreeItem(item);
  if (!target) {
    notify.warning('Open "Edit Description" from a course or a unit in the tree.');
    return;
  }

  // An assignment's description IS its README: the student view renders the
  // README and never course_content.description, so text written here would
  // never be seen (issue #356). The editor serves the course and units only.
  const kindId = item?.contentType?.course_content_kind_id
    ?? item?.courseContent?.course_content_kind_id;
  const submittable = item?.isSubmittable ?? item?.courseContent?.is_submittable;
  if (target.kind === 'content' && (kindId === 'assignment' || submittable === true)) {
    notify.info(
      'Assignments describe themselves in their README — edit the README in the example and release it instead.'
    );
    return;
  }

  let description: string;
  try {
    description = await fetchDescription(target, apiService);
  } catch (error) {
    notify.error(
      `Could not load the description: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  const filePath = scratchPathFor(target, context);
  const uri = vscode.Uri.file(filePath);

  // An editor already open on this description may hold unsaved edits; writing
  // the server's copy over it would throw them away.
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === filePath);
  if (!open?.isDirty) {
    fs.writeFileSync(filePath, description, 'utf8');
  }

  openDescriptions.set(filePath, target);

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(document, 'markdown');
  await vscode.window.showTextDocument(document, { viewColumn: SOURCE_COLUMN, preview: false });
  await renderPreview(context, document, target);

  if (description.trim().length === 0) {
    notify.info(`No description yet — what you write here becomes the description of “${target.label}”. Ctrl+S/Cmd+S publishes it.`);
  }
}

export function registerDescriptionEditor(
  context: vscode.ExtensionContext,
  apiService: ComputorApiService,
  onSaved?: (target: { kind: 'course' | 'content'; courseId: string; contentId?: string }) => void
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(EDIT_DESCRIPTION_COMMAND, async (item?: unknown) => {
      await editDescription(context, apiService, item);
    })
  );

  // `onDidSaveTextDocument` does not say WHY a document saved, and autosave
  // (`files.autoSave`) fires it on every pause — which published half-written
  // descriptions mid-sentence (#324). The reason is captured here, and only a
  // deliberate Ctrl+S/Cmd+S publishes; autosave keeps the draft local.
  const pendingSaveReasons = new Map<string, vscode.TextDocumentSaveReason>();
  let autosaveHintShown = false;
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((event) => {
      if (openDescriptions.has(event.document.uri.fsPath)) {
        pendingSaveReasons.set(event.document.uri.fsPath, event.reason);
      }
    })
  );

  // A manual save of the scratch document is what publishes the description.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const target = openDescriptions.get(document.uri.fsPath);
      if (!target) {
        return;
      }
      const reason =
        pendingSaveReasons.get(document.uri.fsPath) ?? vscode.TextDocumentSaveReason.Manual;
      pendingSaveReasons.delete(document.uri.fsPath);
      if (reason !== vscode.TextDocumentSaveReason.Manual) {
        if (!autosaveHintShown) {
          autosaveHintShown = true;
          notify.info(
            'Autosave keeps this draft local — press Ctrl+S/Cmd+S when you want to publish the description.'
          );
        }
        return;
      }
      try {
        await saveDescription(target, document.getText(), apiService);
        notify.info(`Description of “${target.label}” published.`);
        onSaved?.(
          target.kind === 'course'
            ? { kind: 'course', courseId: target.courseId }
            : { kind: 'content', courseId: target.courseId, contentId: target.contentId }
        );
      } catch (error) {
        // The text stays in the editor, so a failed save loses nothing.
        notify.error(
          `Could not save the description: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    })
  );

  // Typing updates the preview; the server only hears about it on save.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const filePath = event.document.uri.fsPath;
      const target = openDescriptions.get(filePath);
      if (!target || event.contentChanges.length === 0) {
        return;
      }
      const pending = previewTimers.get(filePath);
      if (pending) {
        clearTimeout(pending);
      }
      previewTimers.set(
        filePath,
        setTimeout(() => {
          previewTimers.delete(filePath);
          void renderPreview(context, event.document, target);
        }, PREVIEW_DEBOUNCE_MS)
      );
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      const filePath = document.uri.fsPath;
      const pending = previewTimers.get(filePath);
      if (pending) {
        clearTimeout(pending);
        previewTimers.delete(filePath);
      }
      openDescriptions.delete(filePath);
    })
  );
}
