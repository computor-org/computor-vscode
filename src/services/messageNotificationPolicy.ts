import { kindForScope, type ScopeName } from './MessagePermissions';

/**
 * Why a new-message broadcast earns a toast (issue #251).
 *
 * The per-user WS channel fans out every message in the user's audience —
 * for staff that is every student conversation in the course. A pop-up for
 * each of those buries the ones that matter, so the toast is reserved for
 * messages that involve the user personally; everything else still lands
 * in the unread badges and the inbox tree.
 */
export type ToastReason = 'announcement' | 'mention' | 'reply' | 'participant';

export interface ToastDecision {
  notify: boolean;
  reason?: ToastReason;
}

/**
 * Decide whether a `message:new` broadcast should pop a toast.
 *
 * A toast fires only when the message involves the user personally:
 * an announcement, a direct @-mention, a reply to one of their messages
 * (via the server-enriched `parent_author_id`), or a conversation they are
 * a participant of (their own submission group, or a DM addressed to them).
 *
 * Anything the payload cannot prove involves the user is suppressed —
 * unlike the inbox tree's membership filter this fails closed, because a
 * missed toast still shows up in the badges while a wrong one interrupts.
 */
export function shouldToastNewMessage(
  message: Record<string, unknown>,
  currentUserId: string | undefined
): ToastDecision {
  const scope = (typeof message.scope === 'string' ? message.scope : 'global') as ScopeName;
  const kind = message.kind === 'announcement' || message.kind === 'conversation'
    ? message.kind
    : kindForScope(scope);

  if (kind === 'announcement') {
    return { notify: true, reason: 'announcement' };
  }
  if (!currentUserId) {
    // Every remaining rule is identity-relative.
    return { notify: false };
  }

  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  if (mentions.some(m => m && typeof m === 'object' && (m as { id?: unknown }).id === currentUserId)) {
    return { notify: true, reason: 'mention' };
  }

  if (message.parent_author_id === currentUserId) {
    return { notify: true, reason: 'reply' };
  }

  if (scope === 'user' && message.user_id === currentUserId) {
    return { notify: true, reason: 'participant' };
  }
  if (scope === 'submission_group') {
    const ctx = (message.context ?? undefined) as
      { submission_group_members?: Array<{ user_id?: string | null }> } | undefined;
    const rawMembers = ctx?.submission_group_members;
    const members = Array.isArray(rawMembers) ? rawMembers : [];
    if (members.some(m => m && m.user_id === currentUserId)) {
      return { notify: true, reason: 'participant' };
    }
  }
  // course_member DMs carry no target user_id in the payload, so
  // participation is unknowable there — fail closed like everything else.
  return { notify: false };
}
