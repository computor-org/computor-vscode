/**
 * Finding the links inside courseware.
 *
 * A lecturer cannot see, from an assignment, whether the paper it points at has
 * moved or the picture it embeds still resolves (computor-org/issues#362). The
 * crawler that answers that starts here: everything else is probing and
 * reporting, this is what counts as a link in the first place.
 *
 * Deliberately regex-based rather than a markdown parse. READMEs are markdown,
 * but meta.yaml descriptions, plain text files and the occasional bit of inline
 * HTML are not, and a link left unchecked because a parser did not recognise
 * its container is exactly the failure this feature exists to prevent.
 */

/** One occurrence of a link, and where it was written. */
export interface LinkOccurrence {
  /** The target as written. */
  url: string;
  /** File it appeared in, relative to the example — or a description's label. */
  source: string;
  /** 1-based line, when the source has lines. */
  line?: number;
  /** The raw line the link was found on, so a report can show the hit in
   * context — a captured target like `$$` is a mystery without it (#362). */
  text?: string;
}

/** Markdown inline link or image: `[text](target)` / `![alt](target)`. */
const INLINE_LINK = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;

/**
 * Link reference definition: `[id]: target "title"`.
 *
 * `[ \t]*` — NOT `\s*` — between the colon and the target: `\s` crosses
 * newlines, so a `[Label]:` line directly above a `$$` math block captured the
 * `$$` as a link target and reported "content/$$" as a missing file (#362).
 * A reference definition's target sits on the same line by definition.
 */
const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]]+\]:[ \t]*<?([^\s>]+)>?/gm;

/** Autolink: `<https://example.org>`. */
const AUTOLINK = /<((?:https?|ftp):\/\/[^\s>]+)>/gi;

/** `href="…"` / `src="…"` in inline HTML. */
const HTML_ATTRIBUTE = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;

/**
 * A bare URL written in running text.
 *
 * Parentheses are allowed inside it — Wikipedia and many DOIs put them there,
 * and cutting the address at the first one turns a good link into a reported
 * failure. An unbalanced closing bracket, from "(see https://…/x)", is taken
 * back off by {@link trimTrailingPunctuation}.
 */
const BARE_URL = /(?<![("'<\]=])\b(https?:\/\/[^\s<>"'[\]]+)/gi;

/**
 * Trailing punctuation a sentence lends to a bare URL.
 *
 * "see https://example.org/paper." ends in a full stop that belongs to the
 * sentence, not to the address — probing it as written would report a perfectly
 * good link as broken.
 */
function trimTrailingPunctuation(url: string): string {
  let trimmed = url.replace(/[.,;:!?]+$/, '');
  // A closing bracket only counts as the URL's own when it was opened in it.
  while (trimmed.endsWith(')') && countChar(trimmed, ')') > countChar(trimmed, '(')) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const character of text) {
    if (character === char) {
      count += 1;
    }
  }
  return count;
}

/** Line number (1-based) of an offset in `text`. */
/** The full trimmed line around `offset`, for showing a hit in context. */
function lineTextAt(text: string, offset: number): string {
  const start = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const endIndex = text.indexOf('\n', offset);
  const end = endIndex === -1 ? text.length : endIndex;
  return text.slice(start, end).trim().slice(0, 200);
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') {
      line += 1;
    }
  }
  return line;
}

/**
 * Fenced and indented code blocks, as offset ranges.
 *
 * A URL inside a code sample is usually an illustration — `http://localhost` in
 * a snippet is not a broken link, and reporting it as one buries the real ones.
 */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  // `(?![\s\S])` is end-of-input: an unclosed fence runs to the end of the file
  // rather than leaving the rest of it treated as prose.
  const fence = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:^\1\2|(?![\s\S]))/gm;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  // Inline code spans: `like this`.
  const span = /`[^`\n]+`/g;
  while ((match = span.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  // Math is prose to none of the link patterns either: a `$$…$$` display block
  // or `$…$` inline math is notation, and what look like bracketed labels or
  // URLs inside it are formulas (#362).
  const displayMath = /\$\$[\s\S]*?\$\$/g;
  while ((match = displayMath.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  const inlineMath = /\$[^$\n]+\$/g;
  while ((match = inlineMath.exec(text)) !== null) {
    if (!inRanges(match.index, ranges)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

function inRanges(offset: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

/**
 * Every link written in a piece of text.
 *
 * Duplicates within one source are collapsed per line, so a line that carries
 * the same address twice is reported once.
 */
export function extractLinks(text: string, source: string): LinkOccurrence[] {
  if (!text) {
    return [];
  }

  const skip = codeRanges(text);
  const found: LinkOccurrence[] = [];
  const seen = new Set<string>();

  const collect = (pattern: RegExp, group = 1) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[group];
      if (!raw) {
        continue;
      }
      if (inRanges(match.index, skip)) {
        continue;
      }
      const url = trimTrailingPunctuation(raw.trim());
      if (!url) {
        continue;
      }
      const line = lineAt(text, match.index);
      const key = `${url}\0${line}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      found.push({ url, source, line, text: lineTextAt(text, match.index) });
    }
  };

  collect(INLINE_LINK);
  collect(REFERENCE_DEFINITION);
  collect(AUTOLINK);
  collect(HTML_ATTRIBUTE);
  collect(BARE_URL);

  return found;
}

/** The URL fields of a parsed meta.yaml — both the old and the new format. */
export function extractMetaLinks(meta: unknown, source: string): LinkOccurrence[] {
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const document = meta as Record<string, unknown>;
  const found: LinkOccurrence[] = [];

  const listFields = ['links', 'supportingMaterial', 'courseMaterials', 'supportingMaterials'];
  for (const field of listFields) {
    const entries = document[field];
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (entry && typeof entry === 'object') {
        const url = (entry as Record<string, unknown>).url;
        if (typeof url === 'string' && url.trim()) {
          found.push({ url: url.trim(), source: `${source} (${field})` });
        }
      } else if (typeof entry === 'string' && entry.trim()) {
        found.push({ url: entry.trim(), source: `${source} (${field})` });
      }
    }
  }

  // The description is prose and may carry markdown links of its own.
  const description = document.description;
  if (typeof description === 'string') {
    found.push(...extractLinks(description, `${source} (description)`));
  }

  return found;
}

/** What kind of target a link points at, which decides how it is checked. */
export type LinkKind = 'web' | 'relative' | 'anchor' | 'other';

export function classifyLink(url: string): LinkKind {
  const trimmed = url.trim();
  if (!trimmed) {
    return 'other';
  }
  if (trimmed.startsWith('#')) {
    return 'anchor';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return 'web';
  }
  // Any other scheme — mailto:, tel:, ftp:, data: — is nothing we can probe.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) {
    return 'other';
  }
  return 'relative';
}

/**
 * A relative link resolved against the file it was written in, as a path
 * relative to the example root.
 *
 * Returns undefined when it escapes the example — a link reaching outside is
 * broken by construction, since only the example is deployed.
 */
export function resolveRelativeLink(link: string, fromFile: string): string | undefined {
  const target = (link.split('#')[0] ?? '').split('?')[0] ?? '';
  if (!target) {
    return undefined;
  }

  const base = fromFile.split('/').slice(0, -1);
  const segments = target.startsWith('/') ? [] : base.slice();

  for (const part of target.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
      continue;
    }
    segments.push(part);
  }

  const resolved = segments.join('/');
  return resolved.length > 0 ? decodeURIComponent(resolved) : undefined;
}
