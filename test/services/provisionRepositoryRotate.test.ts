import { expect } from 'chai';
import * as vscode from 'vscode';

import { ComputorApiService } from '../../src/services/ComputorApiService';

/**
 * The managed-Forgejo clone token is per user and per git server, so the backend
 * mints it once and hands the same one back on later provision calls — anything
 * else invalidates the credential embedded in the student's existing clones
 * (computor-org/issues#332). `rotate=true` is the deliberate exception, used
 * only where a credential is known-broken; dropping it there would make the
 * self-heal request the same dead token forever, so the wire format is pinned
 * here.
 */
describe('provisionStudentRepository rotate flag', () => {
  let posted: string[];
  let api: ComputorApiService;

  beforeEach(() => {
    posted = [];
    const httpClient: any = {
      post: async (url: string) => {
        posted.push(url);
        return { data: { id: 'r-1', course_member_id: 'cm-1', mode: 'managed' } };
      }
    };
    api = new ComputorApiService({ subscriptions: [] } as unknown as vscode.ExtensionContext, httpClient);
  });

  it('does not rotate by default — the stored token keeps every clone working', async () => {
    await api.provisionStudentRepository('course-1');

    expect(posted).to.deep.equal(['/user/courses/course-1/provision-repository']);
  });

  it('asks for rotation only when explicitly requested', async () => {
    await api.provisionStudentRepository('course-1', { rotate: true });

    expect(posted).to.deep.equal(['/user/courses/course-1/provision-repository?rotate=true']);
  });

  it('treats rotate:false like the default', async () => {
    await api.provisionStudentRepository('course-1', { rotate: false });

    expect(posted[0]).to.not.include('rotate');
  });
});
