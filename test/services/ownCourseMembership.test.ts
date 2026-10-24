import { expect } from 'chai';
import { ComputorApiService } from '../../src/services/ComputorApiService';

describe('authenticated course question membership', () => {
  function fixture(rows: any[], userId: string | undefined = 'me') {
    const requests: any[] = [];
    const api = Object.create(ComputorApiService.prototype) as any;
    api.getCurrentUser = async () => userId ? { id: userId } : undefined;
    api.getHttpClient = async () => ({
      get: async (url: string, query: any) => {
        requests.push({ url, query });
        return { data: rows };
      }
    });
    return { api, requests };
  }

  it('requests only the authenticated user in the requested course', async () => {
    const member = { id: 'own-member', user_id: 'me', course_id: 'course' };
    const { api, requests } = fixture([member]);
    expect(await api.getOwnCourseMember('course')).to.equal(member);
    expect(requests).to.deep.equal([{
      url: '/course-members', query: { course_id: 'course', user_id: 'me', limit: 1 }
    }]);
  });

  for (const [reason, rows] of [
    ['missing membership', []],
    ['another course', [{ id: 'member', user_id: 'me', course_id: 'other' }]],
    ['another user', [{ id: 'member', user_id: 'other', course_id: 'course' }]],
    ['missing member ID', [{ id: '', user_id: 'me', course_id: 'course' }]]
  ] as Array<[string, any[]]>) {
    it(`rejects ${reason}`, async () => {
      const { api } = fixture(rows);
      expect(await api.getOwnCourseMember('course')).to.equal(undefined);
    });
  }

  it('does not query membership without authenticated identity', async () => {
    const { api, requests } = fixture([], '');
    expect(await api.getOwnCourseMember('course')).to.equal(undefined);
    expect(requests).to.be.empty;
  });
});
