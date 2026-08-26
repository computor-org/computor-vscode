import { expect } from 'chai';
import { LecturerTreeDataProvider } from '../../src/ui/tree/lecturer/LecturerTreeDataProvider';

/**
 * A created unit stayed invisible until the window was reloaded
 * (computor-org/issues#162).
 *
 * Two things were missing after the POST: the API cache still held the
 * pre-create content list, and the tree refresh was conditional on finding the
 * parent inside that very list -- which is read *before* the create, so for a
 * root-level unit the branch simply never fired. `createAssignment` masked it
 * by calling `forceRefreshCourse` itself; `createUnit` did not, which is
 * exactly the reported flow.
 */
describe('lecturer create content refresh', () => {
  function makeProvider(existing: Array<{ path: string }> = []) {
    const cacheCleared: string[] = [];
    const fired: Array<unknown> = [];

    const provider = Object.create(LecturerTreeDataProvider.prototype) as any;
    provider.apiService = {
      createCourseContent: async (_courseId: string, data: any) => ({ id: 'new-id', ...data }),
      clearCourseCache: (courseId: string) => { cacheCleared.push(courseId); }
    };
    provider.onDidChangeTreeDataEmitter = { fire: (element: unknown) => { fired.push(element); } };
    provider.getCourseContents = async () => existing;

    const folderItem = { course: { id: 'course-1' } } as any;
    return { provider, folderItem, cacheCleared, fired };
  }

  it('drops the course cache and refreshes when a root-level unit is created', async () => {
    const { provider, folderItem, cacheCleared, fired } = makeProvider();

    const created = await provider.createCourseContent(
      folderItem, 'Week 1', 'type-lecture', undefined, 'week_1', undefined
    );

    expect(created?.id).to.equal('new-id');
    expect(cacheCleared).to.include('course-1');
    // undefined = refresh the whole tree; the new node has no tree item yet.
    expect(fired).to.deep.equal([undefined]);
  });

  it('refreshes a child create too, whether or not the parent is in the stale list', async () => {
    const { provider, folderItem, cacheCleared, fired } = makeProvider([{ path: 'other_unit' }]);

    await provider.createCourseContent(
      folderItem, 'Task 1', 'type-assignment', 'week_1', 'task_1', undefined
    );

    expect(cacheCleared).to.include('course-1');
    expect(fired).to.deep.equal([undefined]);
  });

  it('returns undefined when the create fails, so the caller can stay quiet', async () => {
    const { provider, folderItem } = makeProvider();
    provider.apiService.createCourseContent = async () => { throw new Error('boom'); };

    const created = await provider.createCourseContent(
      folderItem, 'Week 1', 'type-lecture', undefined, 'week_1', undefined
    );

    expect(created).to.equal(undefined);
  });

  it('refuses a path that already exists without calling the API', async () => {
    const { provider, folderItem, cacheCleared } = makeProvider([{ path: 'week_1' }]);
    let posted = false;
    provider.apiService.createCourseContent = async () => { posted = true; return {}; };

    const created = await provider.createCourseContent(
      folderItem, 'Week 1', 'type-lecture', undefined, 'week_1', undefined
    );

    expect(created).to.equal(undefined);
    expect(posted).to.equal(false);
    expect(cacheCleared).to.deep.equal([]);
  });
});
