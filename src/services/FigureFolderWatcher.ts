import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * The figure folder: the file-based contract every language publishes plots
 * through, because Computor workspaces are containers without a desktop and
 * no plotting library can open a real figure window in one.
 *
 * Per figure the producer writes `fig-NNNNNN.png` and a sibling
 * `fig-NNNNNN.json` holding `{ number, title, source }`. A new PNG is a new
 * figure, an overwritten PNG is an update, and a deleted PNG closes the
 * figure — including when this extension is the one deleting it.
 */

/** Where figures live when the environment does not say otherwise. */
export const DEFAULT_FIGURES_DIR = '/tmp/computor-figures';

/** One figure as the folder currently holds it. */
export interface Figure {
  number: number;
  title: string;
  /** Which producer wrote it: 'matplotlib', 'matlab', … */
  source: string;
  pngPath: string;
  /** Changes whenever the image does, so the viewer knows to reload it. */
  revision: string;
}

export interface FigureFolderChange {
  figures: Figure[];
  /** Numbers that were not in the folder before. */
  added: number[];
  /**
   * Numbers whose image changed — a script re-run that overwrites its figures
   * rather than creating new ones. Together with `added` this is "a plot just
   * happened", which is what decides whether the viewer shows itself.
   */
  updated: number[];
  /**
   * True for what the first look at the folder found. Those figures are
   * left over from an earlier session, so the viewer takes note of them but
   * does not open itself over whatever the student is doing.
   */
  initial: boolean;
}

/**
 * Exactly the published name. Producers fill a dotted temp file next to the
 * target and rename it into place, so a looser match would hand the viewer a
 * half-written image.
 */
const PUBLISHED_PNG = /^fig-(\d{6})\.png$/;

/** A burst of renames (image plus sidecar) should cost one scan, not four. */
const SCAN_DEBOUNCE_MS = 80;

/**
 * File watching is unreliable across the container mounts a figure folder can
 * live on, and a plot that never appears reads as a broken feature. A slow
 * re-scan is a few stats of a folder holding a handful of files.
 */
const RESCAN_INTERVAL_MS = 5000;

/** Where figures would go here — the workspace's setting, or the default. */
export function configuredFiguresDirectory(): string {
  return (process.env.COMPUTOR_FIGURES_DIR ?? '').trim() || DEFAULT_FIGURES_DIR;
}

/**
 * The folder to start watching on its own, or `undefined` for "not unless
 * asked". Outside a workspace container nothing publishes figures, and
 * watching the default path anyway would create the folder on a lecturer's own
 * machine — so that only happens once someone opens the viewer themselves.
 */
export function resolveFiguresDirectory(): string | undefined {
  const configured = (process.env.COMPUTOR_FIGURES_DIR ?? '').trim();
  if (configured) {
    return configured;
  }
  return fs.existsSync(DEFAULT_FIGURES_DIR) ? DEFAULT_FIGURES_DIR : undefined;
}

