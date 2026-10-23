import JSZip from 'jszip';
import type * as vscode from 'vscode';
import type { ComputorApiService } from './ComputorApiService';
import type { CourseStudentList } from '../types/generated';
import { pickDescriptionFile } from '../utils/descriptionLanguage';
import { descriptionHeading, localizedUnitTitle, resolveContentLanguage, withoutLeadingHeading } from '../utils/contentLanguage';
import { showMarkdownTextPreview } from '../ui/webviews/markdownPreview';
import { courseWelcomeItem, firstReleasedCourseItem } from '../utils/courseStart';

export { firstReleasedCourseItem };

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

/** Open instructions without cloning, provisioning, or inspecting other courses. */
export async function showWorkspaceCourseLanding(
  context: vscode.ExtensionContext,
  api: ComputorApiService,
  course: CourseStudentList
): Promise<void> {
  const contents = await api.getStudentCourseContents(course.id, { throwOnError: true });
  const welcome = courseWelcomeItem(contents);
  const title = course.title || course.path;
  if (welcome) {
    await showMarkdownTextPreview(context, welcome.description!, `${title}: ${welcome.title}`);
    return;
  }
  const first = firstReleasedCourseItem(contents);
  let markdown = `# ${escapeHeading(title)}\n\n${course.description?.trim() ?? ''}`;
  let inlineImages: Record<string, string> | undefined;
  const language = await landingLanguage(api, course.id);
  const copy = LANDING_COPY[language === 'de' ? 'de' : 'en'];
  if (first) {
    let description = first.description?.trim();
    try {
      const archive = await api.downloadStudentCourseContentDescription(first.id);
      if (archive) {
        description = await readStudentDescription(archive, language) || description;
        inlineImages = await studentDescriptionImages(archive);
      }
    } catch (error) {
      console.warn('[WorkspaceCourseLanding] Could not load assignment instructions:', error);
    }
    markdown += `\n\n${landingSection(first.title || first.path, description, language, copy.selectExercise)}`;
  } else {
    markdown += `\n\n${copy.noExercises}`;
  }
  await showMarkdownTextPreview(context, markdown, title, { inlineImages });
}

const LANDING_COPY = {
  de: {
    selectExercise: 'Wähle diese Aufgabe in der Kursübersicht, um mit der Arbeit zu beginnen.',
    noExercises: 'Noch sind keine Aufgaben freigegeben. Kursmaterialien erscheinen in der Kursübersicht, sobald sie freigegeben sind.'
  },
  en: {
    selectExercise: 'Select this exercise in the course tree to start working.',
    noExercises: 'No exercises are available yet. Course materials will appear in the course tree when released.'
  }
};

async function landingLanguage(api: ComputorApiService, courseId: string): Promise<string> {
  let userLanguage: string | null | undefined;
  let courseLanguage: string | null | undefined;
  try {
    userLanguage = (await api.getUserAccount())?.profile?.language_code;
    if (!userLanguage) courseLanguage = (await api.getCourse(courseId))?.language_code;
  } catch (error) {
    console.warn('[WorkspaceCourseLanding] Could not load the language preference:', error);
  }
  return resolveContentLanguage(userLanguage, courseLanguage);
}

/**
 * The first exercise, set off from the course description by a rule and a label, under one heading: the description's own heading (it is
 * in the reading language) replaces the stored title instead of following it.
 */
export function landingSection(title: string, description: string | undefined, language: string, fallback: string): string {
  const heading = descriptionHeading(description);
  const body = heading && description ? withoutLeadingHeading(description).trim() : description;
  const label = language === 'de' ? 'Erste Aufgabe' : 'First exercise';
  return `---\n\n*${label}*\n\n## ${heading ?? escapeHeading(localizedUnitTitle(title, language))}\n\n${body || fallback}`;
}

function escapeHeading(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]()#+.!<>])/g, '\\$1');
}
