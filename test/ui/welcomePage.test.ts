import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { env, UIKind, webviewPanels } from '../helpers/vscode-stub';
import { SimpleMockMemento } from '../helpers/SimpleMockContext';
import {
  collectWelcomeFacts,
  renderWelcomeBody,
  resolveWelcomeMessage,
  WelcomeApi,
  WelcomeModel
} from '../../src/ui/webviews/welcome/welcomeContent';
import { isWelcomeShownOnStartup, WelcomeWebviewProvider } from '../../src/ui/webviews/WelcomeWebviewProvider';
import { codicon, codiconPaths, CodiconName } from '../../src/ui/webviews/welcome/codicons';
import { contentIconSvg } from '../../src/utils/contentIconSvg';

/**
 * The welcome page (computor-org/issues#374).
 *
 * The page is the first thing a student sees in a workspace, so what it says
 * is the behaviour: which sections appear for which account, that the other
 * edition (browser or desktop) is pointed at, and that the tutorial walks from
 * the Student view to a submission in order. The webview script only reports
 * clicks, so the allow-list behind those clicks is pinned here too.
 */

function model(overrides: Partial<WelcomeModel> = {}): WelcomeModel {
  return {
    signedIn: true,
    givenName: 'Ada',
    roles: ['student'],
    courses: [{ id: 'c1', title: 'Programming in Physics', roles: ['student'] }],
    inBrowser: false,
    showOnStartup: true,
    ...overrides
  };
}

function has(html: string, sectionId: string): boolean {
  return html.includes(`id="${sectionId}"`);
}

