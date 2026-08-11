import type { MessageGet, MessageQuery, UserScopes } from '../types/generated';
import { CONVERSATIONAL_SCOPES, MESSAGE_TARGET_FIELDS } from '../types/generated/constants';

const POSTING_ROLES = new Set(['_owner', '_manager']);

// Course roles that may post an announcement to a course, one of its
// contents, or one of its groups. Mirrors LECTURER_AND_ABOVE in
// computor_backend/permissions/roles.py — the backend's
// `_check_course_*_write_permission` helpers all gate on `_lecturer`.
const COURSE_ANNOUNCEMENT_ROLES = new Set(['_lecturer', '_maintainer', '_owner']);

/** The message scopes, straight off the generated MessageQuery. */
export type ScopeName = NonNullable<MessageQuery['scope']>;
/** Conversation vs. announcement, straight off the generated MessageGet. */
export type MessageKind = MessageGet['kind'];

const CONVERSATIONAL: ReadonlySet<string> = new Set(CONVERSATIONAL_SCOPES);

/**
 * Whether a scope hosts a conversation or a one-way announcement.
 *
 * Prefer reading `kind` off a MessageGet/MessageList — the server computes
 * it from the same set. This exists for the compose path, which has to
 * decide before any message exists.
 */
export function kindForScope(scope: ScopeName): MessageKind {
  return CONVERSATIONAL.has(scope) ? 'conversation' : 'announcement';
}

/** The scope a message posted with this payload would land in. */
export function deriveScopeFromCreatePayload(payload: Record<string, unknown>): ScopeName {
  // MESSAGE_TARGET_FIELDS is ordered most-specific first, matching the
  // backend's single-target rule: the first one set is the one persisted.
  for (const field of MESSAGE_TARGET_FIELDS) {
    const value = payload[field];
    if (typeof value === 'string' && value.length > 0) {
      // Every target field is named `<scope>_id`.
      return field.slice(0, -3) as ScopeName;
    }
  }
  return 'global';
}

/**
 * Whether a scope accepts replies.
 *
 * Announcements are one-way: a reply to a course-wide announcement fans out
 * to every course member, which is the opposite of what the scope is for.
 * The backend refuses those with a 400.
 */
export function canReplyInScope(scope: ScopeName): boolean {
  return kindForScope(scope) === 'conversation';
}

/**
 * Whether a message in this scope carries a subject line.
 *
 * Announcements require one — it is what identifies them in a list.
 * Conversations must not have one; the backend rejects a subject there.
 */
export function scopeHasSubject(scope: ScopeName): boolean {
  return kindForScope(scope) === 'announcement';
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
