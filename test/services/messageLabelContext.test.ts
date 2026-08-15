import { expect } from 'chai';

import { MessageLabelResolver, messageContextOf } from '../../src/services/MessageLabelResolver';
import type { ComputorApiService } from '../../src/services/ComputorApiService';
import type { MessageContext, MessageList } from '../../src/types/generated';

/**
 * Server-resolved MessageContext drives thread titles (issue #322 §1): the
 * reader's own submission group is named after the assignment, staff see who
 * the conversation is with — and nobody ever sees "Submission Group e86522aa"
 * when a context is on the wire.
 */

const ctx = (over: Partial<MessageContext> = {}): MessageContext => ({
  course_id: 'c-1',
  course_title: 'Programming in MATLAB',
  course_content_id: 'cc-9',
  course_content_title: 'A3 Filters',
  course_content_path: 'unit1.a3',
  submission_group_display_name: 'Max Muster',
  submission_group_members: [
    { course_member_id: 'cm-1', user_id: 'u-student', given_name: 'Max', family_name: 'Muster' }
  ],
  ...over
});

const sgMessage = (over: Partial<MessageList> = {}): MessageList =>
  ({
    id: 'm-1',
    content: 'hello',
    level: 0,
    author_id: 'u-student',
    submission_group_id: 'sg-1',
    scope: 'submission_group',
    kind: 'conversation',
    context: ctx(),
    ...over
  } as unknown as MessageList);

// The resolver never touches the API in these tests — every name comes off
// the message context, which is the point.
const resolver = () => new MessageLabelResolver({} as ComputorApiService);

describe('MessageLabelResolver — submission groups with context', () => {
  it('names the reader own group after the assignment', () => {
    const label = resolver().label('submission_group', 'sg-1', [sgMessage()], 'u-student');
    expect(label.title).to.equal('A3 Filters');
  });

  it('shows staff who the conversation is with', () => {
    const label = resolver().label('submission_group', 'sg-1', [sgMessage()], 'u-tutor');
    expect(label.title).to.equal('Max Muster — A3 Filters');
    expect(label.subtitle).to.equal('Programming in MATLAB');
  });

  it('prefers an explicit team name over the member name', () => {
    const msg = sgMessage({
      context: ctx({ submission_group_display_name: 'Team Rocket' })
    } as Partial<MessageList>);
    const label = resolver().label('submission_group', 'sg-1', [msg], 'u-tutor');
    expect(label.title).to.equal('Team Rocket — A3 Filters');
  });

  it('falls back to member names when the server sent no display name', () => {
    const msg = sgMessage({
      context: ctx({ submission_group_display_name: null })
    } as Partial<MessageList>);
    const label = resolver().label('submission_group', 'sg-1', [msg], 'u-tutor');
    expect(label.title).to.equal('Max Muster — A3 Filters');
  });

  it('uses the first message that actually carries a context', () => {
    const bare = sgMessage({ id: 'm-0', context: null } as Partial<MessageList>);
    const label = resolver().label('submission_group', 'sg-1', [bare, sgMessage()], 'u-student');
    expect(label.title).to.equal('A3 Filters');
  });

  it('still falls back to the short id without any context (older backend)', () => {
    const bare = sgMessage({ context: null, course_content_id: null } as Partial<MessageList>);
    const label = resolver().label('submission_group', 'sg-1', [bare], 'u-student');
    expect(label.title).to.equal('Submission Group sg-1');
  });
});

describe('MessageLabelResolver — announcement scopes with context', () => {
  it('labels a course_content announcement from its context', () => {
    const msg = {
      id: 'm-2', content: 'x', level: 0, author_id: 'a',
      course_content_id: 'cc-9', scope: 'course_content', kind: 'announcement',
      context: ctx({ submission_group_members: [] })
    } as unknown as MessageList;
    const label = resolver().label('course_content', 'cc-9', [msg]);
    expect(label.title).to.equal('A3 Filters');
    expect(label.subtitle).to.equal('Programming in MATLAB');
  });

  it('labels a course_group announcement from its context', () => {
    const msg = {
      id: 'm-3', content: 'x', level: 0, author_id: 'a',
      course_group_id: 'cg-1', scope: 'course_group', kind: 'announcement',
      context: ctx({ course_group_id: 'cg-1', course_group_title: 'Group 2' })
    } as unknown as MessageList;
    const label = resolver().label('course_group', 'cg-1', [msg]);
    expect(label.title).to.equal('Group 2');
  });
});

describe('MessageLabelResolver — prefetch seeds caches from contexts', () => {
  it('answers later label calls without touching the API', async () => {
    const r = resolver();
    const grouped = new Map([
      ['submission_group' as const, new Map([['sg-1', [sgMessage()]]])]
    ]);
    // With every name seeded off the context, ensureLabel never needs the
    // (absent) API — a fetch attempt here would throw on the empty stub.
    await r.prefetch(grouped as never);
    expect(r.courseLabel('c-1')).to.equal('Programming in MATLAB');
    expect(r.label('course_content', 'cc-9').title).to.equal('A3 Filters');
    expect(r.parentCourseId('submission_group', 'sg-1')).to.equal('c-1');
  });
});

describe('messageContextOf', () => {
  it('returns the first context present', () => {
    const bare = sgMessage({ id: 'a', context: null } as Partial<MessageList>);
    expect(messageContextOf([bare, sgMessage()])?.course_id).to.equal('c-1');
  });
  it('returns undefined when no message has one', () => {
    const bare = sgMessage({ context: null } as Partial<MessageList>);
    expect(messageContextOf([bare])).to.equal(undefined);
  });
});
