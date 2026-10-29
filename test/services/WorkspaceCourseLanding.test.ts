import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import JSZip from 'jszip';
import { beginMarkdownPreviewRequest, showMarkdownTextPreview } from '../../src/ui/webviews/markdownPreview';
import { webviewPanels } from '../helpers/vscode-stub';
import {
  openWorkspaceCourseLaunch, readStudentDescription, showWorkspaceCourseUnit, showCourseWelcomeGuideOnce, showWorkspaceCourseLanding, studentDescriptionImages
} from '../../src/services/WorkspaceCourseLanding';
import { firstReleasedCourseItem } from '../../src/utils/courseStart';
import type { ComputorApiService } from '../../src/services/ComputorApiService';
import type { CourseContentStudentList, CourseStudentList } from '../../src/types/generated';

async function archive(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, contents] of Object.entries(files)) { zip.file(name, contents); }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('readStudentDescription', () => {
  it('opens the preferred description language from the released assignment archive', async () => {
    const zip = await archive({
      'README.md': 'Default description',
      'README_de.md': 'Deutsche Aufgabenstellung',
      'README_en.md': 'English assignment',
      'main.py': 'print(42)'
    });

    expect(await readStudentDescription(zip, 'de')).to.equal('Deutsche Aufgabenstellung');
    expect(await readStudentDescription(zip, 'fr')).to.equal('English assignment');
    expect(await readStudentDescription(zip, null)).to.equal('English assignment');
  });

  it('accepts index descriptions in a single canonical archive folder', async () => {
    const zip = await archive({
      'math-constants/index_de.md': 'Konstanten bestimmen',
      'math-constants/index_en.md': 'Find the constants',
      'math-constants/main.py': 'import math',
      'math-constants/tests/case.py': 'assert True'
    });

    expect(await readStudentDescription(zip, 'de')).to.equal('Konstanten bestimmen');
    expect(await readStudentDescription(zip, 'it')).to.equal('Find the constants');
  });

  it('uses the default description when the preferred and English translations are absent', async () => {
    const zip = await archive({ 'README.md': 'Default', 'README_de.md': 'Deutsch' });
    expect(await readStudentDescription(zip, 'fr')).to.equal('Default');
  });

  it('does not use a dependency README as the assignment description', async () => {
    const zip = await archive({
      'README_en.md': 'The actual assignment',
      'dependencies/tool/README_de.md': 'Unrelated package instructions'
    });
    expect(await readStudentDescription(zip, 'de')).to.equal('The actual assignment');
  });

  it('does not guess between unrelated folders when the archive has no canonical root', async () => {
    const zip = await archive({
      'library-a/README_de.md': 'First package',
      'library-b/README_en.md': 'Second package'
    });
    expect(await readStudentDescription(zip, 'de')).to.equal(undefined);
  });

  it('ignores path traversal entries even if the zip loader normalizes their names', async () => {
    const zip = await archive({
      '../README_de.md': 'Escaped description',
      'folder/../../index_de.md': 'Another escaped description',
      'README_en.md': 'Safe assignment'
    });
    expect(await readStudentDescription(zip, 'de')).to.equal('Safe assignment');
  });

  it('does not treat absolute paths, Windows paths or macOS metadata as assignment descriptions', async () => {
    const zip = await archive({
      '/README_de.md': 'Absolute path',
      '..\\README_de.md': 'Windows traversal',
      '__MACOSX/README_de.md': 'Metadata',
      'README_en.md': 'Safe assignment'
    });
    expect(await readStudentDescription(zip, 'de')).to.equal('Safe assignment');
  });

  it('returns no description for deeply nested readmes or an archive without description files', async () => {
    expect(await readStudentDescription(await archive({
      'example/assets/tool/README.md': 'A package readme',
      'example/main.py': 'pass'
    }))).to.equal(undefined);
    expect(await readStudentDescription(await archive({
      'main.py': 'pass',
      'CHANGELOG.md': 'Changes',
      'notes.md': 'Notes'
    }))).to.equal(undefined);
    expect(await readStudentDescription(await archive({}))).to.equal(undefined);
  });
});

