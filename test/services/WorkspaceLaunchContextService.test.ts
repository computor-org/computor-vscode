import { expect } from 'chai';
import { trackTree } from '../../src/ui/treeRestore';
import { StudentCourseContentTreeProvider } from '../../src/ui/tree/student/StudentCourseContentTreeProvider';
import {
  WorkspaceLaunchContext,
  WorkspaceLaunchContextService,
  findWorkspaceLaunchTarget,
  workspaceLaunchContent,
  workspaceLaunchIdentity
} from '../../src/services/WorkspaceLaunchContextService';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const request = (requestId = 'launch-1', courseId = 'course-1'): WorkspaceLaunchContext => ({
  course_id: courseId,
  request_id: requestId,
  expires_at: new Date(NOW + 60_000).toISOString()
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('workspaceLaunchIdentity', () => {
  it('uses the workspace owner and server name without falling back to unrelated environment variables', () => {
    expect(workspaceLaunchIdentity({
      COMPUTOR_WORKSPACE_OWNER: 'student',
      COMPUTOR_WORKSPACE_NAME: 'workspace-2',
      USER: 'root'
    })).to.deep.equal({ owner: 'student', name: 'workspace-2' });
    expect(workspaceLaunchIdentity({ USER: 'student', JUPYTERHUB_USER: 'student' })).to.equal(undefined);
  });

  it('requires both nonblank workspace identity fields', () => {
    for (const env of [
      {},
      { COMPUTOR_WORKSPACE_OWNER: 'student' },
      { COMPUTOR_WORKSPACE_NAME: 'workspace-2' },
      { COMPUTOR_WORKSPACE_OWNER: ' ', COMPUTOR_WORKSPACE_NAME: 'workspace-2' },
      { COMPUTOR_WORKSPACE_OWNER: 'student', COMPUTOR_WORKSPACE_NAME: '\t' }
    ]) {
      expect(workspaceLaunchIdentity(env)).to.equal(undefined);
    }
  });
});

describe('WorkspaceLaunchContextService', () => {
  const services: WorkspaceLaunchContextService[] = [];

  function service(
    fetchContext: () => Promise<WorkspaceLaunchContext | null>,
    openCourse: (id: string, courseContentId?: string | null) => Promise<boolean>,
    intervalMs = 10
  ): WorkspaceLaunchContextService {
    const value = new WorkspaceLaunchContextService({ fetchContext, openCourse, now: () => NOW, intervalMs });
    services.push(value);
    return value;
  }

  afterEach(() => { services.splice(0).forEach(value => value.dispose()); });

  it('opens a valid requested course once without stealing focus again on subsequent polls', async () => {
    const opened: string[] = [];
    const value = service(async () => request(), async id => { opened.push(id); return true; });

    await value.poll();
    // A student may select a different course between polls. The unchanged
    // launch request must not undo that manual selection.
    await value.poll();
    await value.poll();

    expect(opened).to.deep.equal(['course-1']);
  });

  it('handles a fresh launch request even when it targets the same course', async () => {
    let context = request();
    const opened: string[] = [];
    const value = service(async () => context, async id => { opened.push(id); return true; });

    await value.poll();
    context = request('launch-2');
    await value.poll();
    context = request('launch-3', 'course-2');
    await value.poll();

    expect(opened).to.deep.equal(['course-1', 'course-1', 'course-2']);
  });

  it('forwards exact material intents once, including repeated clicks, another assignment and a unit', async () => {
    let context: WorkspaceLaunchContext = { ...request(), course_content_id: 'exercise-1' };
    const opened: Array<[string, string | null | undefined]> = [];
    const value = service(async () => context, async (courseId, contentId) => {
      opened.push([courseId, contentId]);
      return true;
    });
    await value.poll();
    await value.poll();
    context = { ...request('launch-2'), course_content_id: 'exercise-1' };
    await value.poll();
    context = { ...request('launch-3'), course_content_id: 'exercise-2' };
    await value.poll();
    context = { ...request('launch-4'), course_content_id: 'unit-1' };
    await value.poll();
    expect(opened).to.deep.equal([
      ['course-1', 'exercise-1'], ['course-1', 'exercise-1'], ['course-1', 'exercise-2'], ['course-1', 'unit-1']
    ]);
  });

  it('preserves course-only launches with omitted or null exercise targets', async () => {
    let context = request();
    const opened: Array<string | null | undefined> = [];
    const value = service(async () => context, async (_courseId, contentId) => {
      opened.push(contentId);
      return true;
    });
    await value.poll();
    context = { ...request('launch-2'), course_content_id: null };
    await value.poll();
    expect(opened).to.deep.equal([undefined, null]);
  });

  it('ignores malformed exercise targets instead of degrading them to course-only launches', async () => {
    const contexts = ['', ' ', 42, {}, false].map((course_content_id, index) => ({
      ...request(`invalid-${index}`), course_content_id
    }));
    const opened: string[] = [];
    const value = service(async () => contexts.shift() as WorkspaceLaunchContext | null, async id => {
      opened.push(id);
      return true;
    });
    for (let index = 0; index < 5; index++) await value.poll();
    expect(opened).to.deep.equal([]);
  });

  it('remembers older consumed requests when a server response returns to an earlier request', async () => {
    let context = request();
    const opened: string[] = [];
    const value = service(async () => context, async id => { opened.push(id); return true; });

    await value.poll();
    context = request('launch-2', 'course-2');
    await value.poll();
    context = request();
    await value.poll();

    expect(opened).to.deep.equal(['course-1', 'course-2']);
  });

  it('refreshes the launch language before opening each new course intent', async () => {
    let context: WorkspaceLaunchContext = { ...request(), ui_language: 'de' };
    const actions: string[] = [];
    const value = new WorkspaceLaunchContextService({
      fetchContext: async () => context,
      now: () => NOW,
      onLaunch: async () => { actions.push(`language:${context.ui_language}`); },
      openCourse: async id => { actions.push(`open:${id}`); return true; }
    });
    services.push(value);
    await value.poll();
    await value.poll();
    context = { ...request('launch-2'), ui_language: 'en' };
    await value.poll();
    expect(actions).to.deep.equal(['language:de', 'open:course-1', 'language:en', 'open:course-1']);
  });

  it('does not overlap context fetches', async () => {
    const fetched = deferred<WorkspaceLaunchContext | null>();
    let fetches = 0;
    const opened: string[] = [];
    const value = service(async () => { fetches++; return fetched.promise; }, async id => { opened.push(id); return true; });

    const first = value.poll();
    const second = value.poll();
    fetched.resolve(request());
    await Promise.all([first, second]);

    expect(fetches).to.equal(1);
    expect(opened).to.deep.equal(['course-1']);
  });

  it('keeps course opening serialized until the previous open finishes', async () => {
    const opening = deferred<boolean>();
    let context = request();
    const opened: string[] = [];
    const value = service(async () => context, async id => { opened.push(id); return opening.promise; });

    const first = value.poll();
    await new Promise<void>(resolve => setImmediate(resolve));
    context = request('launch-2', 'course-2');
    const second = value.poll();
    opening.resolve(true);
    await Promise.all([first, second]);
    expect(opened).to.deep.equal(['course-1']);

    await value.poll();
    expect(opened).to.deep.equal(['course-1', 'course-2']);
  });

  it('ignores absent, expired and malformed requests while allowing a subsequent valid request', async () => {
    const contexts: unknown[] = [
      null,
      {},
      { ...request(), course_id: '' },
      { ...request(), course_id: ' ' },
      { ...request(), request_id: '' },
      { ...request(), request_id: ' ' },
      { ...request(), expires_at: 'not a date' },
      { ...request(), expires_at: new Date(NOW - 1).toISOString() },
      { ...request(), expires_at: new Date(NOW).toISOString() },
      { ...request(), ui_language: 'fr' },
      { ...request(), ui_language: 'de-DE' },
      { ...request(), ui_language: '' },
      { ...request(), ui_language: 0 },
      request()
    ];
    const opened: string[] = [];
    const value = service(async () => contexts.shift() as WorkspaceLaunchContext | null, async id => { opened.push(id); return true; });

    const count = contexts.length;
    for (let i = 0; i < count; i++) { await value.poll(); }

    expect(opened).to.deep.equal(['course-1']);
  });

  it('consumes an unavailable course request instead of retrying it on every poll', async () => {
    let context = request();
    const opened: string[] = [];
    const value = service(async () => context, async id => { opened.push(id); return false; });

    await value.poll();
    await value.poll();
    context = request('launch-2', 'course-2');
    await value.poll();

    expect(opened).to.deep.equal(['course-1', 'course-2']);
  });

  it('recovers from a transient fetch error without rejecting its poll', async () => {
    let fetches = 0;
    const opened: string[] = [];
    const value = service(async () => {
      if (++fetches === 1) { throw new Error('session reconnecting'); }
      return request();
    }, async id => { opened.push(id); return true; });

    await value.poll();
    await value.poll();

    expect(opened).to.deep.equal(['course-1']);
  });

  it('handles an opening error safely and still accepts a later new request', async () => {
    let context = request();
    const opened: string[] = [];
    const value = service(async () => context, async id => {
      opened.push(id);
      if (id === 'course-1') { throw new Error('course service unavailable'); }
      return true;
    });

    await value.poll();
    context = request('launch-2', 'course-2');
    await value.poll();

    expect(opened).to.deep.equal(['course-1', 'course-2']);
  });

  it('retries the same request after a transient opening failure and consumes it only after success', async () => {
    let attempts = 0;
    const value = service(async () => request(), async () => {
      if (++attempts === 1) throw new Error('temporary connection loss');
      return true;
    });
    await value.poll();
    await value.poll();
    await value.poll();
    expect(attempts).to.equal(2);
  });

  it('bounds retries for an opening that keeps failing', async () => {
    let attempts = 0;
    const value = service(async () => request(), async () => { attempts++; throw new Error('offline'); });
    for (let index = 0; index < 8; index++) await value.poll();
    expect(attempts).to.equal(5);
  });

  it('does not open a course if disposed while its context fetch is pending', async () => {
    const fetched = deferred<WorkspaceLaunchContext | null>();
    const opened: string[] = [];
    const value = service(async () => fetched.promise, async id => { opened.push(id); return true; });

    const polling = value.poll();
    value.dispose();
    fetched.resolve(request());
    await polling;
    await value.poll();

    expect(opened).to.deep.equal([]);
  });

  it('polls immediately on start, starts only one timer, and cancels it on dispose', async () => {
    const realSetInterval = global.setInterval;
    const realClearInterval = global.clearInterval;
    let timerCallback: (() => void) | undefined;
    let timers = 0;
    let cancelled = 0;
    const timer = {} as NodeJS.Timeout;
    global.setInterval = ((callback: () => void) => {
      timers++;
      timerCallback = callback;
      return timer;
    }) as typeof setInterval;
    global.clearInterval = ((handle: NodeJS.Timeout) => {
      expect(handle).to.equal(timer);
      cancelled++;
    }) as typeof clearInterval;
    let fetches = 0;
    try {
      const value = service(async () => { fetches++; return request(); }, async () => true);
      value.start();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(fetches).to.equal(1);
      value.start();
      expect(timers).to.equal(1);
      timerCallback!();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(fetches).to.equal(2);

      value.dispose();
      timerCallback!();
      value.start();
      await value.poll();
      expect(fetches).to.equal(2);
      expect(cancelled).to.equal(1);
    } finally {
      global.setInterval = realSetInterval;
      global.clearInterval = realClearInterval;
    }
  });
});

describe('native workspace launch target resolution', () => {
  function fixture() {
    const expanded: string[] = [];
    const content = (id: string, kind: string, path: string, extra = {}) => ({
      id, path, title: id, course_id: 'course-1', course_content_kind_id: kind,
      course_content_type: { id: kind, course_content_kind_id: kind }, position: 1,
      visible_effective: true, ...extra
    });
    const contents = [
      content('welcome-1', 'unit', 'welcome', { description: '# Authored welcome' }),
      content('unit-1', 'unit', 'week_1', { description: '# Week instructions' }),
      content('exercise-1', 'assignment', 'week_1.exercise_1'),
      content('exercise-2', 'assignment', 'week_1.exercise_2'),
      content('reading-1', 'reading', 'reading'),
      content('hidden-1', 'assignment', 'hidden', { visible_effective: false }),
      content('foreign-1', 'assignment', 'foreign', { course_id: 'course-2' })
    ];
    const api = {
      getStudentCourses: async () => [
        { id: 'course-1', title: 'Course 1', path: 'one' },
        { id: 'course-2', title: 'Course 2', path: 'two' }
      ],
      getStudentCourseContents: async () => contents,
      getCourseContentKinds: async () => [
        { id: 'unit', has_descendants: true }, { id: 'assignment', has_descendants: false }
      ],
      getCourseGitDescriptor: async () => ({ configured: false })
    };
    const tree = new StudentCourseContentTreeProvider(api as any, { getCurrentCourseId: () => undefined } as any);
    const getChildren = tree.getChildren.bind(tree);
    tree.getChildren = async element => {
      if ((element as any)?.courseId) expanded.push((element as any).courseId);
      return getChildren(element);
    };
    const tracked = trackTree(tree);
    return { tracked, expanded };
  }

  it('resolves exact assignment and unit identities through the native provider without descending sibling courses', async () => {
    const { tracked, expanded } = fixture();
    try {
      const assignment = await findWorkspaceLaunchTarget(tracked, 'course-1', 'exercise-2');
      const unit = await findWorkspaceLaunchTarget(tracked, 'course-1', 'unit-1');
      const welcome = await findWorkspaceLaunchTarget(tracked, 'course-1', 'welcome-1');
      expect(workspaceLaunchContent(assignment)?.id).to.equal('exercise-2');
      expect(workspaceLaunchContent(unit)?.id).to.equal('unit-1');
      expect((unit as any).command).to.equal(undefined);
      expect((welcome as any).command?.command).to.equal('computor.student.previewDescription');
      expect(expanded).not.to.include('course-2');
      expect(tracked.find('exercise-2')).to.equal(assignment);
    } finally { tracked.dispose(); }
  });

  it('does not substitute another assignment for a missing, hidden, foreign or unsupported target', async () => {
    const { tracked, expanded } = fixture();
    try {
      for (const id of ['missing', 'hidden-1', 'foreign-1', 'reading-1']) {
        expect(await findWorkspaceLaunchTarget(tracked, 'course-1', id)).to.equal(undefined);
      }
      expect(expanded).not.to.include('course-2');
    } finally { tracked.dispose(); }
  });
});
