import { expect } from 'chai';

import { MessagesWebviewProvider } from '../../src/ui/webviews/MessagesWebviewProvider';
import { ChatInboxTreeProvider } from '../../src/ui/tree/chat/ChatInboxTreeProvider';
import type { ChatThreadItem } from '../../src/ui/tree/chat/ChatInboxTreeItems';
import type { MessageList } from '../../src/types/generated';
import type { ComputorApiService } from '../../src/services/ComputorApiService';

/**
 * Mark-as-unread (issue #322 §5) only means something if the panel's own
 * auto-read machinery — the open sweep, the dwell batches, the optimistic
 * normalisation — doesn't immediately erase it.
 */

interface WebviewInternals {
  manuallyUnread: Set<string>;
  currentData?: { target?: unknown; messages: MessageList[] };
  normalizeReadState: (m: MessageList[], uid?: string, t?: unknown) => MessageList[];
  markMessagesOnOpen: (m: MessageList[], t: unknown, uid?: string) => Promise<void>;
  handleMarkRead: (d: { messageIds?: string[] }) => Promise<void>;
  handleMarkUnread: (d: { messageId?: string }) => Promise<void>;
  notifyIndicatorsUpdated: (t: unknown, m: MessageList[]) => void;
}

const msg = (id: string, over: Partial<MessageList> = {}): MessageList =>
  ({ id, content: 'x', level: 0, author_id: 'other', is_read: false, ...over } as unknown as MessageList);

function makeWebview(api: Partial<ComputorApiService>): WebviewInternals {
  const context = {
    extensionPath: '/tmp/computor-test',
    extensionUri: { fsPath: '/tmp/computor-test' },
    globalState: { get: () => undefined, update: async () => undefined }
  };
  const provider = new MessagesWebviewProvider(
    context as never,
    api as ComputorApiService
  );
  const internals = provider as unknown as WebviewInternals;
  // The indicator fan-out executes VS Code commands — not under test here.
  internals.notifyIndicatorsUpdated = () => undefined;
  return internals;
}

describe('MessagesWebviewProvider — mark-unread suppression', () => {
  it('handleMarkUnread flags the message and calls the API', async () => {
    const unreadCalls: string[] = [];
    const w = makeWebview({ markMessageUnread: async (id: string) => { unreadCalls.push(id); } } as never);
    w.currentData = { messages: [msg('m-1', { is_read: true })] };

    await w.handleMarkUnread({ messageId: 'm-1' });

    expect(unreadCalls).to.deep.equal(['m-1']);
    expect(w.manuallyUnread.has('m-1')).to.equal(true);
    expect(w.currentData.messages[0]!.is_read).to.equal(false);
  });

  it('drops the flag again when the API call fails', async () => {
    const w = makeWebview({ markMessageUnread: async () => { throw new Error('down'); } } as never);
    w.currentData = { messages: [msg('m-1', { is_read: true })] };
    await w.handleMarkUnread({ messageId: 'm-1' });
    expect(w.manuallyUnread.has('m-1')).to.equal(false);
  });

  it('the open sweep skips a manually unread message', async () => {
    const swept: string[][] = [];
    const w = makeWebview({ markMessagesRead: async (ids: string[]) => { swept.push(ids); return { marked: ids.length, requested: ids.length }; } } as never);
    w.manuallyUnread.add('m-1');

    await w.markMessagesOnOpen([msg('m-1'), msg('m-2')], { kind: 'conversation' }, 'me');

    expect(swept).to.deep.equal([['m-2']]);
  });

  it('the dwell batches skip a manually unread message', async () => {
    const swept: string[][] = [];
    const w = makeWebview({
      markMessagesRead: async (ids: string[]) => { swept.push(ids); return { marked: ids.length, requested: ids.length }; },
      getCurrentUserId: () => 'me'
    } as never);
    w.currentData = { messages: [msg('m-1'), msg('m-2')] };
    w.manuallyUnread.add('m-1');

    await w.handleMarkRead({ messageIds: ['m-1', 'm-2'] });

    expect(swept).to.deep.equal([['m-2']]);
    expect(w.currentData.messages[0]!.is_read).to.equal(false);
  });

  it('the optimistic normalisation leaves a manually unread message alone', () => {
    const w = makeWebview({} as never);
    w.manuallyUnread.add('m-1');
    const out = w.normalizeReadState([msg('m-1'), msg('m-2')], 'me', { kind: 'conversation' });
    expect(out[0]!.is_read).to.equal(false);
    expect(out[1]!.is_read).to.equal(true);
  });
});

describe('ChatInboxTreeProvider — mark thread unread', () => {
  it('flips the newest message the reader did not write', async () => {
    const unreadCalls: string[] = [];
    const context = { globalState: { get: () => undefined, update: async () => undefined } };
    const provider = new ChatInboxTreeProvider(
      context as never,
      { markMessageUnread: async (id: string) => { unreadCalls.push(id); } } as never,
      {} as never
    );
    const internals = provider as unknown as {
      currentUserId?: string;
      rebuildFromCache: () => void;
    };
    internals.currentUserId = 'me';
    internals.rebuildFromCache = () => undefined;

    const messages = [
      msg('m-old', { is_read: true }),
      msg('m-mine', { is_read: true, author_id: 'me' } as Partial<MessageList>),
      msg('m-newest-other', { is_read: true })
    ];
    await provider.markThreadUnread({
      thread: { scope: 'submission_group', targetId: 'sg-1', title: 't', unreadCount: 0, messageCount: 3, messages }
    } as ChatThreadItem);

    // Newest non-own message — one flag is enough to badge the thread.
    expect(unreadCalls).to.deep.equal(['m-newest-other']);
    expect(messages[2]!.is_read).to.equal(false);
    expect(messages[0]!.is_read).to.equal(true);
  });
});