describe('welcome page content', () => {
  it('greets the user by name and welcomes them to their course', () => {
    const html = renderWelcomeBody(model());

    expect(html).to.contain('Welcome to Computor, Ada!');
    expect(html).to.contain('Welcome to your course!');
    expect(html).to.contain('Programming in Physics');
    expect(html).to.contain('<span class="badge badge-info xs">Student</span>');
    expect(html).to.contain('data-action="view" data-role="student"');
  });

  it('shows the Computor logo it is given, inline', () => {
    const html = renderWelcomeBody(model({ logoDataUri: 'data:image/png;base64,AAAA' }));

    expect(html).to.contain('<img class="welcome-logo" src="data:image/png;base64,AAAA" alt="Computor logo">');
  });

  it('escapes names and course titles', () => {
    const html = renderWelcomeBody(model({
      givenName: '<img src=x>',
      courses: [{ id: 'c1', title: '<script>alert(1)</script>', roles: ['student'] }]
    }));

    expect(html).to.not.contain('<script>alert(1)</script>');
    expect(html).to.not.contain('<img src=x>');
    expect(html).to.contain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('caps a long course list and counts the rest', () => {
    const courses = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, title: `Course ${i}`, roles: ['student' as const] }));
    const html = renderWelcomeBody(model({ courses }));

    expect(html.match(/class="welcome-course"/g)).to.have.length(8);
    expect(html).to.contain('…and 2 more.');
  });

  it('walks a student from the Student view to a submission, in order', () => {
    const html = renderWelcomeBody(model());

    expect(has(html, 'welcome-tutorial')).to.equal(true);
    const steps = ['Open the Student view.', 'Open your course.', 'Read the task.', 'Get the files.',
      'Write your solution.', 'Test it.', 'Submit.'];
    const positions = steps.map(step => html.indexOf(`<strong>${step}</strong>`));
    expect(positions.every(position => position >= 0), 'every step is present').to.equal(true);
    expect([...positions].sort((a, b) => a - b)).to.deep.equal(positions);
    // The names on screen, so the steps can be followed without knowing VS Code.
    expect(html).to.contain('Computor Student');
    expect(html).to.contain('Test Assignment');
    expect(html).to.contain('Results');
    expect(html).to.contain('Commit Course');
  });

  it('leaves the tutorial out for an account without a student role', () => {
    const html = renderWelcomeBody(model({ roles: ['lecturer'], courses: [] }));

    expect(has(html, 'welcome-tutorial')).to.equal(false);
  });

  it('links the three bundled student help pages', () => {
    const html = renderWelcomeBody(model());

    for (const page of ['student-course.md', 'student-unit.md', 'student-assignment.md']) {
      expect(html).to.contain(`data-action="help" data-page="${page}"`);
    }
  });

  it('explains the Git colours with samples in the theme colours', () => {
    const html = renderWelcomeBody(model());

    expect(has(html, 'welcome-git-colours')).to.equal(true);
    for (const sample of ['git-line added', 'git-line modified', 'git-line deleted', 'git-file untracked', 'git-file modified']) {
      expect(html).to.contain(`class="${sample}"`);
    }
    expect(html).to.contain('<span class="git-letter">M</span>');
  });

  describe('anchored on the icons a row really shows (computor-org/issues#526)', () => {
    const rowPicture = fs.readFileSync(path.join(process.cwd(), 'media/welcome/assignment-row.svg'), 'utf8').trim();

    it('draws each icon a step names next to its tooltip text', () => {
      const html = renderWelcomeBody(model());

      const named: Array<[CodiconName, string]> = [['open-preview', 'Show README Preview'], ['git-commit', 'Commit Assignment'],
        ['beaker', 'Test Assignment'], ['cloud-upload', 'Submit'], ['comment-discussion', 'Show Messages'], ['book', 'Show Description']];
      for (const [icon, label] of named) {
        expect(html, label).to.contain(`${codicon(icon)}<em>${label}</em>`);
      }
      expect(html).to.contain(`${codicon('book')} <strong>Computor Student</strong>`);
    });

    it('says the icons appear on hover and numbers them in the order of the row', () => {
      const html = renderWelcomeBody(model({ rowPictureSvg: rowPicture }));

      expect(html).to.contain('Its icons appear only while the mouse is over the row or the row is selected.');
      expect(html).to.contain(rowPicture);
      const legend = html.slice(html.indexOf('class="welcome-row-legend"'));
      const order = ['Show README Preview', 'Commit Assignment', 'Test Assignment', 'Submit', 'Show Messages']
        .map(label => legend.indexOf(`<em>${label}</em>`));
      expect(order.every(position => position >= 0)).to.equal(true);
      expect([...order].sort((a, b) => a - b)).to.deep.equal(order);
      // Test and Submit are explained before the long step list, so they sit above the fold.
      expect(html.indexOf('<em>Submit</em>')).to.be.lessThan(html.indexOf('<strong>Open the Student view.</strong>'));
    });

    it('leaves the picture and its letters out when the picture cannot be read', () => {
      const html = renderWelcomeBody(model());

      expect(html).to.not.contain('welcome-row-picture');
      expect(html).to.not.contain('welcome-callout letter');
      expect(html).to.contain('<em>Test Assignment</em>');
    });

    it('explains the row marks with the markers the tree draws, and what done looks like', () => {
      const html = renderWelcomeBody(model({ language: 'de' }));

      expect(has(html, 'welcome-marks')).to.equal(true);
      const done = contentIconSvg('#FFFF00', 'square', 'success-submitted');
      expect(html).to.contain(`${done}</span></div><p><strong>Erledigt:</strong> alle Tests bestanden und abgegeben.</p>`);
      expect(html).to.contain('wenn ihr Quadrat das grüne Doppelhäkchen trägt');
      for (const badge of ['success', 'failure', 'failure-submitted', 'submitted'] as const) {
        expect(html, badge).to.contain(contentIconSvg('#FFFF00', 'square', badge));
      }
      expect(html).to.contain(contentIconSvg('#00FF00', 'circle'));
      expect(html).to.contain('<code>(1)(1) 100%</code>');
      expect(html).to.contain('<code>●</code> <code>↑</code> <code>⚠</code>');
    });

    it('keeps the Git colours, the other edition and the staff help below a More heading', () => {
      const html = renderWelcomeBody(model({ roles: ['student', 'tutor'] }));

      const more = html.indexOf('id="welcome-more"');
      expect(more).to.be.greaterThan(html.indexOf('id="welcome-marks"'));
      expect(more).to.be.greaterThan(html.indexOf('id="welcome-help"'));
      for (const below of ['welcome-staff', 'welcome-git-colours', 'welcome-browser', 'welcome-credits']) {
        expect(html.indexOf(`id="${below}"`), below).to.be.greaterThan(more);
      }
    });
  });

  describe('the other edition', () => {
    it('in the browser, points to desktop VS Code and names this backend', () => {
      const html = renderWelcomeBody(model({ inBrowser: true, backendUrl: 'https://computor.example/api' }));

      expect(has(html, 'welcome-desktop')).to.equal(true);
      expect(has(html, 'welcome-browser')).to.equal(false);
      expect(html).to.contain('data-link="marketplace"');
      expect(html).to.contain('<code>https://computor.example/api</code>');
      expect(html).to.contain('Computor: Login');
    });

    it('on the desktop, points to browser workspaces on the website', () => {
      const html = renderWelcomeBody(model({ inBrowser: false, webUrl: 'https://computor.example' }));

      expect(has(html, 'welcome-browser')).to.equal(true);
      expect(has(html, 'welcome-desktop')).to.equal(false);
      expect(html).to.contain('data-link="workspaces"');
    });

    it('offers no website button when the web app address is unknown', () => {
      const html = renderWelcomeBody(model({ inBrowser: false, webUrl: undefined }));

      expect(has(html, 'welcome-browser')).to.equal(true);
      expect(html).to.not.contain('data-link="workspaces"');
    });
  });

  describe('help for tutors and lecturers', () => {
    it('is not shown to a student', () => {
      expect(has(renderWelcomeBody(model()), 'welcome-staff')).to.equal(false);
    });

    it('gives a tutor the bundled tutor pages', () => {
      const html = renderWelcomeBody(model({ roles: ['tutor'] }));

      expect(has(html, 'welcome-staff')).to.equal(true);
      expect(html).to.contain('data-page="tutor-course.md"');
      expect(html).to.contain('data-page="tutor-assignment.md"');
      expect(html).to.not.contain('data-link="lecturerGuide"');
    });

    it('adds the lecturer guides for a lecturer', () => {
      const html = renderWelcomeBody(model({ roles: ['tutor', 'lecturer'] }));

      expect(html).to.contain('data-link="lecturerGuide"');
      expect(html).to.contain('data-link="teacherGuide"');
      expect(html).to.contain('Computor Lecturer');
    });
  });

  it('before sign-in, offers to sign in and still shows the tutorial', () => {
    const html = renderWelcomeBody(model({ signedIn: false, givenName: undefined, roles: [], courses: [] }));

    expect(html).to.contain('Welcome to Computor!');
    expect(html).to.contain('data-action="login"');
    expect(has(html, 'welcome-tutorial')).to.equal(true);
    expect(html).to.not.contain('class="welcome-courses"');
  });

  it('credits the developers and the sponsor', () => {
    const html = renderWelcomeBody(model({ version: '2027.3.2' }));

    expect(has(html, 'welcome-credits')).to.equal(true);
    expect(html).to.contain('Maximilian Mandlez');
    expect(html).to.contain('Graz University of Technology');
    expect(html).to.contain('netidee');
    expect(html).to.contain('project 8012');
    expect(html).to.contain('MIT license');
    expect(html).to.contain('data-link="contributors"');
    expect(html).to.contain('Computor extension 2027.3.2');
  });

  it('reflects the startup choice in its checkbox', () => {
    expect(renderWelcomeBody(model({ showOnStartup: true }))).to.contain('id="show-on-startup" checked');
    expect(renderWelcomeBody(model({ showOnStartup: false }))).to.not.contain('id="show-on-startup" checked');
  });

  // computor-org/issues#527 and #458.
  describe('in German, for a launched course', () => {
    const launched = (selfEnrolment?: boolean) => model({
      language: 'de',
      launch: { title: 'Data Science mit Python – Grundlagen', startHere: 'Woche 1 → Mathematische Konstanten', selfEnrolment }
    });

    it('speaks German throughout and keeps the labels VS Code shows', () => {
      const html = renderWelcomeBody(launched(true));

      expect(html).to.contain('Willkommen bei Computor, Ada!');
      const steps = ['Öffne die Student-Ansicht.', 'Dein Kurs ist schon geöffnet.', 'Lies die Aufgabe.', 'Hol dir die Dateien.',
        'Schreib deine Lösung.', 'Teste sie.', 'Gib ab.'];
      const positions = steps.map(step => html.indexOf(`<strong>${step}</strong>`));
      expect(positions.every(position => position >= 0), 'every step is present').to.equal(true);
      expect([...positions].sort((a, b) => a - b)).to.deep.equal(positions);
      for (const english of ['Welcome to', 'Start working on an assignment', 'Help pages', 'You see', 'About Computor', 'Show this page']) {
        expect(html, english).to.not.contain(english);
      }
      expect(html).to.contain('<em>Test Assignment</em>');
      expect(html).to.contain('<em>Submit</em>');
    });

    it('says the course is open, where to start, and does not offer the open Student view again', () => {
      const html = renderWelcomeBody(launched(true));

      expect(html).to.contain('<strong>Data Science mit Python – Grundlagen</strong> ist links schon geöffnet.');
      expect(html).to.contain('Beginne mit <strong>Woche 1 → Mathematische Konstanten</strong>.');
      expect(html).to.not.contain('Öffne deinen Kurs.');
      expect(html).to.not.contain('data-action="view" data-role="student"');
    });

    it('sends a self-enrolled learner to Lena and to a support ticket, not to tutors', () => {
      const html = renderWelcomeBody(launched(true));

      expect(html).to.contain('keine menschlichen Tutorinnen und Tutoren');
      expect(html).to.contain('<code>@lena</code>');
      expect(html).to.contain('data-action="reportProblem"');
      expect(html).to.contain('Abmeldung vom Kurs');
    });

    it('sends a learner in a staffed course to the lecturer and tutors', () => {
      const html = renderWelcomeBody(launched(false));

      expect(html).to.contain('den Lehrenden und den Tutorinnen und Tutoren deines Kurses');
      expect(html).to.not.contain('@lena');
    });
  });

  it('in English, replaces step 2 for a launched course and names Lena for a self-enrolment course', () => {
    const html = renderWelcomeBody(model({ launch: { title: 'Grundlagen', startHere: 'Week 1 → Constants', selfEnrolment: true } }));

    expect(html).to.contain('<strong>Your course is already open.</strong>');
    expect(html).to.not.contain('<strong>Open your course.</strong>');
    expect(html).to.contain('Start with <strong>Week 1 → Constants</strong>.');
    expect(html).to.contain('This course has no human tutors.');
    expect(html).to.not.contain('lecturer and tutors');
  });

  it('names both kinds of help when the course is not known, and offers a ticket only when signed in', () => {
    const html = renderWelcomeBody(model());
    expect(html).to.contain('your lecturer and tutors, or in courses with the AI tutor Lena, <code>@lena</code>');
    expect(html).to.contain('data-action="reportProblem"');

    const signedOut = renderWelcomeBody(model({ signedIn: false, givenName: undefined, roles: [], courses: [] }));
    expect(signedOut).to.not.contain('data-action="reportProblem"');
  });
});

