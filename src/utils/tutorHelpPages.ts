/**
 * Which help page a tutor tree row leads to.
 *
 * Two pages, split the way the work splits: finding the student and the
 * waiting work (the view as a whole), and everything that happens on one
 * assignment (checkout, testing, comparing, grading). The same split the
 * student pages use, without a unit page — a tutor's units carry nothing a
 * paragraph on the course page does not cover.
 *
 * Kept out of the command so it can be tested without a running extension
 * host, and so the set of page names has one home.
 */

export const TUTOR_HELP_PAGES = {
  course: 'tutor-course.md',
  assignment: 'tutor-assignment.md'
} as const;

export type TutorHelpPage = (typeof TUTOR_HELP_PAGES)[keyof typeof TUTOR_HELP_PAGES];

/**
 * The page for a row's context value.
 *
 * Prefix matches, never equality: a row's context value is a dot-joined list
 * of facts about it (`tutorStudentContent.assignment.hasRepo.hidden`), so
 * anything anchored to the whole string breaks the moment a fact is added.
 *
 * Anything unrecognised — including no row at all, when Help is run from the
 * command palette — lands on the course page, which is the one that explains
 * the view as a whole.
 */
export function tutorHelpPageFor(contextValue?: unknown): TutorHelpPage {
  if (typeof contextValue !== 'string' || contextValue.length === 0) {
    return TUTOR_HELP_PAGES.course;
  }

  // An assignment row and everything inside it: the virtual folders, the
  // files under them, and the submission artifacts in the history.
  if (
    contextValue.startsWith('tutorStudentContent.assignment') ||
    contextValue.startsWith('tutorVirtualFolder') ||
    contextValue.startsWith('tutorFsFolder') ||
    contextValue.startsWith('tutorFsFile') ||
    contextValue.startsWith('tutorSubmission')
  ) {
    return TUTOR_HELP_PAGES.assignment;
  }

  return TUTOR_HELP_PAGES.course;
}
