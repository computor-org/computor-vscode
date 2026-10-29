import JSZip from 'jszip';
import type * as vscode from 'vscode';
import type { ComputorApiService } from './ComputorApiService';
import type { CourseContentStudentList, CourseStudentList } from '../types/generated';
import { pickDescriptionFile } from '../utils/descriptionLanguage';
import { descriptionInLanguage, localizedText, localizedTitle, localizedUnitTitle } from '../utils/contentLanguage';
import { accountLanguage, LanguageAccount } from '../utils/uiLanguage';
import { beginMarkdownPreviewRequest, MarkdownPreviewOptions, MarkdownPreviewRequest, showMarkdownTextPreview } from '../ui/webviews/markdownPreview';
import { courseWelcomeItem, hasStartedCourse, nextOpenCourseItem } from '../utils/courseStart';


/** Read only the canonical description, in memory; never extract arbitrary ZIP paths. */
export async function readStudentDescription(archive: Buffer, preferred?: string | null): Promise<string | undefined> {
  const zip = await JSZip.loadAsync(archive);
  const files = Object.values(zip.files).filter(file => {
    const original = (file as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? file.name;
    const parts = original.split('/');
    return !file.dir && parts.length <= 2 && parts.every(part => part && part !== '.' && part !== '..' && !part.startsWith('.'))
      && !original.includes('\\') && !original.startsWith('__MACOSX/');
  });
  const roots = files.filter(file => !file.name.includes('/'));
  if (!roots.length && new Set(files.map(file => file.name.split('/')[0])).size > 1) return undefined;
  const chosen = pickDescriptionFile((roots.length ? roots : files).map(file => file.name), preferred);
  if (!chosen) return undefined;
  const file = zip.file(chosen);
  return file ? file.async('string') : undefined;
}

/** Inline only static instruction images; no workspace files or repository checkout. */
export async function studentDescriptionImages(archive: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(archive);
  const images: Record<string, string> = {};
  const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  let bytes = 0;
  for (const file of Object.values(zip.files)) {
    const original = (file as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? file.name;
    if (file.dir || original.startsWith('/') || original.includes('\\')
      || original.split('/').some(part => !part || part.startsWith('.'))) continue;
    const type = mime[file.name.split('.').pop()?.toLowerCase() ?? ''];
    if (!type) continue;
    const data = await file.async('nodebuffer');
    bytes += data.length;
    if (bytes > 8 * 1024 * 1024 || Object.keys(images).length >= 32) break;
    images[file.name] = `data:${type};base64,${data.toString('base64')}`;
  }
  return images;
}

/**
 * A learner who has not started the course reads its authored Welcome, or its
 * authored description when there is none. A returning learner goes on with the
 * first assignment not handed in, the one the web course page names after
 * "Weiter mit" (computor-org/issues#525). It is returned for the caller to open,
 * and nothing opens once every assignment is handed in. The Welcome stays one
 * click away as the first row of the course tree.
 */
export async function showWorkspaceCourseLanding(
  context: vscode.ExtensionContext,
  api: ComputorApiService,
  course: CourseStudentList,
  request: MarkdownPreviewRequest = beginMarkdownPreviewRequest()
): Promise<CourseContentStudentList | undefined> {
  if (!request.isCurrent()) return undefined;
  const contents = await api.getStudentCourseContents(course.id, { throwOnError: true });
  if (!request.isCurrent()) return undefined;
  const welcome = registerCourseWelcome(contents, course.id);
  if (hasStartedCourse(contents)) return nextOpenCourseItem(contents);
  if (welcome) {
    await showWorkspaceCourseUnit(context, api, welcome, { request });
  } else {
    const language = await readingLanguage(api);
    if (!request.isCurrent()) return undefined;
    await showMarkdownTextPreview(context, descriptionInLanguage(course.description ?? '', language), course.title || course.path, {
      request, studentReading: true
    });
  }
  return undefined;
}

const welcomeIds = new Map<string, string>();

/** Resolve generic course start once, then dispatch units by their exact ID. */
export function registerCourseWelcome(contents: CourseContentStudentList[], courseId?: string): CourseContentStudentList | undefined {
  if (courseId) welcomeIds.delete(courseId);
  for (const content of contents) welcomeIds.delete(content.course_id);
  const welcome = courseWelcomeItem(contents);
  if (welcome) welcomeIds.set(welcome.course_id, welcome.id);
  return welcome;
}

export function isCourseWelcomeContent(content: CourseContentStudentList): boolean {
  return welcomeIds.get(content.course_id) === content.id;
}

/**
 * A course with no authored Welcome item has no guide of its own, so a learner
 * who has not started it gets the general Welcome page once, as on a plain
 * VS Code start. The key follows the course introduction: once per account and
 * course. A course with an authored Welcome, or a learner who has started,
 * never opens it. Returns whether the page was opened.
 */
export async function showCourseWelcomeGuideOnce(
  context: vscode.ExtensionContext, api: ComputorApiService, courseId: string,
  request: MarkdownPreviewRequest, open: () => Promise<void>
): Promise<boolean> {
  if (!request.isCurrent()) return false;
  const user = await api.getUserAccount();
  if (!user?.id || !request.isCurrent()) return false;
  const stateKey = `workspaceCourseWelcomeGuide:${user.id}:${courseId}`;
  if (context.globalState.get<boolean>(stateKey)) return false;
  const contents = await api.getStudentCourseContents(courseId, { throwOnError: true });
  if (!request.isCurrent() || courseWelcomeItem(contents) || hasStartedCourse(contents)) return false;
  await open();
  await context.globalState.update(stateKey, true);
  return true;
}

/** Apply one native course intent, retaining the exact target beneath its first introduction. */
export async function openWorkspaceCourseLaunch(
  context: vscode.ExtensionContext, api: ComputorApiService, courseId: string,
  request: MarkdownPreviewRequest, openCourse: (hasIntroduction: boolean) => Promise<boolean>
): Promise<boolean> {
  const introduction = await prepareWorkspaceCourseIntroduction(context, api, courseId, request);
  if (!request.isCurrent()) return true;
  const opened = await openCourse(Boolean(introduction));
  if (!opened || !request.isCurrent()) return opened;
  if (introduction) await showWorkspaceCourseIntroduction(context, api, introduction, request);
  return true;
}

const freshCourseIntroductions = new WeakMap<vscode.ExtensionContext, Set<string>>();

interface WorkspaceCourseIntroduction {
  welcome: CourseContentStudentList;
  stateKey: string;
}

/** Snapshot before this launch expands a course or provisions its repository. */
async function prepareWorkspaceCourseIntroduction(
  context: vscode.ExtensionContext, api: ComputorApiService, courseId: string,
  request: MarkdownPreviewRequest
): Promise<WorkspaceCourseIntroduction | undefined> {
  if (!request.isCurrent()) return undefined;
  const user = await api.getUserAccount();
  if (!request.isCurrent()) return undefined;
  if (!user?.id) throw new Error('The learner account is not ready.');
  const stateKey = `workspaceCourseIntroduction:${user.id}:${courseId}`;
  if (context.globalState.get<boolean>(stateKey)) return undefined;
  let fresh = freshCourseIntroductions.get(context);
  if (!fresh?.has(stateKey)) {
    const repository = await api.getCourseRepository(courseId);
    if (!request.isCurrent() || repository) return undefined;
  }
  const contents = await api.getStudentCourseContents(courseId, { throwOnError: true });
  if (!request.isCurrent() || hasStartedCourse(contents)) return undefined;
  const welcome = registerCourseWelcome(contents, courseId);
  if (!welcome) return undefined;
  if (!fresh) { fresh = new Set(); freshCourseIntroductions.set(context, fresh); }
  // Retain only the fresh decision across retries, never content or a target.
  fresh.add(stateKey);
  return { welcome, stateKey };
}

/** The exact task stays in native tabs while its first authored introduction is foregrounded. */
async function showWorkspaceCourseIntroduction(
  context: vscode.ExtensionContext, api: ComputorApiService,
  introduction: WorkspaceCourseIntroduction, request: MarkdownPreviewRequest
): Promise<void> {
  if (await showWorkspaceCourseUnit(context, api, introduction.welcome, { request }) && request.isCurrent()) {
    await context.globalState.update(introduction.stateKey, true);
    freshCourseIntroductions.get(context)?.delete(introduction.stateKey);
  }
}

/** Startup, the Welcome row and exact unit handoff render the same authored body. */
export async function showWorkspaceCourseUnit(
  context: vscode.ExtensionContext, api: ComputorApiService, content: CourseContentStudentList,
  options: MarkdownPreviewOptions = {}
): Promise<boolean> {
  const request = options.request ?? beginMarkdownPreviewRequest();
  const language = await readingLanguage(api);
  if (!request.isCurrent() || (options.isCurrent && !options.isCurrent())) return false;
  // The row may predate a language switch; its maps still give the new language.
  const description = localizedText(content.description_i18n, language, content.description) ?? '';
  const title = localizedTitle(content, language) || content.path;
  await showMarkdownTextPreview(context, descriptionInLanguage(description, language), localizedUnitTitle(title, language), {
    ...options, request, studentReading: true,
    welcomeContentId: isCourseWelcomeContent(content) ? content.id : undefined
  });
  return request.isCurrent() && (options.isCurrent?.() ?? true);
}

/** The reading language (uiLanguage) for the account as the backend reports it now. */
export async function readingLanguage(api: { getUserAccount(): Promise<LanguageAccount | undefined> }): Promise<string> {
  try {
    return accountLanguage(await api.getUserAccount());
  } catch (error) {
    console.warn('[WorkspaceCourseLanding] Could not load the language preference:', error);
    return accountLanguage(undefined);
  }
}
