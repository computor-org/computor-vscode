/**
 * Course text in the reading language (see uiLanguage), and the titles that
 * follow it. A course's own language is only the fallback for a text without
 * a version in the reading language.
 */

const HEADING = /^#\s+(.+?)\s*#*\s*$/m;

/** The first level-one heading of a Markdown description, if any. */
export function descriptionHeading(markdown: string | undefined | null): string | undefined {
  return markdown?.match(HEADING)?.[1] || undefined;
}

// Lines that render as nothing above a heading: link reference definitions,
// HTML comments, blank lines.
const INVISIBLE_LINE = /^\s*(?:\[[^\]]+\]:\s+\S.*|<!--.*-->)?\s*$/;

/**
 * The description without its leading heading, for views that already show
 * the title above it. A heading below visible text is kept.
 */
export function withoutLeadingHeading(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^#\s+/.test(line)) {
      lines.splice(index, 1);
      return lines.join('\n');
    }
    if (!INVISIBLE_LINE.test(line)) {
      return markdown;
    }
  }
  return markdown;
}

/**
 * A title in the reading language from its per-language map, else the stored
 * title. For objects the backend does not translate with `?localize=`, such
 * as a content type; an older backend sends no map.
 */
export function titleInLanguage(
  item: { title?: string | null; title_i18n?: Record<string, string> | null },
  language: string
): string | undefined {
  return item.title_i18n?.[language]?.trim() || item.title || undefined;
}

const UNIT_TITLE = /^(?:Week|Woche)\s+(\d+)$/i;

/** "Week N" and "Woche N" follow the reading language; other titles stay. */
export function localizedUnitTitle(title: string, language: string): string {
  const unit = title.trim().match(UNIT_TITLE);
  if (!unit) {
    return title;
  }
  return language === 'de' ? `Woche ${unit[1]}` : language === 'en' ? `Week ${unit[1]}` : title;
}

// A course or unit description may hold one section per language, each behind
// a "<!-- lang: xx -->" line, because the field itself has no languages.
const LANGUAGE_MARKER = /^<!--\s*lang:\s*([a-z]{2})\s*-->[ \t]*$/gim;

/**
 * The section of a description in the reading language, after any text that
 * precedes the first marker. Without a section in that language the first
 * section is used; text without markers is returned unchanged.
 */
export function descriptionInLanguage(markdown: string, language: string): string {
  const parts = markdown.split(LANGUAGE_MARKER);
  if (parts.length === 1) {
    return markdown;
  }
  const wanted = language.trim().toLowerCase().slice(0, 2);
  let index = 1;
  for (let candidate = 1; candidate < parts.length; candidate += 2) {
    if (parts[candidate]!.toLowerCase() === wanted) {
      index = candidate;
      break;
    }
  }
  return `${parts[0]!.trim()}\n\n${parts[index + 1]!.trim()}`.trim();
}
