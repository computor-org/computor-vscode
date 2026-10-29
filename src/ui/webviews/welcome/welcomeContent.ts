import { escapeHtml } from '../shared/webviewHelpers';
import { HELP_PAGES } from '../../../utils/studentHelpPages';
import { TUTOR_HELP_PAGES } from '../../../utils/tutorHelpPages';
import { resolveContentLanguage } from '../../../utils/contentLanguage';
import { courseStartPointer, hasStartedCourse } from '../../../utils/courseStart';
import { contentIconSvg, ContentIconBadge, ContentIconCorner, ContentIconShape } from '../../../utils/contentIconSvg';
import { codicon, CodiconName } from './codicons';
import { defaultSettings } from '../../../types/SettingsTypes';
import type { CourseContentStudentList } from '../../../types/generated';

/**
 * The Computor welcome page (computor-org/issues#374).
 *
 * What a student meets when the workspace opens: who they are, which courses
 * they are in, how to get from the course tree to a submitted assignment, where
 * the help pages are, what the Git colours mean, that the other edition
 * (browser or desktop) exists, and who builds and funds Computor. Connecting
 * a desktop VS Code is one set of steps, shown both in the browser edition
 * and on a desktop that is not signed in yet (computor-org/issues#366).
 *
 * Free of `vscode` on purpose, like the help-page mappings it links to: the
 * provider gathers the facts, this turns them into markup, and a plain Node
 * test can check every variant (student, tutor, lecturer, browser, desktop,
 * signed out) without an extension host.
 *
 * The page speaks German when the learner's profile language, or else the
 * launched course's language, is German (computor-org/issues#527), and
 * English otherwise.
 */

export type WelcomeLanguage = 'en' | 'de';

/** The course a hosted workspace was launched for (computor-org/issues#432). */
export interface WelcomeLaunch {
  title: string;
  /** Where to begin, as the course tree shows it: "Woche 1 → Mathematische Konstanten". */
  startHere?: string;
  /** The learner has started, so `startHere` is the next open assignment (computor-org/issues#525). */
  resume?: boolean;

}

export type WelcomeRole = 'student' | 'tutor' | 'lecturer';

const roleOrder: readonly WelcomeRole[] = ['student', 'tutor', 'lecturer'];

const roleLabels: Record<WelcomeRole, string> = {
  student: 'Student',
  tutor: 'Tutor',
  lecturer: 'Lecturer'
};

/** A course's role badge in the page language, as the web app names it. */
const roleBadges: Record<WelcomeRole, [string, string]> = {
  student: ['Student', 'Studierende'],
  tutor: ['Tutor', 'Tutor'],
  lecturer: ['Lecturer', 'Lehrende']
};

/**
 * The names VS Code shows for Computor's commands, views and menus, English and
 * German as in package.nls.json and package.nls.de.json (a test keeps them
 * equal).
 */
export const workbenchNames = {
  'computor.student.help': ['Help', 'Hilfe'],
  'computor.student.showPreview': ['Show README Preview', 'Anleitung anzeigen'],
  'computor.student.commitAssignment': ['Commit Assignment', 'Aufgabe sichern (Commit)'],
  'computor.student.commitCourse': ['Commit Course', 'Kurs sichern (Commit)'],
  'computor.student.testAssignment': ['Test Assignment', 'Aufgabe testen'],
  'computor.student.submitAssignment': ['Submit', 'Abgeben'],
  'computor.student.showMessages': ['Show Messages', 'Nachrichten anzeigen'],
  'computor.showContentDescription': ['Show Description', 'Beschreibung anzeigen'],
  'computor-test-results': ['Results', 'Ergebnisse'],
  'computor.student.courses': ['Courses', 'Kurse'],
  'computor.welcome': ['Welcome and Help', 'Willkommen und Hilfe'],
  'computor.changeRealmUrl': ['Change Backend URL', 'Backend-URL ändern'],
  'computor.login': ['Login', 'Anmelden'],
  'computor-student': ['Computor Student', 'Computor Studierende'],
  'computor-tutor': ['Computor Tutor', 'Computor Tutor'],
  'computor-lecturer': ['Computor Lecturer', 'Computor Lehrende'],
  'computor.tutor.filters': ['Courses & Members', 'Kurse und Teilnehmende'],
  'computor.tutor.courses': ['Courses', 'Kurse'],
  'computor.lecturer.courses': ['Courses', 'Kurse'],
  'computor.lecturer.examples': ['Examples', 'Beispiele']
} as const;

export type WorkbenchName = keyof typeof workbenchNames;
type Names = (key: WorkbenchName) => string;

function namer(model: Pick<WelcomeModel, 'workbenchLanguage'>): Names {
  return key => workbenchNames[key][model.workbenchLanguage === 'de' ? 1 : 0];
}

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
  /** Absent means English. */
  language?: WelcomeLanguage;
  /**
   * The VS Code display language. Command and view names on the page follow
   * it rather than the page language, so that they read as the tooltips and
   * panel titles on screen do. Absent means English.
   */
  workbenchLanguage?: WelcomeLanguage;
  /** Only in a workspace launched for one course. */
  launch?: WelcomeLaunch;
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
  /**
   * The annotated assignment row (media/welcome/assignment-row.svg), as
   * markup. Inline for the same reason as the logo, and so that it draws in
   * the theme's own colours (computor-org/issues#526).
   */
  rowPictureSvg?: string;
}

/** Fixed external destinations. The webview names one by key; it never sends a URL. */
export const welcomeLinks = {
  marketplace: 'https://marketplace.visualstudio.com/items?itemName=computor-org.computor',
  lecturerGuide: 'https://github.com/computor-org/computor-vscode/blob/main/docs/user-guide.md#lecturer-guide',
  teacherGuide: 'https://github.com/computor-org/computor-backend/blob/main/docs/teacher-guide.md',
  contributors: 'https://github.com/computor-org/computor-vscode/graphs/contributors',
  netidee: 'https://www.netidee.at/computor',
  source: 'https://github.com/computor-org',
  feedback: 'https://computor.at/problem',
  website: 'https://computor.at'
} as const;

/**
 * The API of computor.at, where its website sends desktop VS Code
 * (computor-org/issues#366). Suggested when this window is still on the
 * built-in development default, which no learner can sign in to.
 */
export const publicBackendUrl = 'https://computor.at/api';

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
  position?: number | null;
  id?: string | null;
  title?: string | null;
  path?: string | null;
}

