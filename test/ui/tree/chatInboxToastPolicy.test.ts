import { expect } from 'chai';

import { ChatInboxTreeProvider } from '../../../src/ui/tree/chat/ChatInboxTreeProvider';

/**
 * The inbox toast is gated by the notification policy (issue #251): a
 * `message:new` broadcast must involve the user personally to pop up.
 * These tests drive the real handler to pin the wiring around the policy —
 * the badge reload always runs, the mute settings still win over a mention,
 * and the user's own posts never toast.
 */

function makeProvider(currentUserId: string) {
  const context = {
    globalState: { get: () => undefined, update: async () => undefined }
  } as unknown as import('vscode').ExtensionContext;
  const provider = new ChatInboxTreeProvider(context, {} as never, {} as never);
  const toasted: Record<string, unknown>[] = [];
  let reloads = 0;
  const internals = provider as unknown as {
    currentUserId?: string;
    messagesProvider: { isShowingMessage: (m: unknown) => boolean };
    mutedCourses: Set<string>;
    scheduleWsReload: () => void;
    showNewMessageToast: (m: Record<string, unknown>) => Promise<void>;
    handleInboxNewMessage: (channel: string, data: Record<string, unknown>) => void;
  };
  internals.currentUserId = currentUserId;
  internals.messagesProvider = { isShowingMessage: () => false };
  internals.scheduleWsReload = () => { reloads += 1; };
  internals.showNewMessageToast = async (m) => { toasted.push(m); };
  const deliver = (message: Record<string, unknown>) =>
    internals.handleInboxNewMessage(`user:${currentUserId}`, { data: message });
  return { internals, deliver, toasted, reloadCount: () => reloads };
}

const studentGroupMessage = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
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
    submission_group_members: [{ course_member_id: 'cm-1', user_id: 'u-student' }]
  },
  ...over
});

describe('ChatInboxTreeProvider — new-message toast policy', () => {
  it('keeps the badge reload but drops the toast for an uninvolved staff reader', () => {
    const { deliver, toasted, reloadCount } = makeProvider('u-tutor');
    deliver(studentGroupMessage());
    expect(toasted).to.have.length(0);
    expect(reloadCount()).to.equal(1);
  });

  it('toasts a reply to the reader own message', () => {
    const { deliver, toasted } = makeProvider('u-tutor');
    deliver(studentGroupMessage({ parent_id: 'm-0', parent_author_id: 'u-tutor' }));
    expect(toasted).to.have.length(1);
  });

  it('lets a mute win even over a mention', () => {
    const { internals, deliver, toasted } = makeProvider('u-tutor');
    internals.mutedCourses.add('c-1');
    deliver(studentGroupMessage({ mentions: [{ id: 'u-tutor' }] }));
    expect(toasted).to.have.length(0);
  });

  it('never toasts the reader own posts', () => {
    const { deliver, toasted } = makeProvider('u-tutor');
    deliver(studentGroupMessage({ author_id: 'u-tutor', parent_author_id: 'u-tutor' }));
    expect(toasted).to.have.length(0);
  });

  it('toasts announcements', () => {
    const { deliver, toasted } = makeProvider('u-tutor');
    deliver({ id: 'm-2', scope: 'course', kind: 'announcement', course_id: 'c-1', author_id: 'u-lecturer' });
    expect(toasted).to.have.length(1);
  });
});
