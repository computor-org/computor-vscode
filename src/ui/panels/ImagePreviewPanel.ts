import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { renderWebviewPage } from '../webviews/shared/webviewPage';

/**
 * An image editor that works in every browser a student might use.
 *
 * VS Code's own image preview loads the picture, its stylesheet and its script
 * from `https://<…>.vscode-resource.vscode-cdn.net/…` — a host that exists
 * only inside the webview service worker. Under code-server the webview's
 * content lives in a *grandchild* iframe, and Firefox never routes that
 * frame's requests through the service worker: `serviceWorker.controller` is
 * set, yet even a same-origin request from it is answered by the network.
 * Nothing loads, and the two panels the missing stylesheet was keeping hidden
 * — "An error occurred while loading the image" and "The image is stored with
 * Git LFS and is not available for preview" — both appear at once, neither of
 * them true. Older Safari fails the same way for a reason of its own
 * (computor-org/issues#274). Chrome and current WebKit are fine, which is what
 * made this look like a Mac problem (computor-org/issues#282).
 *
 * So this viewer does what every other Computor webview does: the image
 * travels inline as a `data:` URI and `renderWebviewPage` inlines the CSS and
 * JS, leaving no fetch for a service worker to miss. Same reasoning as
 * FiguresPanel, and the same reason `docs/figures.md` gives for publishing
 * plots that way.
 *
 * It is contributed at `priority: "option"`, so it never displaces the
 * built-in editor on its own. The workspace templates make it the default by
 * writing `workbench.editorAssociations` into the workspace's settings, which
 * keeps a lecturer's desktop VS Code — where the built-in works, and works
 * better — untouched.
 */

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
};

/**
 * Past this, base64 in the document costs more than the preview is worth — and
 * the whole string has to cross the extension host boundary on every render.
 * Figures and screenshots are orders of magnitude smaller than this.
 */
const MAX_INLINE_BYTES = 24 * 1024 * 1024;

/** A rewrite lands as several events; render once the file has settled. */
const RELOAD_DEBOUNCE_MS = 120;

interface ImageState {
  name: string;
  /** Data URI, or null when the file could not be inlined. */
  src: string | null;
  byteLength: number;
  /** Why there is no image, for the webview to show instead of one. */
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

async function readImageState(uri: vscode.Uri): Promise<ImageState> {
  const name = path.basename(uri.fsPath);
  const extension = path.extname(uri.fsPath).toLowerCase();
  const mime = MIME_TYPES[extension] ?? 'application/octet-stream';

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(uri.fsPath);
  } catch {
    return { name, src: null, byteLength: 0, error: 'This file is no longer there.' };
  }

  if (stat.size > MAX_INLINE_BYTES) {
    return {
      name,
      src: null,
      byteLength: stat.size,
      error:
        `This image is ${formatBytes(stat.size)}, too large to preview here. ` +
        'Open it with "Reopen Editor With…" to try the built-in viewer.'
    };
  }

  try {
    const bytes = await fs.promises.readFile(uri.fsPath);
    return {
      name,
      src: `data:${mime};base64,${bytes.toString('base64')}`,
      byteLength: bytes.byteLength,
      error: null
    };
  } catch {
    return { name, src: null, byteLength: stat.size, error: 'This file could not be read.' };
  }
}

export class ImagePreviewProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'computor.imagePreview';

  constructor(private readonly extensionUri: vscode.Uri) {}

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

    // Re-running a test overwrites its figure rather than writing a new file,
    // so an open preview has to follow the bytes on disk — otherwise it keeps
    // showing the previous run's plot with no hint that it is stale.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
        path.basename(document.uri.fsPath)
      )
    );
    let pending: NodeJS.Timeout | undefined;
    const reload = (): void => {
      if (pending) {
        clearTimeout(pending);
      }
      pending = setTimeout(() => {
        pending = undefined;
        void render();
      }, RELOAD_DEBOUNCE_MS);
    };
    watcher.onDidChange(reload);
    watcher.onDidCreate(reload);
    watcher.onDidDelete(reload);

    panel.onDidDispose(() => {
      if (pending) {
        clearTimeout(pending);
      }
      watcher.dispose();
    });
  }

  private async getHtmlContent(webview: vscode.Webview, uri: vscode.Uri): Promise<string> {
    const state = await readImageState(uri);
    return renderWebviewPage(webview, this.extensionUri, {
      title: state.name,
      cssFiles: ['images/image-preview.css'],
      scriptFiles: ['images/image-preview.js'],
      initialState: { ...state, sizeLabel: formatBytes(state.byteLength) },
      bodyHtml: `
      <div class="image-preview">
        <div class="image-toolbar">
          <span class="image-meta" id="imageMeta"></span>
          <span class="flex-spacer"></span>
          <button class="btn secondary" data-action="zoomOut" title="Zoom out">&minus;</button>
          <button class="btn secondary" id="imageZoom" data-action="toggleZoom" title="Fit the window, or show every pixel">Fit</button>
          <button class="btn secondary" data-action="zoomIn" title="Zoom in">+</button>
        </div>
        <div class="image-canvas" id="imageCanvas">
          <img id="imageStage" alt="">
        </div>
        <div class="image-error hidden" id="imageError"></div>
      </div>`
    });
  }
}

/**
 * Registers the viewer. Unconditional: the contribution's "option" priority
 * means nothing opens with it unless a workspace asked for it by setting
 * `workbench.editorAssociations`, or the student picked it from
 * "Reopen Editor With…".
 */
export function registerImageViewer(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      ImagePreviewProvider.viewType,
      new ImagePreviewProvider(context.extensionUri),
      { supportsMultipleEditorsPerDocument: true }
    )
  );
}