/** The slice of ComputorApiService the page reads. Every call may fail on its own. */
export interface WelcomeApi {
  getUserAccount(): Promise<{ given_name?: string | null; profile?: { language_code?: string | null } | null } | undefined>;
  getUserViews(): Promise<string[]>;
  getStudentCourses(): Promise<CourseLike[]>;
  getTutorCourses(): Promise<CourseLike[]>;
  getLecturerCourses(): Promise<CourseLike[] | undefined>;
  getInstanceInfo(): Promise<{ web_url?: string | null } | undefined>;
  getCourse(courseId: string): Promise<{ title?: string | null; path?: string; language_code?: string | null } | undefined>;
  getStudentCourseContents(courseId: string): Promise<CourseContentStudentList[]>;
}

export type WelcomeFacts = Pick<WelcomeModel, 'signedIn' | 'givenName' | 'roles' | 'courses' | 'webUrl' | 'language' | 'launch'>;

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
 * `launchedCourseId` names the course a hosted workspace was started for.
 */
export async function collectWelcomeFacts(api: WelcomeApi | undefined, launchedCourseId?: string): Promise<WelcomeFacts> {
  if (!api) {
    return { signedIn: false, roles: [], courses: [] };
  }

  const views = await settle(api.getUserViews(), [] as string[]);
  const roles = roleOrder.filter(role => views.includes(role));
  const none = Promise.resolve([] as CourseLike[]);

  const [account, student, tutor, lecturer, info, launchedCourse, contents] = await Promise.all([
    settle(api.getUserAccount(), undefined),
    roles.includes('student') ? settle(api.getStudentCourses(), [] as CourseLike[]) : none,
    roles.includes('tutor') ? settle(api.getTutorCourses(), [] as CourseLike[]) : none,
    roles.includes('lecturer') ? settle(api.getLecturerCourses(), [] as CourseLike[]) : none,
    settle(api.getInstanceInfo(), undefined),
    launchedCourseId ? settle(api.getCourse(launchedCourseId), undefined) : undefined,
    launchedCourseId ? settle(api.getStudentCourseContents(launchedCourseId), [] as CourseContentStudentList[]) : []
  ]);

  const language = welcomeLanguage(account?.profile?.language_code, launchedCourse?.language_code);
  const courses = mergeCourses({ student, tutor, lecturer });
  const launchedTitle = launchedCourse?.title?.trim() || launchedCourse?.path?.trim()
    || courses.find(course => course.id === launchedCourseId)?.title;
  return {
    signedIn: true,
    givenName: account?.given_name?.trim() || undefined,
    roles,
    courses,
    webUrl: httpUrl(info?.web_url),
    language,
    launch: launchedCourseId && launchedTitle ? {
      title: launchedTitle,
      startHere: courseStartPointer(contents, language),
      resume: hasStartedCourse(contents)
    } : undefined
  };
}

/** The learner's own choice wins, then the launched course's language (as for the course landing). */
export function welcomeLanguage(userLanguage?: string | null, courseLanguage?: string | null): WelcomeLanguage {
  return resolveContentLanguage(userLanguage, courseLanguage).startsWith('de') ? 'de' : 'en';
}

/** Mirror the server's course order when combining separately ordered role lists. */
function compareCourses(a: CourseLike, b: CourseLike): number {
  const aPosition = typeof a.position === 'number' && Number.isFinite(a.position) ? a.position : Infinity;
  const bPosition = typeof b.position === 'number' && Number.isFinite(b.position) ? b.position : Infinity;
  if (aPosition !== bPosition) return aPosition < bPosition ? -1 : 1;
  const aTitle = a.title ?? null;
  const bTitle = b.title ?? null;
  if (aTitle === null && bTitle !== null) return 1;
  if (aTitle !== null && bTitle === null) return -1;
  const titleOrder = (aTitle ?? '').localeCompare(bTitle ?? '');
  return titleOrder || (a.id ?? '').localeCompare(b.id ?? '');
}

/** One row per course, carrying every role the user has in it. */
export function mergeCourses(byRole: Record<WelcomeRole, CourseLike[]>): WelcomeCourse[] {
  const courses = new Map<string, CourseLike & { id: string; roles: WelcomeRole[] }>();
  for (const role of roleOrder) {
    for (const course of byRole[role] ?? []) {
      if (!course?.id) continue;
      const known = courses.get(course.id);
      if (known) {
        if (!known.roles.includes(role)) known.roles.push(role);
        continue;
      }
      courses.set(course.id, { ...course, id: course.id, roles: [role] });
    }
  }
  return [...courses.values()].sort(compareCourses).map(course => ({
    id: course.id,
    title: course.title?.trim() || course.path?.trim() || 'Untitled course',
    roles: course.roles
  }));
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
  | { kind: 'setBackend' }
  | { kind: 'reportProblem' }
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
    case 'setBackend':
      return model.signedIn ? undefined : { kind: 'setBackend' };
    case 'reportProblem':
      return model.signedIn ? { kind: 'reportProblem' } : undefined;
    case 'showOnStartup':
      return typeof data?.value === 'boolean' ? { kind: 'showOnStartup', value: data.value } : undefined;
    default:
      return undefined;
  }
}

// ----------------------------------------------------------------- markup

/** English first, German second: the page picks one by the model's language. */
type Say = (en: string, de: string) => string;

function sayer(model: Pick<WelcomeModel, 'language'>): Say {
  return (en, de) => (model.language === 'de' ? de : en);
}

/** Tutors and lecturers hold the student role too; their page opens on teaching (computor-org/issues#541). */
function isStaff(model: Pick<WelcomeModel, 'roles'>): boolean {
  return model.roles.includes('tutor') || model.roles.includes('lecturer');
}

function helpButton(page: string, label: string): string {
  return `<button type="button" class="btn secondary sm" data-action="help" data-page="${escapeHtml(page)}">${escapeHtml(label)}</button>`;
}

function linkButton(key: WelcomeLinkKey, label: string): string {
  return `<button type="button" class="btn secondary sm" data-action="link" data-link="${key}">${escapeHtml(label)}</button>`;
}

