import type { CascadeDeleteResult, EntityDeleteCount } from '../types/generated/common';

/**
 * Renders a `CascadeDeleteResult` dry run as the `detail` body of the
 * confirmation modal shown before an organization, course family or course
 * is deleted.
 *
 * Pure text, no VS Code API, so it is unit-testable. Order matters: the
 * number that decides whether the delete is even allowed (submissions from
 * students) comes first, then the rest of what goes, then what is removed
 * from the git server, and — always, for courses — the reassurance that the
 * students' repositories stay.
 */

export type CascadeEntityKind = 'organization' | 'course_family' | 'course';

/** Human labels for the counters, in display order. Zero counts are omitted. */
const COUNT_LABELS: ReadonlyArray<[keyof EntityDeleteCount, string]> = [
  ['student_submissions', 'Submissions from students'],
  ['courses', 'Courses'],
  ['course_families', 'Course families'],
  ['course_members', 'Course members'],
  ['course_groups', 'Course groups'],
  ['course_contents', 'Assignments and units'],
  ['course_content_types', 'Content types'],
  ['submission_groups', 'Submission groups'],
  ['submission_artifacts', 'Submissions (all)'],
  ['submission_grades', 'Grades'],
  ['submission_reviews', 'Reviews'],
  ['results', 'Test results'],
  ['course_content_deployments', 'Deployments'],
  ['messages', 'Messages'],
  ['course_member_comments', 'Comments'],
  ['example_repositories', 'Example repositories'],
  ['examples', 'Examples'],
  ['example_versions', 'Example versions'],
  ['student_profiles', 'Student profiles']
];

export function formatCascadePreview(
  result: CascadeDeleteResult,
  opts: { kind?: CascadeEntityKind } = {}
): string {
  const kind = opts.kind ?? (result.entity_type as CascadeEntityKind);
  const counts = result.deleted_counts ?? {};
  const lines: string[] = [];

  const rows = COUNT_LABELS
    .map(([key, label]) => [label, Number(counts[key] ?? 0)] as const)
    .filter(([, n]) => n > 0);
  if (rows.length > 0) {
    lines.push('This permanently deletes:');
    for (const [label, n] of rows) {
      lines.push(`  • ${label}: ${n}`);
    }
  } else {
    lines.push('Nothing else is stored under it.');
  }

  const repos = result.git_repositories ?? [];
  if (repos.length > 0) {
    lines.push('');
    lines.push('Git repositories that will be deleted:');
    for (const repo of repos) {
      lines.push(`  • ${repo}`);
    }
  }

  if (kind === 'course') {
    lines.push('');
    const kept = result.student_repositories_kept ?? 0;
    lines.push(`Student repositories are kept (${kept}). They stay on the git server, untouched.`);
  }

  lines.push('');
  lines.push('There is no undo.');
  return lines.join('\n');
}