describe('firstReleasedCourseItem', () => {
  function item(id: string, overrides: Partial<CourseContentStudentList> = {}): CourseContentStudentList {
    return {
      id,
      path: id,
      course_id: 'course-1',
      course_content_type_id: 'python',
      course_content_kind_id: 'assignment',
      position: 1,
      course_content_type: { id: 'python', title: 'Python' },
      result_count: 0,
      submission_count: 0,
      color: '#ffffff',
      visible_effective: true,
      deployment: {
        id: `deployment-${id}`,
        course_content_id: id,
        example_version_id: 'version-1',
        deployment_status: 'deployed',
        assigned_at: '2026-10-12T10:00:00Z',
        deployed_at: '2026-10-12T10:01:00Z',
        version_identifier: 'v1'
      },
      ...overrides
    } as CourseContentStudentList;
  }

  it('selects the first visible, released assignment rather than modules or hidden and unreleased exercises', () => {
    const expected = item('second', { position: 2 });
    const contents = [
      item('hidden', { visible_effective: false }),
      item('unreleased', { deployment: null }),
      item('module', { course_content_kind_id: 'unit' }),
      item('later', { position: 3 }),
      expected
    ];
    expect(firstReleasedCourseItem(contents)).to.equal(expected);
  });

  it('sorts a copy of the course contents without changing the visible tree order', () => {
    const later = item('later', { position: 3 });
    const earlier = item('earlier', { position: 1 });
    const contents = [later, earlier];
    expect(firstReleasedCourseItem(contents)).to.equal(earlier);
    expect(contents).to.deep.equal([later, earlier]);
  });

  it('returns no exercise when none are released', () => {
    expect(firstReleasedCourseItem([])).to.equal(undefined);
    expect(firstReleasedCourseItem([item('unreleased', { deployment: null })])).to.equal(undefined);
  });

  it('follows parent unit order before comparing assignment positions in different units', () => {
    const first = item('first', { path: 'intro.second', position: 2 });
    const contents = [
      item('later', { path: 'advanced.first', position: 1 }),
      item('advanced', { path: 'advanced', position: 2, course_content_kind_id: 'unit' }),
      first,
      item('intro', { path: 'intro', position: 1, course_content_kind_id: 'unit' })
    ];
    expect(firstReleasedCourseItem(contents)).to.equal(first);
  });
});

describe('studentDescriptionImages', () => {
  it('keeps relative instruction images readable without writing a repository', async () => {
    const images = await studentDescriptionImages(await archive({
      'mediaFiles/diagram.png': 'png data',
      'assets/figure.svg': '<svg/>',
      'README.md': 'Instructions',
      'solution.py': 'secret',
      '../images/escaped.png': 'outside'
    }));
    expect(images).to.deep.equal({
      'mediaFiles/diagram.png': `data:image/png;base64,${Buffer.from('png data').toString('base64')}`,
      'assets/figure.svg': `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`
    });
  });
});