function viewButton(role: WelcomeRole, primary: boolean, say: Say): string {
  const variant = primary ? 'btn' : 'btn secondary';
  const label = say(`Open the ${roleLabels[role]} view`, `${roleLabels[role]}-Ansicht öffnen`);
  return `<button type="button" class="${variant}" data-action="view" data-role="${role}">${label}</button>`;
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

/** The window title, in the page's language. */
export function welcomeTitle(model?: Pick<WelcomeModel, 'language'>): string {
  return model?.language === 'de' ? 'Willkommen bei Computor' : 'Welcome to Computor';
}

function renderHero(model: WelcomeModel, say: Say): string {
  const name = model.givenName ? `, ${escapeHtml(model.givenName)}` : '';
  const logo = model.logoDataUri
    ? `<img class="welcome-logo" src="${escapeHtml(model.logoDataUri)}" alt="Computor logo">`
    : '';
  return `<div class="header welcome-hero">
    ${logo}
    <div>
      <h1>${welcomeTitle(model)}${name}!</h1>
      <p>${isStaff(model)
        ? say('Your teaching inside VS Code: review, test and grade what your students hand in, and see the course as they see it.',
          'Deine Lehre in VS Code: Abgaben deiner Studierenden durchsehen, testen und bewerten und den Kurs so sehen, wie sie ihn sehen.')
        : say('Your courses inside VS Code: read the task, write and test your code, and hand it in.',
          'Deine Kurse in VS Code: Aufgabe lesen, Code schreiben und testen, Lösung abgeben.')}</p>
    </div>
  </div>`;
}

function renderCourses(model: WelcomeModel, say: Say): string {
  const title = say('Your courses', 'Deine Kurse');
  if (!model.signedIn) {
    const notice = `<div class="notice info">${say('You are not signed in. Sign in to see your courses.',
      'Du bist nicht angemeldet. Melde dich an, um deine Kurse zu sehen.')}</div>`;
    const signIn = `<button type="button" class="btn" data-action="login">${say('Sign in', 'Anmelden')}</button>`;
    if (model.inBrowser) {
      return section('welcome-sign-in', title, `${notice}<div class="actions">${signIn}</div>`);
    }
    // A desktop install starts on the development default and knows no
    // account yet: the same steps as the browser edition's pointer, from the
    // point the extension is installed (computor-org/issues#366).
    return section('welcome-sign-in', title, `
      ${notice}
      ${desktopConnectSteps(model, say, { install: false })}
      <div class="actions">
        ${signIn}
        <button type="button" class="btn secondary" data-action="setBackend">${say('Set the backend URL', 'Backend-URL festlegen')}</button>
        <button type="button" class="btn secondary" data-action="link" data-link="website">${say('Computor website', 'Computor-Website')}</button>
      </div>`);
  }

  const listed = model.courses.slice(0, maxListedCourses);
  const hidden = model.courses.length - listed.length;
  const list = listed.length
    ? `<ul class="welcome-courses">${listed.map(course => `
        <li class="welcome-course">
          <span>${escapeHtml(course.title)}</span>
          ${course.roles.map(role => `<span class="badge badge-info xs">${say(...roleBadges[role])}</span>`).join(' ')}
        </li>`).join('')}
      </ul>${hidden > 0 ? `<p class="text-muted">${say(`…and ${hidden} more.`, `…und ${hidden} weitere.`)}</p>` : ''}`
    : `<p class="text-muted">${say(
      'You are not in any course yet. Courses appear here and in the Computor views as soon as you are added to one.',
      'Du bist noch in keinem Kurs. Kurse erscheinen hier und in den Computor-Ansichten, sobald du in einen aufgenommen wirst.')}</p>`;

  // A launched workspace already shows the Student view; offering to open it
  // again leads nowhere (computor-org/issues#527).
  const offered = model.launch ? model.roles.filter(role => role !== 'student') : model.roles;
  const roles = isStaff(model) ? [...offered.filter(role => role !== 'student'), ...offered.filter(role => role === 'student')] : offered;
  const buttons = roles.map((role, index) => viewButton(role, index === 0, say)).join('');
  const intro = model.courses.length === 1
    ? say('Welcome to your course!', 'Willkommen in deinem Kurs!')
    : model.courses.length > 1 ? say('Welcome to your courses!', 'Willkommen in deinen Kursen!') : '';
  return section('welcome-courses', title, `
    ${intro ? `<p>${intro}</p>` : ''}
    ${list}
    ${buttons ? `<div class="actions">${buttons}</div>` : ''}`);
}

/** A row action as the tree shows it: its icon, then its tooltip text. */
function action(name: CodiconName, label: string): string {
  return `<span class="welcome-action">${codicon(name)}<em>${escapeHtml(label)}</em></span>`;
}

/**
 * The five actions on the assignment row, in their native inline order
 * (package.json), numbered for the guide.
 */
function rowActions(say: Say, n: Names): Array<[CodiconName, string, string]> {
  const results = n('computor-test-results');
  return [
    ['open-preview', n('computor.student.showPreview'), say('Read the task.', 'Aufgabe lesen.')],
    ['git-commit', n('computor.student.commitAssignment'), say('Back up your work on the server. Not a submission.', 'Arbeit auf dem Server sichern. Das ist keine Abgabe.')],
    ['beaker', n('computor.student.testAssignment'), say(`Run the tests. The result appears under <strong>${results}</strong>.`, `Tests ausführen. Das Ergebnis erscheint unter <strong>${results}</strong>.`)],
    ['cloud-upload', n('computor.student.submitAssignment'), say('Hand the assignment in for grading.', 'Aufgabe zur Bewertung abgeben.')],
    ['comment-discussion', n('computor.student.showMessages'), say('Messages and questions about this assignment.', 'Nachrichten und Fragen zu dieser Aufgabe.')]
  ];
}

/** The picture of a native assignment row; the steps below it name its icons. */
function renderRowOnly(model: Pick<WelcomeModel, 'rowPictureSvg'>, say: Say): string {
  return model.rowPictureSvg
    ? `<figure class="welcome-row"><div class="welcome-row-picture" role="img" aria-label="${escapeHtml(say(
      'An assignment row with its title and action icons.',
      'Eine Aufgabenzeile mit ihrem Titel und ihren Aktionssymbolen.'))}">${model.rowPictureSvg}</div></figure>`
    : '';
}

/** The native assignment row and its action legend. */
function renderRowPicture(model: Pick<WelcomeModel, 'rowPictureSvg' | 'workbenchLanguage'>, say: Say, compact = false): string {
  const picture = model.rowPictureSvg
    ? `<div class="welcome-row-picture" role="img" aria-label="${escapeHtml(say(
      'An assignment row with its title and action icons.',
      'Eine Aufgabenzeile mit ihrem Titel und ihren Aktionssymbolen.'))}">${model.rowPictureSvg}</div>`
    : '';
  const actions = rowActions(say, namer(model)).map((row, index) => ({ row, index }))
    .filter(({ index }) => !compact || [0, 2, 3].includes(index))
    .map(({ row: [icon, label, meaning], index }) => `
      <li>${compact ? '' : `<span class="welcome-callout" aria-hidden="true">${index + 1}</span>`}${action(icon, label)}${compact ? '' : `<span class="text-muted">${meaning}</span>`}</li>`).join('');
  return `<figure class="welcome-row">
      ${picture}
      <ol class="welcome-row-legend">${actions}
      </ol>
    </figure>`;
}

/** Course questions use Messages; technical problems use support tickets. */
function renderAskForHelp(model: WelcomeModel, say: Say): string {
  const stuck = `<strong>${say('Stuck?', 'Kommst du nicht weiter?')}</strong>`;
  const messages = action('comment-discussion', namer(model)('computor.student.showMessages'));
  const ask = say(`${stuck} Choose ${messages} on an assignment row to ask for help in this course.`,
    `${stuck} Wähle ${messages} an einer Aufgabenzeile, um in diesem Kurs um Hilfe zu bitten.`);
  if (!model.signedIn) return `<p>${ask}</p>`;

  const ticket = say('For a technical problem with Computor itself, open a support ticket.',
    'Bei einem technischen Problem mit Computor selbst eröffne ein Support-Ticket.');
  return `<p>${ask}</p>
    <div class="welcome-links"><div><button type="button" class="btn secondary sm" data-action="reportProblem">${say('Report a problem', 'Problem melden')}</button></div><p class="text-muted">${ticket}</p></div>`;
}

/**
 * From the course tree to a submitted assignment.
 *
 * Every step names what is on screen in the Student view — the container
 * title, the row actions and their icons (package.json), the Results panel —
 * so a student can follow it without knowing VS Code. The labels follow the
 * VS Code display language (workbenchLanguage), because the workbench shows
 * them so: English names in a German text when VS Code itself is English.
 */
function renderTutorial(model: WelcomeModel, say: Say): string {
  const n = namer(model);
  const openCourse: [string, string] = model.launch
    ? [say('Your course is already open.', 'Dein Kurs ist schon geöffnet.'),
      say(`In the Student view on the left, <strong>${escapeHtml(model.launch.title)}</strong> is already expanded. Units group the material; assignments sit inside them.`,
        `Links in der Student-Ansicht ist <strong>${escapeHtml(model.launch.title)}</strong> schon aufgeklappt. Einheiten gliedern den Stoff, und in ihnen liegen die Aufgaben.`)]
    : [say('Open your course.', 'Öffne deinen Kurs.'),
      say(`Under <strong>${n('computor.student.courses')}</strong>, click your course to expand it. If your university or department is listed first, expand it until you reach the course. Units group the material; assignments sit inside them.`,
        `Klicke unter <strong>${n('computor.student.courses')}</strong> auf deinen Kurs, um ihn aufzuklappen. Steht davor deine Universität oder dein Institut, klappe weiter auf, bis du beim Kurs bist. Einheiten gliedern den Stoff, und in ihnen liegen die Aufgaben.`)];
  const description = say(` If a unit has a description, open it with the book ${action('book', n('computor.showContentDescription'))} on its row.`,
    ` Hat eine Einheit eine Beschreibung, öffnest du sie mit dem Buch ${action('book', n('computor.showContentDescription'))} in ihrer Zeile.`);
  openCourse[1] += description;
  const steps: Array<[string, string]> = [
    [say('Open the Student view.', 'Öffne die Student-Ansicht.'),
      say(`Click the book ${codicon('book')} <strong>${n('computor-student')}</strong> in the Activity Bar on the far left. In a workspace started for a course, it is already open.`,
        `Klicke in der Aktivitätsleiste ganz links auf das Buch ${codicon('book')} <strong>${n('computor-student')}</strong>. In einer Arbeitsumgebung, die für einen Kurs gestartet wurde, ist sie schon offen.`)],
    openCourse,
    [say('Read the task.', 'Lies die Aufgabe.'),
      say(`Click an assignment's title to open its instructions and Python source: code on the left and instructions on the right on a desktop, or tabs on a narrow screen. On first use, Computor may prepare your personal course repository, which takes a moment. For the instructions alone, choose ${action('open-preview', n('computor.student.showPreview'))}.`,
        `Klicke auf den Titel einer Aufgabe, um ihre Anleitung und den Python-Code zu öffnen: am Desktop den Code links und die Anleitung rechts, auf einem schmalen Bildschirm in Tabs. Beim ersten Mal richtet Computor gegebenenfalls dein persönliches Kurs-Repository ein, das dauert einen Moment. Nur die Anleitung öffnest du mit ${action('open-preview', n('computor.student.showPreview'))}.`)],
    [say('Browse the files.', 'Sieh dir die Dateien an.'),
      say('The Python source opens automatically with the task. Expand the arrow in front of the assignment to browse its other files.',
        'Der Python-Code öffnet sich automatisch mit der Aufgabe. Klappe den Pfeil vor der Aufgabe auf, um ihre weiteren Dateien anzusehen.')],
    [say('Write your solution.', 'Schreib deine Lösung.'),
      say('Click a file to open and edit it. Keep the file names the task asks for: the tests look for them.',
        'Klicke auf eine Datei, um sie zu öffnen und zu bearbeiten. Behalte die Dateinamen bei, die die Aufgabe verlangt, denn die Tests suchen genau nach ihnen.')],
    [say('Test it.', 'Teste sie.'),
      say(`On the assignment row, choose the beaker ${action('beaker', n('computor.student.testAssignment'))}. The same actions are available in the context menu. Computor saves, commits and uploads your work and runs the tests on the server; the results appear in the <strong>${n('computor-test-results')}</strong> panel. If test runs are limited, each one counts.`,
        `Wähle an der Aufgabenzeile das Becherglas ${action('beaker', n('computor.student.testAssignment'))}. Dieselben Aktionen findest du im Kontextmenü. Computor speichert und committet deine Arbeit, lädt sie hoch und führt die Tests auf dem Server aus. Die Ergebnisse erscheinen im Bereich <strong>${n('computor-test-results')}</strong>. Wenn die Testläufe begrenzt sind, zählt jeder einzelne.`)],
    [say('Submit.', 'Gib ab.'),
      say(`When you are happy with the result, choose the cloud with the arrow ${action('cloud-upload', n('computor.student.submitAssignment'))}. This hands the assignment in for grading — the version you last tested. Submissions may be limited too.`,
        `Wenn du mit dem Ergebnis zufrieden bist, wähle die Wolke mit dem Pfeil ${action('cloud-upload', n('computor.student.submitAssignment'))}. Damit gibst du die Aufgabe zur Bewertung ab, und zwar in der Fassung, die du zuletzt getestet hast. Auch die Abgaben können begrenzt sein.`)]
  ];

  const staff = isStaff(model);
  const title = staff ? say('How students work', 'So arbeiten Studierende') : say('Start working on an assignment', 'Mit einer Aufgabe beginnen');
  const lead = staff
    ? say('The steps your students follow, as this page shows them to a student. ',
      'Die Schritte, denen deine Studierenden folgen, so wie diese Seite sie ihnen zeigt. ')
    : '';
  return section('welcome-tutorial', title, `
    ${renderRowOnly(model, say)}
    <p class="welcome-steps-lead"><strong>${say('Step by step', 'Schritt für Schritt')}</strong></p>
    <ol class="welcome-steps">
      ${steps.map(([title, text]) => `<li><strong>${title}</strong> ${text}</li>`).join('')}
    </ol>
    <p>${say(`<strong>Commit as you go.</strong> ${action('git-commit', n('computor.student.commitAssignment'))} on an assignment row, or <em>${n('computor.student.commitCourse')}</em> on the course row, saves your work on the server. That is your backup; it is not a submission.`,
      `<strong>Committe zwischendurch.</strong> ${action('git-commit', n('computor.student.commitAssignment'))} an einer Aufgabenzeile oder <em>${n('computor.student.commitCourse')}</em> in der Kurszeile speichert deine Arbeit auf dem Server. Das ist deine Sicherung, aber keine Abgabe.`)}</p>
    ${renderAskForHelp(model, say)}
    <p class="text-muted">${say('Not every course uses every step. The assignment row shows the actions available in your course.',
      'Nicht jeder Kurs nutzt jeden Schritt. Die Aufgabenzeile zeigt dir, welche Aktionen dein Kurs anbietet.')}</p>`,
  lead + say('Every assignment is a row in the Student view. Point to an assignment or focus its row to show its action icons. The same actions are available in the context menu.',
    'Jede Aufgabe ist eine Zeile in der Student-Ansicht. Zeige auf eine Aufgabe oder fokussiere ihre Zeile, damit ihre Aktionssymbole erscheinen. Dieselben Aktionen findest du im Kontextmenü.'));
}

/** A content marker drawn by the same code as the tree's. */
function mark(shape: ContentIconShape, color: string, badge: ContentIconBadge = 'none', corner: ContentIconCorner = 'none'): string {
  return `<span class="welcome-mark" aria-hidden="true">${contentIconSvg(color, shape, badge, corner)}</span>`;
}

/** Example colours: in the tree, a row's colour comes from its content type. */
const unitColour = '#00FF00';
const assignmentColour = '#FFFF00';

/**
 * What the marks on a row mean, each drawn as the tree draws it, and what
 * "done" looks like (computor-org/issues#526).
 */
function renderMarks(say: Say, includeHelp = true): string {
  const rows: Array<[string, string]> = [
    [mark('circle', unitColour),
      say('A unit, such as a week. Its colour stands for the kind of content.', 'Eine Einheit, etwa eine Woche. Ihre Farbe steht für die Art des Inhalts.')],
    [mark('square', assignmentColour),
      say('An assignment that has not been tested yet.', 'Eine Aufgabe, die noch nicht getestet ist.')],
    [mark('square', assignmentColour, 'success'),
      say('All tests passed, not submitted yet.', 'Alle Tests bestanden, noch nicht abgegeben.')],
    [mark('square', assignmentColour, 'failure'),
      say('Not all tests passed yet. Improve your solution and test again.', 'Noch nicht alle Tests bestanden. Verbessere deine Lösung und teste noch einmal.')],
    [mark('square', assignmentColour, 'success-submitted'),
      say('<strong>Done:</strong> all tests passed and submitted.', '<strong>Erledigt:</strong> alle Tests bestanden und abgegeben.')],
    [mark('square', assignmentColour, 'failure-submitted'),
      say('Submitted, but not all tests passed.', 'Abgegeben, aber nicht alle Tests bestanden.')],
    [mark('square', assignmentColour, 'submitted'),
      say('Submitted, not tested yet.', 'Abgegeben, noch nicht getestet.')],
    [`${mark('square', assignmentColour, 'none', 'corrected')}${mark('square', assignmentColour, 'none', 'correction_necessary')}${mark('square', assignmentColour, 'none', 'correction_possible')}`,
      say('Dot in the corner, once your work has been graded: green corrected, red correction necessary, orange improvement possible.',
        'Punkt in der Ecke, sobald deine Arbeit bewertet ist: grün korrigiert, rot Korrektur nötig, orange Verbesserung möglich.')],
    ['<code>(1)(1) 100%</code>',
      say('Test runs, submissions and the result of the last test. With a limit, as in <code>(1/5)</code>, the second number is the limit. A second percentage is your grade.',
        'Testläufe, Abgaben und das Ergebnis des letzten Tests. Bei einer Grenze, etwa <code>(1/5)</code>, ist die zweite Zahl die Grenze. Eine zweite Prozentzahl ist deine Bewertung.')],
    ['<code>●</code> <code>↑</code> <code>⚠</code>',
      say('Changes not committed yet, committed but not uploaded yet, uploading fails.',
        'Änderungen noch nicht committet, committet, aber noch nicht hochgeladen, das Hochladen schlägt fehl.')],
    ['<code>🔔 2</code>', say('Unread messages.', 'Ungelesene Nachrichten.')]
  ];

  return section('welcome-marks', say('The marks on a row', 'Die Markierungen an einer Zeile'), `
    <div class="welcome-marks">${rows.map(([sample, meaning]) => `<div class="welcome-mark-sample">${sample}</div><p>${meaning}</p>`).join('')}</div>
    ${includeHelp ? `<div class="actions">${helpButton(HELP_PAGES.course, say('More about the marks', 'Mehr über die Markierungen'))}</div>` : ''}`,
  say('An assignment is done when its square carries the green double check: all tests passed and submitted.',
    'Eine Aufgabe ist erledigt, wenn ihr Quadrat das grüne Doppelhäkchen trägt: alle Tests bestanden und abgegeben.'));
}

/** Sections that matter less on the first day sit below this heading. */
function renderMoreHeading(say: Say): string {
  return `<h2 class="welcome-more" id="welcome-more">${say('More', 'Mehr')}</h2>`;
}

function renderHelp(say: Say, n: Names): string {
  return section('welcome-help', say('Help pages', 'Hilfeseiten'), linkRows([
    [helpButton(HELP_PAGES.course, say('Courses', 'Kurse')),
      say('Your course repository, committing versus submitting, and the marks on a row.',
        'Dein Kurs-Repository, der Unterschied zwischen Commit und Abgabe und die Markierungen an einer Zeile.')],
    [helpButton(HELP_PAGES.unit, say('Units and readings', 'Einheiten und Lesestoff')),
      say('How a course is organised, and material you read rather than hand in.',
        'Wie ein Kurs aufgebaut ist, und Material, das du liest, statt es abzugeben.')],
    [helpButton(HELP_PAGES.assignment, say('Assignments', 'Aufgaben')),
      say('Working, testing and submitting, managing files, and getting a file back.',
        'Bearbeiten, Testen und Abgeben, Dateien verwalten und eine Datei zurückholen.')]
  ]), say(`Short guides that come with the extension. In the Student view, right-click any row and choose <em>${n('computor.student.help')}</em> to open the page for it.`,
    `Kurze Anleitungen auf Englisch, die mit der Erweiterung kommen. In der Student-Ansicht öffnet ein Rechtsklick auf eine Zeile und <em>${n('computor.student.help')}</em> die passende Seite.`));
}

/**
 * The colours Git paints over the editor (computor-org/issues#374, comment by
 * Steffi276). The samples are drawn in the user's own theme colours, through
 * the --c-git-* tokens, so they match what is on screen.
 */
function renderGitColours(say: Say): string {
  const rows: Array<[string, string]> = [
    [`<span class="git-line added" aria-hidden="true"></span>${say('Green bar beside a line', 'Grüner Balken neben einer Zeile')}`,
      say('You added this line.', 'Du hast diese Zeile hinzugefügt.')],
    [`<span class="git-line modified" aria-hidden="true"></span>${say('Blue bar beside a line', 'Blauer Balken neben einer Zeile')}`,
      say('You changed this line.', 'Du hast diese Zeile geändert.')],
    [`<span class="git-line deleted" aria-hidden="true"></span>${say('Red marker between lines', 'Rote Markierung zwischen Zeilen')}`,
      say('Lines were deleted here.', 'Hier wurden Zeilen gelöscht.')],
    ['<span class="git-file untracked">solution.py<span class="git-letter">U</span></span>',
      say('A new file that has not been committed yet.', 'Eine neue Datei, die noch nicht committet ist.')],
    ['<span class="git-file modified">solution.py<span class="git-letter">M</span></span>',
      say('A file you changed since your last commit.', 'Eine Datei, die du seit deinem letzten Commit geändert hast.')]
  ];

  return section('welcome-git-colours', say('Colours in the editor and the file tree', 'Farben im Editor und im Dateibaum'), `
    <table class="table">
      <thead><tr><th>${say('You see', 'Du siehst')}</th><th>${say('It means', 'Das bedeutet')}</th></tr></thead>
      <tbody>${rows.map(([sample, meaning]) => `<tr><td>${sample}</td><td>${meaning}</td></tr>`).join('')}</tbody>
    </table>
    <p>${say('The bars appear in the editor next to the line numbers; the coloured names with a letter appear in the Explorer and in the Student view. The exact colours depend on your theme.',
      'Die Balken erscheinen im Editor neben den Zeilennummern, die farbigen Namen mit einem Buchstaben im Explorer und in der Student-Ansicht. Die genauen Farben hängen von deinem Farbschema ab.')}</p>
    <p>${say('The Student view adds its own marks to a row: <code>●</code>, <code>↑</code> and <code>⚠</code>, explained under <em>The marks on a row</em>.',
      'Die Student-Ansicht setzt dazu eigene Markierungen an eine Zeile: <code>●</code>, <code>↑</code> und <code>⚠</code>, erklärt unter <em>Die Markierungen an einer Zeile</em>.')}</p>`,
  say('They come from Git and compare your files with your last commit. Nothing is wrong when you see them; they go away when you commit.',
    'Sie stammen von Git und vergleichen deine Dateien mit deinem letzten Commit. Wenn du sie siehst, ist nichts falsch, und nach dem nächsten Commit verschwinden sie.'));
}

/** The address a desktop install should be pointed at, if this window knows a real one. */
function knownBackendUrl(model: WelcomeModel): string | undefined {
  const url = model.backendUrl?.trim().replace(/\/+$/, '');
  const configured = url && url !== defaultSettings.authentication.baseUrl ? url : undefined;
  if (!model.inBrowser) return configured;
  // A browser workspace reaches the backend over the deployment's internal
  // network (http://computor-api), which no desktop can resolve. The public
  // API sits under /api on the web app's own address, as on computor.at.
  if (model.webUrl) return `${model.webUrl}/api`;
  return configured && isPublicAddress(configured) ? configured : undefined;
}

/** A host another computer can reach: a dotted name, not a container or localhost. */
function isPublicAddress(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.includes('.') && host !== '127.0.0.1' && !host.endsWith('.local') && !host.endsWith('.internal');
  } catch {
    return false;
  }
}