/** Watches the figure folder and reports what it holds. */
export class FigureFolderWatcher implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<FigureFolderChange>();
  readonly onDidChange: vscode.Event<FigureFolderChange> = this.changeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private revisions = new Map<number, string>();
  private scanned = false;
  private debounceTimer: NodeJS.Timeout | undefined;
  private rescanTimer: NodeJS.Timeout | undefined;
  private scanning = false;
  private scanAgain = false;

  constructor(readonly directory: string) {}

  start(): void {
    try {
      fs.mkdirSync(this.directory, { recursive: true });
    } catch (error) {
      console.error(`Computor figures: cannot create ${this.directory}`, error);
      return;
    }

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(this.directory), '*')
    );
    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => this.scheduleScan()),
      watcher.onDidChange(() => this.scheduleScan()),
      watcher.onDidDelete(() => this.scheduleScan())
    );

    this.rescanTimer = setInterval(() => this.scheduleScan(), RESCAN_INTERVAL_MS);
    this.scheduleScan();
  }

  /**
   * Close a figure. Removing the PNG is the whole protocol: the producer that
   * owns it sees the file go and closes its own figure to match.
   */
  async closeFigure(figureNumber: number): Promise<void> {
    await this.closeFigures([figureNumber]);
  }

  /**
   * Close several figures as one act, so "Close All" costs a single re-scan
   * and the viewer empties in one step instead of blinking down one figure at
   * a time as each deletion lands.
   */
  async closeFigures(figureNumbers: number[]): Promise<void> {
    await Promise.all(figureNumbers.map((figureNumber) => this.removeFigure(figureNumber)));
    this.scheduleScan();
  }

  private async removeFigure(figureNumber: number): Promise<void> {
    const stem = path.join(this.directory, `fig-${String(figureNumber).padStart(6, '0')}`);
    for (const file of [`${stem}.png`, `${stem}.json`]) {
      try {
        await fs.promises.unlink(file);
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          console.error(`Computor figures: cannot remove ${file}`, error);
        }
      }
    }
  }

  private scheduleScan(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.scan();
    }, SCAN_DEBOUNCE_MS);
  }

  private async scan(): Promise<void> {
    // Scans overlap when a producer republishes while one is in flight. Let
    // the running scan finish and repeat it, so the last state always wins.
    if (this.scanning) {
      this.scanAgain = true;
      return;
    }
    this.scanning = true;
    try {
      await this.scanOnce();
    } finally {
      this.scanning = false;
      if (this.scanAgain) {
        this.scanAgain = false;
        this.scheduleScan();
      }
    }
  }

  private async scanOnce(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.promises.readdir(this.directory);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.error(`Computor figures: cannot read ${this.directory}`, error);
      }
      entries = [];
    }

    const figures: Figure[] = [];
    for (const entry of entries.sort()) {
      const match = PUBLISHED_PNG.exec(entry);
      if (!match) {
        continue;
      }
      const figure = await this.readFigure(Number(match[1]), path.join(this.directory, entry));
      if (figure) {
        figures.push(figure);
      }
    }
    figures.sort((a, b) => a.number - b.number);

    const revisions = new Map(figures.map((figure) => [figure.number, figure.revision]));
    const added = figures.filter((f) => !this.revisions.has(f.number)).map((f) => f.number);
    const updated = figures
      .filter((f) => this.revisions.has(f.number) && this.revisions.get(f.number) !== f.revision)
      .map((f) => f.number);
    const unchanged =
      revisions.size === this.revisions.size &&
      figures.every((f) => this.revisions.get(f.number) === f.revision);
    const initial = !this.scanned;
    this.scanned = true;
    if (unchanged) {
      return;
    }

    this.revisions = revisions;
    this.changeEmitter.fire({ figures, added, updated, initial });
  }

  private async readFigure(figureNumber: number, pngPath: string): Promise<Figure | undefined> {
    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(pngPath);
    } catch {
      // Closed between the listing and now — it is simply not there any more.
      return undefined;
    }

    // The sidecar is written before the image, so it is normally already
    // there. A producer that skips it still gets its figure shown.
    let title = `Figure ${figureNumber}`;
    let source = 'unknown';
    try {
      const raw = await fs.promises.readFile(pngPath.replace(/\.png$/, '.json'), 'utf8');
      const metadata = JSON.parse(raw);
      if (typeof metadata?.title === 'string' && metadata.title.trim()) {
        title = metadata.title.trim();
      }
      if (typeof metadata?.source === 'string' && metadata.source.trim()) {
        source = metadata.source.trim();
      }
    } catch {
      // No readable metadata; the defaults above describe the figure well enough.
    }

    return {
      number: figureNumber,
      title,
      source,
      pngPath,
      revision: `${stats.mtimeMs}:${stats.size}`
    };
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.rescanTimer) {
      clearInterval(this.rescanTimer);
    }
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;
    this.changeEmitter.dispose();
  }
}
