import { ComputorApiService } from './ComputorApiService';
import type { MessageContext, MessageList } from '../types/generated';
import type { ScopeName } from './MessagePermissions';

export interface TargetLabel {
  title: string;
  subtitle?: string;
}

/** The first server-resolved context found among the messages, if any. */
export function messageContextOf(messages: MessageList[]): MessageContext | undefined {
  for (const m of messages) {
    if (m.context) { return m.context; }
  }
  return undefined;
}

/**
 * Turns a message's scope + target id into something a human recognises.
 *
 * A message carries ids, not names: `course_content_id` says nothing about
 * which assignment it is. Every surface that lists messages by target — the
 * chat inbox tree and the messages browser — needs the same lookups, the
 * same caches, and the same fallbacks, so they live here once rather than in
 * whichever view happened to need them first.
 *
 * Lookups are cached for the life of the resolver and are best-effort: a
 * failed fetch falls back to a truncated id rather than blocking a render.
 */
export class MessageLabelResolver {
  private readonly orgLabels = new Map<string, string>();
  private readonly familyLabels = new Map<string, string>();
  private readonly courseLabels = new Map<string, string>();
  private readonly contentLabels = new Map<string, TargetLabel>();
  private readonly groupLabels = new Map<string, TargetLabel>();
  private readonly memberLabels = new Map<string, TargetLabel>();
  /**
   * `${scope}:${targetId}` -> the course that target belongs to.
   *
   * Recorded while resolving labels, because it cannot be recovered from the
   * messages: the single-target invariant means a course_content message has
   * `course_id` NULL. The posting check for course / course_content /
   * course_group all gate on a role in the containing course, so it needs
   * this.
   */
  private readonly parentCourse = new Map<string, string>();

  constructor(private readonly api: ComputorApiService) {}

  /** The course a course-scoped target belongs to, if already resolved. */
  parentCourseId(scope: ScopeName, targetId: string | null): string | undefined {
    if (!targetId) { return undefined; }
    if (scope === 'course') { return targetId; }
    return this.parentCourse.get(`${scope}:${targetId}`);
  }

  /** The cached course title, if it has already been looked up. */
  courseLabel(courseId: string): string | undefined {
    return this.courseLabels.get(courseId);
  }

  /** Fetch and cache a course title; returns undefined on failure. */
  async ensureCourseLabel(courseId: string): Promise<string | undefined> {
    if (this.courseLabels.has(courseId)) { return this.courseLabels.get(courseId); }
    try {
      const course = await this.api.getCourse(courseId);
      const label = course?.title || course?.path || shortId(courseId);
      this.courseLabels.set(courseId, label);
      return label;
    } catch {
      return undefined;
    }
  }

  /**
   * Populate the cache for one target. Safe to call repeatedly; each id is
   * fetched at most once.
   */
  async ensureLabel(scope: ScopeName, targetId: string): Promise<void> {
    switch (scope) {
      case 'organization':
        if (!this.orgLabels.has(targetId)) {
          const org = await this.api.getOrganization(targetId);
          this.orgLabels.set(targetId, org?.title || org?.path || shortId(targetId));
        }
        break;
      case 'course_family':
        if (!this.familyLabels.has(targetId)) {
          const fam = await this.api.getCourseFamily(targetId);
          this.familyLabels.set(targetId, fam?.title || fam?.path || shortId(targetId));
        }
        break;
      case 'course':
        if (!this.courseLabels.has(targetId)) {
          const course = await this.api.getCourse(targetId);
          this.courseLabels.set(targetId, course?.title || course?.path || shortId(targetId));
        }
        break;
      case 'course_content':
        if (!this.contentLabels.has(targetId)) {
          const content = await this.api.getCourseContent(targetId);
          if (content) {
            if (content.course_id) {
              this.parentCourse.set(`course_content:${targetId}`, content.course_id);
            }
            const courseLabel = content.course_id
              ? await this.ensureCourseLabel(content.course_id)
              : undefined;
            this.contentLabels.set(targetId, {
              title: content.title || content.path || shortId(targetId),
              subtitle: courseLabel
            });
          } else {
            this.contentLabels.set(targetId, { title: shortId(targetId) });
          }
        }
        break;
      case 'course_group':
        if (!this.groupLabels.has(targetId)) {
          const group = await this.api.getCourseGroup(targetId);
          if (group) {
            if (group.course_id) {
              this.parentCourse.set(`course_group:${targetId}`, group.course_id);
            }
            const courseLabel = group.course_id
              ? await this.ensureCourseLabel(group.course_id)
              : undefined;
            this.groupLabels.set(targetId, {
              title: group.title || `Group ${shortId(targetId)}`,
              subtitle: courseLabel
            });
          } else {
            this.groupLabels.set(targetId, { title: `Group ${shortId(targetId)}` });
          }
        }
        break;
      case 'course_member':
        if (!this.memberLabels.has(targetId)) {
          const member = await this.api.getCourseMember(targetId);
          if (member) {
            if (member.course_id) {
              this.parentCourse.set(`course_member:${targetId}`, member.course_id);
            }
            const user = (member as any).user;
            const name = user
              ? `${user.given_name || ''} ${user.family_name || ''}`.trim() || user.username || user.email
              : `Member ${shortId(targetId)}`;
            const courseLabel = member.course_id
              ? await this.ensureCourseLabel(member.course_id)
              : undefined;
            this.memberLabels.set(targetId, { title: name, subtitle: courseLabel });
          } else {
            this.memberLabels.set(targetId, { title: `Member ${shortId(targetId)}` });
          }
        }
        break;
      default:
        // user / submission_group / global: derived from the messages inline
        // by `label()` — there is no standalone entity to fetch.
        break;
    }
  }

