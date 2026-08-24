import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { renderWebviewPage } from '../webviews/shared/webviewPage';
import { escapeHtml } from '../webviews/shared/webviewHelpers';

/**
 * Viewers for the two document kinds lecturers actually publish and could not
 * look at: PDF and HTML (computor-org/issues#361).
 *
 * Neither had a viewer. A PDF opened as a tab VS Code cannot render — before
 * the open went through `computor.openFile` it did not even get that far, it
 * failed outright with "File seems to be binary and cannot be opened as text".
 * HTML opened as source, which is right for editing it and useless for
 * checking what a student will see.
 *
 * Both render through the browser's own engine inside an iframe, reached by a
 * `blob:` URL built in the webview. The bytes travel inline like every other
 * Computor webview's assets do, because under code-server a `vscode-resource`
 * fetch goes through a service worker that Firefox and older Safari never
 * consult — the same reason ImagePreviewPanel inlines its image
 * (computor-org/issues#274, #282). A `data:` URL is not usable here either:
 * Chrome refuses to navigate a frame to one.
 *
 * The HTML frame is sandboxed with no `allow-scripts`, so a document renders
 * with its own markup and styling but cannot run anything. These files come
 * from the shared documents area, where anyone with write access to a scope
 * can put them, and a preview is not worth handing them script execution in a
 * context that holds the lecturer's session.
 *
 * Contributed at `priority: "option"`, like the image preview: desktop VS Code
 * keeps whatever it does today, and `editorAssociations.ts` points these at
 * their viewer only in the browser.
 */

/** Past this the inline hand-off costs more than the preview is worth. */
const MAX_INLINE_BYTES = 24 * 1024 * 1024;

/** A rewrite lands as several events; render once the file has settled. */
const RELOAD_DEBOUNCE_MS = 120;

type PreviewKind = 'pdf' | 'html';

interface PreviewState {
  name: string;
  kind: PreviewKind;
  mime: string;
  /** Base64 payload, or null when there is nothing to show. */
  base64: string | null;
  byteLength: number;
  /** Why there is no preview, for the webview to show instead of one. */
  error: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

async function readPreviewState(uri: vscode.Uri, kind: PreviewKind): Promise<PreviewState> {
  const name = path.basename(uri.fsPath);
  const mime = kind === 'pdf' ? 'application/pdf' : 'text/html';

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(uri.fsPath);
  } catch {
    return { name, kind, mime, base64: null, byteLength: 0, error: 'This file is no longer there.' };
  }

  if (stat.size > MAX_INLINE_BYTES) {
    return {
      name,
      kind,
      mime,
      base64: null,
      byteLength: stat.size,
      error:
        `This document is ${formatBytes(stat.size)}, too large to preview here. ` +
        'Download it to your computer to open it.'
    };
  }

  try {
    const bytes = await fs.promises.readFile(uri.fsPath);
    return { name, kind, mime, base64: bytes.toString('base64'), byteLength: bytes.byteLength, error: null };
  } catch {
    return { name, kind, mime, base64: null, byteLength: stat.size, error: 'This file could not be read.' };
  }
}

class DocumentPreviewProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly kind: PreviewKind
  ) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: (): void => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel
  ): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    const render = async (): Promise<void> => {
      panel.webview.html = await this.getHtmlContent(panel.webview, document.uri);
    };
    await render();

    // A document re-uploaded or pulled again overwrites the same path, so an
    // open preview has to follow the bytes rather than keep showing a stale
    // version with no hint that it is one.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
        path.basename(document.uri.fsPath)
      )
    );
    let pending: NodeJS.Timeout | undefined;
    const reload = (): void => {
      if (pending) { clearTimeout(pending); }
      pending = setTimeout(() => {
        pending = undefined;
        void render();
      }, RELOAD_DEBOUNCE_MS);
    };
    watcher.onDidChange(reload);
    watcher.onDidCreate(reload);
    watcher.onDidDelete(reload);

    const messages = panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message?.command === 'openExternally') {
        await vscode.commands.executeCommand('vscode.open', document.uri);
      }
    });

    panel.onDidDispose(() => {
      if (pending) { clearTimeout(pending); }
      watcher.dispose();
      messages.dispose();
    });
  }

  private async getHtmlContent(webview: vscode.Webview, uri: vscode.Uri): Promise<string> {
    const state = await readPreviewState(uri, this.kind);

    const body = state.error
      ? `
        <div class="notice warning">
          <p>${escapeHtml(state.error)}</p>
        </div>`
      : `
        <div id="frame-host" class="preview-host"></div>
        <p id="fallback" class="text-muted" hidden>
          This document could not be rendered here.
          <button id="external" class="btn btn-secondary">Open with another editor</button>
        </p>`;

    return renderWebviewPage(webview, this.extensionUri, {
      title: state.name,
      bodyHtml: body,
      // The frame's content is a blob built below; nothing else is embedded.
      embedSrc: state.error ? undefined : ['blob:'],
      inlineStyles: `
        html, body { height: 100%; margin: 0; padding: 0; }
        .preview-host { height: 100vh; width: 100%; }
        .preview-host iframe { border: 0; width: 100%; height: 100%; background: #fff; }
        .notice { padding: 1rem; }
      `,
      initialState: state.error ? null : { base64: state.base64, mime: state.mime, kind: state.kind },
      inlineScript: PREVIEW_SCRIPT
    });
  }
}

const PREVIEW_SCRIPT = `
  (function () {
    var state = window.__INITIAL_STATE__;
    if (!state) { return; }

    var external = document.getElementById('external');
    if (external) {
      external.addEventListener('click', function () {
        vscode.postMessage({ command: 'openExternally' });
      });
    }

    function fail() {
      var fallback = document.getElementById('fallback');
      if (fallback) { fallback.hidden = false; }
    }

    try {
      var binary = atob(state.base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
      var url = URL.createObjectURL(new Blob([bytes], { type: state.mime }));

      var frame = document.createElement('iframe');
      frame.src = url;
      // HTML documents come from the shared documents area, so they render
      // without scripts. A PDF is handed to the browser's own viewer, which
      // needs same-origin to run.
      if (state.kind === 'html') {
        frame.setAttribute('sandbox', '');
      } else {
        frame.setAttribute('sandbox', 'allow-same-origin');
      }
      frame.addEventListener('error', fail);
      document.getElementById('frame-host').appendChild(frame);
    } catch (error) {
      fail();
    }
  })();
`;

/** Kept in step with the `customEditors` selectors in package.json. */
export const PDF_VIEWER = 'computor.pdfPreview';
export const HTML_VIEWER = 'computor.htmlPreview';

export function registerDocumentPreviewProviders(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      PDF_VIEWER,
      new DocumentPreviewProvider(context.extensionUri, 'pdf'),
      { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: false } }
    ),
    vscode.window.registerCustomEditorProvider(
      HTML_VIEWER,
      new DocumentPreviewProvider(context.extensionUri, 'html'),
      { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: false } }
    )
  );
}
