import * as vscode from 'vscode';
import type { ComputorApiService } from '../../../services/ComputorApiService';
import { messageContextOf } from '../../../services/MessageLabelResolver';
import { TutorSelectionService } from '../../../services/TutorSelectionService';
import { notify } from '../../../utils/notify';
import { getTreeHandle, TreeHandle } from '../../treeRegistry';
import { suppressSelectionSideEffects } from '../../treeRestore';
import type { ChatThread } from './ChatInboxTreeItems';

/**
 * Jump from an inbox assignment thread to the assignment itself (issue #322
 * §1): a student lands on their assignment in the Student view, a tutor lands
 * on that student's assignment in the Tutor view — and in both cases the
 * conversation opens alongside, so the reader answers with the code in front
 * of them.
 */

export interface JumpTarget {
  submissionGroupId: string;
  courseId?: string;
  courseTitle?: string;
  courseContentId?: string;
  courseContentTitle?: string;
  courseContentPath?: string;
  members: Array<{ courseMemberId: string; userId?: string; name?: string }>;
  /** The current user belongs to the submission group → student flow. */
  isMember: boolean;
}

/** What the thread itself knows, from the server-resolved message context. */
export function resolveJumpTarget(
  thread: ChatThread,
  currentUserId: string | undefined
): JumpTarget | undefined {
  if (thread.scope !== 'submission_group' || !thread.targetId) {
    return undefined;
  }
  const ctx = messageContextOf(thread.messages);
  const members = (ctx?.submission_group_members ?? []).map(m => ({
    courseMemberId: m.course_member_id,
    userId: m.user_id ?? undefined,
    name: `${m.given_name ?? ''} ${m.family_name ?? ''}`.trim() || undefined
  }));
  return {
    submissionGroupId: thread.targetId,
    courseId: ctx?.course_id
      ?? thread.messages.find(m => m.course_id)?.course_id
      ?? undefined,
    courseTitle: ctx?.course_title ?? undefined,
    courseContentId: ctx?.course_content_id
      ?? thread.messages.find(m => m.course_content_id)?.course_content_id
      ?? undefined,
    courseContentTitle: ctx?.course_content_title ?? undefined,
    courseContentPath: ctx?.course_content_path ?? undefined,
    members,
    isMember: Boolean(currentUserId && members.some(m => m.userId === currentUserId))
  };
}

/**
 * Breadth-first walk of a wrapped provider until the wanted node is rendered.
 *
 * `reveal` needs the element instance, and the id index only knows nodes that
 * have passed through `getChildren`. Walking the wrapped provider populates
 * the index *and* the recorded parent chain, which is exactly the state
 * reveal needs to expand its way down.
 */
export async function findInTree(
  tracked: TreeHandle['tracked'],
  matches: (item: vscode.TreeItem) => boolean,
  descend: (item: vscode.TreeItem) => boolean,
  maxNodes = 400
): Promise<unknown | undefined> {
  const provider = tracked.provider;
  const queue: (unknown | undefined)[] = [undefined];
  let visited = 0;
  while (queue.length > 0 && visited < maxNodes) {
    const parent = queue.shift();
    let children: unknown[];
    try {
      children = ((await provider.getChildren(parent)) ?? []) as unknown[];
    } catch {
      continue;
    }
    for (const child of children) {
      visited += 1;
      const item = child as vscode.TreeItem;
      if (matches(item)) {
        return child;
      }
      if (descend(item)) {
        queue.push(child);
      }
    }
  }
  return undefined;
}

const idOf = (item: vscode.TreeItem): string => (typeof item.id === 'string' ? item.id : '');
const isCollapsible = (item: vscode.TreeItem): boolean =>
  item.collapsibleState !== undefined
  && item.collapsibleState !== vscode.TreeItemCollapsibleState.None;

/** Content nodes carry the content id — pre-expanded tutor rows suffix it. */
const matchesContent = (contentId: string) => (item: vscode.TreeItem): boolean => {
  const id = idOf(item);
  return id === contentId || id.startsWith(`${contentId}:`);
};

async function revealInView(
  handle: TreeHandle,
  matches: (item: vscode.TreeItem) => boolean,
  descend: (item: vscode.TreeItem) => boolean
): Promise<boolean> {
  const element = await findInTree(handle.tracked, matches, descend);
  if (!element) {
    return false;
  }
  await suppressSelectionSideEffects(async () => {
    try {
      await handle.view.reveal(element, { select: true, focus: true, expand: true });
    } catch (err) {
      console.warn('[ChatJump] Reveal failed:', err);
    }
  });
  return true;
}

