import type { MessageList, UserScopes } from '../types/generated';
import type { MessageTargetContext } from '../ui/webviews/MessagesWebviewProvider';
import {
  COURSE_ANNOUNCEMENT_DENIED_REASON,
  canPostCourseAnnouncement,
  canPostGlobal,
  canPostToCourseFamily,
  canPostToOrganization,
  kindForScope
} from './MessagePermissions';
import type { ScopeName } from './MessagePermissions';
import type { MessageLabelResolver } from './MessageLabelResolver';

/**
 * The channel global messages are broadcast on.
 *
 * Matches GLOBAL_CHANNEL in computor_backend/websocket/broadcast.py; every
 * connection is auto-subscribed to it on connect, and `_can_subscribe`
 * always allows it.
 */
export const GLOBAL_CHANNEL = 'global';

/**
 * The target id a message carries for a given scope.
 *
 * Under the single-target invariant a message has exactly one target column
 * set, and `scope` names which — so this is just "read the column `scope`
 * points at".
 */
export function targetIdFor(scope: ScopeName, m: MessageList): string | null {
  if (scope === 'global') { return null; }
  return (m as unknown as Record<string, string | null | undefined>)[`${scope}_id`] ?? null;
}

/** Group a scope's messages by the target they belong to. */
export function groupByTarget(
  scope: ScopeName,
  messages: MessageList[]
): Map<string, MessageList[]> {
  const byTarget = new Map<string, MessageList[]>();
  for (const m of messages) {
    const targetId = targetIdFor(scope, m) ?? '__none__';
    if (!byTarget.has(targetId)) { byTarget.set(targetId, []); }
    byTarget.get(targetId)!.push(m);
  }
  return byTarget;
}

export interface TargetContextInput {
  scope: ScopeName;
  targetId: string | null;
  /** Messages of this target — only used to name DMs and submission groups. */
  messages?: MessageList[];
  labels: MessageLabelResolver;
  userScopes?: UserScopes;
  /** Role-based views the user has, e.g. `user_manager`. */
  userViews?: string[];
  currentUserId?: string;
  /** Client-side cache hint; never sent as a query filter. */
  cacheCourseMemberId?: string;
  sourceRole?: MessageTargetContext['sourceRole'];
}

/**
 * Build everything the messages panel needs to show one scope+target.
 *
 * This is the single place that decides three things which used to be
 * decided ad hoc at every call site and disagreed:
 *
 * 1. **The query pins `scope`.** Target-id filters walk *down* the hierarchy
 *    by default, so `course_id=X` alone also returns every course_content,
 *    course_group and submission_group message underneath it — a lecturer's
 *    announcement list filling up with students' private conversations.
 * 2. **`createPayload` carries exactly one target**, matching the backend's
 *    single-target invariant.
 * 3. **Whether the viewer may post**, so the compose box isn't offered where
 *    it would 403.
 *
 * Returns undefined when a non-global scope has no target — there is nothing
 * to show.
 */
export async function buildTargetContext(
  input: TargetContextInput
): Promise<MessageTargetContext | undefined> {
  const { scope, targetId, messages = [], labels, userScopes, userViews = [] } = input;

  if (scope !== 'global' && !targetId) {
    return undefined;
  }

  // Submission groups are named after their assignment, which may not be in
  // the label cache yet (e.g. opening straight from a WebSocket toast).
  if (scope === 'submission_group') {
    const seen = new Set<string>();
    for (const m of messages) {
      const contentId = m.course_content_id;
      if (typeof contentId === 'string' && contentId && !seen.has(contentId)) {
        seen.add(contentId);
        await labels.ensureLabel('course_content', contentId).catch(() => undefined);
      }
    }
  } else if (targetId) {
    await labels.ensureLabel(scope, targetId).catch(() => undefined);
  }

  const label = labels.label(scope, targetId, messages, input.currentUserId);
  const title = [label.subtitle, label.title].filter(Boolean).join(' / ');

  const query: Record<string, string> = { scope };
  const createPayload: Record<string, unknown> = {};
  let wsChannel: string | undefined;
  let readOnly = false;
  let readOnlyReason: string | undefined;

  if (scope === 'global') {
    readOnly = !canPostGlobal(userScopes, userViews.includes('user_manager'));
    readOnlyReason = readOnly
      ? 'Only administrators or user managers can post global announcements.'
      : undefined;
    // Global has no target id, but it does have a channel: the backend
    // publishes global messages to `global`, and every connection is
    // auto-subscribed to it. Leaving this undefined made global the one
    // scope with no live updates at all — a posted announcement did not
    // appear until a manual refresh.
    wsChannel = GLOBAL_CHANNEL;
  } else {
    query[`${scope}_id`] = targetId!;
    createPayload[`${scope}_id`] = targetId!;
    wsChannel = `${scope}:${targetId}`;

    if (scope === 'organization') {
      readOnly = !canPostToOrganization(userScopes, targetId!);
      readOnlyReason = readOnly
        ? 'Posting to this organization requires manager or owner role.'
        : undefined;
    } else if (scope === 'course_family') {
      readOnly = !canPostToCourseFamily(userScopes, targetId!);
      readOnlyReason = readOnly
        ? 'Posting to this course family requires manager or owner role.'
        : undefined;
    } else if (scope === 'course' || scope === 'course_content' || scope === 'course_group') {
      // All three gate on _lecturer in the containing course. A course is its
      // own course; a content or group needs a lookup, and that cannot come
      // off the messages — the single-target invariant leaves `course_id`
      // NULL on a course_content message — so it comes from the label
      // resolver, which recorded it when it fetched the entity.
      const courseId = scope === 'course'
        ? targetId!
        : labels.parentCourseId(scope, targetId);
      readOnly = !canPostCourseAnnouncement(userScopes, courseId);
      readOnlyReason = readOnly ? COURSE_ANNOUNCEMENT_DENIED_REASON : undefined;
    }
  }

  return {
    title,
    subtitle: label.subtitle,
    query,
    createPayload,
    wsChannel,
    readOnly,
    readOnlyReason,
    kind: kindForScope(scope),
    cacheCourseMemberId: input.cacheCourseMemberId,
    sourceRole: input.sourceRole
  };
}

