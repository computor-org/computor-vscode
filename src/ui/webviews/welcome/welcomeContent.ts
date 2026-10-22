import { escapeHtml } from '../shared/webviewHelpers';
import { HELP_PAGES } from '../../../utils/studentHelpPages';
import { TUTOR_HELP_PAGES } from '../../../utils/tutorHelpPages';

/**
 * The Computor welcome page (computor-org/issues#374).
 *
 * What a student meets when the workspace opens: who they are, which courses
 * they are in, how to get from the course tree to a submitted assignment, where
 * the help pages are, what the Git colours mean, that the other edition
 * (browser or desktop) exists, and who builds and funds Computor.
 *
 * Free of `vscode` on purpose, like the help-page mappings it links to: the
 * provider gathers the facts, this turns them into markup, and a plain Node
 * test can check every variant (student, tutor, lecturer, browser, desktop,
 * signed out) without an extension host.
 */

export type WelcomeRole = 'student' | 'tutor' | 'lecturer';

const roleOrder: readonly WelcomeRole[] = ['student', 'tutor', 'lecturer'];

const roleLabels: Record<WelcomeRole, string> = {
  student: 'Student',
  tutor: 'Tutor',
  lecturer: 'Lecturer'
};

/** The activity-bar container each role's view lives in. */
export const welcomeRoleContainers: Record<WelcomeRole, string> = {
  student: 'computor-student',
  tutor: 'computor-tutor',
  lecturer: 'computor-lecturer'
};

export interface WelcomeCourse {
  id: string;
  title: string;
  roles: WelcomeRole[];
}

export interface WelcomeModel {
  /** False before sign-in: the page then offers to sign in instead of listing courses. */
  signedIn: boolean;
  givenName?: string;
  /** The role views this account has (`/user/views`), in display order. */
  roles: WelcomeRole[];
  courses: WelcomeCourse[];
  /** VS Code running in the browser (code-server) rather than on the desktop. */
  inBrowser: boolean;
  /** Public address of the Computor web app, where browser workspaces start. */
  webUrl?: string;
  /** The backend this window talks to — what a desktop install has to be pointed at. */
  backendUrl?: string;
  version?: string;
  showOnStartup: boolean;
  /**
   * The Computor logo as a data: URI. A webview resource URL is served through
   * the service worker that Firefox never routes under code-server (#267), so
   * the picture travels inside the document like every other asset.
   */
  logoDataUri?: string;
}

/** Fixed external destinations. The webview names one by key; it never sends a URL. */
export const welcomeLinks = {
  marketplace: 'https://marketplace.visualstudio.com/items?itemName=computor-org.computor',
  lecturerGuide: 'https://github.com/computor-org/computor-vscode/blob/main/docs/user-guide.md#lecturer-guide',
  teacherGuide: 'https://github.com/computor-org/computor-backend/blob/main/docs/teacher-guide.md',
  contributors: 'https://github.com/computor-org/computor-vscode/graphs/contributors',
  netidee: 'https://www.netidee.at/computor',
  source: 'https://github.com/computor-org',
  feedback: 'https://github.com/computor-org/feedback/issues'
} as const;

export type WelcomeLinkKey = keyof typeof welcomeLinks | 'workspaces';

/** The help pages bundled under docs/help that this page may open. */
const helpPages: ReadonlySet<string> = new Set<string>([
  ...Object.values(HELP_PAGES),
  ...Object.values(TUTOR_HELP_PAGES)
]);

/** More than this and the list stops being a greeting; the rest is counted. */
const maxListedCourses = 8;

// ------------------------------------------------------------------ facts

interface CourseLike {
  id?: string | null;
  title?: string | null;
  path?: string | null;
}

/** The slice of ComputorApiService the page reads. Every call may fail on its own. */
export interface WelcomeApi {
  getUserAccount(): Promise<{ given_name?: string | null } | undefined>;
  getUserViews(): Promise<string[]>;
  getStudentCourses(): Promise<CourseLike[]>;
  getTutorCourses(): Promise<CourseLike[]>;
  getLecturerCourses(): Promise<CourseLike[] | undefined>;
  getInstanceInfo(): Promise<{ web_url?: string | null } | undefined>;
}

