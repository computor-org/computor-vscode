import type { UserScopes } from '../types/generated/users';

const GLOBAL_ORG_MANAGER_ROLE = '_organization_manager';
const GLOBAL_FAMILY_MANAGER_ROLE = '_course_family_manager';
const POSTING_ROLES: ReadonlySet<string> = new Set(['_owner', '_manager']);

export type ScopeKind = 'organization' | 'course_family';

export interface ScopePermissionContext {
  scopes?: UserScopes;
  /** Role IDs from `user.user_roles[]` — i.e. system-wide roles. */
  globalRoles?: ReadonlySet<string>;
}

function isAdmin(ctx: ScopePermissionContext): boolean {
  return ctx.scopes?.is_admin === true;
}

function hasGlobalRole(ctx: ScopePermissionContext, roleId: string): boolean {
  return ctx.globalRoles?.has(roleId) === true;
}

function hasScopeManagerClaim(
  map: Record<string, string[]> | undefined,
  scopeId?: string
): boolean {
  if (!map) {
    return false;
  }
  if (scopeId !== undefined) {
    const roles = map[scopeId];
    return Array.isArray(roles) && roles.some(r => POSTING_ROLES.has(r));
  }
  for (const roles of Object.values(map)) {
    if (Array.isArray(roles) && roles.some(r => POSTING_ROLES.has(r))) {
      return true;
    }
  }
  return false;
}

/** True when the user can manage members on at least one organization. */
export function canManageAnyOrganizationMembers(ctx: ScopePermissionContext): boolean {
  return isAdmin(ctx)
    || hasGlobalRole(ctx, GLOBAL_ORG_MANAGER_ROLE)
    || hasScopeManagerClaim(ctx.scopes?.organization);
}

/** True when the user can manage members on at least one course family.
 *  Organization-manager grants this transitively (course families nest under
 *  organizations). */
export function canManageAnyCourseFamilyMembers(ctx: ScopePermissionContext): boolean {
  return isAdmin(ctx)
    || hasGlobalRole(ctx, GLOBAL_ORG_MANAGER_ROLE)
    || hasGlobalRole(ctx, GLOBAL_FAMILY_MANAGER_ROLE)
    || hasScopeManagerClaim(ctx.scopes?.course_family);
}

/** True when the user can manage members on this specific scope. */
export function canManageScopeMembership(
  scopeKind: ScopeKind,
  scopeId: string,
  ctx: ScopePermissionContext
): boolean {
  if (isAdmin(ctx)) {
    return true;
  }
  if (scopeKind === 'organization') {
    if (hasGlobalRole(ctx, GLOBAL_ORG_MANAGER_ROLE)) {
      return true;
    }
    return hasScopeManagerClaim(ctx.scopes?.organization, scopeId);
  }
  // course_family — org-manager grants transitive access.
  if (hasGlobalRole(ctx, GLOBAL_ORG_MANAGER_ROLE)) {
    return true;
  }
  if (hasGlobalRole(ctx, GLOBAL_FAMILY_MANAGER_ROLE)) {
    return true;
  }
  return hasScopeManagerClaim(ctx.scopes?.course_family, scopeId);
}
