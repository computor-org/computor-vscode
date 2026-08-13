import { expect } from 'chai';
import { commands, Uri, ViewColumn } from '../helpers/vscode-stub';
import {
  AUX_COLUMN,
  columnFor,
  openFile,
  registerEditorLayout,
  showOptions,
  SOURCE_COLUMN
} from '../../src/ui/editorLayout';

/**
 * A file opened from the tree used to land wherever focus happened to be, so
 * clicking a figure and then a .m file dropped the .m file on top of the
 * figure (computor-org/issues#286). Every column is absolute now, and these
 * tests pin the two that matter: source left, everything you look at right.
 */
describe('editorLayout', () => {
  describe('columnFor', () => {
    it('puts files you edit in the source group', () => {
      for (const file of ['/w/math_constants.m', '/w/main.py', '/w/a.ts', '/w/meta.yaml', '/w/README.md']) {
        expect(columnFor(file), file).to.equal(SOURCE_COLUMN);
      }
    });

    it('puts images with the figures', () => {
      for (const file of ['/w/fig-000001.png', '/w/plot.JPG', '/w/d.svg', '/w/x.webp']) {
        expect(columnFor(file), file).to.equal(AUX_COLUMN);
      }
    });

    it('reads a Uri as happily as a path', () => {
      expect(columnFor(Uri.file('/w/fig.png') as any)).to.equal(AUX_COLUMN);
      expect(columnFor(Uri.file('/w/solution.m') as any)).to.equal(SOURCE_COLUMN);
    });

    it('never answers with a relative column', () => {
      // Beside/Active are what made the layout drift in the first place.
      for (const file of ['/w/a.m', '/w/b.png']) {
        expect(columnFor(file)).to.not.equal(ViewColumn.Beside);
        expect(columnFor(file)).to.not.equal(ViewColumn.Active);
      }
    });
  });

  describe('showOptions', () => {
    it('fills in the column while keeping what the caller asked for', () => {
      expect(showOptions('/w/a.m', { preview: false })).to.deep.equal({
        preview: false,
        viewColumn: SOURCE_COLUMN
      });
    });

    it('does not invent a preview setting', () => {
      // vscode.open follows workbench.editor.enablePreview; forcing it would
      // pin a tab for every file clicked in the tree.
      expect(showOptions('/w/a.m')).to.not.have.property('preview');
    });

    it('wins over a column the caller passed', () => {
      const opts = showOptions('/w/a.m', { viewColumn: ViewColumn.Beside } as any);
      expect(opts.viewColumn).to.equal(SOURCE_COLUMN);
    });
  });

  describe('openFile', () => {
    const originalExecute = commands.executeCommand;
    let calls: any[][];

    beforeEach(() => {
      calls = [];
      (commands as any).executeCommand = async (...args: any[]) => {
        calls.push(args);
        return undefined;
      };
    });

    afterEach(() => {
      (commands as any).executeCommand = originalExecute;
    });

    it('goes through vscode.open so editor associations still apply', async () => {
      await openFile('/w/fig.png');
      expect(calls).to.have.length(1);
      expect(calls[0]![0]).to.equal('vscode.open');
      expect(calls[0]![2]).to.deep.equal({ viewColumn: AUX_COLUMN });
    });

    it('sends a source file to the source group', async () => {
      await openFile(Uri.file('/w/math_constants.m') as any);
      expect(calls[0]![2]).to.deep.equal({ viewColumn: SOURCE_COLUMN });
    });
  });

  describe('computor.openFile double click', () => {
    // A single tree click opens a preview tab that the next click reuses, so
    // opening a second file silently closed the first
    // (computor-org/issues#319). Tree views have no double-click event, so the
    // command handler counts a second click on the same file inside the
    // double-click window as "keep this one open" and pins it.
    const originalRegister = commands.registerCommand;
    const originalExecute = commands.executeCommand;
    const originalNow = Date.now;
    let handler: (uri: any, extra?: any) => Promise<void>;
    let calls: any[][];
    let now: number;

    beforeEach(() => {
      calls = [];
      now = 100_000;
      Date.now = () => now;
      (commands as any).registerCommand = (_id: string, cb: any) => {
        handler = cb;
        return { dispose() {} };
      };
      (commands as any).executeCommand = async (...args: any[]) => {
        calls.push(args);
        return undefined;
      };
      registerEditorLayout({ subscriptions: [] } as any);
    });

    afterEach(() => {
      Date.now = originalNow;
      (commands as any).registerCommand = originalRegister;
      (commands as any).executeCommand = originalExecute;
    });

    it('leaves a single click as a preview', async () => {
      await handler('/w/a.m');
      expect(calls[0]![2]).to.not.have.property('preview');
    });

    it('pins on a double click on the same file', async () => {
      await handler('/w/a.m');
      now += 200;
      await handler('/w/a.m');
      expect(calls[0]![2]).to.not.have.property('preview');
      expect(calls[1]![2]).to.include({ preview: false });
    });

    it('does not pin two quick clicks on different files', async () => {
      await handler('/w/a.m');
      now += 200;
      await handler('/w/b.m');
      expect(calls[1]![2]).to.not.have.property('preview');
    });

    it('leaves a slow second click as a preview', async () => {
      await handler('/w/a.m');
      now += 1000;
      await handler('/w/a.m');
      expect(calls[1]![2]).to.not.have.property('preview');
    });

    it('keeps the column rules on the pinning open', async () => {
      await handler('/w/fig.png');
      now += 200;
      await handler('/w/fig.png');
      expect(calls[1]![2]).to.include({ preview: false, viewColumn: AUX_COLUMN });
    });
  });
});
