import { escapeHtml } from '../shared/webviewHelpers';
import { HELP_PAGES } from '../../../utils/studentHelpPages';
import { TUTOR_HELP_PAGES } from '../../../utils/tutorHelpPages';
import { resolveContentLanguage } from '../../../utils/contentLanguage';
import { courseStartPointer, hasStartedCourse } from '../../../utils/courseStart';
import { contentIconSvg, ContentIconBadge, ContentIconCorner, ContentIconShape } from '../../../utils/contentIconSvg';
import { codicon, CodiconName } from './codicons';
import type { CourseContentStudentList } from '../../../types/generated';

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
  /**
   * Listed in the self-enrolment catalog. Such a course has no human tutors;
   * questions go to the AI tutor Lena (computor-org/issues#458). Undefined
   * when the course could not be read, and the page then names both.
   */
  selfEnrolment?: boolean;
}

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
  /** Absent means English. */
  language?: WelcomeLanguage;
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
  feedback: 'https://computor.at/problem'
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
  getUserAccount(): Promise<{ given_name?: string | null; profile?: { language_code?: string | null } | null } | undefined>;
  getUserViews(): Promise<string[]>;
  getStudentCourses(): Promise<CourseLike[]>;
  getTutorCourses(): Promise<CourseLike[]>;
  getLecturerCourses(): Promise<CourseLike[] | undefined>;
  getInstanceInfo(): Promise<{ web_url?: string | null } | undefined>;
  getCourse(courseId: string): Promise<{ title?: string | null; path?: string; language_code?: string | null; public?: boolean | null } | undefined>;
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
      resume: hasStartedCourse(contents),
      selfEnrolment: typeof launchedCourse?.public === 'boolean' ? launchedCourse.public : undefined
    } : undefined
  };
}