export type WelcomeFacts = Pick<WelcomeModel, 'signedIn' | 'givenName' | 'roles' | 'courses' | 'webUrl'>;

async function settle<T>(promise: Promise<T | undefined | null>, fallback: T): Promise<T> {
  try {
    return (await promise) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Everything the page says about the account, from the backend.
 *
 * `api` is passed only while a session is active. A failing call leaves its
 * part out rather than failing the page: a welcome page that cannot open
 * because the course list timed out would be worse than one without the list.
 */
export async function collectWelcomeFacts(api: WelcomeApi | undefined): Promise<WelcomeFacts> {
  if (!api) {
    return { signedIn: false, roles: [], courses: [] };
  }

  const views = await settle(api.getUserViews(), [] as string[]);
  const roles = roleOrder.filter(role => views.includes(role));
  const none = Promise.resolve([] as CourseLike[]);

  const [account, student, tutor, lecturer, info] = await Promise.all([
    settle(api.getUserAccount(), undefined),
    roles.includes('student') ? settle(api.getStudentCourses(), [] as CourseLike[]) : none,
    roles.includes('tutor') ? settle(api.getTutorCourses(), [] as CourseLike[]) : none,
    roles.includes('lecturer') ? settle(api.getLecturerCourses(), [] as CourseLike[]) : none,
    settle(api.getInstanceInfo(), undefined)
  ]);

  return {
    signedIn: true,
    givenName: account?.given_name?.trim() || undefined,
    roles,
    courses: mergeCourses({ student, tutor, lecturer }),
    webUrl: httpUrl(info?.web_url)
  };
}

/** One row per course, carrying every role the user has in it. */
export function mergeCourses(byRole: Record<WelcomeRole, CourseLike[]>): WelcomeCourse[] {
  const courses = new Map<string, WelcomeCourse>();
  for (const role of roleOrder) {
    for (const course of byRole[role] ?? []) {
      if (!course?.id) continue;
      const known = courses.get(course.id);
      if (known) {
        if (!known.roles.includes(role)) known.roles.push(role);
        continue;
      }
      courses.set(course.id, {
        id: course.id,
        title: course.title?.trim() || course.path?.trim() || 'Untitled course',
        roles: [role]
      });
    }
  }
  return [...courses.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** A server-supplied address is only ever used as an http(s) link. */
function httpUrl(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/+$/, '') : undefined;
}

// --------------------------------------------------------------- messages

export type WelcomeIntent =
  | { kind: 'help'; page: string }
  | { kind: 'link'; url: string }
  | { kind: 'view'; role: WelcomeRole }
  | { kind: 'login' }
  | { kind: 'showOnStartup'; value: boolean };

export function welcomeLinkUrl(key: unknown, model: WelcomeModel): string | undefined {
  if (key === 'workspaces') {
    return model.webUrl ? `${model.webUrl}/workspaces` : undefined;
  }
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(welcomeLinks, key)
    ? welcomeLinks[key as keyof typeof welcomeLinks]
    : undefined;
}

/**
 * Turn a message from the webview into something the extension may do.
 *
 * The webview is untrusted input: it names a help page, a link key or a role,
 * and only names on the lists above get through. Anything else is undefined.
 */
export function resolveWelcomeMessage(message: unknown, model: WelcomeModel): WelcomeIntent | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const { command, data } = message as { command?: unknown; data?: Record<string, unknown> };

  switch (command) {
    case 'help': {
      const page = data?.page;
      return typeof page === 'string' && helpPages.has(page) ? { kind: 'help', page } : undefined;
    }
    case 'link': {
      const url = welcomeLinkUrl(data?.key, model);
      return url ? { kind: 'link', url } : undefined;
    }
    case 'view': {
      const role = data?.role;
      return roleOrder.includes(role as WelcomeRole) && model.roles.includes(role as WelcomeRole)
        ? { kind: 'view', role: role as WelcomeRole }
        : undefined;
    }
    case 'login':
      return model.signedIn ? undefined : { kind: 'login' };
    case 'showOnStartup':
      return typeof data?.value === 'boolean' ? { kind: 'showOnStartup', value: data.value } : undefined;
    default:
      return undefined;
  }
}

// ----------------------------------------------------------------- markup

function helpButton(page: string, label: string): string {
  return `<button type="button" class="btn secondary sm" data-action="help" data-page="${escapeHtml(page)}">${escapeHtml(label)}</button>`;
}

function linkButton(key: WelcomeLinkKey, label: string): string {
  return `<button type="button" class="btn secondary sm" data-action="link" data-link="${key}">${escapeHtml(label)}</button>`;
}

function viewButton(role: WelcomeRole, primary: boolean): string {
  const variant = primary ? 'btn' : 'btn secondary';
  return `<button type="button" class="${variant}" data-action="view" data-role="${role}">Open the ${roleLabels[role]} view</button>`;
}

/** A button beside the sentence that says what is behind it. */
function linkRows(rows: Array<[button: string, description: string]>): string {
  return `<div class="welcome-links">${rows
    .map(([button, description]) => `<div>${button}</div><p class="text-muted">${description}</p>`)
    .join('')}</div>`;
}

function section(id: string, title: string, body: string, description?: string): string {
  return `<div class="section" id="${id}">
    <h2>${escapeHtml(title)}</h2>
    <div class="stack tight">
      ${description ? `<p class="section-description">${description}</p>` : ''}
      ${body}
    </div>
  </div>`;
}

function renderHero(model: WelcomeModel): string {
  const name = model.givenName ? `, ${escapeHtml(model.givenName)}` : '';
  const logo = model.logoDataUri
    ? `<img class="welcome-logo" src="${escapeHtml(model.logoDataUri)}" alt="Computor logo">`
    : '';
  return `<div class="header welcome-hero">
    ${logo}
    <div>
      <h1>Welcome to Computor${name}!</h1>
      <p>Your courses inside VS Code: read the task, write and test your code, and hand it in.</p>
    </div>
  </div>`;
}

function renderCourses(model: WelcomeModel): string {
  if (!model.signedIn) {
    return section('welcome-sign-in', 'Your courses', `
      <div class="notice info">You are not signed in. Sign in to see your courses.</div>
      <div class="actions"><button type="button" class="btn" data-action="login">Sign in</button></div>`);
  }

  const listed = model.courses.slice(0, maxListedCourses);
  const hidden = model.courses.length - listed.length;
  const list = listed.length
    ? `<ul class="welcome-courses">${listed.map(course => `
        <li class="welcome-course">
          <span>${escapeHtml(course.title)}</span>
          ${course.roles.map(role => `<span class="badge badge-info xs">${roleLabels[role]}</span>`).join(' ')}
        </li>`).join('')}
      </ul>${hidden > 0 ? `<p class="text-muted">…and ${hidden} more.</p>` : ''}`
    : '<p class="text-muted">You are not in any course yet. Courses appear here and in the Computor views as soon as you are added to one.</p>';

  const buttons = model.roles.map((role, index) => viewButton(role, index === 0)).join('');
  const intro = model.courses.length === 1
    ? 'Welcome to your course!'
    : model.courses.length > 1 ? 'Welcome to your courses!' : '';
  return section('welcome-courses', 'Your courses', `
    ${intro ? `<p>${intro}</p>` : ''}
    ${list}
    ${buttons ? `<div class="actions">${buttons}</div>` : ''}`);
}

/**
 * From the course tree to a submitted assignment.
 *
 * Every step names what is on screen in the Student view — the container
 * title, the row actions and their icons (package.json), the Results panel —
 * so a student can follow it without knowing VS Code.
 */
function renderTutorial(): string {
  const steps = [
    ['Open the Student view.',
      'Click the <strong>Computor Student</strong> icon (a book) in the Activity Bar on the far left. In a workspace started for a course, it is already open.'],
    ['Open your course.',
      'Under <strong>Courses</strong>, click your course to expand it. If your university or department is listed first, expand it until you reach the course. Units group the material; assignments sit inside them.'],
    ['Read the task.',
      'Click an assignment\'s title. Its instructions open beside your code; nothing is downloaded yet.'],
    ['Get the files.',
      'Click the arrow in front of the assignment to expand it. The first time, Computor sets up your personal course repository, which takes a moment. Then the assignment\'s starting files appear underneath.'],
    ['Write your solution.',
      'Click a file to open and edit it. Keep the file names the task asks for: the tests look for them.'],
    ['Test it.',
      'Click the beaker icon on the assignment row, or right-click it and choose <em>Test Assignment</em>. Computor saves, commits and uploads your work and runs the tests on the server; the results appear in the <strong>Results</strong> panel. If test runs are limited, each one counts.'],
    ['Submit.',
      'When you are happy with the result, click the cloud icon with the arrow (<em>Submit</em>). This hands the assignment in for grading — the version you last tested. Submissions may be limited too.']
  ];

  return section('welcome-tutorial', 'Start working on an assignment', `
    <ol class="welcome-steps">
      ${steps.map(([title, text]) => `<li><strong>${title}</strong> ${text}</li>`).join('')}
    </ol>
    <p><strong>Commit as you go.</strong> The commit icon on an assignment, or <em>Commit Course</em> on the course row, saves your work on the server. That is your backup; it is not a submission.</p>
    <p><strong>Stuck?</strong> The speech-bubble icon on an assignment (<em>Show Messages</em>) lets you ask your lecturer and tutors.</p>
    <p class="text-muted">Not every course uses every step. If an icon is missing, right-click the assignment to see what your course offers.</p>`,
  'Seven steps from your course to a submitted solution.');
}

function renderHelp(): string {
  return section('welcome-help', 'Help pages', linkRows([
    [helpButton(HELP_PAGES.course, 'Courses'),
      'Your course repository, committing versus submitting, and the marks on a row.'],
    [helpButton(HELP_PAGES.unit, 'Units and readings'),
      'How a course is organised, and material you read rather than hand in.'],
    [helpButton(HELP_PAGES.assignment, 'Assignments'),
      'Working, testing and submitting, managing files, and getting a file back.']
  ]), 'Short guides that come with the extension. In the Student view, right-click any row and choose <em>Help</em> to open the page for it.');
}

/**
 * The colours Git paints over the editor (computor-org/issues#374, comment by
 * Steffi276). The samples are drawn in the user's own theme colours, through
 * the --c-git-* tokens, so they match what is on screen.
 */
function renderGitColours(): string {
  const rows: Array<[string, string]> = [
    ['<span class="git-line added" aria-hidden="true"></span>Green bar beside a line', 'You added this line.'],
    ['<span class="git-line modified" aria-hidden="true"></span>Blue bar beside a line', 'You changed this line.'],
    ['<span class="git-line deleted" aria-hidden="true"></span>Red marker between lines', 'Lines were deleted here.'],
    ['<span class="git-file untracked">solution.py<span class="git-letter">U</span></span>', 'A new file that has not been committed yet.'],
    ['<span class="git-file modified">solution.py<span class="git-letter">M</span></span>', 'A file you changed since your last commit.']
  ];

  return section('welcome-git-colours', 'Colours in the editor and the file tree', `
    <table class="table">
      <thead><tr><th>You see</th><th>It means</th></tr></thead>
      <tbody>${rows.map(([sample, meaning]) => `<tr><td>${sample}</td><td>${meaning}</td></tr>`).join('')}</tbody>
    </table>
    <p>The bars appear in the editor next to the line numbers; the coloured names with a letter appear in the Explorer and in the Student view. The exact colours depend on your theme.</p>
    <p>The Student view adds its own marks to a row: <code>●</code> changes not committed yet, <code>↑</code> committed but not uploaded yet, <code>⚠</code> uploading fails.</p>
    <div class="actions">${helpButton(HELP_PAGES.course, 'More about the marks')}</div>`,
  'They come from Git and compare your files with your last commit. Nothing is wrong when you see them; they go away when you commit.');
}

/** Point each edition at the other one (browser ↔ desktop). */
function renderOtherEdition(model: WelcomeModel): string {
  const switching = '<p>Commit before you switch, so your latest work is on the server.</p>';

  if (model.inBrowser) {
    const backend = model.backendUrl
      ? `run <strong>Computor: Change Backend URL</strong> and enter <code>${escapeHtml(model.backendUrl)}</code>`
      : 'run <strong>Computor: Change Backend URL</strong> and enter the address your course gives you';
    return section('welcome-desktop', 'Computor on your own computer', `
      <ol class="welcome-steps">
        <li>Install Visual Studio Code and Git.</li>
        <li>Install the <strong>Computor</strong> extension from the Visual Studio Marketplace.</li>
        <li>Open an empty folder, press <kbd>F1</kbd> and ${backend}.</li>
        <li>Run <strong>Computor: Login</strong> and sign in in your browser.</li>
      </ol>
      ${switching}
      <div class="actions">${linkButton('marketplace', 'Open the Marketplace page')}</div>`,
    'You are using Computor in the browser. It also runs in Visual Studio Code on your own computer, with the same account and the same courses.');
  }

  const website = model.webUrl
    ? `<div class="actions">${linkButton('workspaces', 'Open Workspaces on the website')}</div>`
    : '';
  return section('welcome-browser', 'Computor in the browser', `
    <p>If your course offers online workspaces, start one on the Computor website under <strong>Workspaces</strong> and open your course there.</p>
    ${switching}
    ${website}`,
  'Computor also runs in the browser, with nothing to install and the same account and courses.');
}

function renderStaff(model: WelcomeModel): string {
  const isTutor = model.roles.includes('tutor');
  const isLecturer = model.roles.includes('lecturer');
  if (!isTutor && !isLecturer) return '';

  const icons = [
    isTutor ? '<strong>Computor Tutor</strong> for reviewing and grading' : '',
    isLecturer ? '<strong>Computor Lecturer</strong> for building and releasing course content' : ''
  ].filter(Boolean).join(', and ');

  const rows: Array<[string, string]> = [
    [helpButton(TUTOR_HELP_PAGES.course, 'The Tutor view'),
      'Picking a student and finding the work waiting for review.'],
    [helpButton(TUTOR_HELP_PAGES.assignment, 'Grading an assignment'),
      'Inspecting, testing and grading one submission, and the message that goes with it.']
  ];
  if (isLecturer) {
    rows.push(
      [linkButton('lecturerGuide', 'Lecturer guide'),
        'Courses, content, examples and releases in the Lecturer view (online).'],
      [linkButton('teacherGuide', 'Course dashboard guide'),
        'Course statistics, flags and grading pages in the Computor web app (online).']
    );
  }

  return section('welcome-staff', 'For tutors and lecturers', linkRows(rows),
    `Teaching has its own icons in the Activity Bar: ${icons}.`);
}

/** Who makes Computor and who pays for it — as stated in LICENSE and the computor.at imprint. */
function renderCredits(model: WelcomeModel): string {
  return section('welcome-credits', 'About Computor', `
    <p>Computor is a project of the Institute of Theoretical Physics – Computational Physics (ITPcp) at Graz University of Technology, led by Christopher Albert, and is developed by Maximilian Mandlez and the Computor team.</p>
    <p>Financially supported and made possible by the netidee funding programme of the Internet Privatstiftung Austria (project 8012).</p>
    <p>Computor is open source under the MIT license.</p>
    <div class="actions">
      ${linkButton('contributors', 'Contributors')}
      ${linkButton('netidee', 'netidee project page')}
      ${linkButton('source', 'Source code')}
      ${linkButton('feedback', 'Feedback and bug reports')}
    </div>
    ${model.version ? `<p class="text-muted">Computor extension ${escapeHtml(model.version)}</p>` : ''}`);
}

function renderStartupToggle(model: WelcomeModel): string {
  return `<div class="welcome-footer">
    <label class="welcome-startup">
      <input type="checkbox" id="show-on-startup"${model.showOnStartup ? ' checked' : ''}>
      Show this page when Computor starts
    </label>
    <p class="text-muted">Open it again any time with <strong>Computor: Welcome and Help</strong>, or the question-mark icon at the top of the Computor views.</p>
  </div>`;
}

/** The page body; the provider wraps it with base.css, the view stylesheet and script. */
export function renderWelcomeBody(model: WelcomeModel): string {
  // Before sign-in the role is unknown, and most people opening Computor are
  // students — so the tutorial shows unless the account is known not to be one.
  const showTutorial = !model.signedIn || model.roles.includes('student');
  return `<div class="page-root welcome-page">
    ${renderHero(model)}
    ${renderCourses(model)}
    ${showTutorial ? renderTutorial() : ''}
    ${renderHelp()}
    ${renderStaff(model)}
    ${renderGitColours()}
    ${renderOtherEdition(model)}
    ${renderCredits(model)}
    ${renderStartupToggle(model)}
  </div>`;
}