/** A returning learner lands where they left off, a new one on the first exercise (computor-org/issues#525). */
describe('showWorkspaceCourseLanding', () => {
  const context = { subscriptions: [], extensionUri: vscode.Uri.file(path.resolve(__dirname, '../..')) } as unknown as vscode.ExtensionContext;
  const course = { id: 'course', title: 'Course', path: 'course', description: '# Authored course description' } as CourseStudentList;
  const welcome = { id: 'welcome', course_id: 'course', path: 'welcome', title: 'Welcome', course_content_kind_id: 'unit',
    description: '<!-- lang: de -->\nHallo du\n<!-- lang: en -->\nHello you' } as CourseContentStudentList;
  const api = (contents: CourseContentStudentList[], language = 'en') => ({
    getStudentCourseContents: async () => contents,
    getUserAccount: async () => ({ profile: { language_code: language } })
  }) as unknown as ComputorApiService;
  const closePanels = () => { webviewPanels.forEach(panel => panel.dispose()); webviewPanels.length = 0; };
  const shown = () => JSON.parse(/window\.__INITIAL_STATE__ = (.*?);<\/script>/s.exec(webviewPanels.at(-1)!.webview.html)![1]!).markdown;
  beforeEach(closePanels); afterEach(closePanels);

  it('lets a returning learner go on with the first assignment not handed in instead of the Welcome', async () => {
    const released = { deployment: { deployment_status: 'deployed' } };
    const done = { id: 'done', course_id: 'course', path: 'week.done', position: 1, course_content_kind_id: 'assignment', submitted: true, ...released } as CourseContentStudentList;
    const next = { id: 'next', course_id: 'course', path: 'week.next', position: 2, course_content_kind_id: 'assignment', ...released } as CourseContentStudentList;
    const resumeAt = await showWorkspaceCourseLanding(context, api([welcome, done, next], 'de'), course);
    expect(resumeAt?.id).to.equal('next');
    expect(webviewPanels).to.have.length(0);
    // Everything handed in: nothing opens, the course tree is the way on.
    expect(await showWorkspaceCourseLanding(context, api([welcome, done], 'de'), course)).to.equal(undefined);
    expect(webviewPanels).to.have.length(0);
  });

  it('opens only the authored Welcome for a learner who has not started', async () => {
    const execute = vscode.commands.executeCommand;
    const groups = vscode.window.tabGroups;
    (vscode.window as any).tabGroups = { all: [{ viewColumn: 1, tabs: [] }] };
    (vscode.commands as any).executeCommand = async () => ({ orientation: 1, groups: [{}] });
    try { await require('../../src/ui/editorLayout').updateLearnerReadingWidth(390); }
    finally { (vscode.commands as any).executeCommand = execute; (vscode.window as any).tabGroups = groups; }
    for (const language of ['de', 'en']) {
      closePanels();
      const open = { id: 'open', course_id: 'course', path: 'week.open', course_content_kind_id: 'assignment' } as CourseContentStudentList;
      expect(await showWorkspaceCourseLanding(context, api([welcome, open], language), course)).to.equal(undefined);
      expect(webviewPanels).to.have.length(1);
      expect(webviewPanels[0]!.viewColumn).to.equal(vscode.ViewColumn.One);
      expect(shown()).to.equal(language === 'de' ? 'Hallo du' : 'Hello you');
      expect(webviewPanels[0]!.webview.html).not.to.contain('welcome-row-picture');
      expect(webviewPanels[0]!.webview.html).not.to.contain('welcome-tutorial');
    }
  });

  it('titles and fills a unit tab from its language maps, also for a row fetched before a switch', async () => {
    const unit = { id: 'unit', course_id: 'course', path: 'week1', title: 'Woche 1', description: 'Inhalt der Woche',
      title_i18n: { de: 'Woche 1', en: 'First steps' }, description_i18n: { en: 'This week' }, course_content_kind_id: 'unit' } as unknown as CourseContentStudentList;
    await showWorkspaceCourseUnit(context, api([], 'en'), unit);
    expect(webviewPanels.at(-1)!.title).to.equal('First steps');
    expect(shown()).to.equal('This week');
  });

  it('falls back to the authored course description without a synthetic task or guide', async () => {
    await showWorkspaceCourseLanding(context, api([]), course);
    expect(shown()).to.equal('# Authored course description');
    expect(webviewPanels[0]!.title).to.equal('Course');
  });

  it('does not replace a newer explicit task when startup contents arrive late', async () => {
    let release!: (contents: CourseContentStudentList[]) => void;
    const delayed = api([]);
    delayed.getStudentCourseContents = () => new Promise(resolve => { release = resolve; });
    const launch = showWorkspaceCourseLanding(context, delayed, course);
    await showMarkdownTextPreview(context, '# Exact task', 'Task', { studentReading: true });
    release([welcome]); await launch;
    expect(webviewPanels).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('Task');
  });

  it('retains the request reserved before fetching a course', async () => {
    const request = beginMarkdownPreviewRequest();
    await showMarkdownTextPreview(context, '# Manual read', 'Manual');
    await showWorkspaceCourseLanding(context, api([welcome]), course, request);
    expect(webviewPanels).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('Manual');
  });
});