/**
 * Connecting desktop VS Code to Computor, as one list of steps
 * (computor-org/issues#366). The browser edition shows it whole, as the way to
 * the desktop; a signed-out desktop shows it from the backend step on, as the
 * way in. Either way it ends in the same account as on the website, and
 * only someone not signed in yet is told how to get one.
 */
function desktopConnectSteps(model: WelcomeModel, say: Say, options: { install: boolean }): string {
  const known = knownBackendUrl(model);
  // As the Command Palette shows them, which follows the VS Code display language.
  const changeBackend = `<strong>Computor: ${namer(model)('computor.changeRealmUrl')}</strong>`;
  const login = `<strong>Computor: ${namer(model)('computor.login')}</strong>`;
  const backend = known
    ? say(`run ${changeBackend} and enter <code>${escapeHtml(known)}</code>`,
      `führe den Befehl ${changeBackend} aus und gib <code>${escapeHtml(known)}</code> ein`)
    : say(`run ${changeBackend} and enter <code>${publicBackendUrl}</code> for computor.at, or the address your course gives you`,
      `führe den Befehl ${changeBackend} aus und gib für computor.at <code>${publicBackendUrl}</code> ein oder die Adresse, die dein Kurs dir nennt`);
  const steps = [
    ...(options.install ? [
      say('Install Visual Studio Code and Git, and whatever your course works with, such as Python.',
        'Installiere Visual Studio Code und Git und dazu, womit dein Kurs arbeitet, etwa Python.'),
      say('Install the <strong>Computor</strong> extension from the Visual Studio Marketplace.',
        'Installiere die Erweiterung <strong>Computor</strong> aus dem Visual Studio Marketplace.')
    ] : []),
    say(`Open an empty folder, press <kbd>F1</kbd> and ${backend}.`, `Öffne einen leeren Ordner, drücke <kbd>F1</kbd>, ${backend}.`),
    say(`Run ${login} and sign in in your browser, with the same account as on the Computor website.`,
      `Führe den Befehl ${login} aus und melde dich im Browser an, mit demselben Konto wie auf der Computor-Website.`),
    ...(model.signedIn ? [] : [
      say('No account yet? Create one on the Computor website and join your course there. It then appears in the Student view.',
        'Noch kein Konto? Lege auf der Computor-Website eines an und tritt dort deinem Kurs bei. Danach erscheint er in der Student-Ansicht.')
    ])
  ];
  return `<ol class="welcome-steps">${steps.map(step => `<li>${step}</li>`).join('')}</ol>`;
}

