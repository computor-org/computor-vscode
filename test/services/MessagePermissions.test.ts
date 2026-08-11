import * as assert from 'assert';

import {
  canPostCourseAnnouncement,
  canPostGlobal,
  canPostToCourseFamily,
  canPostToOrganization,
  canReplyInScope,
  deriveScopeFromCreatePayload,
  kindForScope,
  scopeHasSubject
} from '../../src/services/MessagePermissions';
import { CONVERSATIONAL_SCOPES, MESSAGE_TARGET_FIELDS } from '../../src/types/generated/constants';
import type { UserScopes } from '../../src/types/generated';

/**
 * The conversation/announcement split drives three separate rules in the UI:
 * whether a Reply button appears, whether a subject input appears, and (via
 * the panel) how the list reads. All three are supposed to agree with the
 * backend, which enforces the same split from CONVERSATIONAL_SCOPES.
 *
 * These tests pin the derivation against the generated constants, so a
 * pydantic-side change that reaches TypeScript but not this logic fails here
 * rather than silently in a webview.
 */
describe('MessagePermissions — scope kind', () => {
  const ANNOUNCEMENT_SCOPES = [
    'global',
    'organization',
    'course_family',
    'course',
    'course_content',
    'course_group'
  ] as const;

  it('mirrors the generated conversational scope list', () => {
    assert.deepStrictEqual([...CONVERSATIONAL_SCOPES].sort(), [
      'course_member',
      'submission_group',
      'user'
    ]);
  });

  it('classifies every scope', () => {
    for (const scope of CONVERSATIONAL_SCOPES) {
      assert.strictEqual(kindForScope(scope as never), 'conversation', scope);
    }
    for (const scope of ANNOUNCEMENT_SCOPES) {
      assert.strictEqual(kindForScope(scope), 'announcement', scope);
    }
  });

  it('allows replies exactly on conversations', () => {
    for (const scope of CONVERSATIONAL_SCOPES) {
      assert.ok(canReplyInScope(scope as never), `${scope} should accept replies`);
    }
    for (const scope of ANNOUNCEMENT_SCOPES) {
      assert.ok(!canReplyInScope(scope), `${scope} is announcement-only`);
    }
  });

  it('shows a subject exactly on announcements', () => {
    // The inverse of replies: announcements are list items and need a
    // subject; conversations are chat and the backend rejects one.
    for (const scope of ANNOUNCEMENT_SCOPES) {
      assert.ok(scopeHasSubject(scope), `${scope} needs a subject`);
    }
    for (const scope of CONVERSATIONAL_SCOPES) {
      assert.ok(!scopeHasSubject(scope as never), `${scope} carries no subject`);
    }
  });
});

describe('MessagePermissions — deriveScopeFromCreatePayload', () => {
  it('reads the scope off each single target', () => {
    for (const field of MESSAGE_TARGET_FIELDS) {
      const scope = field.slice(0, -3);
      assert.strictEqual(deriveScopeFromCreatePayload({ [field]: 'x-1' }), scope);
    }
  });

  it('treats an empty payload as global', () => {
    assert.strictEqual(deriveScopeFromCreatePayload({}), 'global');
  });

  it('ignores empty-string and non-string targets', () => {
    assert.strictEqual(deriveScopeFromCreatePayload({ course_id: '' }), 'global');
    assert.strictEqual(deriveScopeFromCreatePayload({ course_id: 123 }), 'global');
    assert.strictEqual(deriveScopeFromCreatePayload({ course_id: null }), 'global');
  });

  it('picks the most specific target when several are set', () => {
    // The backend keeps exactly one target column and nulls the rest, so the
    // client has to agree about which one wins or the two disagree about the
    // message's scope.
    assert.strictEqual(
      deriveScopeFromCreatePayload({
        organization_id: 'o-1',
        course_id: 'c-1',
        submission_group_id: 'sg-1'
      }),
      'submission_group'
    );
    assert.strictEqual(
      deriveScopeFromCreatePayload({ organization_id: 'o-1', course_family_id: 'f-1' }),
      'course_family'
    );
  });
});

describe('MessagePermissions — posting rights', () => {
  const scopes = (over: Partial<UserScopes> = {}): UserScopes =>
    ({ is_admin: false, ...over } as UserScopes);

  describe('course announcements', () => {
    it('allows lecturer and above', () => {
      for (const role of ['_lecturer', '_maintainer', '_owner']) {
        assert.ok(
          canPostCourseAnnouncement(scopes({ course: { 'c-1': [role] } }), 'c-1'),
          role
        );
      }
    });

    it('refuses students and tutors', () => {
      // This is the check the student and tutor panels skipped entirely,
      // shipping a compose box that always 403'd.
      for (const role of ['_student', '_tutor']) {
        assert.ok(
          !canPostCourseAnnouncement(scopes({ course: { 'c-1': [role] } }), 'c-1'),
          role
        );
      }
    });

    it('is scoped to the course in question', () => {
      const s = scopes({ course: { 'other-course': ['_lecturer'] } });
      assert.ok(!canPostCourseAnnouncement(s, 'c-1'));
    });

    it('lets admins through', () => {
      assert.ok(canPostCourseAnnouncement(scopes({ is_admin: true }), 'c-1'));
    });

    it('refuses when scopes or course id are missing', () => {
      assert.ok(!canPostCourseAnnouncement(undefined, 'c-1'));
      assert.ok(!canPostCourseAnnouncement(scopes({ course: { 'c-1': ['_owner'] } }), undefined));
    });
  });

  describe('organization and course family', () => {
    it('requires manager or owner', () => {
      assert.ok(canPostToOrganization(scopes({ organization: { 'o-1': ['_manager'] } }), 'o-1'));
      assert.ok(canPostToOrganization(scopes({ organization: { 'o-1': ['_owner'] } }), 'o-1'));
      // _developer is deliberately below the bar for announcements.
      assert.ok(!canPostToOrganization(scopes({ organization: { 'o-1': ['_developer'] } }), 'o-1'));
      assert.ok(canPostToCourseFamily(scopes({ course_family: { 'f-1': ['_owner'] } }), 'f-1'));
      assert.ok(!canPostToCourseFamily(scopes({ course_family: { 'f-1': ['_developer'] } }), 'f-1'));
    });
  });

  describe('global', () => {
    it('allows admins and user managers', () => {
      assert.ok(canPostGlobal(scopes({ is_admin: true })));
      assert.ok(canPostGlobal(scopes(), true));
      assert.ok(!canPostGlobal(scopes(), false));
    });
  });
});
