import { expect } from 'chai';

import { shouldToastNewMessage } from '../../src/services/messageNotificationPolicy';

/**
 * The toast policy for `message:new` broadcasts (issue #251): the per-user
 * WS channel delivers every message in the user's audience, so the toast
 * must be reserved for messages that involve the user personally —
 * announcements, direct mentions, replies to them, or conversations they
 * are a participant of. Everything else stays badge-only. Unknowable
 * participation fails closed: a missed toast still shows in the badges,
 * a wrong one interrupts.
 */

const ME = 'u-me';

const conversation = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'm-1',
  content: 'hi',
  level: 0,
  author_id: 'u-student',
  submission_group_id: 'sg-1',
  scope: 'submission_group',
  kind: 'conversation',
  mentions: [],
  context: {
    course_id: 'c-1',
    submission_group_members: [
      { course_member_id: 'cm-1', user_id: 'u-student', given_name: 'Some', family_name: 'One' }
    ]
  },
  ...over
});

describe('messageNotificationPolicy — shouldToastNewMessage', () => {
  it('toasts announcements for everyone', () => {
    const msg = { scope: 'course', kind: 'announcement', course_id: 'c-1' };
    expect(shouldToastNewMessage(msg, ME)).to.deep.equal({ notify: true, reason: 'announcement' });
  });

  it('stays quiet for a plain student message in a group the reader is not in — the issue #251 case', () => {
    expect(shouldToastNewMessage(conversation(), ME).notify).to.equal(false);
  });

  it('toasts when the reader is mentioned', () => {
    const msg = conversation({ mentions: [{ id: ME, given_name: 'Me', family_name: 'Too' }] });
    expect(shouldToastNewMessage(msg, ME)).to.deep.equal({ notify: true, reason: 'mention' });
  });

  it('stays quiet when only someone else is mentioned', () => {
    const msg = conversation({ mentions: [{ id: 'u-other-tutor' }] });
    expect(shouldToastNewMessage(msg, ME).notify).to.equal(false);
  });

  it('toasts a reply to one of the reader own messages', () => {
    const msg = conversation({ parent_id: 'm-0', parent_author_id: ME });
    expect(shouldToastNewMessage(msg, ME)).to.deep.equal({ notify: true, reason: 'reply' });
  });

  it('stays quiet for a reply to someone else', () => {
    const msg = conversation({ parent_id: 'm-0', parent_author_id: 'u-other' });
    expect(shouldToastNewMessage(msg, ME).notify).to.equal(false);
  });

  it('toasts inside the reader own submission group', () => {
    const msg = conversation({
      context: {
        course_id: 'c-1',
        submission_group_members: [{ course_member_id: 'cm-9', user_id: ME }]
      }
    });
    expect(shouldToastNewMessage(msg, ME)).to.deep.equal({ notify: true, reason: 'participant' });
  });

  it('fails closed when the payload cannot say whose group it is', () => {
    expect(shouldToastNewMessage(conversation({ context: null }), ME).notify).to.equal(false);
    expect(shouldToastNewMessage(conversation({ context: { course_id: 'c-1' } }), ME).notify).to.equal(false);
  });

  it('toasts a DM addressed to the reader, not one addressed elsewhere', () => {
    const dm = { scope: 'user', kind: 'conversation', user_id: ME, mentions: [] };
    expect(shouldToastNewMessage(dm, ME)).to.deep.equal({ notify: true, reason: 'participant' });
    const other = { scope: 'user', kind: 'conversation', user_id: 'u-else', mentions: [] };
    expect(shouldToastNewMessage(other, ME).notify).to.equal(false);
  });

  it('fails closed for course_member DMs — the payload never names the target user', () => {
    const msg = { scope: 'course_member', kind: 'conversation', course_member_id: 'cm-1', mentions: [] };
    expect(shouldToastNewMessage(msg, ME).notify).to.equal(false);
  });

  it('derives kind from scope when an older backend omits it', () => {
    expect(shouldToastNewMessage({ scope: 'course', course_id: 'c-1' }, ME).reason).to.equal('announcement');
    expect(shouldToastNewMessage({ scope: 'submission_group', submission_group_id: 'sg-1' }, ME).notify).to.equal(false);
  });

  it('without an identity only announcements get through', () => {
    expect(shouldToastNewMessage({ scope: 'course', kind: 'announcement' }, undefined).notify).to.equal(true);
    expect(shouldToastNewMessage(conversation(), undefined).notify).to.equal(false);
  });
});
