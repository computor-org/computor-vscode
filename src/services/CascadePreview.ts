import type { CascadeDeleteResult, EntityDeleteCount } from '../types/generated/common';
import { say } from '../utils/uiLanguage';

/**
 * Renders a `CascadeDeleteResult` dry run as the `detail` body of the
 * confirmation modal shown before an organization, course family or course
 * is deleted.
 *
 * Pure text in the reading language, so it is unit-testable. Order matters: the
 * number that decides whether the delete is even allowed (submissions from
 * students) comes first, then the rest of what goes, then what is removed
 * from the git server, and — always, for courses — the reassurance that the
 * students' repositories stay.
 */

export type CascadeEntityKind = 'organization' | 'course_family' | 'course';

/** English and German labels for the counters, in display order. Zero counts are omitted. */
const COUNT_LABELS: ReadonlyArray<[keyof EntityDeleteCount, string, string]> = [
  ['student_submissions', 'Submissions from students', 'Abgaben von Studierenden'],
  ['courses', 'Courses', 'Kurse'],
  ['course_families', 'Course families', 'Kursfamilien'],
  ['course_members', 'Course members', 'Kursmitglieder'],
  ['course_groups', 'Course groups', 'Kursgruppen'],
  ['course_contents', 'Assignments and units', 'Aufgaben und Einheiten'],
  ['course_content_types', 'Content types', 'Inhaltstypen'],
  ['submission_groups', 'Submission groups', 'Abgabegruppen'],
  ['submission_artifacts', 'Submissions (all)', 'Abgaben (alle)'],
  ['submission_grades', 'Grades', 'Bewertungen'],
  ['submission_reviews', 'Reviews', 'Reviews'],
  ['results', 'Test results', 'Testergebnisse'],
  ['course_content_deployments', 'Deployments', 'Bereitstellungen'],
  ['messages', 'Messages', 'Nachrichten'],
  ['course_member_comments', 'Comments', 'Kommentare'],
  ['example_repositories', 'Example repositories', 'Beispiel-Repositorys'],
  ['examples', 'Examples', 'Beispiele'],
  ['example_versions', 'Example versions', 'Beispielversionen'],
  ['student_profiles', 'Student profiles', 'Profile von Studierenden']
];

export function formatCascadePreview(
  result: CascadeDeleteResult,
  opts: { kind?: CascadeEntityKind } = {}
): string {
  const kind = opts.kind ?? (result.entity_type as CascadeEntityKind);
  const counts = result.deleted_counts ?? {};
  const lines: string[] = [];

  const rows = COUNT_LABELS
    .map(([key, en, de]) => [say(en, de), Number(counts[key] ?? 0)] as const)
    .filter(([, n]) => n > 0);
  if (rows.length > 0) {
    lines.push(say('This permanently deletes:', 'Endgültig gelöscht werden:'));
    for (const [label, n] of rows) {
      lines.push(`  • ${label}: ${n}`);
    }
  } else {
    lines.push(say('Nothing else is stored under it.', 'Darunter ist nichts weiter gespeichert.'));
  }

  const repos = result.git_repositories ?? [];
  if (repos.length > 0) {
    lines.push('');
    lines.push(say('Git repositories that will be deleted:', 'Diese Git-Repositorys werden gelöscht:'));
    for (const repo of repos) {
      lines.push(`  • ${repo}`);
    }
  }

  if (kind === 'course') {
    lines.push('');
    const kept = result.student_repositories_kept ?? 0;
    lines.push(say(
      `Student repositories are kept (${kept}). They stay on the git server, untouched.`,
      `Die Repositorys der Studierenden bleiben erhalten (${kept}), unangetastet auf dem Git-Server.`
    ));
  }

  lines.push('');
  lines.push(say('There is no undo.', 'Das lässt sich nicht rückgängig machen.'));
  return lines.join('\n');
}
