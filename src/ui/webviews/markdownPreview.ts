import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AUX_COLUMN, LEARNER_READING_COLUMN, ensureAuxColumn, updateLearnerReadingWidth, trackLearnerReadingPanel, setStudentNavigationInvalidator } from '../editorLayout';
import { renderWebviewPage } from './shared/webviewPage';

export interface MarkdownPreviewOptions {
  /** Learner instructions use the left editor group on desktop and mobile. */
  studentReading?: boolean;
  /** Stable separate tab for the authored course Welcome. */
  welcomeContentId?: string;
  /** Panel/tab title; defaults to the file's basename. */
  title?: string;
  /** Explicit placement wins over the default learner reading group. */
  viewColumn?: vscode.ViewColumn;
  /** Static images delivered with a server-backed description archive. */
  inlineImages?: Record<string, string>;
  /** Keep keyboard navigation in the tree when previewing its selection. */
  preserveFocus?: boolean;
  /** Ignore an automatic preview if its selection changed while creating the layout. */
  isCurrent?: () => boolean;
  /** Reserve priority before loading a description asynchronously. */
  request?: MarkdownPreviewRequest;
  /** Heading to scroll to once rendered (the `#part` of a link that led here). */
  fragment?: string;
}

export interface MarkdownPreviewRequest {
  readonly isCurrent: () => boolean;
}

interface PreviewState {
  studentReading?: boolean;
  generation?: number;
  panel?: vscode.WebviewPanel;
  identity?: string;
  dir?: string;
  context?: vscode.ExtensionContext;
}
const previews = new Map<string, PreviewState>();
let renderRequest = 0;
let currentStudentPreview: PreviewState | undefined;

/** Bring the current task reading tab back without taking focus. */
export function revealMarkdownPreview(preserveFocus = true): void {
  previews.get('current')?.panel?.reveal(undefined, preserveFocus);
}

/** Reserve priority before any asynchronous description work. */
export function beginMarkdownPreviewRequest(): MarkdownPreviewRequest {
  const request = ++renderRequest;
  return { isCurrent: () => request === renderRequest };
}

/**
 * Resolve a link written inside a markdown document to a file worth opening,
 * or undefined.
 *
 * Only sibling markdown is followed, and only within the directory the
 * document came from or the extension's own files — the bundled help pages
 * link to each other, and an assignment README links inside its own folder. A
 * document is not a reason to hand out arbitrary files, so `../../../` walks
 * out of that tree resolve to nothing.
 */
