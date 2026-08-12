import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AUX_COLUMN, ensureAuxColumn } from '../editorLayout';
import { renderWebviewPage } from '../webviews/shared/webviewPage';

/** One opened artifact image. */
interface ArtifactEntry {
  /** Stable panel-local id; the webview keys thumbnails by it. */
  id: number;
  title: string;
  source: string;
  absPath: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * The "Artifacts" panel: figure artifacts from test results, presented the
 * way the Figures panel presents live plots — fit to view, a thumbnail strip
 * when several are open, Close and Close All (computor-org/issues#315). It
 * reuses the figures webview assets wholesale; only the host differs.
 *
 * Unlike FiguresPanel, Close only drops the entry from the panel — the file
 * on disk stays, because it is the download cache for the result's artifacts
 * and deleting it would force a re-download on the next click.
 */
export class ArtifactsPanel implements vscode.Disposable {
  public static readonly viewType = 'computor.artifacts';

  private panel: vscode.WebviewPanel | undefined;
  private artifacts: ArtifactEntry[] = [];
  private selected: number | undefined;
  private nextId = 1;
  /** What the webview already has, so an update resends only what changed. */
  private postedRevisions = new Map<number, string>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Show an artifact image, adding it to the strip if it is new. */
  async add(filePath: string, sourceLabel?: string): Promise<void> {
    let entry = this.artifacts.find((artifact) => artifact.absPath === filePath);
    if (!entry) {
      entry = {
        id: this.nextId++,
        title: path.basename(filePath),
        source: sourceLabel ?? path.basename(path.dirname(filePath)),
        absPath: filePath
      };
      this.artifacts.push(entry);
    }
    this.selected = entry.id;
    await this.show(false);
  }

  /** Open the panel, or bring it forward if it is already open. */
  async show(preserveFocus: boolean): Promise<void> {
    await ensureAuxColumn();
    if (this.panel) {
      this.panel.reveal(AUX_COLUMN, preserveFocus);
    } else {
      this.create(preserveFocus);
    }
    await this.postArtifacts();
  }

  private create(preserveFocus: boolean): void {
    const panel = vscode.window.createWebviewPanel(
      ArtifactsPanel.viewType,
      'Artifacts',
      { viewColumn: AUX_COLUMN, preserveFocus },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri]
      }
    );
    panel.webview.html = this.getHtmlContent(panel.webview);

    panel.webview.onDidReceiveMessage((message) => {
      switch (message?.command) {
        case 'ready':
          // A reloaded webview holds no images any more.
          this.postedRevisions.clear();
          void this.postArtifacts();
          break;
        case 'select':
          this.selected = Number(message.data?.number);
          break;
        case 'close':
          this.remove(Number(message.data?.number));
          break;
        case 'closeAll':
          this.artifacts = [];
          this.selected = undefined;
          void this.postArtifacts();
          break;
      }
    });

    panel.onDidDispose(() => {
      this.panel = undefined;
      this.postedRevisions.clear();
    });

    this.panel = panel;
  }

  private remove(id: number): void {
    this.artifacts = this.artifacts.filter((artifact) => artifact.id !== id);
    if (this.selected === id) {
      this.selected = this.artifacts[this.artifacts.length - 1]?.id;
    }
    void this.postArtifacts();
  }

  private async postArtifacts(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }

    const views = await Promise.all(this.artifacts.map((artifact) => this.toView(artifact)));
    const figures = views.filter((view): view is NonNullable<typeof view> => view !== undefined);

    // An artifact whose file vanished (cache cleared) drops out of the list.
    const alive = new Set(figures.map((figure) => figure.number));
    this.artifacts = this.artifacts.filter((artifact) => alive.has(artifact.id));

    this.postedRevisions = new Map(figures.map((figure) => [figure.number, figure.revision]));
    void panel.webview.postMessage({
      command: 'figuresUpdate',
      data: { figures, selected: this.selected ?? null }
    });
  }

  private async toView(entry: ArtifactEntry) {
    const view = {
      number: entry.id,
      title: entry.title,
      source: entry.source,
      revision: '',
      image: null as string | null
    };

    try {
      const stat = await fs.promises.stat(entry.absPath);
      view.revision = `${entry.absPath}:${stat.mtimeMs}`;
      if (this.postedRevisions.get(entry.id) === view.revision) {
        return view;
      }
      const bytes = await fs.promises.readFile(entry.absPath);
      // Inlined as a data URI for the same reason as the Figures panel and the
      // image preview: asWebviewUri goes through a service worker that Safari
      // and Firefox break under code-server (issues #267/#282).
      const mime = MIME_BY_EXTENSION[path.extname(entry.absPath).toLowerCase()] ?? 'image/png';
      view.image = `data:${mime};base64,${bytes.toString('base64')}`;
      return view;
    } catch {
      return undefined;
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    return renderWebviewPage(webview, this.extensionUri, {
      title: 'Artifacts',
      cssFiles: ['figures/figures.css'],
      scriptFiles: ['figures/figures.js'],
      bodyHtml: `
      <div class="figures" id="figures">
        <div class="figures-empty" id="figuresEmpty">
          <p>No artifacts open.</p>
          <p class="text-muted">Figure artifacts from test results appear here when you open them from the Results panel.</p>
        </div>
        <div class="figures-stage hidden" id="figuresStage">
          <div class="figures-toolbar">
            <span class="figures-stage-title" id="figuresStageTitle"></span>
            <span class="figures-stage-meta" id="figuresStageMeta"></span>
            <span class="flex-spacer"></span>
            <button class="btn secondary" data-action="closeSelected" title="Close this artifact">Close</button>
            <button class="btn secondary" data-action="closeAll" title="Close every artifact">Close All</button>
          </div>
          <div class="figures-canvas"><img id="figuresStageImage" alt=""></div>
        </div>
        <div class="figures-strip hidden" id="figuresStrip"></div>
      </div>`
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}
