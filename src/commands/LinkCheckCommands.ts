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
import { getExampleVersionId } from '../utils/deploymentHelpers';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
import type { CourseContentList, CourseList } from '../types/generated/courses';

/**
 * "Check Links" for a course, a unit or a single assignment
 * (computor-org/issues#362).
 *
 * A lecturer has no way of noticing that the paper an assignment points at has
 * moved, or that a picture stopped resolving — until a student says so. This
 * walks the courseware the students actually receive and says which links no
 * longer lead anywhere.
 *
 * The content comes from the API, not from a checked-out working copy: what is
 * checked has to be what was *deployed*, and a lecturer should not have to
 * check out forty examples to find out. Each distinct address is probed once,
 * however many assignments quote it.
 */

/** Where a link was found, in terms the lecturer can navigate by. */
interface LinkFinding {
  url: string;
  /** Assignment / unit / course the link belongs to. */
  where: string;
  /** File or field inside it. */
  source: string;
  line?: number;
}

interface RelativeFinding extends LinkFinding {
  /** The path it resolved to inside the example. */
  resolved?: string;
}

interface CheckScope {
  courseId: string;
  label: string;
  contents: CourseContentList[];
  /** Whole-course checks also cover the course's own description. */
  course?: CourseList;
}

/** Files worth reading for links. Anything binary is skipped. */
const TEXT_FILE = /\.(md|markdown|txt|ya?ml|json|html?|tex|rst|csv|py|m|jl|r)$/i;