describe('collectWelcomeFacts', () => {
  function api(overrides: Partial<WelcomeApi> = {}, calls: string[] = []): WelcomeApi {
    const record = <T>(name: string, value: T) => async () => { calls.push(name); return value; };
    return {
      getUserAccount: record('account', { given_name: ' Ada ' }),
      getUserViews: record('views', ['student', 'tutor']),
      getStudentCourses: record('student', [{ id: 'c1', title: 'Physics', path: 'physics' }]),
      getTutorCourses: record('tutor', [{ id: 'c1', title: 'Physics' }, { id: 'c2', title: null, path: 'algebra' }]),
      getLecturerCourses: record('lecturer', [{ id: 'c2', title: 'Algebra' }]),
      getInstanceInfo: record('info', { web_url: 'https://computor.example/' }),
      getCourse: record('course', { title: 'Grundlagen', language_code: 'de', public: true }),
      getStudentCourseContents: record('contents', [
        { id: 'u1', path: 'woche_1', title: 'Week 1', position: 1, course_content_kind_id: 'unit' },
        { id: 'a1', path: 'woche_1.konstanten', title: 'Mathematische Konstanten', position: 1, course_content_kind_id: 'assignment',
          deployment: { deployment_status: 'deployed' } }
      ] as any),
      ...overrides
    };
  }

  it('reports a signed-out window as such', async () => {
    expect(await collectWelcomeFacts(undefined)).to.deep.equal({ signedIn: false, roles: [], courses: [] });
  });

  it('lists each course once, with every role the user has in it', async () => {
    const facts = await collectWelcomeFacts(api());

    expect(facts.givenName).to.equal('Ada');
    expect(facts.roles).to.deep.equal(['student', 'tutor']);
    expect(facts.courses).to.deep.equal([
      { id: 'c2', title: 'algebra', roles: ['tutor'] },
      { id: 'c1', title: 'Physics', roles: ['student', 'tutor'] }
    ]);
    expect(facts.webUrl).to.equal('https://computor.example');
  });

  it('asks only for the course lists of roles the user has', async () => {
    const calls: string[] = [];
    await collectWelcomeFacts(api({}, calls));

    expect(calls).to.not.include('lecturer');
  });

  it('still opens when parts of the backend fail', async () => {
    const facts = await collectWelcomeFacts(api({
      getUserAccount: async () => { throw new Error('down'); },
      getStudentCourses: async () => { throw new Error('down'); },
      getInstanceInfo: async () => undefined
    }));

    expect(facts.signedIn).to.equal(true);
    expect(facts.givenName).to.equal(undefined);
    expect(facts.courses.map(course => course.id)).to.deep.equal(['c2', 'c1']);
    expect(facts.webUrl).to.equal(undefined);
  });

  it('reads neither a course nor its contents without a launched course, and stays English', async () => {
    const calls: string[] = [];
    const facts = await collectWelcomeFacts(api({}, calls));

    expect(calls).to.not.include('course');
    expect(calls).to.not.include('contents');
    expect(facts.launch).to.equal(undefined);
    expect(facts.language).to.equal('en');
  });

  it('describes the launched course in its language, with where to start', async () => {
    const facts = await collectWelcomeFacts(api(), 'c1');

    expect(facts.language).to.equal('de');
    expect(facts.launch).to.deep.equal({
      title: 'Grundlagen',
      startHere: 'Woche 1 → Mathematische Konstanten',
      selfEnrolment: true
    });
  });

  it('lets the learner\'s own language win over the course language', async () => {
    const facts = await collectWelcomeFacts(api({
      getUserAccount: async () => ({ given_name: 'Ada', profile: { language_code: 'en' } })
    }), 'c1');

    expect(facts.language).to.equal('en');
    expect(facts.launch?.startHere).to.equal('Week 1 → Mathematische Konstanten');
  });

  it('keeps the launched course but leaves its kind open when the course cannot be read', async () => {
    const facts = await collectWelcomeFacts(api({ getCourse: async () => { throw new Error('down'); } }), 'c1');

    expect(facts.launch?.title).to.equal('Physics');
    expect(facts.launch?.selfEnrolment).to.equal(undefined);
  });

  it('uses only an http(s) web app address', async () => {
    const facts = await collectWelcomeFacts(api({ getInstanceInfo: async () => ({ web_url: 'javascript:alert(1)' }) }));

    expect(facts.webUrl).to.equal(undefined);
  });
});

