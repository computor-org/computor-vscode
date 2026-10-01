import * as fs from 'fs';
import * as vscode from 'vscode';
import { escapeHtml } from './webviewHelpers';

/**
 * The single message envelope used between extension host and webviews,
 * in both directions.
 */
export interface WebviewMessage<T = any> {
  command: string;
  data?: T;
}

export interface WebviewPageOptions {
  title: string;
  /** Main page markup. Placed inside <body> (and .container when set). */
  bodyHtml: string;
  /** Optional markup wrapped in a <div class="header"> above the body. */
  headerHtml?: string;
  /** Stylesheets under webview-ui/, loaded after base.css (e.g. 'admin/settings-view.css'). */
  cssFiles?: string[];
  /** Scripts under webview-ui/, loaded after base.js (e.g. 'admin/settings-view.js'). */
  scriptFiles?: string[];
  /** Inline script, executed after all external scripts. `vscode` is in scope. */
  inlineScript?: string;
  /** Serialized to window.__INITIAL_STATE__ before any script runs. */
  initialState?: unknown;
  /** Escape hatch for small view-specific styles; prefer cssFiles. */
  inlineStyles?: string;
  /** Wrap the body in a centered .container (max-width 1200px). */
  container?: boolean;
  /**
   * Extra CSP sources for content this page embeds in a frame or an object —
   * a PDF or an HTML document handed to the browser's own renderer. Default is
   * `default-src 'none'`, which blocks both outright, so a viewer that builds a
   * `blob:` URL passes `['blob:']` here. Keep it to what the page actually
   * needs: this is the one directive that lets foreign markup render.
   */
  embedSrc?: string[];
  /**
   * Sources workers may be created from (`worker-src`). The PDF viewer runs
   * pdf.js's real worker from a blob: URL built in the page (#361); without
   * the directive, worker-src falls back to script-src and refuses it.
   */
  workerSrc?: string[];
}

export function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Renders the canonical HTML document for a webview. Every webview —
 * editor panel or sidebar view — goes through here so CSP, nonce handling,
 * the design system (base.css) and the client runtime (base.js) are
 * identical everywhere.
 */
export function renderWebviewPage(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  options: WebviewPageOptions
): string {
  const nonce = getNonce();
  const assetUri = (file: string): vscode.Uri =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview-ui', ...file.split('/')));

  // Inline CSS/JS directly into the document instead of linking them via
  // asWebviewUri. In code-server (VS Code in the browser) those URIs are served
  // through a service worker, which Firefox blocks under its stricter
  // cross-origin/service-worker rules — so every stylesheet and script silently
  // failed to load and the page rendered blank (issue #267). Inlining removes
  // the fetch entirely and is allowed by the CSP ('unsafe-inline' styles,
  // nonce'd scripts). If a file can't be read we fall back to the linked form.
  const readAsset = (file: string): string | undefined => {
    try {
      return fs.readFileSync(
        vscode.Uri.joinPath(extensionUri, 'webview-ui', ...file.split('/')).fsPath,
        'utf8'
      );
    } catch {
      return undefined;
    }
  };

  const cssLinks = ['shared/base.css', ...(options.cssFiles ?? [])]
    .map((file) => {
      const css = readAsset(file);
      return css !== undefined
        ? `<style>\n${css}\n</style>`
        : `<link rel="stylesheet" href="${assetUri(file)}">`;
    })
    .join('\n  ');

  const scriptTags = ['shared/base.js', ...(options.scriptFiles ?? [])]
    .map((file) => {
      const js = readAsset(file);
      // Break any literal </script in the source so it can't terminate the
      // inline <script> element early; <\/script parses identically in JS.
      return js !== undefined
        ? `<script nonce="${nonce}">\n${js.replace(/<\/(script)/gi, '<\\/$1')}\n</script>`
        : `<script nonce="${nonce}" src="${assetUri(file)}"></script>`;
    })
    .join('\n  ');

  const initialStateScript =
    options.initialState !== undefined
      ? `<script nonce="${nonce}">window.__INITIAL_STATE__ = ${JSON.stringify(options.initialState).replace(/</g, '\\u003c')};</script>`
      : '';

  const inlineScript = options.inlineScript
    ? `<script nonce="${nonce}">
  const vscode = window.vscodeApi || acquireVsCodeApi();
  window.vscodeApi = vscode;
  ${options.inlineScript.replace(/{{NONCE}}/g, nonce)}
</script>`
    : '';

  const embedDirectives = (options.embedSrc?.length
    ? ` frame-src ${options.embedSrc.join(' ')}; object-src ${options.embedSrc.join(' ')};`
    : '') + (options.workerSrc?.length
    ? ` worker-src ${options.workerSrc.join(' ')};`
    : '');

  const headerHtml = options.headerHtml ? `<div class="header">${options.headerHtml}</div>` : '';
  const bodyHtml = options.bodyHtml.replace(/{{NONCE}}/g, nonce);
  const content = `${headerHtml}\n  ${bodyHtml}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource} data:;${embedDirectives}">
  <title>${escapeHtml(options.title)}</title>
  ${cssLinks}
  ${options.inlineStyles ? `<style>${options.inlineStyles}</style>` : ''}
</head>
<body>
  ${options.container ? `<div class="container">${content}</div>` : content}
  ${initialStateScript}
  ${scriptTags}
  ${inlineScript}
</body>
</html>`;
}
