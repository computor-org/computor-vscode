import * as fs from 'fs';
import * as vscode from 'vscode';
import {
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

    // A figure that just appeared is the one the student wants to look at.
    const newest = change.added[change.added.length - 1];
    if (newest !== undefined) {
      this.selected = newest;
    } else if (this.selected === undefined || !this.has(this.selected)) {
      this.selected = this.figures[this.figures.length - 1]?.number;
    }

    if (newest !== undefined && !change.initial) {
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
 * Wire up the figure viewer, if this installation has a figure folder at all.
 *
 * Only workspaces publish figures. On a lecturer's own machine there is no
 * folder and nothing to watch, so the viewer stays out of the way — including
 * out of the command palette, via the `computor.figures.available` context.
 */
export function registerFigureViewer(context: vscode.ExtensionContext): void {
  const directory = resolveFiguresDirectory();
  void vscode.commands.executeCommand('setContext', 'computor.figures.available', !!directory);

  if (!directory) {
    return;
  }

  const watcher = new FigureFolderWatcher(directory);
  const panel = new FiguresPanel(context.extensionUri, watcher);

  context.subscriptions.push(
    watcher,
    panel,
    watcher.onDidChange((change) => {
      void panel.apply(change);
    }),
    vscode.commands.registerCommand('computor.figures.show', async () => {
      await panel.show(false);
    })
  );

  watcher.start();
}
