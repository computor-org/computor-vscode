import { expect } from 'chai';

import {
  buildTargetContext,
  groupByTarget,
  targetIdFor
} from '../../src/services/messageTargets';
import type { MessageLabelResolver } from '../../src/services/MessageLabelResolver';
import type { MessageList, UserScopes } from '../../src/types/generated';

const msg = (over: Partial<MessageList> = {}): MessageList =>
  ({
    id: 'm-1',
    content: 'hi',
    level: 0,
    parent_id: null,
    author_id: 'u-1',
    is_read: true,
    ...over
  } as unknown as MessageList);

/** A resolver that answers from a fixed table, with no network. */
function fakeLabels(over: Partial<MessageLabelResolver> = {}): MessageLabelResolver {
  return {
    async ensureLabel() { /* no-op */ },
    async ensureCourseLabel() { return undefined; },
    courseLabel() { return undefined; },
    parentCourseId() { return undefined; },
    label() { return { title: 'A target' }; },
    async prefetch() { /* no-op */ },
    ...over
  } as unknown as MessageLabelResolver;
}

const scopes = (over: Partial<UserScopes> = {}): UserScopes =>
  ({ is_admin: false, ...over } as UserScopes);

describe('messageTargets — targetIdFor', () => {
  it('reads the column the scope names', () => {
    expect(targetIdFor('course', msg({ course_id: 'c-1' }))).to.equal('c-1');
    expect(targetIdFor('submission_group', msg({ submission_group_id: 'sg-1' }))).to.equal('sg-1');
    expect(targetIdFor('course_content', msg({ course_content_id: 'cc-1' }))).to.equal('cc-1');
  });

  it('is null for global, which has no target', () => {
    expect(targetIdFor('global', msg())).to.equal(null);
  });

  it('is null when the column is unset', () => {
    expect(targetIdFor('course', msg())).to.equal(null);
  });
});

describe('messageTargets — groupByTarget', () => {
  it('buckets messages by their target', () => {
    const grouped = groupByTarget('course', [
      msg({ id: 'a', course_id: 'c-1' }),
      msg({ id: 'b', course_id: 'c-2' }),
      msg({ id: 'c', course_id: 'c-1' })
    ]);
    expect([...grouped.keys()]).to.have.members(['c-1', 'c-2']);
    expect(grouped.get('c-1')!.map(m => m.id)).to.deep.equal(['a', 'c']);
  });

  it('collects targetless messages under a sentinel', () => {
    const grouped = groupByTarget('global', [msg({ id: 'a' }), msg({ id: 'b' })]);
    expect([...grouped.keys()]).to.deep.equal(['__none__']);
    expect(grouped.get('__none__')).to.have.length(2);
  });
});

