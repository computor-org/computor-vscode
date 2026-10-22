/**
 * Which language a learner reads a course in, and the titles that follow it.
 *
 * The learner's explicit profile language wins; otherwise the course's own
 * language; otherwise English. A German course must not show an English
 * README just because the learner never picked a language.
 */

export function resolveContentLanguage(
  userLanguage?: string | null,
  courseLanguage?: string | null
): string {
  return userLanguage?.trim().toLowerCase() || courseLanguage?.trim().toLowerCase() || 'en';
}

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

const UNIT_TITLE = /^(?:Week|Woche)\s+(\d+)$/i;

/** "Week N" and "Woche N" follow the reading language; other titles stay. */
export function localizedUnitTitle(title: string, language: string): string {
  const unit = title.trim().match(UNIT_TITLE);
  if (!unit) {
    return title;
  }
  return language === 'de' ? `Woche ${unit[1]}` : language === 'en' ? `Week ${unit[1]}` : title;
}