export class LinkCheckCommands {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly apiService: ComputorApiService
  ) {}

  registerCommands(): void {
    const register = commandRegistrar(this.context);
    register('computor.lecturer.checkLinks', async (item: any) => {
      await this.checkLinks(item);
    });
  }

  private async checkLinks(item: any): Promise<void> {
    const scope = await this.resolveScope(item);
    if (!scope) {
      notify.warning('Open "Check Links" from a course, a unit or an assignment in the tree.');
      return;
    }

    if (scope.contents.length === 0 && !scope.course) {
      notify.info(`Nothing to check under “${scope.label}”.`);
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Checking links in ${scope.label}…`,
        cancellable: true
      },
      async (progress, token) => {
        const web: LinkFinding[] = [];
        const missingFiles: RelativeFinding[] = [];

        progress.report({ message: 'collecting links…' });
        const collected = await this.collect(scope, missingFiles, (message) =>
          progress.report({ message })
        );
        web.push(...collected);

        if (token.isCancellationRequested) {
          return;
        }

        const urls = Array.from(new Set(web.map((finding) => finding.url)));
        if (urls.length === 0 && missingFiles.length === 0) {
          notify.info(`No links found in ${scope.label}.`);
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

        const reportPath = this.writeReport(scope, web, results, missingFiles);
        await this.showReport(reportPath);

        const broken = countStatus(web, results, 'broken') + missingFiles.length;
        const blocked = countStatus(web, results, 'blocked');
        notify.info(
          broken === 0 && blocked === 0
            ? `All ${urls.length} links in ${scope.label} are reachable.`
            : `${broken} problem(s), ${blocked} not checkable — see the report.`
        );
      }
    );
  }

  /**
   * What a tree item asks to be checked.
   *
   * A unit means the unit and everything under it, because that is what "check
   * this chapter" means to the person clicking it.
   */
  private async resolveScope(item: any): Promise<CheckScope | undefined> {
    const content = item?.courseContent;
    const course: CourseList | undefined = item?.course;
    const courseId = content?.course_id ?? course?.id;
    if (!courseId) {
      return undefined;
    }

    const all = await this.apiService.getCourseContents(String(courseId), true, true);

    if (content?.id) {
      const own = all.find((entry) => entry.id === content.id);
      const prefix = `${content.path}.`;
      const descendants = all.filter((entry) => entry.path?.startsWith(prefix));
      return {
        courseId: String(courseId),
        label: `“${content.title || content.path}”`,
        contents: [...(own ? [own] : []), ...descendants]
      };
    }

    // The course row, or its Contents folder.
    return {
      courseId: String(courseId),
      label: `“${course?.title || course?.path || 'course'}”`,
      contents: all,
      ...(course ? { course } : {})
    };
  }

  /** Every link in the scope, with the relative ones resolved on the way. */
  private async collect(
    scope: CheckScope,
    missingFiles: RelativeFinding[],
    report: (message: string) => void
  ): Promise<LinkFinding[]> {
    const findings: LinkFinding[] = [];

    const addOccurrences = (occurrences: LinkOccurrence[], where: string) => {
      for (const occurrence of occurrences) {
        if (classifyLink(occurrence.url) === 'web') {
          findings.push({
            url: occurrence.url,
            where,
            source: occurrence.source,
            ...(occurrence.line !== undefined ? { line: occurrence.line } : {})
          });
        }
      }
    };

    if (scope.course) {
      const description = (scope.course as any).description;
      if (typeof description === 'string') {
        addOccurrences(extractLinks(description, 'description'), 'Course');
      }
    }

    let index = 0;
    for (const content of scope.contents) {
      index += 1;
      const where = content.title || content.path || 'content';
      report(`reading ${index} of ${scope.contents.length}: ${where}…`);

      const description = (content as any).description;
      if (typeof description === 'string') {
        addOccurrences(extractLinks(description, 'description'), where);
      }

      const versionId = getExampleVersionId(content as any);
      if (!versionId) {
        continue;
      }

      const download = await this.apiService.downloadExampleVersion(String(versionId));
      if (!download) {
        continue;
      }

      const files = download.files ?? {};
      const fileNames = new Set(Object.keys(files));

      addOccurrences(extractMetaLinks(download.meta, 'meta.yaml'), where);

      for (const [name, raw] of Object.entries(files)) {
        if (!TEXT_FILE.test(name) || typeof raw !== 'string') {
          continue;
        }
        // meta.yaml's links are read from the parsed document above; reading the
        // raw text too would report each of them twice.
        if (name === 'meta.yaml') {
          continue;
        }

        const occurrences = extractLinks(raw, name);
        addOccurrences(occurrences, where);

        // A relative link is checked against the example's own files — this is
        // where the classic mediaFiles/MediaFiles slip shows up, and no amount
        // of network probing would ever have found it.
        for (const occurrence of occurrences) {
          if (classifyLink(occurrence.url) !== 'relative') {
            continue;
          }
          const resolved = resolveRelativeLink(occurrence.url, name);
          if (resolved !== undefined && fileNames.has(resolved)) {
            continue;
          }
          missingFiles.push({
            url: occurrence.url,
            where,
            source: occurrence.source,
            ...(occurrence.line !== undefined ? { line: occurrence.line } : {}),
            ...(resolved !== undefined ? { resolved } : {})
          });
        }
      }
    }

    return findings;
  }

  /** The report as markdown, written where the lecturer can keep it. */
  private writeReport(
    scope: CheckScope,
    findings: LinkFinding[],
    results: Map<string, ProbeResult>,
    missingFiles: RelativeFinding[]
  ): string {
    const byUrl = new Map<string, LinkFinding[]>();
    for (const finding of findings) {
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
    lines.push(`# Link check — ${scope.label.replace(/^“|”$/g, '')}`);
    lines.push('');
    lines.push(`Checked ${new Date().toLocaleString()}.`);
    lines.push('');
    lines.push(
      `${byUrl.size} distinct link(s) in ${scope.contents.length} item(s): ` +
      `**${broken.length} unreachable**, **${blocked.length} not checkable**, ${okCount} fine.` +
      (missingFiles.length > 0 ? ` **${missingFiles.length} missing file reference(s)**.` : '')
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
        const result = results.get(url);
        lines.push(`### ${url}`);
        lines.push('');
        lines.push(`${result?.reason ?? 'unknown'}`);
        lines.push('');
        for (const occurrence of occurrences) {
          const at = occurrence.line !== undefined ? `:${occurrence.line}` : '';
          lines.push(`- ${occurrence.where} — \`${occurrence.source}${at}\``);
        }
        lines.push('');
      }
    };

    section(
      'Unreachable',
      'These did not answer, or answered that they are gone.',
      broken
    );
    section(
      'Did not let us check',
      'These refused an automated request (403, 429 and friends). They usually ' +
      'work fine in a browser — worth one manual look, not a fix.',
      blocked
    );

    lines.push('## Missing files inside the example');
    lines.push('');
    if (missingFiles.length === 0) {
      lines.push('_None._');
      lines.push('');
    } else {
      lines.push(
        'These point at a file the example does not contain. Watch the spelling ' +
        'and the capitalisation — `mediaFiles` and `MediaFiles` are two different ' +
        'folders to a server.'
      );
      lines.push('');
      for (const missing of missingFiles) {
        const at = missing.line !== undefined ? `:${missing.line}` : '';
        lines.push(
          `- \`${missing.url}\` — ${missing.where}, \`${missing.source}${at}\`` +
          (missing.resolved ? ` (looked for \`${missing.resolved}\`)` : '')
        );
      }
      lines.push('');
    }

    const directories = WorkspaceStructureManager.getInstance().getDirectories();
    fs.mkdirSync(directories.reports, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = scope.label
      .replace(/[“”"]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'course';
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
