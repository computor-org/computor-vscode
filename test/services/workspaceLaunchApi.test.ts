import { expect } from 'chai';
import { ComputorApiService } from '../../src/services/ComputorApiService';
import { HttpError } from '../../src/exceptions/errors/HttpError';

describe('workspace launch API', () => {
  it('requests fresh launch context on the authenticated instance and escapes path segments', async () => {
    const urls: string[] = [];
    let requestId = 0;
    const api = new ComputorApiService({} as any, {
      get: async (url: string) => { urls.push(url); return { data: { request_id: ++requestId } }; }
    } as any);
    expect((await api.getWorkspaceLaunchContext('owner/name', 'Python work'))?.request_id).to.equal(1);
    expect((await api.getWorkspaceLaunchContext('owner/name', 'Python work'))?.request_id).to.equal(2);
    expect(urls).to.deep.equal([
      '/coder/workspaces/owner%2Fname/Python%20work/launch-context',
      '/coder/workspaces/owner%2Fname/Python%20work/launch-context'
    ]);
  });

  it('preserves the ordinary view for unsupported, expired or unauthorized launch endpoints', async () => {
    for (const status of [401, 403, 404, 410]) {
      const api = new ComputorApiService({} as any, {
        get: async () => { throw new HttpError('Unavailable', status, 'Unavailable'); }
      } as any);
      expect(await api.getWorkspaceLaunchContext('student', 'python')).to.equal(null);
    }
  });

  it('uses the student description endpoint without a tutor permission or cloning call', async () => {
    const archive = Buffer.from('instructions');
    const urls: string[] = [];
    const api = new ComputorApiService({} as any, {
      getBuffer: async (url: string) => { urls.push(url); return archive; }
    } as any);
    expect(await api.downloadStudentCourseContentDescription('content/id')).to.equal(archive);
    expect(urls).to.deep.equal(['/students/course-contents/content%2Fid/description']);
  });

  it('allows transient course-list and content failures to reach the launch retry controller', async () => {
    const api = new ComputorApiService({} as any);
    const failure = new Error('Network unavailable');
    (api as any).cachedRequest = async () => { throw failure; };
    for (const call of [
      () => api.getStudentCourses({ throwOnError: true }),
      () => api.getStudentCourseContents('course', { throwOnError: true })
    ]) {
      let caught: unknown;
      try { await call(); } catch (error) { caught = error; }
      expect(caught).to.equal(failure);
    }
    expect(await api.getStudentCourses()).to.deep.equal([]);
    expect(await api.getStudentCourseContents('course')).to.deep.equal([]);
  });
});