/** Point each edition at the other one (browser ↔ desktop). */
function renderOtherEdition(model: WelcomeModel, say: Say): string {
  const switching = `<p>${say('Commit before you switch, so your latest work is on the server.',
    'Committe, bevor du wechselst, damit deine neueste Arbeit auf dem Server liegt.')}</p>`;

  if (model.inBrowser) {
    return section('welcome-desktop', say('Computor on your own computer', 'Computor auf deinem eigenen Computer'), `
      ${desktopConnectSteps(model, say, { install: true })}
      ${switching}
      <div class="actions">${linkButton('marketplace', say('Open the Marketplace page', 'Marketplace-Seite öffnen'))}</div>`,
    say('You are using Computor in the browser. It also runs in Visual Studio Code on your own computer, with the same account and the same courses. Tests and submissions run on the server there too, so you can keep working when no online workspace is free.',
      'Du verwendest Computor im Browser. Es läuft auch in Visual Studio Code auf deinem eigenen Computer, mit demselben Konto und denselben Kursen. Auch dort laufen Tests und Abgaben auf dem Server, du kannst also weiterarbeiten, wenn gerade keine Online-Arbeitsumgebung frei ist.'));
  }

  const website = model.webUrl
    ? `<div class="actions">${linkButton('workspaces', say('Open Workspaces on the website', 'Arbeitsumgebungen auf der Website öffnen'))}</div>`
    : '';
  return section('welcome-browser', say('Computor in the browser', 'Computor im Browser'), `
    <p>${say('If your course offers online workspaces, open the course on the Computor website and start its workspace on the course page. VS Code then opens in a new browser tab, with your course already on the left.',
      'Wenn dein Kurs Online-Arbeitsumgebungen anbietet, öffne ihn auf der Computor-Website und starte auf der Kursseite seine Arbeitsumgebung. VS Code öffnet sich dann in einem neuen Browser-Tab, und dein Kurs ist links schon offen.')}</p>
    ${switching}
    ${website}`,
  say('Computor also runs in the browser, with nothing to install and the same account and courses.',
    'Computor läuft auch im Browser, ohne Installation und mit demselben Konto und denselben Kursen.'));
}