describe('resolveWelcomeMessage', () => {
  const signedIn = model({ roles: ['student', 'tutor'], webUrl: 'https://computor.example' });

  it('opens bundled help pages and nothing else', () => {
    expect(resolveWelcomeMessage({ command: 'help', data: { page: 'student-unit.md' } }, signedIn))
      .to.deep.equal({ kind: 'help', page: 'student-unit.md' });
    expect(resolveWelcomeMessage({ command: 'help', data: { page: 'tutor-course.md' } }, signedIn))
      .to.deep.equal({ kind: 'help', page: 'tutor-course.md' });
    expect(resolveWelcomeMessage({ command: 'help', data: { page: '../../package.json' } }, signedIn)).to.equal(undefined);
  });

  it('opens links by key, never a URL from the page', () => {
    expect(resolveWelcomeMessage({ command: 'link', data: { key: 'marketplace' } }, signedIn))
      .to.deep.equal({ kind: 'link', url: 'https://marketplace.visualstudio.com/items?itemName=computor-org.computor' });
    expect(resolveWelcomeMessage({ command: 'link', data: { key: 'workspaces' } }, signedIn))
      .to.deep.equal({ kind: 'link', url: 'https://computor.example/workspaces' });
    for (const key of ['https://example.org', 'toString', '__proto__', undefined]) {
      expect(resolveWelcomeMessage({ command: 'link', data: { key } }, signedIn)).to.equal(undefined);
    }
    expect(resolveWelcomeMessage({ command: 'link', data: { key: 'workspaces' } }, model({ webUrl: undefined }))).to.equal(undefined);
  });

  it('opens only the views of roles the user has', () => {
    expect(resolveWelcomeMessage({ command: 'view', data: { role: 'tutor' } }, signedIn)).to.deep.equal({ kind: 'view', role: 'tutor' });
    expect(resolveWelcomeMessage({ command: 'view', data: { role: 'lecturer' } }, signedIn)).to.equal(undefined);
  });

  it('offers sign-in only while signed out', () => {
    expect(resolveWelcomeMessage({ command: 'login' }, signedIn)).to.equal(undefined);
    expect(resolveWelcomeMessage({ command: 'login' }, model({ signedIn: false }))).to.deep.equal({ kind: 'login' });
  });

  it('stores a startup choice only when it is a boolean', () => {
    expect(resolveWelcomeMessage({ command: 'showOnStartup', data: { value: false } }, signedIn))
      .to.deep.equal({ kind: 'showOnStartup', value: false });
    expect(resolveWelcomeMessage({ command: 'showOnStartup', data: { value: 'no' } }, signedIn)).to.equal(undefined);
  });

  it('opens a support ticket only while signed in', () => {
    expect(resolveWelcomeMessage({ command: 'reportProblem' }, signedIn)).to.deep.equal({ kind: 'reportProblem' });
    expect(resolveWelcomeMessage({ command: 'reportProblem' }, model({ signedIn: false }))).to.equal(undefined);
  });

  it('ignores anything else', () => {
    for (const message of [undefined, null, 'help', { command: 'runCommand', data: { id: 'workbench.action.quit' } }]) {
      expect(resolveWelcomeMessage(message, signedIn)).to.equal(undefined);
    }
  });
});

