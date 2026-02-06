/**
 * Extracts the grader's display name from a submission group object.
 *
 * Tries multiple paths because list-level and detail-level API responses
 * expose grading author info under different shapes:
 *   1. graded_by_course_member.user                    (CourseMemberGradingNode)
 *   2. gradings[latest].graded_by_course_member.user   (detail endpoint)
 *   3. latest_grading.graded_by_course_member.user     (SubmissionGroupWithGrading)
 *   4. graded_by_name                                   (GradingStudentView)
 */
export function extractGraderName(submissionGroup: unknown): string | null {
  if (!submissionGroup || typeof submissionGroup !== 'object') return null;
  const sg = submissionGroup as Record<string, unknown>;

  const directMember = graderNameFromMember(sg.graded_by_course_member);
  if (directMember) return directMember;

  const gradings = sg.gradings as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(gradings) && gradings.length > 0) {
    const latest = gradings[gradings.length - 1]!;
    const name = graderNameFromMember(latest.graded_by_course_member);
    if (name) return name;
  }

  const latestGrading = sg.latest_grading as Record<string, unknown> | undefined;
  if (latestGrading) {
    const name = graderNameFromMember(latestGrading.graded_by_course_member);
    if (name) return name;
  }

  const gradedByName = sg.graded_by_name;
  if (typeof gradedByName === 'string' && gradedByName.trim()) return gradedByName.trim();

  return null;
}

function graderNameFromMember(member: unknown): string | null {
  if (!member || typeof member !== 'object') return null;
  const m = member as Record<string, unknown>;
  const user = m.user as { given_name?: string | null; family_name?: string | null } | undefined;
  if (user) {
    const parts = [user.given_name, user.family_name].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }
  const userId = m.user_id;
  if (typeof userId === 'string' && userId.trim()) return userId.trim();
  return null;
}
