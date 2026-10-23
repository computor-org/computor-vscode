import * as path from 'path';

/**
 * Which assignment a palette command acts on.
 *
 * The Command Palette passes no tree element, so `Test Assignment` and `Submit`
 * used to fail with "No assignment selected" even while a row was highlighted
 * (computor-org/issues#470). The target now comes from the tree selection first
 * and from the file in the active editor second.
 */

/** A tree row that stands for an assignment (the shape the commands already take). */
export interface AssignmentItem {
  courseContent: any;
  submissionGroup?: any;
}

const isAssignmentRow = (row: any): row is AssignmentItem =>
  !!row?.courseContent
  && (typeof row.contextValue !== 'string' || row.contextValue.startsWith('studentCourseContent.assignment'));

/** The highlighted assignment row, if the selection holds one. */
export function assignmentFromSelection(selection: readonly unknown[] | undefined): AssignmentItem | undefined {
  return (selection ?? []).find(isAssignmentRow) as AssignmentItem | undefined;
}

/**
 * The assignment whose directory contains `filePath`; the deepest directory
 * wins so nested assignments resolve to the inner one.
 */
export function assignmentForFile(
  contents: readonly any[],
  filePath: string | undefined,
  baseDir?: string
): AssignmentItem | undefined {
  if (!filePath) {
    return undefined;
  }
  const file = path.resolve(filePath);
  let best: { content: any; length: number } | undefined;
  for (const content of contents) {
    const dir = content?.directory as string | undefined;
    if (!dir || !content.submission_group) {
      continue;
    }
    const abs = path.isAbsolute(dir) ? path.resolve(dir) : baseDir ? path.resolve(baseDir, dir) : undefined;
    if (!abs) {
      continue;
    }
    const rel = path.relative(abs, file);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      continue;
    }
    if (!best || abs.length > best.length) {
      best = { content, length: abs.length };
    }
  }
  return best ? { courseContent: best.content, submissionGroup: best.content.submission_group } : undefined;
}

export const NO_ASSIGNMENT_HINT = (action: string): string =>
  `Select an assignment first, then run ${action}.`;

/** Wording of the confirmation shown before a palette command acts. */
export function confirmationPrompt(kind: 'test' | 'submit', title: string): {
  message: string; detail: string; verb: string;
} {
  const verb = kind === 'test' ? 'Test' : 'Submit';
  return {
    verb,
    message: `${verb} "${title}"?`,
    detail: kind === 'test'
      ? 'Your saved changes are committed, uploaded and run against the tests. Nothing is submitted for grading.'
      : 'Your work is sent for grading. The last tested version is submitted and counts against your submission limit.'
  };
}

/** The positive confirmation after a submission went through (computor-org/issues#471). */
export function submittedMessage(title: string, version?: string): string {
  return version
    ? `Submitted "${title}" (revision ${version.substring(0, 8)}).`
    : `Submitted "${title}".`;
}
