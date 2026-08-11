import { expect } from 'chai';

import { ChatInboxTreeProvider } from '../../../src/ui/tree/chat/ChatInboxTreeProvider';
import type { ChatThread, MessageScope } from '../../../src/ui/tree/chat/ChatInboxTreeItems';
import type { MessageList } from '../../../src/types/generated';
import type { ComputorApiService } from '../../../src/services/ComputorApiService';
import type { MessagesWebviewProvider } from '../../../src/ui/webviews/MessagesWebviewProvider';

/**
 * The inbox groups by (scope, target), which is right for a conversation —
 * one submission group is one thread — and wrong for announcements, which all
 * share a target. A semester of course notices collapsed into a single row
 * labelled with the course name showing "40 unread"; the subject that
 * identifies each one was never displayed.
 */
function makeProvider(): {
  provider: ChatInboxTreeProvider;
  rows: (scope: MessageScope, byTarget: Map<string, MessageList[]>) => ChatThread[];
  setUnreadOnly: (v: boolean) => void;
  setCurrentUser: (id: string) => void;
} {
  const context = {
    globalState: {
      get: () => undefined,
      update: async () => undefined
    }
  } as unknown as import('vscode').ExtensionContext;

  const provider = new ChatInboxTreeProvider(
    context,
    {} as ComputorApiService,
    {} as MessagesWebviewProvider
  );

  const anyProvider = provider as unknown as {
    buildThreadRows: (s: MessageScope, m: Map<string, MessageList[]>) => ChatThread[];
    unreadOnly: boolean;
    currentUserId?: string;
  };

  return {
    provider,
    rows: (scope, byTarget) => anyProvider.buildThreadRows(scope, byTarget),
    setUnreadOnly: (v) => { anyProvider.unreadOnly = v; },
    setCurrentUser: (id) => { anyProvider.currentUserId = id; }
  };
}

const at = (min: number) => `2026-08-11T12:${String(min).padStart(2, '0')}:00Z`;

const announcement = (
  id: string,
  title: string | null,
  min: number,
  over: Partial<MessageList> = {}
): MessageList =>
  ({
    id,
    title,
    content: `body of ${id}`,
    level: 0,
    parent_id: null,
    author_id: 'lecturer-1',
    course_id: 'c-1',
    created_at: at(min),
    is_read: true,
    ...over
  } as unknown as MessageList);

const chatLine = (id: string, min: number, over: Partial<MessageList> = {}): MessageList =>
  ({
    id,
    title: null,
    content: `line ${id}`,
    level: 0,
    parent_id: null,
    author_id: 'student-1',
    submission_group_id: 'sg-1',
    created_at: at(min),
    is_read: true,
    ...over
  } as unknown as MessageList);

describe('ChatInboxTreeProvider — announcement rows', () => {
  it('gives each announcement its own row, labelled by its subject', () => {
    const { rows } = makeProvider();
    const byTarget = new Map([
      [
        'c-1',
        [
          announcement('m1', 'Exam moved to Friday', 1),
          announcement('m2', 'Lab 3 published', 2),
          announcement('m3', 'Office hours cancelled', 3)
        ]
      ]
    ]);

    const result = rows('course', byTarget);

    expect(result).to.have.length(3);
    expect(result.map((t) => t.title)).to.have.members([
      'Exam moved to Friday',
      'Lab 3 published',
      'Office hours cancelled'
    ]);
    // The anchor is what keeps sibling tree ids distinct — they all share a
    // target id.
    expect(result.map((t) => t.anchorMessageId)).to.have.members(['m1', 'm2', 'm3']);
    expect(result.every((t) => t.targetId === 'c-1')).to.equal(true);
  });

  it('orders announcements newest first, unread ahead of read', () => {
    const { rows, setCurrentUser } = makeProvider();
    setCurrentUser('reader-1');
    const byTarget = new Map([
      [
        'c-1',
        [
          announcement('old-read', 'Old read', 1),
          announcement('new-read', 'New read', 9),
          announcement('old-unread', 'Old unread', 2, { is_read: false })
        ]
      ]
    ]);

    expect(rows('course', byTarget).map((t) => t.title)).to.deep.equal([
      'Old unread',
      'New read',
      'Old read'
    ]);
  });

  it('falls back to the scope label when a legacy row has no subject', () => {
    // Announcements require a subject now, but rows predating that rule exist.
    const { rows } = makeProvider();
    const byTarget = new Map([['c-1', [announcement('m1', null, 1)]]]);
    const result = rows('course', byTarget);
    expect(result[0]!.title).to.be.a('string').and.not.equal('');
  });

  it('respects the unread-only filter per announcement', () => {
    const { rows, setUnreadOnly, setCurrentUser } = makeProvider();
    setCurrentUser('reader-1');
    setUnreadOnly(true);
    const byTarget = new Map([
      [
        'c-1',
        [
          announcement('read', 'Read one', 1),
          announcement('unread', 'Unread one', 2, { is_read: false })
        ]
      ]
    ]);

    const result = rows('course', byTarget);
    expect(result.map((t) => t.title)).to.deep.equal(['Unread one']);
  });

  it('does not count the reader own posts as unread', () => {
    const { rows, setCurrentUser } = makeProvider();
    setCurrentUser('lecturer-1');
    const byTarget = new Map([
      ['c-1', [announcement('mine', 'Mine', 1, { is_read: false })]]
    ]);
    expect(rows('course', byTarget)[0]!.unreadCount).to.equal(0);
  });

  it('folds a legacy reply under its announcement rather than listing it', () => {
    const { rows } = makeProvider();
    const byTarget = new Map([
      [
        'c-1',
        [
          announcement('root', 'A notice', 1),
          announcement('reply', null, 2, { parent_id: 'root' })
        ]
      ]
    ]);

    const result = rows('course', byTarget);
    expect(result).to.have.length(1);
    expect(result[0]!.title).to.equal('A notice');
    expect(result[0]!.messageCount).to.equal(2);
  });
});

describe('ChatInboxTreeProvider — conversation rows', () => {
  it('keeps one row per target, not one per message', () => {
    const { rows } = makeProvider();
    const byTarget = new Map([
      ['sg-1', [chatLine('a', 1), chatLine('b', 2), chatLine('c', 3)]]
    ]);

    const result = rows('submission_group', byTarget);

    expect(result).to.have.length(1);
    expect(result[0]!.messageCount).to.equal(3);
    // No anchor: the row stands for the whole conversation.
    expect(result[0]!.anchorMessageId).to.equal(undefined);
    // Preview/sort key is the latest line.
    expect(result[0]!.lastMessage?.id).to.equal('c');
  });

  it('counts unread across the conversation', () => {
    const { rows, setCurrentUser } = makeProvider();
    setCurrentUser('reader-1');
    const byTarget = new Map([
      [
        'sg-1',
        [chatLine('a', 1), chatLine('b', 2, { is_read: false }), chatLine('c', 3, { is_read: false })]
      ]
    ]);
    expect(rows('submission_group', byTarget)[0]!.unreadCount).to.equal(2);
  });
});
