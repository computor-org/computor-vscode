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

/**
 * Opening messages from a chat row.
 *
 * A thread row names its target and opens straight away. A scope row or a
 * course node names a scope but not which destination — "Courses" is nine
 * courses — so those pick. The picker is also the only route to a
 * destination nobody has posted to yet: rows are built from messages that
 * exist, so an empty course has no row to click and no way to write the
 * first announcement.
 */
describe('ChatInboxTreeProvider — target choices', () => {
  function withApi(over: Record<string, unknown> = {}) {
    const { provider } = makeProvider();
    const anyProvider = provider as unknown as {
      targetChoices: (
        s: MessageScope,
        c?: string
      ) => Promise<Array<{ targetId: string | null; label: string; description?: string }>>;
      userScopes?: unknown;
      labels: Record<string, unknown>;
      api: Record<string, unknown>;
      currentUserId?: string;
    };
    anyProvider.api = {
      // targetChoices resolves the caller's scopes first; without this the
      // stub throws before it ever reaches the branch under test.
      getUserScopes: async () => ({ is_admin: false }),
      getUserViews: async () => [],
      listMessagesPage: async () => ({ items: [], total: 0 }),
      ...over
    };
    return { provider, choices: anyProvider.targetChoices.bind(provider), p: anyProvider };
  }

  it('offers courses from enrolment, not from messages', async () => {
    // The case that matters: a course with no announcements yet still has to
    // be openable, or nobody can post the first one.
    const { choices, p } = withApi({
      listMessagesPage: async () => ({ items: [], total: 0 })
    });
    p.userScopes = { is_admin: false, course: { 'c-1': ['_lecturer'], 'c-2': ['_lecturer'] } };
    p.labels = {
      ensureCourseLabel: async () => undefined,
      courseLabel: (id: string) => (id === 'c-1' ? 'Programmierung 1' : 'Physics'),
      ensureLabel: async () => undefined,
      label: () => ({ title: 'x' })
    };

    const result = await choices('course');
    expect(result.map(c => c.targetId)).to.have.members(['c-1', 'c-2']);
    expect(result.map(c => c.label)).to.have.members(['Programmierung 1', 'Physics']);
  });

  it('fetches a scope rather than trusting the lazy cache', async () => {
    // Course-grouped scopes are only pulled once a course node is expanded,
    // so reading the cache would report "nothing here" before that.
    let asked: Record<string, unknown> | undefined;
    const { choices, p } = withApi({
      listMessagesPage: async (params: Record<string, unknown>) => {
        asked = params;
        return {
          items: [
            { id: 'm1', submission_group_id: 'sg-1', author_id: 'u' },
            { id: 'm2', submission_group_id: 'sg-1', author_id: 'u' },
            { id: 'm3', submission_group_id: 'sg-2', author_id: 'u' }
          ],
          total: 3
        };
      }
    });
    p.labels = {
      ensureCourseLabel: async () => undefined,
      courseLabel: () => undefined,
      ensureLabel: async () => undefined,
      label: (_s: string, id: string) => ({ title: `Group ${id}` })
    };

    const result = await choices('submission_group', 'c-1');

    expect(asked).to.include({ scope: 'submission_group', course_id: 'c-1' });
    expect(result.map(c => c.targetId)).to.deep.equal(['sg-1', 'sg-2']);
  });

  it('returns nothing when a scope genuinely has no destinations', async () => {
    const { choices, p } = withApi();
    p.labels = {
      ensureCourseLabel: async () => undefined,
      courseLabel: () => undefined,
      ensureLabel: async () => undefined,
      label: () => ({ title: 'x' })
    };
    expect(await choices('course_group')).to.deep.equal([]);
  });

  it('survives a failed fetch without throwing', async () => {
    const { choices, p } = withApi({
      listMessagesPage: async () => { throw new Error('backend down'); }
    });
    p.labels = {
      ensureCourseLabel: async () => undefined,
      courseLabel: () => undefined,
      ensureLabel: async () => undefined,
      label: () => ({ title: 'x' })
    };
    expect(await choices('course_content')).to.deep.equal([]);
  });
});
