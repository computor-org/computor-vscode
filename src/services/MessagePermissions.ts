import type { UserScopes } from '../types/generated';

const POSTING_ROLES = new Set(['_owner', '_manager']);

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
