import JSZip from 'jszip';
import type * as vscode from 'vscode';
import type { ComputorApiService } from './ComputorApiService';
import type { CourseContentStudentList, CourseStudentList } from '../types/generated';
import { pickDescriptionFile } from '../utils/descriptionLanguage';
import { descriptionInLanguage, localizedUnitTitle, resolveContentLanguage } from '../utils/contentLanguage';
import { beginMarkdownPreviewRequest, MarkdownPreviewOptions, MarkdownPreviewRequest, showMarkdownTextPreview } from '../ui/webviews/markdownPreview';
import { SOURCE_COLUMN } from '../ui/editorLayout';
import { courseWelcomeItem } from '../utils/courseStart';


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
 * Open the same authored course Welcome for fresh and returning learners.
 * Courses without a Welcome show their authored description, without a startup wrapper.
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
  if (welcome) {
    await showWorkspaceCourseUnit(context, api, welcome, { request });
  } else {
    const language = await readingLanguage(api, course.id);
    if (!request.isCurrent()) return undefined;
    await showMarkdownTextPreview(context, descriptionInLanguage(course.description ?? '', language), course.title || course.path, {
      request, studentReading: true, viewColumn: SOURCE_COLUMN
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

/** Startup, the Welcome row and exact unit handoff render the same authored body. */
export async function showWorkspaceCourseUnit(
  context: vscode.ExtensionContext, api: ComputorApiService, content: CourseContentStudentList,
  options: MarkdownPreviewOptions = {}
): Promise<void> {
  const request = options.request ?? beginMarkdownPreviewRequest();
  const language = await readingLanguage(api, content.course_id);
  if (!request.isCurrent() || (options.isCurrent && !options.isCurrent())) return;
  await showMarkdownTextPreview(context, descriptionInLanguage(content.description ?? '', language), localizedUnitTitle(content.title || content.path, language), {
    ...options, request, studentReading: true, viewColumn: SOURCE_COLUMN,
    welcomeContentId: isCourseWelcomeContent(content) ? content.id : undefined
  });
}

/** The learner's profile language, else the course's, else English. */
export async function readingLanguage(api: ComputorApiService, courseId: string): Promise<string> {
  let userLanguage: string | null | undefined;
  let courseLanguage: string | null | undefined;
  try {
    userLanguage = (await api.getUserAccount())?.profile?.language_code;
    if (!userLanguage && courseId) courseLanguage = (await api.getCourse(courseId))?.language_code;
  } catch (error) {
    console.warn('[WorkspaceCourseLanding] Could not load the language preference:', error);
  }
  return resolveContentLanguage(userLanguage, courseLanguage);
}
