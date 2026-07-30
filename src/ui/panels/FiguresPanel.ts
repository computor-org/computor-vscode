import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  configuredFiguresDirectory,
  Figure,
  FigureFolderChange,
  FigureFolderWatcher,
  resolveFiguresDirectory
} from '../../services/FigureFolderWatcher';
import { renderWebviewPage } from '../webviews/shared/webviewPage';

/** A figure as the webview needs it: the image travels with it. */
interface FigureView {
  number: number;
  title: string;
  source: string;
  revision: string;
  /** Data URI, or null when the webview already holds this revision. */
  image: string | null;
}

/**
 * The "Figures" panel: what a plot window would be if this workspace had a
 * desktop. It shows every figure published to the figure folder — a strip of
 * thumbnails and the selected figure in full — and closing one deletes its
 * PNG, which is how the producing MATLAB or Python session learns to close it.
 */
export class FiguresPanel implements vscode.Disposable {
  public static readonly viewType = 'computor.figures';

  private panel: vscode.WebviewPanel | undefined;
  private figures: Figure[] = [];
  private selected: number | undefined;
  /** What the webview already has, so an update resends only what changed. */
  private postedRevisions = new Map<number, string>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly watcher: FigureFolderWatcher
  ) {}

  /** Open the panel, or bring it forward if it is already open. */
  async show(preserveFocus: boolean): Promise<void> {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn, preserveFocus);
    } else {
      this.create(preserveFocus);
    }
    await this.postFigures();
  }

  /** Take in what the folder now holds. */
  async apply(change: FigureFolderChange): Promise<void> {
    this.figures = change.figures;
    const wasClosed = this.panel === undefined;

    // A figure that just appeared is the one the student wants to look at; if
    // none did, a figure that was just redrawn is the next best answer, but
    // only when the panel is coming back — an open panel keeps its selection.
    const newest = change.added[change.added.length - 1]
      ?? (wasClosed ? change.updated[change.updated.length - 1] : undefined);
    if (newest !== undefined) {
      this.selected = newest;
    } else if (this.selected === undefined || !this.has(this.selected)) {
      this.selected = this.figures[this.figures.length - 1]?.number;
    }

    // Closing the panel is not a decision to stop seeing figures — it is done
    // with the ones on screen. Running the script again has to bring it back,
    // and re-running usually *overwrites* fig-000001 rather than adding to it,
    // so waiting for a brand new number left the panel shut for good unless
    // the student had pressed Close first (issue #279 follow-up).
    const plotted = change.added.length > 0 || change.updated.length > 0;
    const reveal = plotted && !change.initial && (wasClosed || change.added.length > 0);

    if (reveal) {
      // Reveal, never focus: a plot appearing must not take the cursor out of
      // the editor the student is typing in.
      await this.show(true);
    } else if (this.panel) {
      await this.postFigures();
    }
  }

  private has(figureNumber: number): boolean {
    return this.figures.some((figure) => figure.number === figureNumber);
  }

  private create(preserveFocus: boolean): void {
    const panel = vscode.window.createWebviewPanel(
      FiguresPanel.viewType,
      'Figures',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus },
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
          void this.postFigures();
          break;
        case 'select':
          this.selected = Number(message.data?.number);
          break;
        case 'close':
          void this.watcher.closeFigure(Number(message.data?.number));
          break;
      }
    });

    panel.onDidDispose(() => {
      this.panel = undefined;
      this.postedRevisions.clear();
    });

    this.panel = panel;
  }

  private async postFigures(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }

    const views = await Promise.all(this.figures.map((figure) => this.toView(figure)));
    const figures = views.filter((view): view is FigureView => view !== undefined);

    this.postedRevisions = new Map(figures.map((figure) => [figure.number, figure.revision]));
    void panel.webview.postMessage({
      command: 'figuresUpdate',
      data: { figures, selected: this.selected ?? null }
    });
  }

  private async toView(figure: Figure): Promise<FigureView | undefined> {
    const view: FigureView = {
      number: figure.number,
      title: figure.title,
      source: figure.source,
      revision: figure.revision,
      image: null
    };

    // Republishing in a loop (an animation, a `plt.ion()` session) would
    // otherwise resend every other figure's image on every frame.
    if (this.postedRevisions.get(figure.number) === figure.revision) {
      return view;
    }

    try {
      const bytes = await fs.promises.readFile(figure.pngPath);
      // Inlined rather than served through asWebviewUri: those URIs go through
      // a service worker that Firefox blocks under code-server, which is what
      // left webviews blank in issue #267. A data URI needs no fetch, and the
      // figure folder then needs no place among the resource roots.
      view.image = `data:image/png;base64,${bytes.toString('base64')}`;
      return view;
    } catch {
      // Closed while we were reading it.
      return undefined;
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    return renderWebviewPage(webview, this.extensionUri, {
      title: 'Figures',
      cssFiles: ['figures/figures.css'],
      scriptFiles: ['figures/figures.js'],
      bodyHtml: `
      <div class="figures" id="figures">
        <div class="figures-empty" id="figuresEmpty">
          <p>No figures yet.</p>
          <p class="text-muted">Plots published by your code appear here — <code class="code">plt.show()</code> in Python, any <code class="code">plot</code> in MATLAB.</p>
        </div>
        <div class="figures-stage hidden" id="figuresStage">
          <div class="figures-toolbar">
            <span class="figures-stage-title" id="figuresStageTitle"></span>
            <span class="figures-stage-meta" id="figuresStageMeta"></span>
            <span class="flex-spacer"></span>
            <button class="btn secondary" data-action="closeSelected" title="Close this figure">Close</button>
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

/**
 * Wire up the figure viewer.
 *
 * A workspace publishes figures, so there the folder is watched from startup
 * and a plot opens the panel by itself. Elsewhere — a lecturer's own machine,
 * or a workspace whose folder does not exist yet — watching starts only when
 * someone opens the viewer, so nothing creates the folder behind their back.
 *
 * "Show Figures" is registered either way. Gating the command on the folder
 * existing made the viewer impossible to find, impossible to try, and blind to
 * a folder that appeared after startup.
 */
export function registerFigureViewer(context: vscode.ExtensionContext): void {
  let panel: FiguresPanel | undefined;

  const startWatching = (directory: string): FiguresPanel => {
    const watcher = new FigureFolderWatcher(directory);
    const started = new FiguresPanel(context.extensionUri, watcher);
    context.subscriptions.push(
      watcher,
      started,
      watcher.onDidChange((change) => {
        void started.apply(change);
      })
    );
    watcher.start();
    panel = started;
    return started;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('computor.figures.show', async () => {
      await (panel ?? startWatching(configuredFiguresDirectory())).show(false);
    })
  );

  const directory = resolveFiguresDirectory();
  if (directory) {
    startWatching(directory);
  }
}
