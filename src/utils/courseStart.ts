import type { CourseContentStudentList } from '../types/generated';
import { localizedUnitTitle } from './contentLanguage';

/**
 * Where a learner starts in a course: its welcome item, or else its first
 * released assignment; and where a returning learner goes on. Shared by the
 * workspace landing and the welcome page, and free of `vscode` so both can be
 * tested in plain Node.
 */

export function firstReleasedCourseItem(contents: CourseContentStudentList[]): CourseContentStudentList | undefined {
  return releasedAssignments(contents)[0];
}

/** The learner has tested or handed in at least one assignment of the course. */
export function hasStartedCourse(contents: CourseContentStudentList[]): boolean {
  return contents.some(content => content.course_content_kind_id === 'assignment'
    && (content.submitted === true || content.result != null
      || (content.result_count ?? 0) > 0 || (content.submission_count ?? 0) > 0));
}

/** Handed in with a passing test (or one without tests), or already marked corrected. */
export function isCourseItemDone(content: CourseContentStudentList): boolean {
  if (content.status?.toLowerCase() === 'corrected') return true;
  if (content.submitted !== true) return false;
  const result = content.result?.result;
  return typeof result !== 'number' || result >= 1;
}

/** The first released assignment, in course order, that is not done yet (computor-org/issues#525). */
export function nextOpenCourseItem(contents: CourseContentStudentList[]): CourseContentStudentList | undefined {
  return releasedAssignments(contents).find(content => !isCourseItemDone(content));
}

function releasedAssignments(contents: CourseContentStudentList[]): CourseContentStudentList[] {
  const byPath = new Map(contents.map(content => [content.path, content]));
  const ancestry = (content: CourseContentStudentList): number[] => content.path.split('.')
    .map((_, index, parts) => byPath.get(parts.slice(0, index + 1).join('.'))?.position ?? 0);
  return contents.filter(content => content.visible_effective !== false
    && content.course_content_kind_id === 'assignment'
    && (content.deployment?.deployment_status === 'deployed' || Boolean(content.deployment?.deployed_at)))
    .sort((a, b) => {
      const left = ancestry(a), right = ancestry(b);
      for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const difference = left[index]! - right[index]!;
        if (difference) return difference;
      }
      return left.length - right.length || a.path.localeCompare(b.path);
    });
}

export function courseWelcomeItem(contents: CourseContentStudentList[]): CourseContentStudentList | undefined {
  return contents.find(content => content.visible_effective !== false
    && content.course_content_kind_id !== 'assignment' && Boolean(content.description?.trim())
    && (/^(welcome(?:\s*\/\s*start here)?|willkommen|getting[ _-]started|start[ _-]here|start|introduction|einführung)$/i.test(content.title?.trim() ?? '')
      || /^(welcome|willkommen|start_here|getting_started|introduction)$/.test(content.path.split('.').pop()?.toLowerCase() ?? '')));
}

/**
 * The item to start with, as the learner finds it in the course tree:
 * "Woche 1 → Mathematische Konstanten", or the welcome item's title. A
 * learner who has started is pointed at the next open assignment instead,
 * and at nothing once every released assignment is done.
 */
export function courseStartPointer(contents: CourseContentStudentList[], language: string): string | undefined {
  if (hasStartedCourse(contents)) {
    const next = nextOpenCourseItem(contents);
    return next ? courseItemTrail(contents, next, language) : undefined;
  }
  const welcome = courseWelcomeItem(contents);
  if (welcome) return welcome.title?.trim() || undefined;
  const first = firstReleasedCourseItem(contents);
  return first ? courseItemTrail(contents, first, language) : undefined;
}

/** "Woche 3 → Beta-Absorption": the item's title under its units' titles in the reading language. */
export function courseItemTrail(contents: CourseContentStudentList[], item: CourseContentStudentList, language: string): string | undefined {
  const byPath = new Map(contents.map(content => [content.path, content]));
  const parts = item.path.split('.');
  const trail = parts.map((_, index) => byPath.get(parts.slice(0, index + 1).join('.')))
    .filter((entry): entry is CourseContentStudentList => Boolean(entry?.title?.trim()))
    .map(entry => entry === item ? entry.title!.trim() : localizedUnitTitle(entry.title!.trim(), language));
  return trail.length ? trail.join(' → ') : undefined;
}