describe('messageTargets — buildTargetContext', () => {
  it('always pins scope on the query', async () => {
    // Without it, target filters walk *down* the hierarchy: course_id=X also
    // returns every submission-group conversation in that course.
    const ctx = await buildTargetContext({
      scope: 'course',
      targetId: 'c-1',
      labels: fakeLabels(),
      userScopes: scopes({ course: { 'c-1': ['_lecturer'] } })
    });
    expect(ctx!.query).to.deep.equal({ scope: 'course', course_id: 'c-1' });
  });

  it('sends exactly one target on create', async () => {
    const ctx = await buildTargetContext({
      scope: 'submission_group',
      targetId: 'sg-1',
      labels: fakeLabels()
    });
    expect(ctx!.createPayload).to.deep.equal({ submission_group_id: 'sg-1' });
  });

  it('derives the websocket channel from scope and target', async () => {
    const ctx = await buildTargetContext({
      scope: 'course_group',
      targetId: 'cg-1',
      labels: fakeLabels()
    });
    expect(ctx!.wsChannel).to.equal('course_group:cg-1');
  });

  it('puts global on the global channel, with no target', async () => {
    // Global has no target id but it does have a channel: the backend
    // publishes there and every connection is auto-subscribed. Leaving it
    // undefined made global the one scope with no live updates, so a posted
    // announcement did not appear until a manual refresh.
    const ctx = await buildTargetContext({
      scope: 'global',
      targetId: null,
      labels: fakeLabels(),
      userScopes: scopes({ is_admin: true })
    });
    expect(ctx!.wsChannel).to.equal('global');
    expect(ctx!.createPayload).to.deep.equal({});
    expect(ctx!.readOnly).to.equal(false);
  });

  it('gives every scope a channel, so none is silently live-update-less', async () => {
    const cases: Array<[Parameters<typeof buildTargetContext>[0]['scope'], string | null, string]> = [
      ['global', null, 'global'],
      ['organization', 'o-1', 'organization:o-1'],
      ['course_family', 'f-1', 'course_family:f-1'],
      ['course', 'c-1', 'course:c-1'],
      ['course_content', 'cc-1', 'course_content:cc-1'],
      ['course_group', 'cg-1', 'course_group:cg-1'],
      ['submission_group', 'sg-1', 'submission_group:sg-1'],
      ['course_member', 'cm-1', 'course_member:cm-1']
    ];
    for (const [scope, targetId, expected] of cases) {
      const ctx = await buildTargetContext({ scope, targetId, labels: fakeLabels() });
      expect(ctx!.wsChannel, `${scope} channel`).to.equal(expected);
    }
  });

  it('returns nothing for a non-global scope with no target', async () => {
    const ctx = await buildTargetContext({
      scope: 'course',
      targetId: null,
      labels: fakeLabels()
    });
    expect(ctx).to.equal(undefined);
  });

  it('carries the kind so the panel knows how to render', async () => {
    const announcement = await buildTargetContext({
      scope: 'course', targetId: 'c-1', labels: fakeLabels()
    });
    const conversation = await buildTargetContext({
      scope: 'submission_group', targetId: 'sg-1', labels: fakeLabels()
    });
    expect(announcement!.kind).to.equal('announcement');
    expect(conversation!.kind).to.equal('conversation');
  });

  describe('posting rights', () => {
    it('locks a course announcement for a student', async () => {
      const ctx = await buildTargetContext({
        scope: 'course',
        targetId: 'c-1',
        labels: fakeLabels(),
        userScopes: scopes({ course: { 'c-1': ['_student'] } })
      });
      expect(ctx!.readOnly).to.equal(true);
      expect(ctx!.readOnlyReason).to.be.a('string');
    });

    it('opens it for a lecturer', async () => {
      const ctx = await buildTargetContext({
        scope: 'course',
        targetId: 'c-1',
        labels: fakeLabels(),
        userScopes: scopes({ course: { 'c-1': ['_lecturer'] } })
      });
      expect(ctx!.readOnly).to.equal(false);
    });

    it('resolves the containing course for a course_content target', async () => {
      // The single-target invariant leaves course_id NULL on a
      // course_content message, so this has to come from the label resolver —
      // reading it off the messages would deny every lecturer.
      const labels = fakeLabels({
        parentCourseId: ((scope: string, targetId: string | null) =>
          scope === 'course_content' && targetId === 'cc-1' ? 'c-1' : undefined) as never
      });
      const ctx = await buildTargetContext({
        scope: 'course_content',
        targetId: 'cc-1',
        messages: [msg({ course_content_id: 'cc-1', course_id: null })],
        labels,
        userScopes: scopes({ course: { 'c-1': ['_lecturer'] } })
      });
      expect(ctx!.readOnly).to.equal(false);
    });

    it('locks a course_content board when the course cannot be resolved', async () => {
      // Better a locked box the user can ask about than one that 403s on send.
      const ctx = await buildTargetContext({
        scope: 'course_content',
        targetId: 'cc-1',
        labels: fakeLabels(),
        userScopes: scopes({ course: { 'c-1': ['_lecturer'] } })
      });
      expect(ctx!.readOnly).to.equal(true);
    });

    it('leaves a submission group open — membership is checked server-side', async () => {
      const ctx = await buildTargetContext({
        scope: 'submission_group',
        targetId: 'sg-1',
        labels: fakeLabels(),
        userScopes: scopes()
      });
      expect(ctx!.readOnly).to.equal(false);
    });

    it('requires admin or user manager for global', async () => {
      const denied = await buildTargetContext({
        scope: 'global', targetId: null, labels: fakeLabels(), userScopes: scopes()
      });
      expect(denied!.readOnly).to.equal(true);

      const allowed = await buildTargetContext({
        scope: 'global',
        targetId: null,
        labels: fakeLabels(),
        userScopes: scopes(),
        userViews: ['user_manager']
      });
      expect(allowed!.readOnly).to.equal(false);
    });
  });
});