describe('native workspace course launch', () => {
  const welcome = { id: 'welcome', course_id: 'course', path: 'welcome', title: 'Welcome',
    course_content_kind_id: 'unit', description: '# Authored introduction' } as CourseContentStudentList;
  let state: Map<string, unknown>;
  let context: vscode.ExtensionContext;
  let userId: string;
  let contents: CourseContentStudentList[];
  let repository: unknown;
  let api: ComputorApiService;
  const closePanels = () => { webviewPanels.forEach(panel => panel.dispose()); webviewPanels.length = 0; };
  const shown = (index: number) => JSON.parse(/window\.__INITIAL_STATE__ = (.*?);<\/script>/s.exec(webviewPanels[index]!.webview.html)![1]!).markdown;
  beforeEach(() => {
    closePanels(); state = new Map(); userId = 'learner-a'; contents = [welcome]; repository = null;
    context = { subscriptions: [], extensionUri: vscode.Uri.file(path.resolve(__dirname, '../..')),
      globalState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value); } }
    } as unknown as vscode.ExtensionContext;
    api = { getUserAccount: async () => ({ id: userId, profile: { language_code: 'en' } }),
      getCourseRepository: async () => repository,
      getStudentCourseContents: async () => contents } as unknown as ComputorApiService;
  });
  afterEach(closePanels);

  it('snapshots before provisioning, retains the exact target and foregrounds the authored Welcome', async () => {
    const order: string[] = [];
    api.getCourseRepository = async () => { order.push('snapshot'); return repository as any; };
    const request = beginMarkdownPreviewRequest();
    await openWorkspaceCourseLaunch(context, api, 'course', request, async () => {
      order.push('exact task B'); repository = { id: 'created-by-this-launch' };
      await showMarkdownTextPreview(context, '# Exact requested task B', 'Task B', { request, studentReading: true });
      expect(state.size).to.equal(0);
      return true;
    });
    expect(order).to.deep.equal(['snapshot', 'exact task B']);
    expect(webviewPanels.map(panel => panel.title)).to.deep.equal(['Task B', 'Welcome']);
    expect(shown(0)).to.equal('# Exact requested task B');
    expect(shown(1)).to.equal('# Authored introduction');
    expect(state.get('workspaceCourseIntroduction:learner-a:course')).to.equal(true);
  });

  it('uses the same authored introduction for course-only and scopes later visits to account and course', async () => {
    const launch = async (courseId: string) => openWorkspaceCourseLaunch(context, api, courseId, beginMarkdownPreviewRequest(), async hasIntroduction => {
      expect(hasIntroduction).to.equal(true); return true;
    });
    await launch('course');
    expect(shown(0)).to.equal('# Authored introduction');
    await openWorkspaceCourseLaunch(context, api, 'course', beginMarkdownPreviewRequest(), async first => { expect(first).to.equal(false); return true; });
    userId = 'learner-b'; await launch('course');
    contents = [{ ...welcome, course_id: 'other-course' }]; await launch('other-course');
    expect([...state.keys()]).to.have.length(3);
  });

  it('opens the exact task directly for genuine returning learners, including a pre-upgrade blank repository', async () => {
    for (const returning of ['repository', 'progress']) {
      closePanels(); repository = returning === 'repository' ? { id: 'existing-blank-repo' } : null;
      contents = [welcome, { course_content_kind_id: 'assignment', result_count: returning === 'progress' ? 1 : 0 } as CourseContentStudentList];
      const request = beginMarkdownPreviewRequest();
      await openWorkspaceCourseLaunch(context, api, 'course', request, async first => {
        expect(first).to.equal(false);
        await showMarkdownTextPreview(context, '# Exact task', 'Task', { request }); return true;
      });
      expect(webviewPanels.map(panel => panel.title)).to.deep.equal(['Task']);
      expect(state.size).to.equal(0);
    }
  });

  it('leaves no-Welcome fallback with the existing course callback and does not mark seen', async () => {
    contents = [];
    const request = beginMarkdownPreviewRequest();
    await openWorkspaceCourseLaunch(context, api, 'course', request, async first => {
      expect(first).to.equal(false);
      await showWorkspaceCourseLanding(context, api, { id: 'course', title: 'Course', description: '# Authored course' } as CourseStudentList, request);
      return true;
    });
    expect(shown(0)).to.equal('# Authored course'); expect(state.size).to.equal(0);
  });

  it('does not guess fresh on unknown account or repository errors and does not open a course', async () => {
    let opened = false;
    for (const failure of ['account', 'repository']) {
      (api as any).getUserAccount = async () => failure === 'account' ? undefined : { id: userId };
      api.getCourseRepository = async () => { throw new Error('repository unavailable'); };
      try {
        await openWorkspaceCourseLaunch(context, api, 'course', beginMarkdownPreviewRequest(), async () => { opened = true; return true; });
        expect.fail('Expected transient failure');
      } catch (error) { expect(String(error)).to.contain(failure === 'account' ? 'learner account' : 'repository unavailable'); }
    }
    expect(opened).to.equal(false); expect(state.size).to.equal(0);
  });

  it('does not replace or mark seen after a target callback is superseded by manual reading', async () => {
    await openWorkspaceCourseLaunch(context, api, 'course', beginMarkdownPreviewRequest(), async () => {
      await showMarkdownTextPreview(context, '# New manual read', 'Manual'); return true;
    });
    expect(webviewPanels.map(panel => panel.title)).to.deep.equal(['Manual']); expect(state.size).to.equal(0);
  });

  it('does not invoke the target when its first-visit lookup arrives after newer reading', async () => {
    let release!: (contents: CourseContentStudentList[]) => void;
    api.getStudentCourseContents = () => new Promise(resolve => { release = resolve; });
    let opened = false;
    const pending = openWorkspaceCourseLaunch(context, api, 'course', beginMarkdownPreviewRequest(), async () => { opened = true; return true; });
    while (!release) await Promise.resolve();
    await showMarkdownTextPreview(context, '# Manual', 'Manual'); release([welcome]); await pending;
    expect(opened).to.equal(false); expect(state.size).to.equal(0);
  });

  it('retries after its own provisioning and failed Welcome render, fetching current authorized content', async () => {
    const request = beginMarkdownPreviewRequest();
    const create = vscode.window.createWebviewPanel;
    try {
      await openWorkspaceCourseLaunch(context, api, 'course', request, async () => {
        repository = { id: 'created-by-this-launch' };
        await showMarkdownTextPreview(context, '# Exact task', 'Task', { request });
        (vscode.window as any).createWebviewPanel = () => { throw new Error('render failed'); }; return true;
      });
      expect.fail('Expected render failure');
    } catch (error) { expect(String(error)).to.contain('render failed'); }
    finally { (vscode.window as any).createWebviewPanel = create; }
    expect(state.size).to.equal(0);
    contents = [{ ...welcome, visible_effective: false }];
    await openWorkspaceCourseLaunch(context, api, 'course', beginMarkdownPreviewRequest(), async first => { expect(first).to.equal(false); return true; });
    expect(state.size).to.equal(0);
    contents = [{ ...welcome, description: '# Updated authored introduction' }];
    await openWorkspaceCourseLaunch(context, api, 'course', beginMarkdownPreviewRequest(), async first => { expect(first).to.equal(true); return true; });
    expect(webviewPanels.map(panel => panel.title)).to.deep.equal(['Task', 'Welcome']);
    expect(shown(1)).to.equal('# Updated authored introduction');
    expect(state.get('workspaceCourseIntroduction:learner-a:course')).to.equal(true);
  });
});