describe('WelcomeWebviewProvider', () => {
  /** The real extension root, so the page inlines its real assets and logo. */
  const extensionRoot = path.resolve(__dirname, '../..');
  const extensionUri = { fsPath: extensionRoot, path: extensionRoot, scheme: 'file' };

  const fakeApi: WelcomeApi = {
    getUserAccount: async () => ({ given_name: 'Ada' }),
    getUserViews: async () => ['student'],
    getStudentCourses: async () => [{ id: 'c1', title: 'Programming in Physics' }],
    getTutorCourses: async () => [],
    getLecturerCourses: async () => [],
    getInstanceInfo: async () => ({ web_url: 'https://computor.example' }),
    getCourse: async () => ({ title: 'Grundlagen', language_code: 'de', public: true }),
    getStudentCourseContents: async () => []
  };

  let context: any;

  function provider(api: WelcomeApi | undefined = fakeApi): WelcomeWebviewProvider {
    return new WelcomeWebviewProvider(context, { api: () => api, backendUrl: async () => 'https://computor.example/api' });
  }

  function latestHtml(): string {
    return webviewPanels[webviewPanels.length - 1]!.webview.html;
  }

  beforeEach(() => {
    context = {
      subscriptions: [],
      extensionPath: extensionRoot,
      extensionUri,
      globalState: new SimpleMockMemento(),
      extension: { packageJSON: { version: '9.9.9' } }
    };
    webviewPanels.length = 0;
  });

  afterEach(() => {
    env.uiKind = UIKind.Desktop;
    context.subscriptions.forEach((d: any) => d?.dispose?.());
  });

  it('renders a self-contained page with the logo, its stylesheet and its script inlined', async () => {
    await provider().open();
    const html = latestHtml();

    expect(html).to.contain('Welcome to Computor, Ada!');
    expect(html).to.contain('data:image/png;base64,');
    expect(html).to.contain(fs.readFileSync(path.join(extensionRoot, 'webview-ui/welcome/welcome.css'), 'utf8').trim());
    expect(html).to.contain('CW.registerActions');
    // A linked asset would go through the service worker Firefox never routes
    // under code-server (#267) and leave the page unstyled there.
    expect(html).to.not.match(/<link rel="stylesheet"/);
    expect(html).to.not.match(/<script[^>]*\ssrc=/);
    expect(html).to.contain('Computor extension 9.9.9');
  });

  it('inlines the annotated assignment row from media/', async () => {
    await provider().open();

    const svg = fs.readFileSync(path.join(extensionRoot, 'media/welcome/assignment-row.svg'), 'utf8').trim();
    expect(latestHtml()).to.contain(`class="welcome-row-picture" role="img"`);
    expect(latestHtml()).to.contain(svg);
  });

  it('shows the desktop pointer in the browser and the browser pointer on the desktop', async () => {
    env.uiKind = UIKind.Web;
    await provider().open();
    expect(latestHtml()).to.contain('id="welcome-desktop"');

    env.uiKind = UIKind.Desktop;
    webviewPanels.length = 0;
    await provider().open();
    expect(latestHtml()).to.contain('id="welcome-browser"');
  });

  it('opens itself once after sign-in by default', async () => {
    const page = provider();

    await page.afterSignIn();
    expect(webviewPanels).to.have.length(1);

    webviewPanels[0]!.dispose();
    await page.afterSignIn();
    expect(webviewPanels).to.have.length(1);
  });

  it('stays closed after sign-in once switched off from the page', async () => {
    const page = provider();
    await page.open();
    webviewPanels[0]!.fireMessage({ command: 'showOnStartup', data: { value: false } });
    await new Promise(resolve => setImmediate(resolve));
    webviewPanels[0]!.dispose();

    expect(isWelcomeShownOnStartup(context)).to.equal(false);
    await provider().afterSignIn();
    expect(webviewPanels).to.have.length(1);
  });

  it('refreshes an open page after sign-in, so it lists the courses', async () => {
    let api: WelcomeApi | undefined;
    const page = new WelcomeWebviewProvider(context, { api: () => api, backendUrl: async () => undefined });
    await page.open();
    expect(latestHtml()).to.contain('data-action="login"');

    api = fakeApi;
    await page.afterSignIn();
    expect(webviewPanels).to.have.length(1);
    expect(latestHtml()).to.contain('Programming in Physics');
  });

  it('speaks to a course launched into the open page, in place and in its language', async () => {
    let launched: string | undefined;
    const page = new WelcomeWebviewProvider(context, {
      api: () => fakeApi, backendUrl: async () => undefined, launchedCourseId: () => launched
    });
    await page.open();
    expect(latestHtml()).to.contain('Welcome to Computor, Ada!');

    launched = 'c1';
    await page.refresh();
    expect(webviewPanels).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('Willkommen bei Computor');
    expect(latestHtml()).to.contain('<strong>Grundlagen</strong> ist links schon geöffnet.');
  });

  it('does not open a closed page on refresh', async () => {
    await provider().refresh();
    expect(webviewPanels).to.have.length(0);
  });
});