function renderStaff(model: WelcomeModel, say: Say): string {
  const isTutor = model.roles.includes('tutor');
  const isLecturer = model.roles.includes('lecturer');
  if (!isTutor && !isLecturer) return '';
  const n = namer(model);
  const tutorView = n('computor-tutor');
  const lecturerView = n('computor-lecturer');

  const icons = [
    isTutor ? say(`<strong>${tutorView}</strong> for reviewing and grading`, `<strong>${tutorView}</strong> zum Durchsehen und Bewerten`) : '',
    isLecturer ? say(`<strong>${lecturerView}</strong> for building and releasing course content`,
      `<strong>${lecturerView}</strong> zum Erstellen und Freigeben von Kursinhalten`) : ''
  ].filter(Boolean).join(say(', and ', ' und '));

  const rows: Array<[string, string]> = [
    [helpButton(TUTOR_HELP_PAGES.course, say('The Tutor view', 'Die Tutor-Ansicht')),
      say('Picking a student and finding the work waiting for review.',
        'Studierende auswählen und die Arbeit finden, die auf eine Durchsicht wartet.')],
    [helpButton(TUTOR_HELP_PAGES.assignment, say('Grading an assignment', 'Eine Aufgabe bewerten')),
      say('Inspecting, testing and grading one submission, and the message that goes with it.',
        'Eine Abgabe ansehen, testen und bewerten, samt der Nachricht dazu.')]
  ];
  if (isLecturer) {
    rows.push(
      [linkButton('lecturerGuide', say('Lecturer guide', 'Leitfaden für Lehrende')),
        say('Courses, content, examples and releases in the Lecturer view (online).',
          'Kurse, Inhalte, Beispiele und Freigaben in der Lecturer-Ansicht (online, auf Englisch).')],
      [linkButton('teacherGuide', say('Course dashboard guide', 'Leitfaden zum Kurs-Dashboard')),
        say('Course statistics, flags and grading pages in the Computor web app (online).',
          'Kursstatistiken, Markierungen und Bewertungsseiten in der Computor-Web-App (online, auf Englisch).')]
    );
  }

  const steps: Array<[string, string]> = [
    ...(isTutor ? [
      [say('Open the Tutor view.', 'Öffne die Tutor-Ansicht.'),
        say(`Click <strong>${tutorView}</strong> in the Activity Bar on the far left.`,
          `Klicke in der Aktivitätsleiste ganz links auf <strong>${tutorView}</strong>.`)],
      [say('Pick a student.', 'Wähle eine Person aus.'),
        say(`Under <strong>${escapeHtml(n('computor.tutor.filters'))}</strong>, click a course and then a member; their work appears under <strong>${n('computor.tutor.courses')}</strong>. A 📝 behind a name counts submissions you have not reviewed yet, a 🔔 unread messages.`,
          `Klicke unter <strong>${escapeHtml(n('computor.tutor.filters'))}</strong> auf einen Kurs und dann auf eine Person, deren Arbeit darauf unter <strong>${n('computor.tutor.courses')}</strong> erscheint. Ein 📝 hinter einem Namen zählt die Abgaben, die du noch nicht durchgesehen hast, ein 🔔 die ungelesenen Nachrichten.`)],
      [say('Review and grade.', 'Prüfe und bewerte.'),
        say('Click an assignment to download the latest submission and the reference solution. Test it, set the grade with the grading icon on its row, and say in the assignment\'s messages what to change.',
          'Klicke auf eine Aufgabe, um die letzte Abgabe und die Musterlösung herunterzuladen. Teste die Abgabe, vergib mit dem Bewertungssymbol in ihrer Zeile die Bewertung und schreib in den Nachrichten zur Aufgabe, was noch zu ändern ist.')]
    ] as Array<[string, string]> : []),
    ...(isLecturer ? [
      [say('Build the course.', 'Baue den Kurs auf.'),
        say(`In <strong>${lecturerView}</strong>, <strong>${n('computor.lecturer.courses')}</strong> holds your courses with their content, content types and groups, and <strong>${n('computor.lecturer.examples')}</strong> the library of reusable assignments.`,
          `In <strong>${lecturerView}</strong> findest du unter <strong>${n('computor.lecturer.courses')}</strong> deine Kurse mit ihren Inhalten, Inhaltstypen und Gruppen und unter <strong>${n('computor.lecturer.examples')}</strong> die Bibliothek wiederverwendbarer Aufgaben.`)]
    ] as Array<[string, string]> : [])
  ];
  const students = model.roles.includes('student')
    ? `<p>${say('Your account has the Student view too. <em>How students work</em>, under <em>More</em>, walks through it as your students meet it.',
      'Dein Konto hat auch die Student-Ansicht. Wie deine Studierenden sie kennenlernen, zeigt <em>So arbeiten Studierende</em> unter <em>Mehr</em>.')}</p>`
    : '';

  return section('welcome-staff', say('Teaching with Computor', 'Lehren mit Computor'), `
    <ol class="welcome-steps">
      ${steps.map(([title, text]) => `<li><strong>${title}</strong> ${text}</li>`).join('')}
    </ol>
    ${linkRows(rows)}
    ${students}`,
    say(`Teaching has its own icons in the Activity Bar: ${icons}.`, `Für die Lehre gibt es eigene Symbole in der Aktivitätsleiste: ${icons}.`));
}

