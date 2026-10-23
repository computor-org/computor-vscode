import JSZip from 'jszip';
import type * as vscode from 'vscode';
import type { ComputorApiService } from './ComputorApiService';
import type { CourseContentStudentList, CourseStudentList } from '../types/generated';
import { pickDescriptionFile } from '../utils/descriptionLanguage';
import { descriptionHeading, localizedUnitTitle, resolveContentLanguage, withoutLeadingHeading } from '../utils/contentLanguage';
import { showMarkdownTextPreview } from '../ui/webviews/markdownPreview';
import { courseItemTrail, courseWelcomeItem, firstReleasedCourseItem, hasStartedCourse, nextOpenCourseItem } from '../utils/courseStart';

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

/**
 * Open instructions without cloning, provisioning, or inspecting other courses. A new learner lands on the course welcome or the first
 * exercise; a returning learner on the next open exercise, which is returned so the caller can reveal its row (computor-org/issues#525).
 */
export async function showWorkspaceCourseLanding(
  context: vscode.ExtensionContext,
  api: ComputorApiService,
  course: CourseStudentList
): Promise<CourseContentStudentList | undefined> {
  const contents = await api.getStudentCourseContents(course.id, { throwOnError: true });
  const started = hasStartedCourse(contents);
  const welcome = started ? undefined : courseWelcomeItem(contents);
  const title = course.title || course.path;
  if (welcome) {
    await showMarkdownTextPreview(context, welcome.description!, `${title}: ${welcome.title}`);
    return undefined;
  }
  const item = started ? nextOpenCourseItem(contents) : firstReleasedCourseItem(contents);
  let markdown = `# ${escapeHeading(title)}`;
  let inlineImages: Record<string, string> | undefined;
  const language = await landingLanguage(api, course.id);
  const copy = LANDING_COPY[language === 'de' ? 'de' : 'en'];
  if (item) {
    let description = item.description?.trim();
    try {
      const archive = await api.downloadStudentCourseContentDescription(item.id);
      if (archive) {
        description = await readStudentDescription(archive, language) || description;
        inlineImages = await studentDescriptionImages(archive);
      }
    } catch (error) {
      console.warn('[WorkspaceCourseLanding] Could not load assignment instructions:', error);
    }
    const name = item.title || item.path;
    markdown += started
      ? `\n\n${resumeLine(contents, item, language)}\n\n${landingSection(name, description, language, copy.selectExercise, null)}`
      : `\n\n${course.description?.trim() ?? ''}\n\n${landingSection(name, description, language, copy.selectExercise)}`;
  } else {
    markdown += `\n\n${course.description?.trim() ?? ''}\n\n${started ? copy.allDone : copy.noExercises}`;
  }
  await showMarkdownTextPreview(context, markdown, title, { inlineImages });
  return started ? item : undefined;
}

/** "**Weiter mit:** Woche 3 → Beta-Absorption (zuletzt getestet: 0 %)" */
export function resumeLine(contents: CourseContentStudentList[], item: CourseContentStudentList, language: string): string {
  const de = language === 'de';
  const trail = courseItemTrail(contents, item, language) ?? (item.title || item.path);
  const result = item.result?.result;
  const percent = typeof result === 'number' ? Math.round(result * 100) : undefined;
  const state = percent !== undefined
    ? (de ? `zuletzt getestet: ${percent} %` : `last tested: ${percent}%`)
    : (de ? 'noch nicht getestet' : 'not tested yet');
  return `**${de ? 'Weiter mit' : 'Continue with'}:** ${escapeInline(trail)} (${state})`;
}

const LANDING_COPY = {
  de: {
    selectExercise: 'Wähle diese Aufgabe in der Kursübersicht, um mit der Arbeit zu beginnen.',
    noExercises: 'Noch sind keine Aufgaben freigegeben. Kursmaterialien erscheinen in der Kursübersicht, sobald sie freigegeben sind.',
    allDone: 'Du hast alle freigegebenen Aufgaben bestanden und abgegeben. Neue Aufgaben erscheinen in der Kursübersicht, sobald sie freigegeben sind.'
  },
  en: {
    selectExercise: 'Select this exercise in the course tree to start working.',
    noExercises: 'No exercises are available yet. Course materials will appear in the course tree when released.',
    allDone: 'You have passed and handed in every released exercise. New exercises will appear in the course tree when released.'
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
 * The exercise, set off from what precedes it by a rule and, for a new learner, the label "First exercise", under one heading: the
 * description's own heading (it is in the reading language) replaces the stored title instead of following it.
 */
export function landingSection(
  title: string, description: string | undefined, language: string, fallback: string,
  label: string | null = language === 'de' ? 'Erste Aufgabe' : 'First exercise'
): string {
  const heading = descriptionHeading(description);
  const body = heading && description ? withoutLeadingHeading(description).trim() : description;
  const labelLine = label ? `*${label}*\n\n` : '';
  return `---\n\n${labelLine}## ${heading ?? escapeHeading(localizedUnitTitle(title, language))}\n\n${body || fallback}`;
}

function escapeHeading(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]()#+.!<>])/g, '\\$1');
}

function escapeInline(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]<>])/g, '\\$1');
}
