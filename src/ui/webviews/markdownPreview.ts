import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { renderWebviewPage } from './shared/webviewPage';

export interface MarkdownPreviewOptions {
  /** Panel/tab title; defaults to the file's basename. */
  title?: string;
  /** Defaults to Beside when an editor is active, One otherwise. */
  viewColumn?: vscode.ViewColumn;
}

let previewPanel: vscode.WebviewPanel | undefined;

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
  const column =
    options.viewColumn ??
    (vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One);

  // The resource roots must follow the previewed file: a reused panel would
  // otherwise keep the first file's roots and images from any other
  // directory would stop loading. The extension dir stays included for
  // extension-bundled documents (help pages, getting started).
  const webviewOptions: vscode.WebviewOptions = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(dir), context.extensionUri]
  };

  if (!previewPanel) {
    previewPanel = vscode.window.createWebviewPanel(
      'computor.markdownPreview',
      title,
      column,
      webviewOptions
    );
    previewPanel.onDidDispose(() => {
      previewPanel = undefined;
    });
  } else {
    previewPanel.webview.options = webviewOptions;
    previewPanel.reveal(column);
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
    `
  });
}
