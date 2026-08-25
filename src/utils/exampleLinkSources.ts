import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * An example's files, as the link checker needs to see them
 * (computor-org/issues#362).
 *
 * The same example reaches us two ways: as a working copy on disk, which is
 * what a lecturer is actually editing in the Examples view, and as a version
 * downloaded from the server, which is what was deployed into a course. Both
 * end up here so that the crawling and the reporting are one piece of code and
 * cannot drift apart.
 *
 * `fileNames` holds **every** file, binaries included, because that is what a
 * relative link has to resolve against — a README pointing at a PNG is only
 * correct if that PNG is there. `texts` holds only what is worth reading for
 * links, so a folder of images costs nothing to check.
 */
export interface ExampleBundle {
  /** Every file in the example, as forward-slashed relative paths. */
  fileNames: Set<string>;
  /** Contents of the readable files, by the same paths. */
  texts: Map<string, string>;
  /** Parsed meta.yaml, when the example has one. */
  meta: unknown;
}

/** Files worth reading for links. Anything else is only a name to resolve against. */
const TEXT_FILE = /\.(md|markdown|txt|ya?ml|json|html?|tex|rst|csv|py|m|jl|r)$/i;

/** Never walked into: bookkeeping, not courseware. */
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '__pycache__', '.venv']);

/** Files that exist only to track the checkout. */
const SKIP_FILES = new Set(['.computor-example.json']);

/** Anything bigger than this is not prose, whatever its extension says. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** The bundle for an example downloaded from the server. */
export function bundleFromFiles(
  files: Record<string, string> | undefined,
  meta: unknown
): ExampleBundle {
  const fileNames = new Set<string>();
  const texts = new Map<string, string>();

  for (const [name, content] of Object.entries(files ?? {})) {
    const normalized = name.split(path.sep).join('/');
    fileNames.add(normalized);
    if (typeof content === 'string' && TEXT_FILE.test(normalized)) {
      texts.set(normalized, content);
    }
  }

  return { fileNames, texts, meta: meta ?? parseMetaFrom(texts) };
}

/**
 * The bundle for a working copy on disk.
 *
 * This is the authoring case: the lecturer wants to know about a broken link
 * *before* uploading the example, which is the only moment fixing it is cheap.
 */
export function bundleFromDirectory(directory: string): ExampleBundle {
  const fileNames = new Set<string>();
  const texts = new Map<string, string>();

  const walk = (absolute: string, relative: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          walk(path.join(absolute, entry.name), childRelative);
        }
        continue;
      }
      if (!entry.isFile() || SKIP_FILES.has(entry.name)) {
        continue;
      }

      fileNames.add(childRelative);
      if (!TEXT_FILE.test(entry.name)) {
        continue;
      }

      const childAbsolute = path.join(absolute, entry.name);
      try {
        if (fs.statSync(childAbsolute).size > MAX_TEXT_BYTES) {
          continue;
        }
        texts.set(childRelative, fs.readFileSync(childAbsolute, 'utf8'));
      } catch {
        // An unreadable file is one we cannot check; the rest still gets checked.
      }
    }
  };

  walk(directory, '');
  return { fileNames, texts, meta: parseMetaFrom(texts) };
}

/** meta.yaml out of the already-read text files, or undefined. */
function parseMetaFrom(texts: Map<string, string>): unknown {
  const raw = texts.get('meta.yaml') ?? texts.get('meta.yml');
  if (raw === undefined) {
    return undefined;
  }
  try {
    return yaml.load(raw);
  } catch {
    // A meta.yaml that does not parse is a problem of its own, and not one a
    // link check should fail over. Its links are simply not read.
    return undefined;
  }
}
