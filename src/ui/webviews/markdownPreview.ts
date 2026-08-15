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
}

let previewPanel: vscode.WebviewPanel | undefined;
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
  const dir = path.dirname(filePath);
  const markdown = fs.readFileSync(filePath, 'utf8');
  const title = options.title ?? path.basename(filePath);
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
      column,
      webviewOptions
    );
    previewPanel.onDidDispose(() => {
      previewPanel = undefined;
      previewDir = undefined;
      previewContext = undefined;
    });
    // Registered once for the panel's lifetime; every render retargets it via
    // previewDir. A link between two documents (the help pages point at each
    // other) is otherwise a dead click: the webview resolves it against its own
    // vscode-webview: origin and VS Code drops the navigation
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
      await showMarkdownPreview(previewContext, target);
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
    scriptFiles: ['vendor/marked.min.js', 'vendor/katex.min.js', 'shared/markdown.js'],
    initialState: { markdown, baseUri },
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
            img.setAttribute('src', base + '/' + clean);
          }
        });
      } catch (e) {
        el.textContent = state.markdown || '';
      }

      el.addEventListener('click', function (event) {
        const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
        if (!anchor) return;
        const href = anchor.getAttribute('href') || '';
        if (!href) return;

        // Table-of-contents links: the webview has no navigable location, so
        // scroll to the heading ourselves.
        if (href.charAt(0) === '#') {
          event.preventDefault();
          let id = href.slice(1);
          try { id = decodeURIComponent(id); } catch (e) { /* keep the raw id */ }
          const heading = document.getElementById(id);
          if (heading && heading.scrollIntoView) heading.scrollIntoView({ block: 'start' });
          return;
        }

        // Leave real URLs to the host — it opens them in the browser.
        const lower = href.toLowerCase();
        const external = lower.indexOf('http:') === 0 || lower.indexOf('https:') === 0
          || lower.indexOf('mailto:') === 0 || lower.indexOf('command:') === 0
          || lower.indexOf('data:') === 0 || href.indexOf('//') === 0 || href.indexOf('vscode-') === 0;
        if (external) return;

        event.preventDefault();
        vscode.postMessage({ command: 'openRelativeDocument', href: href });
      });
    `
  });
}