export async function jumpToAssignment(
  thread: ChatThread,
  currentUserId: string | undefined,
  api: ComputorApiService
): Promise<void> {
  let target = resolveJumpTarget(thread, currentUserId);
  if (!target) {
    notify.warning('This message is not attached to an assignment.');
    return;
  }

  // Older backends send no message context; staff can still resolve the
  // group through the tutor endpoint.
  if (!target.courseContentId || target.members.length === 0) {
    const group = await api.getTutorSubmissionGroup(target.submissionGroupId).catch(() => undefined);
    if (group) {
      const members = (group.members ?? []).map(m => ({
        courseMemberId: m.course_member_id,
        userId: m.user_id ?? undefined,
        name: `${m.given_name ?? ''} ${m.family_name ?? ''}`.trim() || undefined
      }));
      target = {
        ...target,
        courseId: target.courseId ?? group.course_id ?? undefined,
        courseContentId: target.courseContentId ?? group.course_content_id ?? undefined,
        courseContentTitle: target.courseContentTitle
          ?? (group as { course_content_title?: string | null }).course_content_title
          ?? undefined,
        members: target.members.length > 0 ? target.members : members,
        isMember: Boolean(currentUserId && members.some(m => m.userId === currentUserId)) || target.isMember
      };
    }
  }

  if (!target.courseId || !target.courseContentId) {
    notify.warning('Cannot resolve the assignment behind this conversation (older backend?).');
    return;
  }

  if (target.isMember) {
    await jumpAsStudent(target);
  } else {
    await jumpAsTutor(target, api);
  }
}

async function jumpAsStudent(target: JumpTarget): Promise<void> {
  await vscode.commands.executeCommand('computor.student.courses.focus');

  const handle = getTreeHandle('computor.student.courses');
  if (handle) {
    const courseNodeId = `course-${target.courseId}`;
    await revealInView(
      handle,
      matchesContent(target.courseContentId!),
      (item) => {
        if (!isCollapsible(item)) { return false; }
        const id = idOf(item);
        // Other courses' subtrees are dead ends; assignments' children are
        // workspace files.
        if (id.startsWith('course-')) { return id === courseNodeId; }
        return !(item.contextValue ?? '').startsWith('studentCourseContent.assignment');
      }
    );
  }

  // Open the conversation alongside — same target the assignment row's own
  // messages action builds.
  await vscode.commands.executeCommand('computor.student.showMessages', {
    courseId: target.courseId,
    courseContent: {
      id: target.courseContentId,
      course_id: target.courseId,
      title: target.courseContentTitle,
      path: target.courseContentPath
    },
    submissionGroup: { id: target.submissionGroupId }
  });
}

async function jumpAsTutor(target: JumpTarget, api: ComputorApiService): Promise<void> {
  let member = target.members[0];
  if (target.members.length > 1) {
    const picked = await vscode.window.showQuickPick(
      target.members.map(m => ({ label: m.name || m.courseMemberId, member: m })),
      { title: 'Open which group member?', placeHolder: 'The group has several members' }
    );
    if (!picked) { return; }
    member = picked.member;
  }
  if (!member) {
    notify.warning('This submission group has no members to open.');
    return;
  }

  // Course first — it resets the member selection.
  const selection = TutorSelectionService.getInstance();
  if (selection.getCurrentCourseId() !== target.courseId) {
    await selection.selectCourse(target.courseId!, target.courseTitle ?? null);
  }
  await selection.selectMember(member.courseMemberId, member.name ?? null);
  await vscode.commands.executeCommand('computor.tutor.refreshTree');
  await vscode.commands.executeCommand('computor.tutor.courses.focus');

  // Open the conversation first — the reveal below is best-effort.
  await vscode.commands.executeCommand('computor.tutor.showMessages', {
    content: {
      id: target.courseContentId,
      title: target.courseContentTitle,
      path: target.courseContentPath
    },
    submissionGroup: { id: target.submissionGroupId }
  });

  const handle = getTreeHandle('computor.tutor.courses');
  if (handle) {
    await revealInView(
      handle,
      matchesContent(target.courseContentId!),
      (item) => {
        if (!isCollapsible(item)) { return false; }
        const id = idOf(item);
        if (id.startsWith('tutorVirtualFolder:') || id.startsWith('tutorSubmission:')) { return false; }
        return !(item.contextValue ?? '').startsWith('tutorStudentContent.assignment');
      }
    );
  }
}
