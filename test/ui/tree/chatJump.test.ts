import { expect } from 'chai';

import { findInTree, resolveJumpTarget } from '../../../src/ui/tree/chat/chatJump';
import type { ChatThread } from '../../../src/ui/tree/chat/ChatInboxTreeItems';
import type { MessageList } from '../../../src/types/generated';

/**
 * The inbox's jump-to-assignment: the thread's server-resolved context names
 * the course, the assignment and the group members, and whether the current
 * user is one of them decides the student vs. tutor flow.
 */

const sgMessage = (over: Partial<MessageList> = {}): MessageList =>
  ({
    id: 'm-1',
    content: 'x',
    level: 0,
    author_id: 'u-student',
    submission_group_id: 'sg-1',
    scope: 'submission_group',
    kind: 'conversation',
    context: {
      course_id: 'c-1',
      course_title: 'Programming in MATLAB',
      course_content_id: 'cc-9',
      course_content_title: 'A3 Filters',
      course_content_path: 'unit1.a3',
      submission_group_display_name: 'Max Muster',
      submission_group_members: [
        { course_member_id: 'cm-1', user_id: 'u-student', given_name: 'Max', family_name: 'Muster' }
      ]
    },
    ...over
  } as unknown as MessageList);

const thread = (messages: MessageList[], over: Partial<ChatThread> = {}): ChatThread => ({
  scope: 'submission_group',
  targetId: 'sg-1',
  title: 't',
  unreadCount: 0,
  messageCount: messages.length,
  messages,
  ...over
});

describe('resolveJumpTarget', () => {
  it('resolves everything the jump needs from the message context', () => {
    const target = resolveJumpTarget(thread([sgMessage()]), 'u-tutor');
    expect(target).to.deep.include({
      submissionGroupId: 'sg-1',
      courseId: 'c-1',
      courseContentId: 'cc-9',
      courseContentTitle: 'A3 Filters',
      isMember: false
    });
    expect(target!.members[0]).to.deep.equal({
      courseMemberId: 'cm-1',
      userId: 'u-student',
      name: 'Max Muster'
    });
  });

  it('marks the group member for the student flow', () => {
    expect(resolveJumpTarget(thread([sgMessage()]), 'u-student')!.isMember).to.equal(true);
  });

  it('ignores threads that are not assignment conversations', () => {
    expect(resolveJumpTarget(thread([], { scope: 'course' }), 'u-1')).to.equal(undefined);
  });

  it('leaves ids undefined without a context, so the caller can fall back', () => {
    const bare = sgMessage({ context: null, course_content_id: null } as Partial<MessageList>);
    const target = resolveJumpTarget(thread([bare]), 'u-student')!;
    expect(target.courseContentId).to.equal(undefined);
    expect(target.members).to.deep.equal([]);
    expect(target.isMember).to.equal(false);
  });
});

describe('findInTree', () => {
  interface FakeNode { id: string; collapsibleState: number; children?: FakeNode[] }
  const tree: FakeNode = {
    id: 'root', collapsibleState: 1,
    children: [
      { id: 'org-1', collapsibleState: 1, children: [
        { id: 'course-c1', collapsibleState: 1, children: [
          { id: 'unit-1', collapsibleState: 1, children: [
            { id: 'cc-9', collapsibleState: 1 }
          ] }
        ] },
        { id: 'course-c2', collapsibleState: 1, children: [
          { id: 'cc-other', collapsibleState: 1 }
        ] }
      ] }
    ]
  };
  const visited: string[] = [];
  const tracked = {
    provider: {
      getChildren: async (parent?: FakeNode) => {
        visited.push(parent?.id ?? 'root');
        return (parent ?? tree).children ?? [];
      },
      getTreeItem: (n: FakeNode) => n
    },
    find: () => undefined,
    onDidProduceItems: () => ({ dispose: () => undefined }),
    dispose: () => undefined
  } as never;

  it('walks lazily-rendered levels down to the wanted node', async () => {
    visited.length = 0;
    const found = await findInTree(
      tracked,
      item => item.id === 'cc-9',
      item => item.id !== 'course-c2'
    );
    expect((found as FakeNode).id).to.equal('cc-9');
    // The pruned course was never expanded.
    expect(visited).to.not.include('course-c2');
  });

  it('gives up quietly when the node is nowhere', async () => {
    const found = await findInTree(tracked, item => item.id === 'nope', () => true);
    expect(found).to.equal(undefined);
  });
});