  /**
   * The display label for a target, from cache.
   *
   * `messages` is only consulted for the scopes with no fetchable entity: a
   * submission group names itself after the assignment it belongs to, and a
   * DM names itself after the other participant.
   */
  label(
    scope: ScopeName,
    targetId: string | null,
    messages: MessageList[] = [],
    currentUserId?: string
  ): TargetLabel {
    switch (scope) {
      case 'global':
        return { title: 'Global Announcements' };
      case 'organization':
        return {
          title: targetId ? this.orgLabels.get(targetId) || shortId(targetId) : 'Organization'
        };
      case 'course_family':
        return {
          title: targetId ? this.familyLabels.get(targetId) || shortId(targetId) : 'Course Family'
        };
      case 'course': {
        const ctx = messageContextOf(messages);
        const fromContext = ctx?.course_id === targetId ? ctx?.course_title ?? undefined : undefined;
        return {
          title: targetId ? this.courseLabels.get(targetId) || fromContext || shortId(targetId) : 'Course'
        };
      }
      case 'course_content': {
        const info = targetId ? this.contentLabels.get(targetId) : undefined;
        const ctx = messageContextOf(messages);
        const fromContext = ctx?.course_content_id === targetId ? ctx?.course_content_title ?? undefined : undefined;
        return {
          title: info?.title || fromContext || (targetId ? shortId(targetId) : 'Course Content'),
          subtitle: info?.subtitle ?? (fromContext ? ctx?.course_title ?? undefined : undefined)
        };
      }
      case 'course_group': {
        const info = targetId ? this.groupLabels.get(targetId) : undefined;
        const ctx = messageContextOf(messages);
        const fromContext = ctx?.course_group_id === targetId ? ctx?.course_group_title ?? undefined : undefined;
        return {
          title: info?.title || fromContext || (targetId ? `Group ${shortId(targetId)}` : 'Course Group'),
          subtitle: info?.subtitle ?? (fromContext ? ctx?.course_title ?? undefined : undefined)
        };
      }
      case 'course_member': {
        const info = targetId ? this.memberLabels.get(targetId) : undefined;
        return {
          title: info?.title || (targetId ? `Member ${shortId(targetId)}` : 'Course Member'),
          subtitle: info?.subtitle
        };
      }
      case 'submission_group': {
        // Prefer the server-resolved context (issue #322 §1): the reader's
        // own group is named after the assignment; anyone else — a tutor —
        // sees who the conversation is with as well.
        const ctx = messageContextOf(messages);
        if (ctx) {
          const contentTitle = ctx.course_content_title
            || (ctx.course_content_id ? this.contentLabels.get(ctx.course_content_id)?.title : undefined);
          const members = ctx.submission_group_members ?? [];
          const isMember = Boolean(
            currentUserId && members.some(m => m.user_id === currentUserId)
          );
          if (isMember && contentTitle) {
            return { title: contentTitle };
          }
          const groupName = ctx.submission_group_display_name
            || members
              .map(m => `${m.given_name ?? ''} ${m.family_name ?? ''}`.trim())
              .find(Boolean);
          if (!isMember && groupName) {
            return {
              title: contentTitle ? `${groupName} — ${contentTitle}` : groupName,
              subtitle: ctx.course_title ?? undefined
            };
          }
          if (contentTitle) {
            return { title: contentTitle };
          }
        }
        // Fallback for messages without context (older backend): the linked
        // course_content, when the single-target invariant left it set.
        const contentId = messages[0]?.course_content_id;
        const contentLabel = contentId ? this.contentLabels.get(contentId)?.title : undefined;
        return {
          title: contentLabel
            || (targetId ? `Submission Group ${shortId(targetId)}` : 'Submission Group')
        };
      }
      case 'user': {
        // A DM is named after the other person, picked out of the messages.
        const other = messages
          .map(m => m.author)
          .find(a => a && currentUserId && (a as any).id !== currentUserId);
        if (other) {
          const name = `${other.given_name || ''} ${other.family_name || ''}`.trim()
            || (other as any).username
            || (other as any).email
            || (targetId ? shortId(targetId) : 'User');
          return { title: name };
        }
        return { title: targetId ? `User ${shortId(targetId)}` : 'User' };
      }
      default:
        return { title: targetId ? shortId(targetId) : 'Messages' };
    }
  }