/** The learner's own choice wins, then the launched course's language (as for the course landing). */
export function welcomeLanguage(userLanguage?: string | null, courseLanguage?: string | null): WelcomeLanguage {
  return resolveContentLanguage(userLanguage, courseLanguage).startsWith('de') ? 'de' : 'en';
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

function sayer(model: WelcomeModel): Say {
  return (en, de) => (model.language === 'de' ? de : en);
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
      <p>${say('Your courses inside VS Code: read the task, write and test your code, and hand it in.',
        'Deine Kurse in VS Code: Aufgabe lesen, Code schreiben und testen, Lösung abgeben.')}</p>
    </div>
  </div>`;
}

/** What the launched course is and where to begin in it. */
function renderLaunch(launch: WelcomeLaunch, say: Say): string {
  const title = escapeHtml(launch.title);
  const start = launch.startHere
    ? ` ${launch.resume ? say('Continue with', 'Weiter mit') : say('Start with', 'Beginne mit')} <strong>${escapeHtml(launch.startHere)}</strong>.`
    : '';
  return `<div class="notice info welcome-launch">${say(
    `<strong>${title}</strong> is already open on the left.`,
    `<strong>${title}</strong> ist links schon geöffnet.`)}${start}</div>`;
}

function renderCourses(model: WelcomeModel, say: Say): string {
  const title = say('Your courses', 'Deine Kurse');
  if (!model.signedIn) {
    return section('welcome-sign-in', title, `
      <div class="notice info">${say('You are not signed in. Sign in to see your courses.',
        'Du bist nicht angemeldet. Melde dich an, um deine Kurse zu sehen.')}</div>
      <div class="actions"><button type="button" class="btn" data-action="login">${say('Sign in', 'Anmelden')}</button></div>`);
  }

  const listed = model.courses.slice(0, maxListedCourses);
  const hidden = model.courses.length - listed.length;
  const list = listed.length
    ? `<ul class="welcome-courses">${listed.map(course => `
        <li class="welcome-course">
          <span>${escapeHtml(course.title)}</span>
          ${course.roles.map(role => `<span class="badge badge-info xs">${roleLabels[role]}</span>`).join(' ')}
        </li>`).join('')}
      </ul>${hidden > 0 ? `<p class="text-muted">${say(`…and ${hidden} more.`, `…und ${hidden} weitere.`)}</p>` : ''}`
    : `<p class="text-muted">${say(
      'You are not in any course yet. Courses appear here and in the Computor views as soon as you are added to one.',
      'Du bist noch in keinem Kurs. Kurse erscheinen hier und in den Computor-Ansichten, sobald du in einen aufgenommen wirst.')}</p>`;

  // A launched workspace already shows the Student view; offering to open it
  // again leads nowhere (computor-org/issues#527).
  const roles = model.launch ? model.roles.filter(role => role !== 'student') : model.roles;
  const buttons = roles.map((role, index) => viewButton(role, index === 0, say)).join('');
  const intro = model.courses.length === 1
    ? say('Welcome to your course!', 'Willkommen in deinem Kurs!')
    : model.courses.length > 1 ? say('Welcome to your courses!', 'Willkommen in deinen Kursen!') : '';
  return section('welcome-courses', title, `
    ${model.launch ? renderLaunch(model.launch, say) : ''}
    ${intro ? `<p>${intro}</p>` : ''}
    ${list}
    ${buttons ? `<div class="actions">${buttons}</div>` : ''}`);
}

/** A row action as the tree shows it: its icon, then its tooltip text. */
function action(name: CodiconName, label: string): string {
  return `<span class="welcome-action">${codicon(name)}<em>${escapeHtml(label)}</em></span>`;
}

/**
 * The five icons on an assignment row, in the order the row shows them
 * (package.json, view/item/context, group inline), numbered as in the picture.
 */
function rowActions(say: Say): Array<[CodiconName, string, string]> {
  return [
    ['open-preview', 'Show README Preview', say('Read the task.', 'Aufgabe lesen.')],
    ['git-commit', 'Commit Assignment', say('Back up your work on the server. Not a submission.', 'Arbeit auf dem Server sichern. Das ist keine Abgabe.')],
    ['beaker', 'Test Assignment', say('Run the tests. The result appears under <strong>Results</strong>.', 'Tests ausführen. Das Ergebnis erscheint unter <strong>Results</strong>.')],
    ['cloud-upload', 'Submit', say('Hand the assignment in for grading.', 'Aufgabe zur Bewertung abgeben.')],
    ['comment-discussion', 'Show Messages', say('Messages and questions about this assignment.', 'Nachrichten und Fragen zu dieser Aufgabe.')]
  ];
}

/** The annotated row and what its numbers and letters point at. */
function renderRowPicture(model: WelcomeModel, say: Say): string {
  const picture = model.rowPictureSvg
    ? `<div class="welcome-row-picture" role="img" aria-label="${escapeHtml(say(
      'An assignment row in the Student view with its five icons, numbered 1 to 5 from left to right.',
      'Eine Aufgabenzeile in der Student-Ansicht mit ihren fünf Symbolen, von links nach rechts nummeriert von 1 bis 5.'))}">${model.rowPictureSvg}</div>`
    : '';
  const actions = rowActions(say).map(([icon, label, meaning], index) => `
      <li><span class="welcome-callout" aria-hidden="true">${index + 1}</span>${action(icon, label)}<span class="text-muted">${meaning}</span></li>`).join('');
  const letters = model.rowPictureSvg ? `
      <li><span class="welcome-callout letter" aria-hidden="true">A</span><span>${say('The mark shows what state the assignment is in.', 'Die Markierung zeigt, in welchem Zustand die Aufgabe ist.')}</span></li>
      <li><span class="welcome-callout letter" aria-hidden="true">B</span><span>${say('Test runs, submissions and the test result.', 'Testläufe, Abgaben und das Testergebnis.')}</span></li>` : '';
  return `<figure class="welcome-row">
      ${picture}
      <ol class="welcome-row-legend">${actions}${letters}
      </ol>
    </figure>`;
}

