import JSZip from 'jszip';
import type * as vscode from 'vscode';
import type { ComputorApiService } from './ComputorApiService';
import type { CourseContentStudentList, CourseStudentList } from '../types/generated';
import { pickDescriptionFile } from '../utils/descriptionLanguage';
import { showMarkdownTextPreview } from '../ui/webviews/markdownPreview';

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

export function firstReleasedCourseItem(contents: CourseContentStudentList[]): CourseContentStudentList | undefined {
  const byPath = new Map(contents.map(content => [content.path, content]));
  const ancestry = (content: CourseContentStudentList): number[] => content.path.split('.')
    .map((_, index, parts) => byPath.get(parts.slice(0, index + 1).join('.'))?.position ?? 0);
  return contents.filter(content => content.visible_effective !== false
    && content.course_content_kind_id === 'assignment'
    && (content.deployment?.deployment_status === 'deployed' || Boolean(content.deployment?.deployed_at)))
    .sort((a, b) => {
      const left = ancestry(a), right = ancestry(b);
      for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const difference = left[index]! - right[index]!;
        if (difference) return difference;
      }
      return left.length - right.length || a.path.localeCompare(b.path);
    })[0];
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

function welcomeItem(contents: CourseContentStudentList[]): CourseContentStudentList | undefined {
  return contents.find(content => content.visible_effective !== false
    && content.course_content_kind_id !== 'assignment' && Boolean(content.description?.trim())
    && (/^(welcome(?:\s*\/\s*start here)?|willkommen|getting[ _-]started|start[ _-]here|start|introduction|einführung)$/i.test(content.title?.trim() ?? '')
      || /^(welcome|willkommen|start_here|getting_started|introduction)$/.test(content.path.split('.').pop()?.toLowerCase() ?? '')));
}

/** Open instructions without cloning, provisioning, or inspecting other courses. */
export async function showWorkspaceCourseLanding(
  context: vscode.ExtensionContext,
  api: ComputorApiService,
  course: CourseStudentList
): Promise<void> {
  const contents = await api.getStudentCourseContents(course.id, { throwOnError: true });
  const welcome = welcomeItem(contents);
  const title = course.title || course.path;
  if (welcome) {
    await showMarkdownTextPreview(context, welcome.description!, `${title}: ${welcome.title}`);
    return;
  }
  const first = firstReleasedCourseItem(contents);
  let markdown = `# ${escapeHeading(title)}\n\n${course.description?.trim() ?? ''}`;
  let inlineImages: Record<string, string> | undefined;
  if (first) {
    let description = first.description?.trim();
    try {
      const archive = await api.downloadStudentCourseContentDescription(first.id);
      if (archive) {
        const profile = await api.getUserAccount();
        description = await readStudentDescription(archive, profile?.profile?.language_code) || description;
        inlineImages = await studentDescriptionImages(archive);
      }
    } catch (error) {
      console.warn('[WorkspaceCourseLanding] Could not load assignment instructions:', error);
    }
    markdown += `\n\n## ${escapeHeading(first.title || first.path)}\n\n${description || 'Select this exercise in the course tree to start working.'}`;
  } else {
    markdown += '\n\nNo exercises are available yet. Course materials will appear in the course tree when released.';
  }
  await showMarkdownTextPreview(context, markdown, title, { inlineImages });
}

function escapeHeading(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]()#+.!<>])/g, '\\$1');
}
