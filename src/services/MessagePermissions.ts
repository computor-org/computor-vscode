import type { UserScopes } from '../types/generated';

const POSTING_ROLES = new Set(['_owner', '_manager']);

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

export function canPostGlobal(scopes: UserScopes | undefined): boolean {
  return scopes?.is_admin === true;
}