/** Who makes Computor and who pays for it — as stated in LICENSE and the computor.at imprint. */
function renderCredits(model: WelcomeModel, say: Say): string {
  return section('welcome-credits', say('About Computor', 'Über Computor'), `
    <p>${say('Computor is a project of the Institute of Theoretical Physics – Computational Physics (ITPcp) at Graz University of Technology, led by Christopher Albert, and is developed by Maximilian Mandlez and the Computor team.',
      'Computor ist ein Projekt des Instituts für Theoretische Physik – Computational Physics (ITPcp) der Technischen Universität Graz unter der Leitung von Christopher Albert und wird von Maximilian Mandlez und dem Computor-Team entwickelt.')}</p>
    <p>${say('Financially supported and made possible by the netidee funding programme of the Internet Privatstiftung Austria (project 8012).',
      'Mit den Mitteln der Förderaktion netidee der Internet Privatstiftung Austria finanziell unterstützt und ermöglicht (Projekt 8012).')}</p>
    <p>${say('Computor is open source under the MIT license.', 'Computor ist Open Source unter der MIT-Lizenz.')}</p>
    <div class="actions">
      ${linkButton('contributors', say('Contributors', 'Mitwirkende'))}
      ${linkButton('netidee', say('netidee project page', 'netidee-Projektseite'))}
      ${linkButton('source', say('Source code', 'Quellcode'))}
      ${linkButton('feedback', say('Feedback and bug reports', 'Feedback und Fehlerberichte'))}
    </div>
    ${model.version ? `<p class="text-muted">${say('Computor extension', 'Computor-Erweiterung')} ${escapeHtml(model.version)}</p>` : ''}`);
}

