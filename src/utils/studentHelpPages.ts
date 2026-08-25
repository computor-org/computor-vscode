/**
 * Which help page a student tree row leads to.
 *
 * The student view has three kinds of row and three help pages, but the mapping
 * is not one line per kind: course *content* covers both assignments and the
 * readings, notes and data that are not handed in. Sending everything under
 * `studentCourseContent` to the assignment page gave a reading a page about
 * repositories, test runs and submission limits — none of which it has.
 *
 * Kept out of the command so it can be tested without a running extension host,
 * and so the set of page names has one home.
 */

export const HELP_PAGES = {
  course: 'student-course.md',
  unit: 'student-unit.md',
  assignment: 'student-assignment.md'
} as const;

export type HelpPage = (typeof HELP_PAGES)[keyof typeof HELP_PAGES];

/**
 * The page for a row's context value.
 *
 * Prefix and segment matches, never equality: a row's context value is a
 * dot-joined list of facts about it (`studentCourseContent.assignment.cloned`,
 * and a `.hasDescription` suffix on top), so anything anchored to the whole
 * string breaks the moment a fact is added.
 *
 * Anything unrecognised — including no row at all, when Help is run from the
 * command palette — lands on the course page, which is the one that explains
 * the view as a whole.
 */
export function helpPageFor(contextValue?: unknown): HelpPage {
  if (typeof contextValue !== 'string' || contextValue.length === 0) {
    return HELP_PAGES.course;
  }

  if (contextValue.startsWith('studentCourseContent')) {
    // Readings share the row type with assignments and are told apart by the
    // kind segment the tree stamps on. Only an actual assignment gets the
    // assignment page; everything else is content to read, which the unit page
    // covers.
    return contextValue.split('.').includes('assignment')
      ? HELP_PAGES.assignment
      : HELP_PAGES.unit;
  }

  if (contextValue.startsWith('studentCourseUnit')) {
    return HELP_PAGES.unit;
  }

  // Files and folders inside an assignment: the assignment page is where
  // working with files is described.
  if (contextValue === 'studentFile' || contextValue === 'studentFolder') {
    return HELP_PAGES.assignment;
  }

  return HELP_PAGES.course;
}