/**
 * Where a question goes. A self-enrolment course has no human tutors, only
 * the AI tutor Lena (computor-org/issues#458); an unknown course gets both.
 */
function renderAskForHelp(model: WelcomeModel, say: Say): string {
  const stuck = `<strong>${say('Stuck?', 'Kommst du nicht weiter?')}</strong>`;
  const lena = '<code>@lena</code>';
  const messages = action('comment-discussion', 'Show Messages');
  const selfEnrolment = model.launch?.selfEnrolment;
  const ask = selfEnrolment === true
    ? say(`${stuck} This course has no human tutors. Lena, the AI tutor, gives hints instead of complete solutions: click the speech-bubble icon ${messages} on an assignment and mention ${lena} in your message.`,
      `${stuck} In diesem Kurs gibt es keine menschlichen Tutorinnen und Tutoren. Die KI-Tutorin Lena gibt Hinweise statt fertiger Lösungen: Klicke an einer Aufgabe auf das Sprechblasen-Symbol ${messages} und erwähne ${lena} in deiner Nachricht.`)
    : selfEnrolment === false
      ? say(`${stuck} The speech-bubble icon ${messages} on an assignment lets you ask your lecturer and tutors.`,
        `${stuck} Über das Sprechblasen-Symbol ${messages} an einer Aufgabe kannst du den Lehrenden und den Tutorinnen und Tutoren deines Kurses Fragen stellen.`)
      : say(`${stuck} The speech-bubble icon ${messages} on an assignment lets you ask for help: your lecturer and tutors, or in courses with the AI tutor Lena, ${lena}.`,
        `${stuck} Über das Sprechblasen-Symbol ${messages} an einer Aufgabe bittest du um Hilfe: je nach Kurs die Lehrenden und die Tutorinnen und Tutoren oder die KI-Tutorin Lena mit ${lena}.`);
  if (!model.signedIn) return `<p>${ask}</p>`;

  const ticket = selfEnrolment === true
    ? say('For anything Lena cannot help with, such as a technical problem or leaving the course, open a support ticket.',
      'Für alles, wobei Lena nicht helfen kann, etwa ein technisches Problem oder die Abmeldung vom Kurs, eröffne ein Support-Ticket.')
    : say('For a technical problem with Computor itself, open a support ticket.',
      'Bei einem technischen Problem mit Computor selbst eröffne ein Support-Ticket.');
  return `<p>${ask}</p>
    <div class="welcome-links"><div><button type="button" class="btn secondary sm" data-action="reportProblem">${say('Report a problem', 'Problem melden')}</button></div><p class="text-muted">${ticket}</p></div>`;
}

/**
 * From the course tree to a submitted assignment.
 *
 * Every step names what is on screen in the Student view — the container
 * title, the row actions and their icons (package.json), the Results panel —
 * so a student can follow it without knowing VS Code. The labels VS Code
 * shows stay in English in the German text, because the workbench shows them so.
 */
