import * as path from 'path';

/**
 * Pure helpers for moving documents between the lecturer's machine, the
 * workspace mirror and the published store (computor-org/issues#361).
 */

/** Enough of a MIME table for the browser to do the right thing on download. */
const DOWNLOAD_MIME_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

export function mimeTypeFor(name: string): string {
  return DOWNLOAD_MIME_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Make a browser-supplied path safe to append to a documents path.
 *
 * `webkitRelativePath` is whatever the chosen folder contained, so it can carry
 * backslashes, empty segments, or `..`. Anything that would climb out of the
 * target directory drops the whole file rather than being silently rewritten
 * into a different destination — a misplaced upload into a scope the lecturer
 * did not choose is worse than a refused one.
 */
export function normalizeUploadPath(input: string): string | undefined {
  const segments = input
    .replace(/\\/g, '/')
    .split('/')
    .filter(segment => segment.length > 0 && segment !== '.');
  if (segments.length === 0) { return undefined; }
  if (segments.some(segment => segment === '..')) { return undefined; }
  return segments.join('/');
}

/**
 * The address the static server publishes a document at.
 *
 * The backend lays the store out along the entity paths (`resolve_scope_root`:
 * organization → course family → course) and the static server exposes that
 * same tree under `/docs`, so the URL is the scope's segments followed by the
 * document's path within its scope.
 */
export function buildPublicDocumentUrl(
  origin: string,
  scopeSegments: readonly string[],
  relativePath: string
): string {
  const parts = [...scopeSegments, ...relativePath.split('/')]
    .filter(part => part.length > 0)
    .map(part => encodeURIComponent(part));
  return `${origin.replace(/\/$/, '')}/docs/${parts.join('/')}`;
}
