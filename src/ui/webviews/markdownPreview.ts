import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AUX_COLUMN, ensureAuxColumn } from '../editorLayout';
import { renderWebviewPage } from './shared/webviewPage';

export interface MarkdownPreviewOptions {
  /** Panel/tab title; defaults to the file's basename. */
  title?: string;
  /** Defaults to the auxiliary group, alongside the figures. */
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

let previewPanel: vscode.WebviewPanel | undefined;
let renderRequest = 0;

/** Bring an open preview back to the front of its group, without taking focus. */
export function revealMarkdownPreview(): void {
  previewPanel?.reveal(undefined, true);
}

/** A later preview supersedes this request, including while its ZIP is loading. */
export function beginMarkdownPreviewRequest(): MarkdownPreviewRequest {
  const request = ++renderRequest;
  return { isCurrent: () => request === renderRequest };
}
/**
 * Directory of the document currently in the panel, and the context to reopen
 * with. Links resolve against these: the panel is a singleton whose message
 * handler is registered once, so the handler reads the current document from
 * here instead of closing over whichever file happened to create the panel.
 */
let previewDir: string | undefined;
let previewContext: vscode.ExtensionContext | undefined;

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
 * One singleton panel is shared by every caller (READMEs, help pages,
 * tutor previews) and retargeted per file. Throws if the file can't be
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
    options
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
  options: MarkdownPreviewOptions
): Promise<void> {
  if (options.isCurrent && !options.isCurrent()) return;
  const request = options.request ?? beginMarkdownPreviewRequest();
  const isCurrent = () => request.isCurrent() && (options.isCurrent?.() ?? true);
  if (!isCurrent()) return;
  // A README belongs beside the code, never on top of it. The old
  // "Beside when an editor is active, One otherwise" put the preview in the
  // *source* group whenever focus happened to be on a webview — which is
  // always true when the student is looking at a figure
  // (computor-org/issues#286).
  const column = options.viewColumn ?? AUX_COLUMN;

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
    localResourceRoots: [vscode.Uri.file(dir), context.extensionUri]
  };

  previewDir = dir;
  previewContext = context;

  if (!previewPanel) {
    previewPanel = vscode.window.createWebviewPanel(
      'computor.markdownPreview',
      title,
      options.preserveFocus ? { viewColumn: column, preserveFocus: true } : column,
      webviewOptions
    );
    previewPanel.onDidDispose(() => {
      previewPanel = undefined;
      previewDir = undefined;
      previewContext = undefined;
    });
    // Registered once for the panel's lifetime; every render retargets it via
    // previewDir. A link between two documents (the help pages point at each
    // other) would otherwise resolve against the webview's own origin: a dead
    // click on the desktop, a "Not found" browser tab on code-server
    // (computor-org/issues#325).
    previewPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.command !== 'openRelativeDocument' || typeof message.href !== 'string') {
        return;
      }
      if (!previewDir || !previewContext) {
        return;
      }
      const target = resolveMarkdownLink(
        message.href,
        previewDir,
        previewContext.extensionUri.fsPath
      );
      if (!target) {
        void vscode.window.showWarningMessage(`Cannot open '${message.href}' — no such document.`);
        return;
      }
      const hash = message.href.indexOf('#');
      await showMarkdownPreview(previewContext, target, {
        fragment: hash >= 0 ? message.href.slice(hash + 1) : undefined
      });
    });
  } else {
    previewPanel.webview.options = webviewOptions;
    // preserveFocus: re-showing a README must not pull the cursor out of the
    // editor the student is typing in.
    previewPanel.reveal(column, true);
  }

  const panel = previewPanel;
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
