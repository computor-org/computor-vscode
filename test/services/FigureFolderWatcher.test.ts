import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileSystemWatchers, FileSystemWatcherStub } from '../helpers/vscode-stub';
import {
  FigureFolderChange,
  FigureFolderWatcher,
  resolveFiguresDirectory
} from '../../src/services/FigureFolderWatcher';

/**
 * The figure folder is a contract shared with two producers that live in
 * other repositories' images (the matplotlib backend and the MATLAB
 * figurewatch package), so these tests write the files exactly the way those
 * producers do and check what the viewer makes of them.
 */
describe('FigureFolderWatcher', () => {
  let directory: string;
  let watcher: FigureFolderWatcher;
  let changes: FigureFolderChange[];

  const publish = (figureNumber: number, title: string, source = 'matplotlib', png = 'image-bytes') => {
    const stem = path.join(directory, `fig-${String(figureNumber).padStart(6, '0')}`);
    fs.writeFileSync(`${stem}.json`, JSON.stringify({ number: figureNumber, title, source }));
    fs.writeFileSync(`${stem}.png`, png);
  };

  /** Let the watcher notice, the way a producer's write would. */
  const settle = async (): Promise<void> => {
    const stub = fileSystemWatchers[fileSystemWatchers.length - 1] as FileSystemWatcherStub;
    stub.fireChange();
    await new Promise((resolve) => setTimeout(resolve, 150));
  };

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-figures-test-'));
    changes = [];
    watcher = new FigureFolderWatcher(directory);
    watcher.onDidChange((change) => changes.push(change));
    watcher.start();
    await settle();
    changes.length = 0;
  });

  afterEach(() => {
    watcher.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('reports a published figure with the title from its sidecar', async () => {
    publish(1, 'Sales');
    await settle();

    expect(changes).to.have.lengthOf(1);
    expect(changes[0]!.added).to.deep.equal([1]);
    expect(changes[0]!.figures).to.have.lengthOf(1);
    expect(changes[0]!.figures[0]).to.include({ number: 1, title: 'Sales', source: 'matplotlib' });
  });

  it('describes a figure whose sidecar is missing', async () => {
    fs.writeFileSync(path.join(directory, 'fig-000007.png'), 'image-bytes');
    await settle();

    expect(changes[0]!.figures[0]).to.include({ number: 7, title: 'Figure 7', source: 'unknown' });
  });

  it('orders figures by number, not by name', async () => {
    publish(10, 'Ten');
    publish(2, 'Two');
    await settle();

    expect(changes[0]!.figures.map((figure) => figure.number)).to.deep.equal([2, 10]);
  });

  it('treats an overwritten image as an update, not a new figure', async () => {
    publish(1, 'Sales');
    await settle();
    const firstRevision = changes[0]!.figures[0]!.revision;
    changes.length = 0;

    publish(1, 'Sales', 'matplotlib', 'different-image-bytes');
    await settle();

    expect(changes).to.have.lengthOf(1);
    expect(changes[0]!.added).to.be.empty;
    expect(changes[0]!.figures[0]!.revision).to.not.equal(firstRevision);
  });

  it('stays quiet when nothing about the folder changed', async () => {
    publish(1, 'Sales');
    await settle();
    changes.length = 0;

    await settle();

    expect(changes).to.be.empty;
  });

  it('ignores the temp files producers rename into place', async () => {
    // Exactly what the two producers leave in flight: figurewatch's
    // .fig-NNNNNN.tmp.png and the matplotlib backend's mkstemp name.
    fs.writeFileSync(path.join(directory, '.fig-000001.tmp.png'), 'half-written');
    fs.writeFileSync(path.join(directory, '.fig-000002.png.a1b2c3.tmp'), 'half-written');
    fs.writeFileSync(path.join(directory, 'fig-1.png'), 'wrong-name');
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'unrelated');
    await settle();

    expect(changes).to.be.empty;
  });

  it('closing a figure removes both of its files', async () => {
    publish(1, 'Sales');
    publish(2, 'Costs');
    await settle();
    changes.length = 0;

    await watcher.closeFigure(1);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(fs.existsSync(path.join(directory, 'fig-000001.png'))).to.be.false;
    expect(fs.existsSync(path.join(directory, 'fig-000001.json'))).to.be.false;
    expect(changes[changes.length - 1]!.figures.map((figure) => figure.number)).to.deep.equal([2]);
  });

  it('closing a figure that is already gone is not an error', async () => {
    await watcher.closeFigure(42);
  });

  it('reports a figure closed by its producer', async () => {
    publish(1, 'Sales');
    await settle();
    changes.length = 0;

    fs.unlinkSync(path.join(directory, 'fig-000001.png'));
    fs.unlinkSync(path.join(directory, 'fig-000001.json'));
    await settle();

    expect(changes[0]!.figures).to.be.empty;
  });

  it('marks only the first look at the folder as initial', async () => {
    publish(1, 'Sales');
    await settle();

    expect(changes[0]!.initial).to.be.false;
  });

  it('marks figures left over from an earlier session as initial', async () => {
    watcher.dispose();
    publish(1, 'From yesterday');

    const restarted = new FigureFolderWatcher(directory);
    const seen: FigureFolderChange[] = [];
    restarted.onDidChange((change) => seen.push(change));
    try {
      restarted.start();
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(seen).to.have.lengthOf(1);
      expect(seen[0]!.initial).to.be.true;
      expect(seen[0]!.added).to.deep.equal([1]);
    } finally {
      restarted.dispose();
    }
  });

  it('creates the folder so a producer can publish into it', () => {
    const missing = path.join(directory, 'nested', 'figures');
    const nested = new FigureFolderWatcher(missing);
    try {
      nested.start();
      expect(fs.existsSync(missing)).to.be.true;
    } finally {
      nested.dispose();
    }
  });
});

describe('resolveFiguresDirectory', () => {
  const original = process.env.COMPUTOR_FIGURES_DIR;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.COMPUTOR_FIGURES_DIR;
    } else {
      process.env.COMPUTOR_FIGURES_DIR = original;
    }
  });

  it('takes the folder the workspace image names', () => {
    process.env.COMPUTOR_FIGURES_DIR = '/somewhere/figures';
    expect(resolveFiguresDirectory()).to.equal('/somewhere/figures');
  });

  it('ignores an empty setting', () => {
    process.env.COMPUTOR_FIGURES_DIR = '   ';
    // Falls back to the default path, which only counts when it already
    // exists — outside a workspace there is nothing to watch.
    const resolved = resolveFiguresDirectory();
    expect(resolved === undefined || resolved === '/tmp/computor-figures').to.be.true;
  });
});