function renderTutorial(model: WelcomeModel, say: Say): string {
  const openCourse: [string, string] = model.launch
    ? [say('Your course is already open.', 'Dein Kurs ist schon geöffnet.'),
      say(`In the Student view on the left, <strong>${escapeHtml(model.launch.title)}</strong> is already expanded. Units group the material; assignments sit inside them.`,
        `Links in der Student-Ansicht ist <strong>${escapeHtml(model.launch.title)}</strong> schon aufgeklappt. Einheiten gliedern den Stoff, und in ihnen liegen die Aufgaben.`)]
    : [say('Open your course.', 'Öffne deinen Kurs.'),
      say('Under <strong>Courses</strong>, click your course to expand it. If your university or department is listed first, expand it until you reach the course. Units group the material; assignments sit inside them.',
        'Klicke unter <strong>Courses</strong> auf deinen Kurs, um ihn aufzuklappen. Steht davor deine Universität oder dein Institut, klappe weiter auf, bis du beim Kurs bist. Einheiten gliedern den Stoff, und in ihnen liegen die Aufgaben.')];
  const description = say(` If a unit has a description, open it with the book ${action('book', 'Show Description')} on its row.`,
    ` Hat eine Einheit eine Beschreibung, öffnest du sie mit dem Buch ${action('book', 'Show Description')} in ihrer Zeile.`);
  openCourse[1] += description;
  const steps: Array<[string, string]> = [
    [say('Open the Student view.', 'Öffne die Student-Ansicht.'),
      say(`Click the book ${codicon('book')} <strong>Computor Student</strong> in the Activity Bar on the far left. In a workspace started for a course, it is already open.`,
        `Klicke in der Aktivitätsleiste ganz links auf das Buch ${codicon('book')} <strong>Computor Student</strong>. In einem Arbeitsbereich, der für einen Kurs gestartet wurde, ist sie schon offen.`)],
    openCourse,
    [say('Read the task.', 'Lies die Aufgabe.'),
      say(`Click an assignment's title or ${action('open-preview', 'Show README Preview')}. Its instructions open beside your code; nothing is downloaded yet.`,
        `Klicke auf den Titel einer Aufgabe oder auf ${action('open-preview', 'Show README Preview')}. Die Anleitung öffnet sich neben deinem Code, heruntergeladen wird dabei noch nichts.`)],
    [say('Get the files.', 'Hol dir die Dateien.'),
      say('Click the arrow in front of the assignment to expand it. The first time, Computor sets up your personal course repository, which takes a moment. Then the assignment\'s starting files appear underneath.',
        'Klicke auf den Pfeil vor der Aufgabe, um sie aufzuklappen. Beim ersten Mal richtet Computor dein persönliches Kurs-Repository ein, das dauert einen Moment. Danach erscheinen darunter die Ausgangsdateien der Aufgabe.')],
    [say('Write your solution.', 'Schreib deine Lösung.'),
      say('Click a file to open and edit it. Keep the file names the task asks for: the tests look for them.',
        'Klicke auf eine Datei, um sie zu öffnen und zu bearbeiten. Behalte die Dateinamen bei, die die Aufgabe verlangt, denn die Tests suchen genau nach ihnen.')],
    [say('Test it.', 'Teste sie.'),
      say(`Click the beaker ${action('beaker', 'Test Assignment')} on the assignment row, or right-click the row and choose the entry from the menu. Computor saves, commits and uploads your work and runs the tests on the server; the results appear in the <strong>Results</strong> panel. If test runs are limited, each one counts.`,
        `Klicke in der Zeile der Aufgabe auf das Becherglas ${action('beaker', 'Test Assignment')}, oder klicke die Zeile mit der rechten Maustaste an und wähle den Eintrag im Menü. Computor speichert und committet deine Arbeit, lädt sie hoch und führt die Tests auf dem Server aus. Die Ergebnisse erscheinen im Bereich <strong>Results</strong>. Wenn die Testläufe begrenzt sind, zählt jeder einzelne.`)],
    [say('Submit.', 'Gib ab.'),
      say(`When you are happy with the result, click the cloud with the arrow ${action('cloud-upload', 'Submit')}. This hands the assignment in for grading — the version you last tested. Submissions may be limited too.`,
        `Wenn du mit dem Ergebnis zufrieden bist, klicke auf die Wolke mit dem Pfeil ${action('cloud-upload', 'Submit')}. Damit gibst du die Aufgabe zur Bewertung ab, und zwar in der Fassung, die du zuletzt getestet hast. Auch die Abgaben können begrenzt sein.`)]
  ];

  return section('welcome-tutorial', say('Start working on an assignment', 'Mit einer Aufgabe beginnen'), `
    ${renderRowPicture(model, say)}
    <ol class="welcome-steps">
      ${steps.map(([title, text]) => `<li><strong>${title}</strong> ${text}</li>`).join('')}
    </ol>
    <p>${say(`<strong>Commit as you go.</strong> ${action('git-commit', 'Commit Assignment')} on an assignment, or <em>Commit Course</em> on the course row, saves your work on the server. That is your backup; it is not a submission.`,
      `<strong>Committe zwischendurch.</strong> ${action('git-commit', 'Commit Assignment')} an einer Aufgabe oder <em>Commit Course</em> in der Kurszeile speichert deine Arbeit auf dem Server. Das ist deine Sicherung, aber keine Abgabe.`)}</p>
    ${renderAskForHelp(model, say)}
    <p class="text-muted">${say('Not every course uses every step. If an icon is missing, right-click the assignment to see what your course offers.',
      'Nicht jeder Kurs nutzt jeden Schritt. Fehlt ein Symbol, klicke die Aufgabe mit der rechten Maustaste an, um zu sehen, was dein Kurs anbietet.')}</p>`,
  say('Every assignment is a row in the Student view. Its icons appear only while the mouse is over the row or the row is selected.',
    'Jede Aufgabe ist eine Zeile in der Student-Ansicht. Ihre Symbole erscheinen erst, wenn die Maus über der Zeile steht oder du die Zeile anklickst.'));
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
function renderMarks(say: Say): string {
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
    <div class="actions">${helpButton(HELP_PAGES.course, say('More about the marks', 'Mehr über die Markierungen'))}</div>`,
  say('An assignment is done when its square carries the green double check: all tests passed and submitted.',
    'Eine Aufgabe ist erledigt, wenn ihr Quadrat das grüne Doppelhäkchen trägt: alle Tests bestanden und abgegeben.'));
}

/** Sections that matter less on the first day sit below this heading. */
function renderMoreHeading(say: Say): string {
  return `<h2 class="welcome-more" id="welcome-more">${say('More', 'Mehr')}</h2>`;
}

function renderHelp(say: Say): string {
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
  ]), say('Short guides that come with the extension. In the Student view, right-click any row and choose <em>Help</em> to open the page for it.',
    'Kurze Anleitungen auf Englisch, die mit der Erweiterung kommen. In der Student-Ansicht öffnet ein Rechtsklick auf eine Zeile und <em>Help</em> die passende Seite.'));
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

/** Point each edition at the other one (browser ↔ desktop). */
function renderOtherEdition(model: WelcomeModel, say: Say): string {
  const switching = `<p>${say('Commit before you switch, so your latest work is on the server.',
    'Committe, bevor du wechselst, damit deine neueste Arbeit auf dem Server liegt.')}</p>`;

  if (model.inBrowser) {
    const backend = model.backendUrl
      ? say(`run <strong>Computor: Change Backend URL</strong> and enter <code>${escapeHtml(model.backendUrl)}</code>`,
        `führe <strong>Computor: Change Backend URL</strong> aus und gib <code>${escapeHtml(model.backendUrl)}</code> ein`)
      : say('run <strong>Computor: Change Backend URL</strong> and enter the address your course gives you',
        'führe <strong>Computor: Change Backend URL</strong> aus und gib die Adresse ein, die dein Kurs dir nennt');
    return section('welcome-desktop', say('Computor on your own computer', 'Computor auf deinem eigenen Computer'), `
      <ol class="welcome-steps">
        <li>${say('Install Visual Studio Code and Git.', 'Installiere Visual Studio Code und Git.')}</li>
        <li>${say('Install the <strong>Computor</strong> extension from the Visual Studio Marketplace.',
          'Installiere die Erweiterung <strong>Computor</strong> aus dem Visual Studio Marketplace.')}</li>
        <li>${say(`Open an empty folder, press <kbd>F1</kbd> and ${backend}.`, `Öffne einen leeren Ordner, drücke <kbd>F1</kbd>, ${backend}.`)}</li>
        <li>${say('Run <strong>Computor: Login</strong> and sign in in your browser.',
          'Führe <strong>Computor: Login</strong> aus und melde dich im Browser an.')}</li>
      </ol>
      ${switching}
      <div class="actions">${linkButton('marketplace', say('Open the Marketplace page', 'Marketplace-Seite öffnen'))}</div>`,
    say('You are using Computor in the browser. It also runs in Visual Studio Code on your own computer, with the same account and the same courses.',
      'Du verwendest Computor im Browser. Es läuft auch in Visual Studio Code auf deinem eigenen Computer, mit demselben Konto und denselben Kursen.'));
  }

  const website = model.webUrl
    ? `<div class="actions">${linkButton('workspaces', say('Open Workspaces on the website', 'Workspaces auf der Website öffnen'))}</div>`
    : '';
  return section('welcome-browser', say('Computor in the browser', 'Computor im Browser'), `
    <p>${say('If your course offers online workspaces, start one on the Computor website under <strong>Workspaces</strong> and open your course there.',
      'Wenn dein Kurs Online-Arbeitsbereiche anbietet, starte einen auf der Computor-Website unter <strong>Workspaces</strong> und öffne dort deinen Kurs.')}</p>
    ${switching}
    ${website}`,
  say('Computor also runs in the browser, with nothing to install and the same account and courses.',
    'Computor läuft auch im Browser, ohne Installation und mit demselben Konto und denselben Kursen.'));
}

function renderStaff(model: WelcomeModel, say: Say): string {
  const isTutor = model.roles.includes('tutor');
  const isLecturer = model.roles.includes('lecturer');
  if (!isTutor && !isLecturer) return '';

  const icons = [
    isTutor ? say('<strong>Computor Tutor</strong> for reviewing and grading', '<strong>Computor Tutor</strong> zum Durchsehen und Bewerten') : '',
    isLecturer ? say('<strong>Computor Lecturer</strong> for building and releasing course content',
      '<strong>Computor Lecturer</strong> zum Erstellen und Freigeben von Kursinhalten') : ''
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

  return section('welcome-staff', say('For tutors and lecturers', 'Für Tutorinnen, Tutoren und Lehrende'), linkRows(rows),
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
  return `<div class="welcome-footer">
    <label class="welcome-startup">
      <input type="checkbox" id="show-on-startup"${model.showOnStartup ? ' checked' : ''}>
      ${say('Show this page when Computor starts', 'Diese Seite beim Start von Computor anzeigen')}
    </label>
    <p class="text-muted">${say('Open it again any time with <strong>Computor: Welcome and Help</strong>, or the question-mark icon at the top of the Computor views.',
      'Du öffnest sie jederzeit wieder mit <strong>Computor: Welcome and Help</strong> oder dem Fragezeichen-Symbol oben in den Computor-Ansichten.')}</p>
  </div>`;
}

/** The page body; the provider wraps it with base.css, the view stylesheet and script. */
export function renderWelcomeBody(model: WelcomeModel): string {
  const say = sayer(model);
  // Before sign-in the role is unknown, and most people opening Computor are
  // students — so the tutorial shows unless the account is known not to be one.
  const showTutorial = !model.signedIn || model.roles.includes('student');
  return `<div class="page-root welcome-page"${model.language === 'de' ? ' lang="de"' : ''}>
    ${renderHero(model, say)}
    ${renderCourses(model, say)}
    ${showTutorial ? renderTutorial(model, say) : ''}
    ${showTutorial ? renderMarks(say) : ''}
    ${renderHelp(say)}
    ${renderMoreHeading(say)}
    ${renderStaff(model, say)}
    ${renderGitColours(say)}
    ${renderOtherEdition(model, say)}
    ${renderCredits(model, say)}
    ${renderStartupToggle(model, say)}
  </div>`;
}
