import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { commands } from '../helpers/vscode-stub';
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
