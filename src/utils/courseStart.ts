import type { CourseContentStudentList } from '../types/generated';
import { localizedUnitTitle } from './contentLanguage';

/**
 * Where a learner starts in a course: its welcome item, or else its first
 * released assignment. Shared by the workspace landing and the welcome page,
 * and free of `vscode` so both can be tested in plain Node.
 */

export function firstReleasedCourseItem(contents: CourseContentStudentList[]): CourseContentStudentList | undefined {
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
    })[0];
}

export function courseWelcomeItem(contents: CourseContentStudentList[]): CourseContentStudentList | undefined {
  return contents.find(content => content.visible_effective !== false
    && content.course_content_kind_id !== 'assignment' && Boolean(content.description?.trim())
    && (/^(welcome(?:\s*\/\s*start here)?|willkommen|getting[ _-]started|start[ _-]here|start|introduction|einführung)$/i.test(content.title?.trim() ?? '')
      || /^(welcome|willkommen|start_here|getting_started|introduction)$/.test(content.path.split('.').pop()?.toLowerCase() ?? '')));
}

/**
 * The item to start with, as the learner finds it in the course tree:
 * "Woche 1 → Mathematische Konstanten", or the welcome item's title.
 */
export function courseStartPointer(contents: CourseContentStudentList[], language: string): string | undefined {
  const welcome = courseWelcomeItem(contents);
  if (welcome) return welcome.title?.trim() || undefined;
  const first = firstReleasedCourseItem(contents);
  if (!first) return undefined;
  const byPath = new Map(contents.map(content => [content.path, content]));
  const parts = first.path.split('.');
  const trail = parts.map((_, index) => byPath.get(parts.slice(0, index + 1).join('.')))
    .filter((item): item is CourseContentStudentList => Boolean(item?.title?.trim()))
    .map(item => item === first ? item.title!.trim() : localizedUnitTitle(item.title!.trim(), language));
  return trail.length ? trail.join(' → ') : undefined;
}
