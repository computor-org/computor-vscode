import * as assert from 'assert';

import {
  canDeleteAny,
  canDeleteCourse,
  canDeleteScope
} from '../../src/services/ScopePermissions';
import type { UserScopes } from '../../src/types/generated/users';

/**
 * Deleting or archiving an organization / course family / course is an OWNER
 * decision (admins bypass). These pin the client-side pre-check against the
 * backend rule: `_organization_manager` is a manager, not an owner, and is
 * deliberately not enough — the server would 403 it, so the menu must not
 * promise what the server refuses.
 */
function ctx(scopes: Partial<UserScopes>, globalRoles: string[] = []) {
  return {
    scopes: { is_admin: false, ...scopes } as UserScopes,
    globalRoles: new Set(globalRoles)
  };
}

describe('ScopePermissions — hierarchy delete', () => {
  it('admins may delete anything', () => {
    const c = ctx({ is_admin: true });
    assert.strictEqual(canDeleteScope('organization', 'org-1', c), true);
    assert.strictEqual(canDeleteScope('course_family', 'fam-1', c), true);
    assert.strictEqual(canDeleteCourse('course-1', c), true);
    assert.strictEqual(canDeleteAny(c), true);
  });

  it('owners may delete exactly the scope they own', () => {
    const c = ctx({
      organization: { 'org-1': ['_owner'] },
      course_family: { 'fam-1': ['_owner'] },
      course: { 'course-1': ['_owner', '_lecturer'] }
    });
    assert.strictEqual(canDeleteScope('organization', 'org-1', c), true);
    assert.strictEqual(canDeleteScope('organization', 'org-2', c), false);
    assert.strictEqual(canDeleteScope('course_family', 'fam-1', c), true);
    assert.strictEqual(canDeleteScope('course_family', 'fam-2', c), false);
    assert.strictEqual(canDeleteCourse('course-1', c), true);
    assert.strictEqual(canDeleteCourse('course-2', c), false);
    assert.strictEqual(canDeleteAny(c), true);
  });

  it('managers and maintainers may not', () => {
    const c = ctx({
      organization: { 'org-1': ['_manager'] },
      course_family: { 'fam-1': ['_manager', '_developer'] },
      course: { 'course-1': ['_maintainer'] }
    });
    assert.strictEqual(canDeleteScope('organization', 'org-1', c), false);
    assert.strictEqual(canDeleteScope('course_family', 'fam-1', c), false);
    assert.strictEqual(canDeleteCourse('course-1', c), false);
    assert.strictEqual(canDeleteAny(c), false);
  });

  it('the global _organization_manager role is not ownership', () => {
    const c = ctx({ organization: { 'org-1': ['_manager'] } }, ['_organization_manager']);
    assert.strictEqual(canDeleteScope('organization', 'org-1', c), false);
    assert.strictEqual(canDeleteScope('course_family', 'fam-1', c), false);
    assert.strictEqual(canDeleteCourse('course-1', c), false);
    assert.strictEqual(canDeleteAny(c), false);
  });

  it('ownership does not cascade between scope kinds', () => {
    const c = ctx({ organization: { 'org-1': ['_owner'] } });
    assert.strictEqual(canDeleteScope('course_family', 'org-1', c), false);
    assert.strictEqual(canDeleteCourse('org-1', c), false);
    // ...but it does make the coarse menu gate true.
    assert.strictEqual(canDeleteAny(c), true);
  });

  it('is false with no scopes at all', () => {
    assert.strictEqual(canDeleteAny({}), false);
    assert.strictEqual(canDeleteCourse('course-1', {}), false);
    assert.strictEqual(canDeleteScope('organization', 'org-1', { scopes: undefined }), false);
  });
});
