import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { commandRegistrar } from './commandHelpers';
import { notify } from '../utils/notify';
import { openFile } from '../ui/editorLayout';
import { showMarkdownPreview } from '../ui/webviews/markdownPreview';
import { ComputorApiService } from '../services/ComputorApiService';
import { probeAll, ProbeResult } from '../services/LinkProbe';
import {
  classifyLink,
  extractLinks,
  extractMetaLinks,
  resolveRelativeLink,
  LinkOccurrence
} from '../utils/linkExtraction';
import {
  bundleFromDirectory,
  bundleFromFiles,
  ExampleBundle
} from '../utils/exampleLinkSources';
import { getExampleVersionId } from '../utils/deploymentHelpers';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
import type { LecturerExampleTreeProvider, MergedExample } from '../ui/tree/lecturer/LecturerExampleTreeProvider';
import type { CourseContentList, CourseList } from '../types/generated/courses';

/**
 * "Check Links" over courseware (computor-org/issues#362).
 *
 * A lecturer has no way of noticing that the paper an assignment points at has
 * moved, or that a figure stopped resolving, until a student says so. The
 * crawler answering that is offered at both levels it makes sense at, because
 * they answer different questions:
 *
 * - On an **example**, which is where READMEs and meta.yaml actually live and
 *   are edited. A working copy is read straight from disk, so a link can be
 *   fixed before the example is ever uploaded — the only moment fixing it is
 *   cheap. Examples that are not checked out, and are not deployed anywhere,
 *   can be checked too.
 * - On a **course, unit or assignment**, which asks the other question: is what
 *   the students have right now still sound? That reads the deployed version,
 *   not whatever the lecturer happens to have on disk.
 *
 * Everything after "which files" is shared: one extractor, one prober, one
 * report.
 */

/** Where a link was found, in terms the lecturer can navigate by. */
interface LinkFinding {
  url: string;
  /** Example / assignment / course the link belongs to. */
  where: string;
  /** File or field inside it. */
  source: string;
  line?: number;
}

interface RelativeFinding extends LinkFinding {
  /** The path it resolved to inside the example. */
  resolved?: string;
}

/** Everything one run found, before probing. */
interface Collected {
  web: LinkFinding[];
  missing: RelativeFinding[];
  /** How many examples / contents were read, for the report's summary line. */
  itemCount: number;
}

