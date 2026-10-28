import { ComputorApiService } from './ComputorApiService';
import { MessageTargetContext } from '../ui/webviews/MessagesWebviewProvider';
import { MESSAGE_TARGET_FIELDS } from '../types/generated/constants';
import { MentionableQuery } from '../types/generated';

export interface TutorAgentInfo {
  /** User id of Lena in this scope, if the server knows a tutor agent. */
  id?: string;
  /** Whether a student's message without an @mention is sent to Lena. */
  routesUnaddressed: boolean;
}

// The backend routes only student messages in conversations (assignment and
// course-question threads) of courses with tutor_agent_auto_route.
const routedFields = ['submission_group_id', 'course_member_id'];

/**
 * Who Lena is in a message target, and whether an unaddressed message goes
 * to her. Learners must see before sending that an AI receives the message.
 */
export async function resolveTutorAgent(
  api: ComputorApiService,
  target: MessageTargetContext | undefined
): Promise<TutorAgentInfo> {
  const payload = (target?.createPayload ?? {}) as Record<string, unknown>;
  const field = MESSAGE_TARGET_FIELDS.find((f) => typeof payload[f] === 'string' && payload[f]);
  if (!target || !field) {
    return { routesUnaddressed: false };
  }
  const [users, course] = await Promise.all([
    api.getMentionableUsers({ [field]: payload[field], search: 'lena', limit: 20 } as MentionableQuery)
      .catch(() => []),
    target.courseId ? api.getCourse(target.courseId) : Promise.resolve(undefined)
  ]);
  // The server advertises the tutor handles only on the tutor agent.
  const id = users.find((u) => Array.isArray(u.aliases) && u.aliases.length > 0)?.id;
  const routesUnaddressed = Boolean(
    id &&
    target.sourceRole === 'student' &&
    routedFields.includes(field) &&
    (course as { tutor_agent_auto_route?: boolean } | undefined)?.tutor_agent_auto_route
  );
  return { id, routesUnaddressed };
}
