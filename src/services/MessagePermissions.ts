import type { UserScopes } from '../types/generated';

const POSTING_ROLES = new Set(['_owner', '_manager']);

// Course roles that may post an announcement to a course, one of its
// contents, or one of its groups. Mirrors LECTURER_AND_ABOVE in
// computor_backend/permissions/roles.py — the backend's
// `_check_course_*_write_permission` helpers all gate on `_lecturer`.
const COURSE_ANNOUNCEMENT_ROLES = new Set(['_lecturer', '_maintainer', '_owner']);

// Scopes where threading replies makes sense. Broadcast-style scopes
// (course/family/org/global, plus course_group / course_content) host one-way
// announcements — a reply thread on those quickly turns into noise that's
// visible to everyone who sees the original. Replies are restricted to
// conversational scopes only.
type ScopeName =
  | 'user'
  | 'course_member'
  | 'submission_group'
  | 'course_group'
  | 'course_content'
  | 'course'
  | 'course_family'
  | 'organization'
  | 'global';

const REPLY_ALLOWED_SCOPES: ReadonlySet<ScopeName> = new Set<ScopeName>([
  'user',
  'course_member',
  'submission_group'
]);

export function deriveScopeFromCreatePayload(payload: Record<string, unknown>): ScopeName {
  if (typeof payload.user_id === 'string' && payload.user_id) { return 'user'; }
  if (typeof payload.course_member_id === 'string' && payload.course_member_id) { return 'course_member'; }
  if (typeof payload.submission_group_id === 'string' && payload.submission_group_id) { return 'submission_group'; }
  if (typeof payload.course_group_id === 'string' && payload.course_group_id) { return 'course_group'; }
  if (typeof payload.course_content_id === 'string' && payload.course_content_id) { return 'course_content'; }
  if (typeof payload.course_id === 'string' && payload.course_id) { return 'course'; }
  if (typeof payload.course_family_id === 'string' && payload.course_family_id) { return 'course_family'; }
  if (typeof payload.organization_id === 'string' && payload.organization_id) { return 'organization'; }
  return 'global';
}

export function canReplyInScope(scope: ScopeName): boolean {
  return REPLY_ALLOWED_SCOPES.has(scope);
}

function hasPostingRole(roles: string[] | undefined): boolean {
  if (!roles) {
    return false;
  }
  for (const role of roles) {
    if (POSTING_ROLES.has(role)) {
      return true;
    }
  }
  return false;
}

export function canPostToOrganization(scopes: UserScopes | undefined, organizationId: string): boolean {
  if (!scopes) {
    return false;
  }
  if (scopes.is_admin) {
    return true;
  }
  return hasPostingRole(scopes.organization?.[organizationId]);
}

export function canPostToCourseFamily(scopes: UserScopes | undefined, courseFamilyId: string): boolean {
  if (!scopes) {
    return false;
  }
  if (scopes.is_admin) {
    return true;
  }
  return hasPostingRole(scopes.course_family?.[courseFamilyId]);
}

export function canPostGlobal(
  scopes: UserScopes | undefined,
  /** Set when the user holds the `_user_manager` system role. User managers
   *  are allowed to post global announcements alongside admins. */
  isUserManager = false
): boolean {
  return scopes?.is_admin === true || isUserManager;
}

/**
 * Whether the user may post an announcement scoped to this course — which
 * covers the `course`, `course_content` and `course_group` scopes, since
 * the backend gates all three on `_lecturer` in the containing course.
 *
 * Callers used to skip this check entirely and build a compose payload
 * anyway, with a comment admitting it would 403. Students and tutors got a
 * full Subject + body + Send form on a lecturer-only scope and found out by
 * typing a message.
 */
export function canPostCourseAnnouncement(
  scopes: UserScopes | undefined,
  courseId: string | undefined
): boolean {
  if (!scopes || !courseId) {
    return false;
  }
  if (scopes.is_admin) {
    return true;
  }
  const roles = scopes.course?.[courseId];
  if (!roles) {
    return false;
  }
  for (const role of roles) {
    if (COURSE_ANNOUNCEMENT_ROLES.has(role)) {
      return true;
    }
  }
  return false;
}

/** The reason to show under a locked compose box for a course announcement. */
export const COURSE_ANNOUNCEMENT_DENIED_REASON =
  'Only lecturers and above can post announcements here. You can read them.';