export class LinkCheckCommands {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly apiService: ComputorApiService,
    private readonly exampleTree?: LecturerExampleTreeProvider
  ) {}

  registerCommands(): void {
    const register = commandRegistrar(this.context);
    register('computor.lecturer.checkLinks', async (item: any) => {
      await this.checkCourseLinks(item);
    });
    register('computor.lecturer.checkExampleLinks', async (item: any) => {
      await this.checkExampleLinks(item);
    });
  }

  // --- entry points --------------------------------------------------------

  /** Course, unit or assignment: what the students currently have. */
  private async checkCourseLinks(item: any): Promise<void> {
    const content = item?.courseContent;
    const course: CourseList | undefined = item?.course;
    const courseId = content?.course_id ?? course?.id;
    if (!courseId) {
      notify.warning('Open "Check Links" from a course, a unit or an assignment in the tree.');
      return;
    }

    const all = await this.apiService.getCourseContents(String(courseId), true, true);

    let contents: CourseContentList[];
    let label: string;
    let courseForDescription: CourseList | undefined;

    if (content?.id) {
      const own = all.find((entry) => entry.id === content.id);
      const prefix = `${content.path}.`;
      contents = [...(own ? [own] : []), ...all.filter((entry) => entry.path?.startsWith(prefix))];
      label = String(content.title || content.path);
    } else {
      contents = all;
      label = String(course?.title || course?.path || 'course');
      courseForDescription = course;
    }

    if (contents.length === 0 && !courseForDescription) {
      notify.info(`Nothing to check under “${label}”.`);
      return;
    }

    await this.run(label, (report, cancelled) =>
      this.collectFromCourse(contents, courseForDescription, report, cancelled)
    );
  }

  /**
   * An example row, or the [Examples] row for everything the filters show.
   *
   * The filtered form matches the other bulk actions on that row, so "according
   * to the filter settings" means the same thing everywhere (issues #339–#341).
   */
  private async checkExampleLinks(item: any): Promise<void> {
    const single: MergedExample | undefined = item?.merged;

    let examples: MergedExample[];
    let label: string;

    if (single) {
      examples = [single];
      label = single.title || single.identifier;
    } else if (this.exampleTree) {
      examples = await this.exampleTree.getFilteredMergedExamples();
      const filters = this.exampleTree.describeActiveFilters();
      label = filters.length > 0 ? `examples (${filters.join(', ')})` : 'all examples';
      if (examples.length === 0) {
        notify.info('No examples match the current filters.');
        return;
      }
    } else {
      notify.warning('Open "Check Links" from an example in the Examples view.');
      return;
    }

    await this.run(label, (report, cancelled) =>
      this.collectFromExamples(examples, report, cancelled)
    );
  }

  // --- the shared run ------------------------------------------------------

  /** Collect, probe, report — the part neither level does differently. */
  private async run(
    label: string,
    collect: (
      report: (message: string) => void,
      cancelled: () => boolean
    ) => Promise<Collected>
  ): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Checking links in ${label}…`,
        cancellable: true
      },
      async (progress, token) => {
        progress.report({ message: 'collecting links…' });
        const collected = await collect(
          (message) => progress.report({ message }),
          () => token.isCancellationRequested
        );

        if (token.isCancellationRequested) {
          notify.info('Link check cancelled.');
          return;
        }

        const urls = Array.from(new Set(collected.web.map((finding) => finding.url)));
        if (urls.length === 0 && collected.missing.length === 0) {
          notify.info(`No links found in ${label}.`);
          return;
        }

        const results = await probeAll(urls, {
          onProgress: (done, total) =>
            progress.report({ message: `checking link ${done} of ${total}…` }),
          isCancelled: () => token.isCancellationRequested
        });

        if (token.isCancellationRequested) {
          notify.info('Link check cancelled.');
          return;
        }

        const reportPath = this.writeReport(label, collected, results);
        await this.showReport(reportPath);

        const broken = countStatus(collected.web, results, 'broken') + collected.missing.length;
        const blocked = countStatus(collected.web, results, 'blocked');
        notify.info(
          broken === 0 && blocked === 0
            ? `All ${urls.length} links in ${label} are reachable.`
            : `${broken} problem(s), ${blocked} not checkable — see the report.`
        );
      }
    );
  }

  // --- collecting ----------------------------------------------------------

  /** Links of the examples themselves — working copy first, server otherwise. */
  private async collectFromExamples(
    examples: MergedExample[],
    report: (message: string) => void,
    cancelled: () => boolean
  ): Promise<Collected> {
    const web: LinkFinding[] = [];
    const missing: RelativeFinding[] = [];
    let itemCount = 0;

    for (const [index, example] of examples.entries()) {
      if (cancelled()) {
        break;
      }
      const where = example.title || example.identifier;
      report(`reading ${index + 1} of ${examples.length}: ${where}…`);

      const bundle = await this.bundleForExample(example);
      if (!bundle) {
        continue;
      }
      itemCount += 1;
      collectFromBundle(bundle, where, web, missing);
    }

    return { web, missing, itemCount };
  }

  /**
   * The files of one example.
   *
   * A checked-out working copy wins over the server: it is what the lecturer is
   * looking at, and checking anything else would answer a question they did not
   * ask. A local-only example has nothing else to read anyway.
   */
  private async bundleForExample(example: MergedExample): Promise<ExampleBundle | undefined> {
    const workingPath = example.local?.workingVersion?.fullPath ?? example.local?.fullPath;
    if (workingPath && fs.existsSync(workingPath)) {
      return bundleFromDirectory(workingPath);
    }

    const exampleId = example.remote?.id;
    if (!exampleId) {
      return undefined;
    }
    const download = await this.apiService.downloadExample(String(exampleId));
    return download ? bundleFromFiles(download.files, download.meta) : undefined;
  }

  /** Links of what a course currently hands out. */
  private async collectFromCourse(
    contents: CourseContentList[],
    course: CourseList | undefined,
    report: (message: string) => void,
    cancelled: () => boolean
  ): Promise<Collected> {
    const web: LinkFinding[] = [];
    const missing: RelativeFinding[] = [];
    let itemCount = 0;

    if (course) {
      const description = (course as any).description;
      if (typeof description === 'string') {
        addWebLinks(extractLinks(description, 'description'), 'Course', web);
      }
    }

    for (const [index, content] of contents.entries()) {
      if (cancelled()) {
        break;
      }
      const where = content.title || content.path || 'content';
      report(`reading ${index + 1} of ${contents.length}: ${where}…`);
      itemCount += 1;

      const description = (content as any).description;
      if (typeof description === 'string') {
        addWebLinks(extractLinks(description, 'description'), where, web);
      }

      const versionId = getExampleVersionId(content as any);
      if (!versionId) {
        continue;
      }
      const download = await this.apiService.downloadExampleVersion(String(versionId));
      if (!download) {
        continue;
      }
      collectFromBundle(bundleFromFiles(download.files, download.meta), where, web, missing);
    }

    return { web, missing, itemCount };
  }

  // --- reporting -----------------------------------------------------------

  /** The report as markdown, written where the lecturer can keep it. */
  private writeReport(
    label: string,
    collected: Collected,
    results: Map<string, ProbeResult>
  ): string {
    const byUrl = new Map<string, LinkFinding[]>();
    for (const finding of collected.web) {
      const list = byUrl.get(finding.url) ?? [];
      list.push(finding);
      byUrl.set(finding.url, list);
    }

    const of = (status: string) =>
      Array.from(byUrl.entries())
        .filter(([url]) => results.get(url)?.status === status)
        .sort(([a], [b]) => a.localeCompare(b));

    const broken = of('broken');
    const blocked = of('blocked');
    const okCount = of('ok').length;

    const lines: string[] = [];
    lines.push(`# Link check — ${label}`);
    lines.push('');
    lines.push(`Checked ${new Date().toLocaleString()}.`);
    lines.push('');
    lines.push(
      `${byUrl.size} distinct link(s) in ${collected.itemCount} item(s): ` +
      `**${broken.length} unreachable**, **${blocked.length} not checkable**, ${okCount} fine.` +
      (collected.missing.length > 0
        ? ` **${collected.missing.length} missing file reference(s)**.`
        : '')
    );
    lines.push('');

    const section = (title: string, note: string, entries: Array<[string, LinkFinding[]]>) => {
      lines.push(`## ${title}`);
      lines.push('');
      if (entries.length === 0) {
        lines.push('_None._');
        lines.push('');
        return;
      }
      lines.push(note);
      lines.push('');
      for (const [url, occurrences] of entries) {
        lines.push(`### ${url}`);
        lines.push('');
        lines.push(`${results.get(url)?.reason ?? 'unknown'}`);
        lines.push('');
        for (const occurrence of occurrences) {
          const at = occurrence.line !== undefined ? `:${occurrence.line}` : '';
          lines.push(`- ${occurrence.where} — \`${occurrence.source}${at}\``);
        }
        lines.push('');
      }
    };

    section('Unreachable', 'These did not answer, or answered that they are gone.', broken);
    section(
      'Did not let us check',
      'These refused an automated request (403, 429 and friends). They usually ' +
      'work fine in a browser — worth one manual look, not a fix.',
      blocked
    );

    lines.push('## Missing files inside the example');
    lines.push('');
    if (collected.missing.length === 0) {
      lines.push('_None._');
      lines.push('');
    } else {
      lines.push(
        'These point at a file the example does not contain. Watch the spelling ' +
        'and the capitalisation — `mediaFiles` and `MediaFiles` are two different ' +
        'folders to a server.'
      );
      lines.push('');
      for (const entry of collected.missing) {
        const at = entry.line !== undefined ? `:${entry.line}` : '';
        lines.push(
          `- \`${entry.url}\` — ${entry.where}, \`${entry.source}${at}\`` +
          (entry.resolved ? ` (looked for \`${entry.resolved}\`)` : '')
        );
      }
      lines.push('');
    }

    const directories = WorkspaceStructureManager.getInstance().getDirectories();
    fs.mkdirSync(directories.reports, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = label
      .replace(/[“”"]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'examples';
    const reportPath = path.join(directories.reports, `link-check-${slug}-${stamp}.md`);
    fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
    return reportPath;
  }

  /** The report as a document to work from, and rendered beside it. */
  private async showReport(reportPath: string): Promise<void> {
    await openFile(reportPath);
    try {
      await showMarkdownPreview(this.context, reportPath, { title: 'Link check' });
    } catch (error) {
      console.warn('Could not preview the link report:', error);
    }
  }
}

/** Keep the web links out of a batch of occurrences. */
function addWebLinks(
  occurrences: LinkOccurrence[],
  where: string,
  into: LinkFinding[]
): void {
  for (const occurrence of occurrences) {
    if (classifyLink(occurrence.url) === 'web') {
      into.push({
        url: occurrence.url,
        where,
        source: occurrence.source,
        ...(occurrence.line !== undefined ? { line: occurrence.line } : {})
      });
    }
  }
}

/**
 * Every link of one example: the meta.yaml fields, every readable file, and the
 * relative links checked against the example's own file list.
 *
 * That last part needs no network and is what catches the classic
 * mediaFiles/MediaFiles slip — probing would never have found it.
 */
export function collectFromBundle(
  bundle: ExampleBundle,
  where: string,
  web: LinkFinding[],
  missing: RelativeFinding[]
): void {
  addWebLinks(extractMetaLinks(bundle.meta, 'meta.yaml'), where, web);

  for (const [name, text] of bundle.texts) {
    // meta.yaml's own link fields are read from the parsed document above;
    // reading the raw text too would report each of them twice.
    if (name === 'meta.yaml' || name === 'meta.yml') {
      continue;
    }

    const occurrences = extractLinks(text, name);
    addWebLinks(occurrences, where, web);

    for (const occurrence of occurrences) {
      if (classifyLink(occurrence.url) !== 'relative') {
        continue;
      }
      const resolved = resolveRelativeLink(occurrence.url, name);
      if (resolved !== undefined && bundle.fileNames.has(resolved)) {
        continue;
      }
      missing.push({
        url: occurrence.url,
        where,
        source: occurrence.source,
        ...(occurrence.line !== undefined ? { line: occurrence.line } : {}),
        ...(resolved !== undefined ? { resolved } : {})
      });
    }
  }
}

function countStatus(
  findings: LinkFinding[],
  results: Map<string, ProbeResult>,
  status: string
): number {
  const urls = new Set(findings.map((finding) => finding.url));
  let count = 0;
  for (const url of urls) {
    if (results.get(url)?.status === status) {
      count += 1;
    }
  }
  return count;
}
