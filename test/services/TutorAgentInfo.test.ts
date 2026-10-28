import { expect } from 'chai';

import { resolveTutorAgent } from '../../src/services/TutorAgentInfo';
import type { ComputorApiService } from '../../src/services/ComputorApiService';
import type { MessageTargetContext } from '../../src/ui/webviews/MessagesWebviewProvider';

const LENA = { id: 'lena-1', given_name: 'Lena', aliases: ['lena', 'luna', 'ai'] };
const ADA = { id: 'ada-1', given_name: 'Ada', aliases: [] };

/** An API that answers from fixed data, with no network. */
function fakeApi(opts: { users?: unknown[]; autoRoute?: boolean }): ComputorApiService {
  return {
    async getMentionableUsers() { return opts.users ?? [ADA, LENA]; },
    async getCourse() { return { id: 'c-1', tutor_agent_auto_route: opts.autoRoute }; }
  } as unknown as ComputorApiService;
}

const target = (over: Partial<MessageTargetContext> = {}): MessageTargetContext => ({
  title: 'Assignment',
  query: {},
  createPayload: { submission_group_id: 'sg-1' },
  sourceRole: 'student',
  courseId: 'c-1',
  ...over
});

describe('resolveTutorAgent', () => {
  it('finds Lena by her tutor aliases and reports routing for a student thread', async () => {
    const info = await resolveTutorAgent(fakeApi({ autoRoute: true }), target());
    expect(info).to.deep.equal({ id: 'lena-1', routesUnaddressed: true });
  });

  it('does not report routing when the course has it off', async () => {
    const info = await resolveTutorAgent(fakeApi({ autoRoute: false }), target());
    expect(info).to.deep.equal({ id: 'lena-1', routesUnaddressed: false });
  });

  it('does not report routing for staff, who are never routed', async () => {
    const info = await resolveTutorAgent(fakeApi({ autoRoute: true }), target({ sourceRole: 'tutor' }));
    expect(info.routesUnaddressed).to.equal(false);
  });

  it('does not report routing for announcements', async () => {
    const info = await resolveTutorAgent(
      fakeApi({ autoRoute: true }),
      target({ createPayload: { course_content_id: 'cc-1' } })
    );
    expect(info.routesUnaddressed).to.equal(false);
  });

  it('reports neither without a tutor agent in the audience', async () => {
    const info = await resolveTutorAgent(fakeApi({ users: [ADA], autoRoute: true }), target());
    expect(info).to.deep.equal({ id: undefined, routesUnaddressed: false });
  });
});
