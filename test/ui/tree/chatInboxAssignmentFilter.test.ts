import { expect } from 'chai';

import { ChatInboxTreeProvider } from '../../../src/ui/tree/chat/ChatInboxTreeProvider';
import { ChatCourseSectionItem, ChatEmptyItem, ChatThreadItem } from '../../../src/ui/tree/chat/ChatInboxTreeItems';
import type { MessageList } from '../../../src/types/generated';

/**
 * A tutor's Assignments section is an inbox of open questions, not an
 * archive (issue #322 follow-up): read conversations of other people's
 * groups drop out of the tree — they stay reachable through the Tutor view,
 * and mark-as-unread pins one back. A reader's own conversations always
 * stay.
 */

const sgMessage = (id: string, sgId: string, memberUserId: string, over: Partial<MessageList> = {}): MessageList =>
  ({
    id,
    content: 'x',
    level: 0,
    author_id: memberUserId,
    submission_group_id: sgId,
    scope: 'submission_group',
    kind: 'conversation',
    is_read: true,
    created_at: '2026-08-15T10:00:00Z',
    context: {
      course_id: 'c-1',
      course_title: 'CE II',
      course_content_id: `cc-${sgId}`,
      course_content_title: `Assignment ${sgId}`,
      submission_group_display_name: 'Someone',
      submission_group_members: [
        { course_member_id: `cm-${sgId}`, user_id: memberUserId, given_name: 'Some', family_name: 'One' }
      ]
    },
    ...over
  } as unknown as MessageList);

function makeProvider(currentUserId: string, messages: MessageList[]) {
  const context = {
    globalState: { get: () => undefined, update: async () => undefined }
  } as unknown as import('vscode').ExtensionContext;
  const provider = new ChatInboxTreeProvider(context, {} as never, {} as never);
  const internals = provider as unknown as {
    currentUserId?: string;
    courseScopeStates: Map<string, Map<string, { messages: MessageList[]; fetched: number; total: number }>>;
    getSectionChildren: (el: ChatCourseSectionItem) => Promise<unknown[]>;
    labels: Record<string, unknown>;
  };
  internals.currentUserId = currentUserId;
  internals.labels = { label: () => ({ title: 'x' }), courseLabel: () => 'CE II' };
  for (const scope of ['submission_group', 'course', 'course_group', 'course_content']) {
    internals.courseScopeStates.set(scope, new Map([
      ['c-1', {
        messages: scope === 'submission_group' ? messages : [],
        fetched: scope === 'submission_group' ? messages.length : 0,
        total: scope === 'submission_group' ? messages.length : 0
      }]
    ]));
  }
  const section = new ChatCourseSectionItem('assignments', 'c-1', 'CE II', 0, undefined, true);
  return { rows: () => internals.getSectionChildren(section) };
}

describe('ChatInboxTreeProvider — assignments section filtering', () => {
  it('hides read conversations of groups the reader is not in', async () => {
    const { rows } = makeProvider('u-tutor', [
      sgMessage('m-1', 'sg-1', 'u-student-1'),
      sgMessage('m-2', 'sg-2', 'u-student-2', { is_read: false })
    ]);
    const items = await rows();
    const threads = items.filter(i => i instanceof ChatThreadItem) as ChatThreadItem[];
    expect(threads).to.have.length(1);
    expect(threads[0]!.thread.targetId).to.equal('sg-2');
  });

  it('keeps the reader own conversations even when read', async () => {
    const { rows } = makeProvider('u-student-1', [
      sgMessage('m-1', 'sg-1', 'u-student-1')
    ]);
    const items = await rows();
    const threads = items.filter(i => i instanceof ChatThreadItem);
    expect(threads).to.have.length(1);
  });

  it('keeps context-less threads — an older backend cannot say whose they are', async () => {
    const { rows } = makeProvider('u-tutor', [
      sgMessage('m-1', 'sg-1', 'u-student-1', { context: null } as Partial<MessageList>)
    ]);
    const items = await rows();
    expect(items.filter(i => i instanceof ChatThreadItem)).to.have.length(1);
  });

  it('says where the read conversations went when everything is filtered', async () => {
    const { rows } = makeProvider('u-tutor', [
      sgMessage('m-1', 'sg-1', 'u-student-1')
    ]);
    const items = await rows();
    expect(items).to.have.length(1);
    expect(items[0]).to.be.instanceOf(ChatEmptyItem);
    expect((items[0] as ChatEmptyItem).label).to.match(/Tutor view/);
  });
});
