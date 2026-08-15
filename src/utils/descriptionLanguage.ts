import * as path from 'path';

/**
 * Choosing which language of an assignment description to show.
 *
 * An assignment ships its description as sibling files: the default document
 * (`README.md`, or `index.md` before release renames it) plus one file per
 * translation (`README_de.md`, `index_fr.md`, …). Nothing server-side picks
 * between them — every variant is delivered and the client decides.
 *
 * The choice used to end at "whatever `readdir` returned first", which is
 * alphabetical, so a student whose language was missing got German purely
 * because `_de` sorts before `_en` (computor-org/issues#328).
 */

const DESCRIPTION_FILE = /^(README|index)(?:_([a-z]{2}))?\.md$/i;

export interface DescriptionFile {
  /** The file as given — a bare name or a full path, unchanged. */
  file: string;
  /** Lower-case language code, or undefined for the default document. */
  language?: string;
}

/**
 * Recognise the description files among `files`, in the order given.
 *
 * Accepts bare names or full paths; only the basename is inspected, and the
 * entry is returned exactly as passed in so callers keep their own paths.
 */
export function listDescriptionFiles(files: string[]): DescriptionFile[] {
  const found: DescriptionFile[] = [];
  for (const file of files) {
    const match = DESCRIPTION_FILE.exec(path.basename(file));
    if (!match) {
      continue;
    }
    const language = match[2]?.toLowerCase();
    found.push(language ? { file, language } : { file });
  }
  return found;
}

/**
 * The languages a description is available in, English first and the rest
 * alphabetical. The default document has no language and is not listed.
 */
export function availableDescriptionLanguages(files: string[]): string[] {
  const languages = new Set<string>();
  for (const entry of listDescriptionFiles(files)) {
    if (entry.language) {
      languages.add(entry.language);
    }
  }
  return [...languages].sort((a, b) => {
    if (a === 'en') { return -1; }
    if (b === 'en') { return 1; }
    return a.localeCompare(b);
  });
}

/**
 * Pick the description to show for a reader who prefers `preferred`.
 *
 * In order: the preferred language, then English, then the default document,
 * then whatever else is there. English outranks the default document on
 * purpose — `_en` is known to be English, while the default's language is
 * whoever wrote it, and showing an unasked-for German page is the complaint
 * this order exists to answer.
 */
export function pickDescriptionFile(
  files: string[],
  preferred?: string | null
): string | undefined {
  const candidates = listDescriptionFiles(files);
  if (candidates.length === 0) {
    return undefined;
  }

  const inLanguage = (language: string): string | undefined =>
    candidates.find((entry) => entry.language === language)?.file;

  const wanted = preferred?.trim().toLowerCase();
  if (wanted) {
    const exact = inLanguage(wanted);
    if (exact) {
      return exact;
    }
  }

  return (
    inLanguage('en') ??
    candidates.find((entry) => entry.language === undefined)?.file ??
    candidates[0]?.file
  );
}
