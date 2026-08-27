import { ComputorApiService } from '../../services/ComputorApiService';

/**
 * Whose result the Results panel is about to show.
 *
 * The panel holds exactly one payload, so this has to be decided before any
 * request goes out. `GET /students/course-contents/{id}` answers for whoever
 * is signed in, and a tutor is usually a course member with a result of their
 * own; asking it for "the latest result" while looking at someone else's
 * assignment put the tutor's own passing run in the panel while the tree kept
 * showing the student's real percentage (computor-org/issues#389).
 */
export type ResultScope =
  /** The signed-in user's own assignment - the student view. */
  | { kind: 'self' }
  /** Someone else's assignment, seen as staff - the tutor view. */
  | { kind: 'member'; memberId?: string };

export interface ResolvedResult {
  resultPayload?: any;
  resultId?: string;
  resultArtifacts?: any[];
}

/**
 * Read the scope off the tree item the command was handed.
 *
 * Only the tutor tree carries a `memberId` (TutorContentItem); the student
 * tree has no such property, so the two views cannot be confused. An item that
 * looks like the tutor tree but carries no member id still stays in the member
 * scope with nothing to fetch: an empty panel beats the tutor's own run
 * standing in for a student's.
 */
export function resultScopeFor(item: any): ResultScope {
  const memberId = typeof item?.memberId === 'string' ? item.memberId : undefined;
  const contextValue = typeof item?.contextValue === 'string' ? item.contextValue : '';
  if (memberId || contextValue.startsWith('tutorStudentContent')) {
    return { kind: 'member', memberId };
  }
  return { kind: 'self' };
}

/**
 * Where the panel persists a payload so it survives a workspace restart (#273).
 *
 * Only the self scope gets one. A staff payload belongs to the member being
 * looked at, and the key here names the course content alone - caching it
 * replayed the previously opened student's results for the next student who
 * had none (#389).
 */
export function resultCacheKey(scope: ResultScope, courseContentId?: string): string | undefined {
  if (scope.kind !== 'self' || !courseContentId) {
    return undefined;
  }
  return `testResults:${courseContentId}`;
}

/**
 * Ask the endpoint that answers for `scope`, and only that one.
 *
 * Returns undefined when the scope has nothing to show - including when a
 * member scope has no member id to ask about. Falling through to the other
 * scope's endpoint is exactly the bug this module exists to prevent.
 */
async function fetchScopedResult(
  api: ComputorApiService,
  scope: ResultScope,
  courseContentId: string
): Promise<any | undefined> {
  if (scope.kind === 'member') {
    if (!scope.memberId) {
      return undefined;
    }
    const content = await api.getTutorMemberCourseContent(scope.memberId, courseContentId, { force: true });
    return content?.result ?? undefined;
  }

  const content = await api.getStudentCourseContent(courseContentId, { force: true });
  return content?.result ?? undefined;
}

/**
 * Resolve the payload the Results panel should render for one assignment.
 *
 * `itemResult` is the result the tree item already carries. It is a same-scope
 * fallback - the tutor tree lists a member through the tutor endpoints and the
 * student tree lists the signed-in user - so using it when the fetch comes back
 * empty keeps a prior run on screen after a restart (#273) without ever
 * crossing between people.
 */
export async function resolveResultPayload(
  api: ComputorApiService,
  scope: ResultScope,
  courseContentId: string | undefined,
  itemResult: any | undefined
): Promise<ResolvedResult> {
  const scopedResult = courseContentId
    ? await fetchScopedResult(api, scope, courseContentId)
    : undefined;
  const rawResult = scopedResult ?? itemResult;

  if (!rawResult) {
    return {};
  }

  const resultId = rawResult.id as string | undefined;
  let resultJson = rawResult.result_json;
  let resultArtifacts = rawResult.result_artifacts;

  // The list DTOs serialize `result` without result_json/result_artifacts, so
  // anything coming off a tree item still needs hydrating. GET /results/{id}
  // always carries both, and staff may read any result in their own courses.
  if (!resultJson && resultId) {
    const fullResult = await api.getResult(resultId);
    if (fullResult) {
      resultJson = fullResult.result_json;
      if (!resultArtifacts?.length) {
        resultArtifacts = fullResult.result_artifacts;
      }
    }
  }

  return { resultPayload: resultJson ?? rawResult, resultId, resultArtifacts };
}