  /**
   * Pre-resolve every label a grouped message set will need.
   *
   * Submission-group rows label themselves from their linked course_content,
   * so those ids are resolved too — otherwise the title falls back to a raw
   * "Submission Group <shortId>".
   */
  async prefetch(grouped: Map<ScopeName, Map<string, MessageList[]>>): Promise<void> {
    // Seed the caches from the server-resolved contexts first — for enriched
    // messages every name is already on the wire, so the per-target fetches
    // below become cache hits instead of API calls.
    for (const [scope, byTarget] of grouped) {
      for (const [targetId, msgs] of byTarget) {
        for (const m of msgs) {
          this.seedFromContext(m.context ?? undefined);
        }
        if (targetId !== '__none__') {
          const courseId = messageContextOf(msgs)?.course_id;
          if (courseId) {
            this.parentCourse.set(`${scope}:${targetId}`, courseId);
          }
        }
      }
    }

    const tasks: Promise<unknown>[] = [];
    for (const [scope, byTarget] of grouped) {
      for (const [targetId, msgs] of byTarget) {
        if (targetId !== '__none__') {
          tasks.push(this.ensureLabel(scope, targetId).catch(() => undefined));
        }
        if (scope === 'submission_group') {
          const seen = new Set<string>();
          for (const m of msgs) {
            if (m.context?.course_content_title) { continue; }
            const contentId = m.course_content_id;
            if (typeof contentId === 'string' && contentId && !seen.has(contentId)) {
              seen.add(contentId);
              tasks.push(this.ensureLabel('course_content', contentId).catch(() => undefined));
            }
          }
        }
      }
    }
    await Promise.all(tasks);
  }

  /** Copy whatever names a message context carries into the label caches. */
  private seedFromContext(ctx: MessageContext | undefined): void {
    if (!ctx) { return; }
    if (ctx.course_id && ctx.course_title && !this.courseLabels.has(ctx.course_id)) {
      this.courseLabels.set(ctx.course_id, ctx.course_title);
    }
    if (ctx.course_content_id && ctx.course_content_title && !this.contentLabels.has(ctx.course_content_id)) {
      this.contentLabels.set(ctx.course_content_id, {
        title: ctx.course_content_title,
        subtitle: ctx.course_title ?? undefined
      });
      if (ctx.course_id) {
        this.parentCourse.set(`course_content:${ctx.course_content_id}`, ctx.course_id);
      }
    }
    if (ctx.course_group_id && ctx.course_group_title && !this.groupLabels.has(ctx.course_group_id)) {
      this.groupLabels.set(ctx.course_group_id, {
        title: ctx.course_group_title,
        subtitle: ctx.course_title ?? undefined
      });
      if (ctx.course_id) {
        this.parentCourse.set(`course_group:${ctx.course_group_id}`, ctx.course_id);
      }
    }
  }
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