export function resolveMarkdownLink(
  href: string,
  fromDir: string,
  extensionPath: string
): string | undefined {
  const withoutFragment = (href.split('#')[0] ?? '').split('?')[0] ?? '';
  if (!withoutFragment || !withoutFragment.toLowerCase().endsWith('.md')) {
    return undefined;
  }

  const target = path.resolve(fromDir, withoutFragment);
  const contained = [fromDir, extensionPath].some((root) => {
    const relative = path.relative(root, target);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (!contained) {
    return undefined;
  }

  return fs.existsSync(target) ? target : undefined;
}

/**
 * Renders a local markdown file in the shared self-contained preview webview
 * (marked + KaTeX, all assets inlined). Preferred over the built-in markdown
 * preview, whose service-worker-served assets leave the tab blank in
 * Firefox/Safari under code-server (issues #267/#274). Relative image paths
 * resolve against the file's directory via the webview resource origin
 * (text and math render even where the browser blocks those image loads).
 *
 * A current-reading panel is shared by READMEs/help/tutor previews; each
 * authored course Welcome retains its own tab. Throws if the file can't be
 * read — callers decide their own fallback.
 */
export async function showMarkdownPreview(
  context: vscode.ExtensionContext,
  filePath: string,
  options: MarkdownPreviewOptions = {}
): Promise<void> {
  await renderMarkdownPreview(
    context,
    fs.readFileSync(filePath, 'utf8'),
    path.dirname(filePath),
    options.title ?? path.basename(filePath),
    options,
    path.resolve(filePath) === path.join(context.extensionUri.fsPath, 'docs', 'help', 'student-course.md')
      ? ['computor.student.askCourseQuestion'] : undefined
  );
}

/**
 * Same preview, for markdown that never was a file — a course or unit
 * description lives in the database, not on disk (computor-org/issues#324).
 *
 * Relative image paths have nothing to resolve against here, so the base is
 * the extension itself; descriptions that need pictures should link to them
 * absolutely.
 */
export async function showMarkdownTextPreview(
  context: vscode.ExtensionContext,
  markdown: string,
  title: string,
  options: MarkdownPreviewOptions = {}
): Promise<void> {
  await renderMarkdownPreview(
    context,
    markdown,
    context.extensionUri.fsPath,
    options.title ?? title,
    options
  );
}

async function renderMarkdownPreview(
  context: vscode.ExtensionContext,
  markdown: string,
  dir: string,
  title: string,
  options: MarkdownPreviewOptions,
  enabledCommands?: string[]
): Promise<void> {
  if (options.isCurrent && !options.isCurrent()) return;
  const request = options.request ?? beginMarkdownPreviewRequest();
  const isCurrent = () => request.isCurrent() && (options.isCurrent?.() ?? true);
  if (!isCurrent()) return;
  const hostedReading = options.studentReading === true;
  const column = options.viewColumn ?? (hostedReading ? LEARNER_READING_COLUMN : AUX_COLUMN);
  const slot = options.welcomeContentId ? `welcome:${options.welcomeContentId}` : 'current';
  let state = previews.get(slot);
  if (!state) {
    state = {};
    previews.set(slot, state);
  }
  const preview = state;
  preview.studentReading = hostedReading && column === LEARNER_READING_COLUMN;
  preview.generation = (preview.generation ?? 0) + 1;
  if (preview.studentReading) currentStudentPreview = preview;
  // Opened before any source file, a webview panel's column request is
  // silently dropped when the only group is empty — force the second group
  // to exist first (computor-org/issues#286 follow-up).
  if (column === AUX_COLUMN) {
    await ensureAuxColumn();
  }
  if (!isCurrent()) return;

  // The resource roots must follow the previewed file: a reused panel would
  // otherwise keep the first file's roots and images from any other
  // directory would stop loading. The extension dir stays included for
  // extension-bundled documents (help pages, getting started).
  const webviewOptions: vscode.WebviewOptions = {
    enableScripts: true,
    enableCommandUris: enabledCommands ?? false,
    localResourceRoots: [vscode.Uri.file(dir), context.extensionUri]
  };

  const documentIdentity = JSON.stringify([dir, title, markdown]);
  const changedDocument = preview.identity !== undefined && preview.identity !== documentIdentity;
  preview.identity = documentIdentity;
  preview.dir = dir;
  preview.context = context;

  if (!preview.panel) {
    preview.panel = vscode.window.createWebviewPanel(
      'computor.markdownPreview',
      title,
      options.preserveFocus ? { viewColumn: column, preserveFocus: true } : column,
      webviewOptions
    );
    preview.panel.onDidDispose(() => {
      if (previews.get(slot) === preview) previews.delete(slot);
      if (currentStudentPreview === preview) currentStudentPreview = undefined;
      preview.panel = undefined;
      preview.dir = undefined;
      preview.context = undefined;
      preview.identity = undefined;
    });
    preview.panel.onDidChangeViewState(({ webviewPanel }) => {
      if (preview.studentReading && webviewPanel.visible && webviewPanel.active) currentStudentPreview = preview;
    });
    // Registered once for the panel's lifetime; every render retargets it via
    // preview.dir. A link between two documents (the help pages point at each
    // other) would otherwise resolve against the webview's own origin: a dead
    // click on the desktop, a "Not found" browser tab on code-server
    // (computor-org/issues#325).
    preview.panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.command === 'readingWidth' && preview.studentReading) {
        if (typeof message.width === 'number' && preview.panel?.visible && currentStudentPreview === preview
          && message.generation === preview.generation) {
          const owner = preview.panel;
          const generation = preview.generation;
          const request = renderRequest;
          const isOwnerCurrent = () => preview.panel === owner && currentStudentPreview === preview
            && preview.generation === generation && renderRequest === request;
          // Visibility admits the message above; selecting code can hide the owner while it waits.
          await updateLearnerReadingWidth(message.width, isOwnerCurrent);
        }
        return;
      }
      if (message?.command !== 'openRelativeDocument' || typeof message.href !== 'string') {
        return;
      }
      if (!preview.dir || !preview.context) {
        return;
      }
      const target = resolveMarkdownLink(
        message.href,
        preview.dir,
        preview.context.extensionUri.fsPath
      );
      if (!target) {
        void vscode.window.showWarningMessage(`Cannot open '${message.href}' — no such document.`);
        return;
      }
      const hash = message.href.indexOf('#');
      await showMarkdownPreview(preview.context, target, {
        studentReading: preview.studentReading,
        fragment: hash >= 0 ? message.href.slice(hash + 1) : undefined
      });
    });
  } else {
    preview.panel.webview.options = webviewOptions;
    // preserveFocus: re-showing a README must not pull the cursor out of the
    // editor the student is typing in.
    preview.panel.reveal(column, true);
  }

  const panel = preview.panel;
  if (preview.studentReading) trackLearnerReadingPanel(panel);
  panel.title = title;
  const baseUri = panel.webview.asWebviewUri(vscode.Uri.file(dir)).toString();
  panel.webview.html = renderWebviewPage(panel.webview, context.extensionUri, {
    title,
    bodyHtml: '<div class="markdown-body" id="content"></div>',
    cssFiles: ['vendor/katex-inline.css', 'shared/markdown-preview.css'],
    scriptFiles: [
      'vendor/marked.min.js',
      'vendor/katex.min.js',
      'shared/markdown.js',
      'shared/markdown-links.js'
    ],
    initialState: { markdown, baseUri, inlineImages: options.inlineImages, fragment: options.fragment },
    inlineScript: `
      ${hostedReading ? `
      // Native editor groups can be wider than their visible portion on mobile.
      // This sentinel belongs to this webview and keeps its intrinsic viewport width.
      const visibleWidth = document.createElement('div');
      visibleWidth.setAttribute('aria-hidden', 'true');
      visibleWidth.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:1px;pointer-events:none';
      document.body.appendChild(visibleWidth);
      document.body.style.boxSizing = 'border-box';
      document.body.classList.add('student-reading');
      const fitReading = new IntersectionObserver(entries => {
        const width = entries[0]?.intersectionRect.width;
        if (width > 0) {
          document.body.style.maxWidth = Math.floor(width) + 'px';
          vscode.postMessage({ command: 'readingWidth', width: Math.floor(width), generation: ${preview.generation} });
        }
      }, { threshold: Array.from({ length: 1001 }, (_, index) => index / 1000) });
      fitReading.observe(visibleWidth);
      // A fully visible resize keeps intersectionRatio at one, so request a
      // fresh intersection when the sentinel's intrinsic viewport width changes.
      const readingResize = new ResizeObserver(() => {
        fitReading.unobserve(visibleWidth);
        fitReading.observe(visibleWidth);
      });
      readingResize.observe(visibleWidth);
      window.addEventListener('pagehide', () => {
        readingResize.disconnect();
        fitReading.disconnect();
      }, { once: true });
      ` : ''}
      const state = window.__INITIAL_STATE__ || {};
      const el = document.getElementById('content');
      try {
        el.innerHTML = window.ComputorWebview.renderMarkdown(state.markdown || '');
        const base = (state.baseUri || '').replace(/\\/+$/, '');
        el.querySelectorAll('img[src]').forEach(function (img) {
          const src = img.getAttribute('src') || '';
          const lower = src.toLowerCase();
          const absolute = lower.indexOf('http:') === 0 || lower.indexOf('https:') === 0
            || lower.indexOf('data:') === 0 || src.indexOf('//') === 0 || src.indexOf('vscode-') === 0;
          if (!absolute) {
            let clean = src;
            if (clean.indexOf('./') === 0) clean = clean.slice(2);
            while (clean.indexOf('/') === 0) clean = clean.slice(1);
            const images = state.inlineImages || {};
            img.setAttribute('src', Object.prototype.hasOwnProperty.call(images, clean) ? images[clean] : base + '/' + clean);
          }
        });
      } catch (e) {
        el.textContent = state.markdown || '';
      }

      ${changedDocument && !options.fragment ? `
      // VS Code restores the preceding frame's scroll on HTML replacement.
      // A different reading document starts at its heading after that restoration;
      // revealing or restyling the same document keeps its reading position.
      window.addEventListener('load', function () {
        requestAnimationFrame(function () { window.scrollTo(0, 0); });
      }, { once: true });
      ` : ''}
      if (state.fragment) {
        window.ComputorWebview.scrollToFragment(document, state.fragment);
      }

      // Links to other documents open here, through the host; see
      // webview-ui/shared/markdown-links.js for why they must not reach
      // VS Code's own link handler (computor-org/issues#325).
      el.addEventListener('click', function (event) {
        window.ComputorWebview.handleMarkdownLinkClick(event, document, function (message) {
          vscode.postMessage(message);
        });
      });
    `
  });
}

// File-row navigation supersedes pending asynchronous assignment launches.
setStudentNavigationInvalidator(beginMarkdownPreviewRequest);