function renderStartupToggle(model: WelcomeModel, say: Say): string {
  // The command as the Command Palette lists it, in the VS Code display language.
  const command = `<strong>Computor: ${namer(model)('computor.welcome')}</strong>`;
  return `<div class="welcome-footer">
    <label class="welcome-startup">
      <input type="checkbox" id="show-on-startup"${model.showOnStartup ? ' checked' : ''}>
      ${say('Show this page when Computor starts', 'Diese Seite beim Start von Computor anzeigen')}
    </label>
    <p class="text-muted">${say(`Open it again any time with ${command}, or the question-mark icon at the top of the Computor views.`,
      `Du öffnest sie jederzeit wieder mit dem Befehl ${command} oder dem Fragezeichen-Symbol oben in den Computor-Ansichten.`)}</p>
  </div>`;
}

/** The page body; the provider wraps it with base.css, the view stylesheet and script. */
export function renderWelcomeBody(model: WelcomeModel): string {
  const say = sayer(model);
  // Before sign-in the role is unknown, and most people opening Computor are
  // students — so the tutorial shows unless the account is known not to be one.
  const showTutorial = !model.signedIn || model.roles.includes('student');
  const students = `
    ${showTutorial ? renderTutorial(model, say) : ''}
    ${showTutorial ? renderMarks(say) : ''}
    ${renderHelp(say, namer(model))}`;
  // Tutors and lecturers open on teaching; how students work follows as an add-on (computor-org/issues#541).
  const staff = isStaff(model);
  return `<div class="page-root welcome-page"${model.language === 'de' ? ' lang="de"' : ''}>
    ${renderHero(model, say)}
    ${renderCourses(model, say)}
    ${staff ? renderStaff(model, say) : students}
    ${renderMoreHeading(say)}
    ${staff ? students : ''}
    ${renderGitColours(say)}
    ${renderOtherEdition(model, say)}
    ${renderCredits(model, say)}
    ${renderStartupToggle(model, say)}
  </div>`;
}

/** The shared guide split around course text, keeping Test and Submit visible first. */
export function renderCourseWelcomeGuide(model: Pick<WelcomeModel, 'language' | 'workbenchLanguage' | 'rowPictureSvg'>, title: string): { intro: string; details: string } {
  const say = sayer(model);
  const wrapper = (body: string) => `<div class="page-root welcome-page welcome-course-guide" lang="${model.language ?? 'en'}">${body}</div>`;
  return {
    intro: wrapper(`<h1>${escapeHtml(title)}</h1>${section('welcome-tutorial', say('Read, test, submit', 'Lesen, testen, abgeben'),
      renderRowPicture(model, say, true), say(
        'Point to an assignment or focus its row, then choose an action icon. The same actions are available in the context menu.',
        'Zeige auf eine Aufgabe oder fokussiere ihre Zeile und wähle ein Aktionssymbol. Dieselben Aktionen findest du im Kontextmenü.'))}`),
    details: wrapper(`${section('welcome-actions', say('All assignment actions', 'Alle Aufgabensymbole'),
      renderRowPicture({ ...model, rowPictureSvg: undefined }, say))}${renderMarks(say, false)}`)
  };
}