describe('general Welcome as first-time guide for a course without a Welcome item', () => {
  const welcomeItem = { id: 'welcome', course_id: 'course', path: 'welcome', title: 'Willkommen',
    course_content_kind_id: 'unit', description: '# Authored introduction' } as CourseContentStudentList;
  const assignment = { id: 'a1', course_id: 'course', path: 'week1.a1', title: 'A1', course_content_kind_id: 'assignment' } as CourseContentStudentList;
  let state: Map<string, unknown>;
  let context: vscode.ExtensionContext;
  let userId: string | undefined;
  let contents: CourseContentStudentList[];
  let api: ComputorApiService;
  let opened: number;
  const open = async () => { opened += 1; };
  const launch = (courseId = 'course') => showCourseWelcomeGuideOnce(context, api, courseId, beginMarkdownPreviewRequest(), open);
  beforeEach(() => {
    state = new Map(); userId = 'learner-a'; contents = [assignment]; opened = 0;
    context = { globalState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value); } } } as unknown as vscode.ExtensionContext;
    api = { getUserAccount: async () => ({ id: userId }), getStudentCourseContents: async () => contents } as unknown as ComputorApiService;
  });

  it('opens once for a first launch and not again, for that account and course only', async () => {
    expect(await launch()).to.equal(true);
    expect(await launch()).to.equal(false);
    expect(opened).to.equal(1);
    userId = 'learner-b'; expect(await launch()).to.equal(true);
    expect(await launch('other-course')).to.equal(true);
    expect(opened).to.equal(3);
  });

  it('does not open for a course with a Welcome item', async () => {
    contents = [welcomeItem, assignment];
    expect(await launch()).to.equal(false);
    expect(opened).to.equal(0); expect(state.size).to.equal(0);
  });

  it('does not open for a learner who has started, or when the account is unknown', async () => {
    contents = [{ ...assignment, result_count: 1 } as CourseContentStudentList];
    expect(await launch()).to.equal(false);
    contents = [assignment]; userId = undefined;
    expect(await launch()).to.equal(false);
    expect(opened).to.equal(0); expect(state.size).to.equal(0);
  });

  it('does not mark the guide seen when opening fails, so the next launch retries', async () => {
    try { await showCourseWelcomeGuideOnce(context, api, 'course', beginMarkdownPreviewRequest(), async () => { throw new Error('render failed'); }); }
    catch { /* expected */ }
    expect(state.size).to.equal(0);
    expect(await launch()).to.equal(true);
  });
});
