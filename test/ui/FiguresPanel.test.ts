import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { commands, fileSystemWatchers, webviewPanels } from '../helpers/vscode-stub';
import { registerFigureViewer } from '../../src/ui/panels/FiguresPanel';

/**
 * "Show Figures" used to be registered only when a figure folder already
 * existed, which left the viewer impossible to find and impossible to try
 * anywhere but inside a workspace — and blind to a folder that appeared after
 * startup. The command has to exist either way.
 */
describe('registerFigureViewer', () => {
  const originalRegister = commands.registerCommand;
  const originalExecute = commands.executeCommand;
  const originalDir = process.env.COMPUTOR_FIGURES_DIR;

  let registered: string[];
  let context: any;

  beforeEach(() => {
    registered = [];
    context = { subscriptions: [], extensionUri: { fsPath: '/ext', path: '/ext', scheme: 'file' } };
    (commands as any).registerCommand = (id: string) => {
      registered.push(id);
      return { dispose: () => {} };
    };
    (commands as any).executeCommand = async () => undefined;
  });

  afterEach(() => {
    (commands as any).registerCommand = originalRegister;
    (commands as any).executeCommand = originalExecute;
    if (originalDir === undefined) {
      delete process.env.COMPUTOR_FIGURES_DIR;
    } else {
      process.env.COMPUTOR_FIGURES_DIR = originalDir;
    }
    context.subscriptions.forEach((d: any) => d?.dispose?.());
  });

  /**
   * The case that regressed: nothing names a figure folder, so there is
   * nothing to watch yet. The command still has to be there — it is the only
   * way to reach the viewer, and the only way to try it outside a workspace.
   * (Sharpest when DEFAULT_FIGURES_DIR is absent, which is the state on any
   * machine that has not run a workspace; the assertion holds either way.)
   */
  it('registers Show Figures when nothing is publishing figures', () => {
    delete process.env.COMPUTOR_FIGURES_DIR;

    registerFigureViewer(context);

    expect(registered).to.include('computor.figures.show');
  });

  /**
   * Closing the panel means "done with these", not "never again". Re-running a
   * script usually overwrites fig-000001 instead of adding a figure, so a
   * reveal rule that waited for a new number left the panel shut for good
   * unless the student happened to press Close on the figure first.
   */
  it('comes back when a script re-runs after the panel was closed', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-reopen-'));
    process.env.COMPUTOR_FIGURES_DIR = folder;
    webviewPanels.length = 0;

    const publish = (bytes: string) => {
      fs.writeFileSync(path.join(folder, 'fig-000001.json'),
        JSON.stringify({ number: 1, title: 'Test', source: 'matplotlib' }));
      fs.writeFileSync(path.join(folder, 'fig-000001.png'), bytes);
    };
    const settle = async () => {
      fileSystemWatchers[fileSystemWatchers.length - 1]!.fireChange();
      await new Promise((resolve) => setTimeout(resolve, 200));
    };

    try {
      registerFigureViewer(context);
      // Let the first scan see the empty folder. Figures already there at
      // startup are left over from an earlier session and deliberately do not
      // open the panel, which would otherwise be what this test measured.
      await new Promise((resolve) => setTimeout(resolve, 200));

      publish('first-run');
      await settle();
      expect(webviewPanels.length, 'first run opens the panel').to.equal(1);

      // The student closes the panel with [x] — without pressing Close on the
      // figure, so fig-000001 stays on disk.
      webviewPanels[0]!.dispose();
      expect(fs.existsSync(path.join(folder, 'fig-000001.png'))).to.be.true;

      // Running the script again overwrites the same figure.
      publish('second-run-different-bytes');
      await settle();

      expect(webviewPanels.length, 'the re-run brings the panel back').to.equal(2);
      expect(webviewPanels[1]!.disposed).to.be.false;
    } finally {
      context.subscriptions.forEach((d: any) => d?.dispose?.());
      context.subscriptions.length = 0;
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  /**
   * "Close All" is the plot-window action students expect after a script draws
   * a dozen figures: one press, an empty viewer, and every producing figure
   * closed with it — the deleted PNGs are how the script learns.
   */
  it('closes every figure on screen when the webview asks it to', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-close-all-'));
    process.env.COMPUTOR_FIGURES_DIR = folder;
    webviewPanels.length = 0;

    const publish = (figureNumber: number) => {
      const stem = path.join(folder, `fig-${String(figureNumber).padStart(6, '0')}`);
      fs.writeFileSync(`${stem}.json`,
        JSON.stringify({ number: figureNumber, title: `Figure ${figureNumber}`, source: 'matplotlib' }));
      fs.writeFileSync(`${stem}.png`, `image-${figureNumber}`);
    };
    const settle = async () => {
      fileSystemWatchers[fileSystemWatchers.length - 1]!.fireChange();
      await new Promise((resolve) => setTimeout(resolve, 200));
    };

    try {
      registerFigureViewer(context);
      await new Promise((resolve) => setTimeout(resolve, 200));

      publish(1);
      publish(2);
      publish(3);
      await settle();
      expect(webviewPanels.length, 'the plots open the panel').to.equal(1);

      webviewPanels[0]!.fireMessage({ command: 'closeAll' });
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(fs.readdirSync(folder), 'every figure is closed').to.be.empty;
      const last = webviewPanels[0]!.posted[webviewPanels[0]!.posted.length - 1];
      expect(last.command).to.equal('figuresUpdate');
      expect(last.data.figures, 'the viewer is left empty').to.be.empty;
    } finally {
      context.subscriptions.forEach((d: any) => d?.dispose?.());
      context.subscriptions.length = 0;
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  /**
   * "Close All" first shipped hidden until a second figure existed, on the
   * theory that with one figure it is "Close" under a longer name. That theory
   * ignored who goes looking for the button: the first person to try it had a
   * single plot open, found nothing, and asked where it was. A control that
   * hides exactly when someone searches for it is worse than a redundant one.
   */
  it('offers Close All even with a single figure open', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-close-all-one-'));
    process.env.COMPUTOR_FIGURES_DIR = folder;
    webviewPanels.length = 0;

    try {
      registerFigureViewer(context);
      await new Promise((resolve) => setTimeout(resolve, 200));

      fs.writeFileSync(path.join(folder, 'fig-000001.json'),
        JSON.stringify({ number: 1, title: 'Sales', source: 'matplotlib' }));
      fs.writeFileSync(path.join(folder, 'fig-000001.png'), 'image-bytes');
      fileSystemWatchers[fileSystemWatchers.length - 1]!.fireChange();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const html: string = webviewPanels[0]!.webview.html;
      const button = /<button[^>]*data-action="closeAll"[^>]*>/.exec(html);
      expect(button, 'the toolbar has a Close All button').to.not.be.null;
      expect(button![0], 'and it is not hidden').to.not.match(/\bhidden\b/);

      // And it still closes the one figure there is.
      webviewPanels[0]!.fireMessage({ command: 'closeAll' });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(fs.readdirSync(folder)).to.be.empty;
    } finally {
      context.subscriptions.forEach((d: any) => d?.dispose?.());
      context.subscriptions.length = 0;
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it('starts watching by itself where the workspace names a folder', () => {
    const folder = path.join(os.tmpdir(), `computor-watched-${Date.now()}`);
    fs.rmSync(folder, { recursive: true, force: true });
    process.env.COMPUTOR_FIGURES_DIR = folder;
    try {
      registerFigureViewer(context);

      expect(registered).to.include('computor.figures.show');
      // The watcher creates the folder it was told to watch.
      expect(fs.existsSync(folder)).to.be.true;
      // The command, plus the watcher, panel and change subscription.
      expect(context.subscriptions.length).to.be.greaterThan(1);
    } finally {
      context.subscriptions.forEach((d: any) => d?.dispose?.());
      context.subscriptions.length = 0;
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
