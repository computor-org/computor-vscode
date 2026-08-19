import * as fs from 'fs';
import * as path from 'path';
import { shouldExcludeExampleEntry } from './exampleExcludePatterns';
import { BINARY_EXTENSIONS } from './exampleFileWriter';

/**
 * A search-and-replace across every file of every checked-out example, the way
 * VS Code's own Replace All works across a folder (computor-org/issues#341).
 *
 * Deliberately free of `vscode` imports: the walking, counting and rewriting
 * are the parts worth testing, and they are testable only if they do not need
 * an extension host.
 */

export interface ReplaceOptions {
  find: string;
  replace: string;
  /** Treat `find` as a regular expression, so `$1` works in `replace`. */
  regex: boolean;
  matchCase: boolean;
}

export interface FileHits {
  filePath: string;
  /** Path relative to the example directory, for display. */
  relativePath: string;
  count: number;
}

export interface ReplaceTarget {
  directory: string;
  dirPath: string;
}

export interface ExamplePlan {
  directory: string;
  dirPath: string;
  files: FileHits[];
  total: number;
}

export interface ReplaceSummary {
  examples: number;
  files: number;
  replacements: number;
  errors: string[];
}

/** How much of a file we sniff for a NUL byte before calling it binary. */
const BINARY_SNIFF_BYTES = 8192;

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * In literal mode the replacement is data, not a template, so `$` has to be
 * escaped — otherwise typing `$&` would splice the match back in and a plain
 * `$100` would silently lose characters.
 */
export function prepareReplacement(options: ReplaceOptions): string {
  return options.regex ? options.replace : options.replace.replace(/\$/g, '$$$$');
}

export function buildMatcher(options: ReplaceOptions): RegExp {
  const pattern = options.regex ? options.find : escapeRegExp(options.find);
  return new RegExp(pattern, options.matchCase ? 'g' : 'gi');
}

export function isProbablyBinary(filePath: string, contents: Buffer): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) { return true; }
  return contents.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * Counts matches without rewriting anything.
 *
 * A pattern like `a*` matches the empty string, and `exec` would then never
 * advance — hence the manual bump of `lastIndex`.
 */
export function countMatches(contents: string, matcher: RegExp): number {
  matcher.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(contents)) !== null) {
    count++;
    if (match.index === matcher.lastIndex) { matcher.lastIndex++; }
  }
  matcher.lastIndex = 0;
  return count;
}

function collectTextFiles(dir: string, baseDir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (shouldExcludeExampleEntry(entry.name)) { continue; }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTextFiles(fullPath, baseDir, out);
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
}

/**
 * Works out what a replacement would do, so the user can be told the size of
 * it before a single file is written.
 */
export function planReplacements(targets: ReplaceTarget[], options: ReplaceOptions): ExamplePlan[] {
  const matcher = buildMatcher(options);
  const plans: ExamplePlan[] = [];

  for (const target of targets) {
    const files: string[] = [];
    collectTextFiles(target.dirPath, target.dirPath, files);

    const hits: FileHits[] = [];
    for (const filePath of files.sort()) {
      let raw: Buffer;
      try {
        raw = fs.readFileSync(filePath);
      } catch {
        continue;
      }
      if (isProbablyBinary(filePath, raw)) { continue; }

      const count = countMatches(raw.toString('utf8'), matcher);
      if (count > 0) {
        hits.push({
          filePath,
          relativePath: path.relative(target.dirPath, filePath).replace(/\\/g, '/'),
          count
        });
      }
    }

    if (hits.length > 0) {
      plans.push({
        directory: target.directory,
        dirPath: target.dirPath,
        files: hits,
        total: hits.reduce((sum, hit) => sum + hit.count, 0)
      });
    }
  }

  return plans;
}

/**
 * Rewrites the files a plan identified. Each file is re-read rather than
 * trusted from the planning pass, so an edit made in the meantime is not
 * clobbered with stale content.
 */
export function applyReplacements(plans: ExamplePlan[], options: ReplaceOptions): ReplaceSummary {
  const matcher = buildMatcher(options);
  const replacement = prepareReplacement(options);
  const summary: ReplaceSummary = { examples: 0, files: 0, replacements: 0, errors: [] };

  for (const plan of plans) {
    let touchedInExample = 0;

    for (const hit of plan.files) {
      try {
        const raw = fs.readFileSync(hit.filePath);
        if (isProbablyBinary(hit.filePath, raw)) { continue; }

        const before = raw.toString('utf8');
        const count = countMatches(before, matcher);
        if (count === 0) { continue; }

        matcher.lastIndex = 0;
        fs.writeFileSync(hit.filePath, before.replace(matcher, replacement), 'utf8');

        summary.files++;
        summary.replacements += count;
        touchedInExample++;
      } catch (error) {
        summary.errors.push(`${plan.directory}/${hit.relativePath}: ${error}`);
      }
    }

    if (touchedInExample > 0) { summary.examples++; }
  }

  return summary;
}

export function totalHits(plans: ExamplePlan[]): { files: number; replacements: number } {
  return {
    files: plans.reduce((sum, plan) => sum + plan.files.length, 0),
    replacements: plans.reduce((sum, plan) => sum + plan.total, 0)
  };
}