describe('welcome page contributions', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

  it('contributes the command under the Computor category', () => {
    const command = pkg.contributes.commands.find((c: { command: string }) => c.command === 'computor.welcome');
    expect(command?.category).to.equal('Computor');
    expect(command?.title).to.equal('Welcome and Help');
  });

  it('puts it at the top of the student, tutor and lecturer views', () => {
    const entry = pkg.contributes.menus['view/title'].find((m: { command: string }) => m.command === 'computor.welcome');
    for (const view of ['computor.student.courses', 'computor.tutor.filters', 'computor.lecturer.courses']) {
      expect(entry?.when).to.contain(`view == ${view}`);
    }
    expect(entry?.group).to.match(/^navigation@/);
  });

  it('draws the assignment row with the icons of package.json, in their order', () => {
    const svg = fs.readFileSync(path.join(process.cwd(), 'media/welcome/assignment-row.svg'), 'utf8');
    const icons = pkg.contributes.menus['view/item/context']
      .filter((m: { when?: string; group?: string; command: string }) =>
        (m.when ?? '').includes('^studentCourseContent\\.assignment') && m.when!.includes('view == computor.student.courses')
        && /^inline@/.test(m.group ?? '') && m.command !== 'computor.student.submitDownload')
      .sort((a: { group: string }, b: { group: string }) => Number(a.group.split('@')[1]) - Number(b.group.split('@')[1]))
      .map((m: { command: string }) => pkg.contributes.commands.find((c: { command: string }) => c.command === m.command).icon.replace(/^\$\((.*)\)$/, '$1'));

    expect(icons).to.deep.equal(['open-preview', 'git-commit', 'beaker', 'cloud-upload', 'comment-discussion']);
    const positions = icons.map((icon: CodiconName) => svg.indexOf(codiconPaths[icon]));
    expect(positions.every((position: number) => position >= 0), 'every icon is drawn').to.equal(true);
    expect([...positions].sort((a, b) => a - b)).to.deep.equal(positions);
    expect(svg).to.contain(contentIconSvg('#FFFF00', 'square', 'success-submitted'));
  });

  it('offers a walkthrough that reuses the row picture, in English and German', () => {
    const [walkthrough] = pkg.contributes.walkthroughs;
    const en = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.nls.json'), 'utf8'));
    const de = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.nls.de.json'), 'utf8'));
    const keys = JSON.stringify(walkthrough).match(/%[^%"]+%/g)!.map(key => key.slice(1, -1));

    expect(keys.length).to.be.greaterThan(0);
    for (const key of keys) {
      expect(en[key], key).to.be.a('string');
      expect(de[key], key).to.be.a('string');
    }
    expect(Object.keys(de).sort()).to.deep.equal(Object.keys(en).sort());
    for (const step of walkthrough.steps) {
      expect(fs.existsSync(path.join(process.cwd(), step.media.svg)), step.id).to.equal(true);
    }
    const commands = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
    for (const text of Object.values(en) as string[]) {
      for (const [, command] of text.matchAll(/\(command:([\w.]+)\)/g)) {
        const view = command!.replace(/\.focus$/, '');
        const known = commands.has(command!) || pkg.contributes.views['computor-student']?.some((v: { id: string }) => v.id === view);
        expect(known, command).to.equal(true);
      }
    }
  });
});
