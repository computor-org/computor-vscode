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

/** A mutable host model checks input identity and tab movement, rather than commands alone. */
describe('learner responsive editor layout', () => {
  const vscode = require('../helpers/vscode-stub');
  const layout = require('../../src/ui/editorLayout');
  const originalExecute = commands.executeCommand;
  let groups: any[];
  let nativeLayout: any;
  let layouts: number[];
  let selected: any[];
  let activeGroup: any;
  let moves: number;
  let onOpen: (() => void) | undefined;
  let onLayout: (() => void) | undefined;
  let onMove: (() => void) | undefined;
  const source = Uri.file('/exact/task/main.py');
  const dirtyInput = { input: { uri: source }, isDirty: true, buffer: 'unsaved learner solution' };
  const unrelated = { input: { uri: Uri.file('/notes/own.py') }, isDirty: true, buffer: 'independent notes' };

  beforeEach(() => {
    groups = [{ viewColumn: 1, tabs: [dirtyInput, unrelated] }];
    nativeLayout = { orientation: 1, groups: [{}] };
    layouts = []; moves = 0; onOpen = undefined; onLayout = undefined; onMove = undefined;
    activeGroup = groups[0]; selected = [dirtyInput, unrelated];
    vscode.window.tabGroups = { get all() { return groups; }, close: () => { throw new Error('must not close tabs'); } };
    (commands as any).executeCommand = async (command: string, ...args: any[]) => {
      if (command === 'vscode.getEditorLayout') return nativeLayout;
      if (command === 'vscode.setEditorLayout') {
        nativeLayout = args[0]; layouts.push(nativeLayout.groups.length);
        if (nativeLayout.groups.length === 1) {
          groups[0].tabs.push(...groups[1].tabs); groups = [groups[0]];
        } else groups.push({ viewColumn: 2, tabs: [] });
        onLayout?.();
      } else if (command === 'vscode.open') {
        const [uri, options] = args;
        activeGroup = groups.find(group => group.viewColumn === options.viewColumn);
        let tab = activeGroup.tabs.find((item: any) => item.input.uri.toString() === uri.toString());
        if (!tab) { tab = { input: { uri } }; activeGroup.tabs.push(tab); }
        selected = [tab]; // native openEditor resets inactive selection
        onOpen?.();
      } else if (command === 'moveActiveEditor') {
        moves++;
        const target = groups[args[0].value - 1];
        for (const tab of selected) {
          activeGroup.tabs.splice(activeGroup.tabs.indexOf(tab), 1); target.tabs.push(tab);
        }
        activeGroup = target;
        onMove?.();
      } else throw new Error(`unexpected command ${command}`);
    };
  });
  afterEach(() => { (commands as any).executeCommand = originalExecute; delete vscode.window.tabGroups; });

  it('moves the same dirty input through mobile, desktop, and mobile without duplicates or oscillation', async () => {
    await layout.updateLearnerReadingWidth(390);
    await layout.openStudentFile(source, { preview: false });
    await layout.updateLearnerReadingWidth(704);
    expect(groups).to.have.length(2);
    expect(groups[1].tabs).to.deep.equal([dirtyInput]);
    expect(groups[0].tabs).to.deep.equal([unrelated]);
    expect(groups[1].tabs[0]).to.equal(dirtyInput);
    await layout.updateLearnerReadingWidth(352); // the split's own resulting width
    expect(layouts).to.deep.equal([2]);
    await layout.updateLearnerReadingWidth(300);
    expect(groups).to.have.length(1);
    expect(groups[0].tabs).to.include(dirtyInput).and.include(unrelated);
    await layout.updateLearnerReadingWidth(600); // merged width stays below widening threshold
    expect(layouts).to.deep.equal([2, 1]);
    await layout.updateLearnerReadingWidth(1100);
    expect(groups[1].tabs).to.deep.equal([dirtyInput]);
    expect(groups.flatMap(group => group.tabs).filter(tab => tab === dirtyInput)).to.have.length(1);
    expect(dirtyInput.buffer).to.equal('unsaved learner solution');
    expect(unrelated.buffer).to.equal('independent notes');
  });

  it('restores code right and reading left when selecting code hides the width-reporting panel', async () => {
    const welcome = { input: { uri: Uri.file('/reading/Welcome.md') } };
    const readme = { input: { uri: Uri.file('/reading/README.md') } };
    groups[0].tabs.push(welcome, readme);
    await layout.updateLearnerReadingWidth(390);
    await layout.openStudentFile(source, { preview: false });
    let visible = true;
    let dispose!: () => void;
    const panel = { active: true, onDidDispose: (callback: () => void) => { dispose = callback; }, reveal: () => { visible = true; } };
    layout.trackLearnerReadingPanel(panel);
    onOpen = () => { visible = false; };
    try {
      await layout.updateLearnerReadingWidth(1100, () => visible, () => true);
      expect(groups[1].tabs).to.deep.equal([dirtyInput]);
      expect(groups[1].tabs[0]).to.equal(dirtyInput);
      expect(groups[0].tabs).to.deep.equal([unrelated, welcome, readme]);
      expect(visible).to.equal(true);
      expect(dirtyInput.buffer).to.equal('unsaved learner solution');
    } finally { dispose(); }
  });

  for (const event of ['split', 'open', 'move']) for (const splitWidth of [600, 700]) it(`restores the exact source after a reentrant ${splitWidth}px ${event} observation`, async () => {
    const welcome = { input: { uri: Uri.file('/reading/Welcome.md') } };
    const readme = { input: { uri: Uri.file('/reading/README.md') } };
    groups[0].tabs.push(welcome, readme);
    await layout.updateLearnerReadingWidth(390);
    await layout.openStudentFile(source, { preview: false });
    await layout.updateLearnerReadingWidth(1100);
    await layout.updateLearnerReadingWidth(300); // narrow viewport merges the reading/code groups
    let visible = true;
    const { showMarkdownTextPreview } = require('../../src/ui/webviews/markdownPreview');
    await showMarkdownTextPreview({ subscriptions: [], extensionUri: Uri.file(process.cwd()) }, '# Task', 'Task', { studentReading: true });
    const panel = vscode.webviewPanels[vscode.webviewPanels.length - 1];
    Object.defineProperty(panel, 'visible', { configurable: true, get: () => visible });
    panel.active = true;
    panel.reveal = () => { visible = true; };
    let observed!: Promise<void>;
    const observe = () => {
      if (!observed) {
        panel.fireMessage({ command: 'readingWidth', width: splitWidth, generation: 1 });
        observed = layout.updateLearnerReadingWidth(0); // await the provider's queued operation
      }
    };
    if (event === 'split') onLayout = observe;
    let sourceOpens = 0;
    onOpen = () => {
      sourceOpens++;
      if (event === 'open') observe(); // positive event queued before selection hides reading
      visible = false;
    };
    onMove = () => {
      visible = true; // moving code away exposes the remaining reading tab
      if (event === 'move') observe();
    };
    try {
      panel.fireMessage({ command: 'readingWidth', width: 1100, generation: 1 });
      await layout.updateLearnerReadingWidth(0);
      await observed;
      expect(groups[1].tabs).to.deep.equal([dirtyInput]);
      expect(groups[1].tabs[0]).to.equal(dirtyInput);
      expect(groups[0].tabs).to.deep.equal([unrelated, welcome, readme]);
      expect(dirtyInput.buffer).to.equal('unsaved learner solution');
      expect(visible).to.equal(true);
      const settledOpens = sourceOpens;
      panel.fireMessage({ command: 'readingWidth', width: 600, generation: 1 });
      await layout.updateLearnerReadingWidth(0);
      expect(sourceOpens).to.equal(settledOpens); // an already-right input keeps its focus
      expect(moves).to.equal(2); // initial wide placement and the final re-split
    } finally { panel.dispose(); }
  });

  for (const cancellation of ['newer request', 'disposed owner', 'richer layout']) it(`cancels queued geometry during selection after ${cancellation}`, async () => {
    await layout.updateLearnerReadingWidth(390);
    await layout.openStudentFile(source, { preview: false });
    let current = true;
    let visible = true;
    let observed!: Promise<void>;
    let dispose!: () => void;
    const panel = { active: true, onDidDispose: (callback: () => void) => { dispose = callback; }, reveal: () => { visible = true; } };
    layout.trackLearnerReadingPanel(panel);
    onOpen = () => {
      if (visible && current) observed = layout.updateLearnerReadingWidth(600, () => current);
      visible = false;
      if (cancellation === 'richer layout') {
        groups.push({ viewColumn: 3, tabs: [] });
        nativeLayout = { orientation: 0, groups: [{}, {}, {}] };
      } else {
        current = false;
        if (cancellation === 'disposed owner') dispose();
      }
    };
    try {
      await layout.updateLearnerReadingWidth(1100, () => current);
      await observed;
      expect(groups[0].tabs).to.deep.equal([dirtyInput, unrelated]);
      expect(groups[1].tabs).to.deep.equal([]);
      expect(moves).to.equal(0);
      if (!current) expect(visible).to.equal(false);
    } finally { dispose(); }
  });

  it('still cancels source movement when a newer request supersedes selection', async () => {
    await layout.updateLearnerReadingWidth(390);
    await layout.openStudentFile(source, { preview: false });
    let current = true;
    onOpen = () => { current = false; };
    await layout.updateLearnerReadingWidth(1100, () => current, () => current);
    expect(groups[0].tabs).to.deep.equal([dirtyInput, unrelated]);
    expect(groups[1].tabs).to.deep.equal([]);
    expect(moves).to.equal(0);
  });

  it('does not let an obsolete reading pane resize a newer tab or normalize a richer layout', async () => {
    let current = true;
    const older = layout.updateLearnerReadingWidth(1000, () => current);
    current = false;
    await older;
    expect(layouts).to.deep.equal([]);
    await layout.updateLearnerReadingWidth(0);
    await layout.updateLearnerReadingWidth(-30);
    expect(layouts).to.deep.equal([]);
    groups.push({ viewColumn: 2, tabs: [] });
    nativeLayout = { orientation: 1, groups: [{}, {}] };
    await layout.updateLearnerReadingWidth(162);
    expect(groups).to.have.length(2);
    expect(layouts).to.deep.equal([]);
    nativeLayout = { orientation: 0, groups: [{ groups: [{}] }, {}] };
    await layout.updateLearnerReadingWidth(162);
    expect(groups).to.have.length(2);
    expect(layouts).to.deep.equal([]);
    groups.push({ viewColumn: 3, tabs: [] });
    nativeLayout = { orientation: 0, groups: [{}, {}, {}] };
    await layout.updateLearnerReadingWidth(162);
    expect(groups).to.have.length(3);
    expect(layouts).to.deep.equal([]);
  });
  it('keeps an existing dirty source in group three when the layout is unmanaged', async () => {
    await layout.updateLearnerReadingWidth(390);
    groups = [{ viewColumn: 1, tabs: [unrelated] }, { viewColumn: 2, tabs: [] }, { viewColumn: 3, tabs: [dirtyInput] }];
    nativeLayout = { orientation: 0, groups: [{}, {}, {}] };
    await layout.updateLearnerReadingWidth(162);
    await layout.openStudentFile(source, { preview: false });
    expect(groups[2].tabs).to.deep.equal([dirtyInput]);
    expect(groups[2].tabs[0]).to.equal(dirtyInput);
    expect(groups[0].tabs).to.deep.equal([unrelated]);
    expect(moves).to.equal(0);
    expect(dirtyInput.isDirty).to.equal(true);
    expect(dirtyInput.buffer).to.equal('unsaved learner solution');
    expect(layouts).to.deep.equal([]);
  });

  it('cancels an older file command waiting for layout after a newer navigation request', async () => {
    const { beginMarkdownPreviewRequest } = require('../../src/ui/webviews/markdownPreview');
    layout.setStudentNavigationInvalidator(beginMarkdownPreviewRequest);
    const originalRegister = commands.registerCommand;
    const hostExecute = commands.executeCommand;
    let openStudent!: (uri: any) => Promise<void>;
    let release!: (value: any) => void;
    let started!: () => void;
    const layoutStarted = new Promise<void>(resolve => { started = resolve; });
    let opens = 0;
    (commands as any).executeCommand = async (command: string, ...args: any[]) => {
      if (command === 'vscode.getEditorLayout') {
        started(); return new Promise(resolve => { release = resolve; });
      }
      if (command === 'vscode.open') opens++;
      return hostExecute(command, ...args);
    };
    (commands as any).registerCommand = (id: string, handler: any) => {
      if (id === 'computor.student.openFile') openStudent = handler;
      return { dispose() {} };
    };
    try {
      registerEditorLayout({ subscriptions: [] } as any);
      const resizing = layout.updateLearnerReadingWidth(390);
      await layoutStarted;
      const older = openStudent(source);
      beginMarkdownPreviewRequest();
      release(nativeLayout);
      await Promise.all([resizing, older]);
      expect(opens).to.equal(0);
      expect(groups[0].tabs).to.deep.equal([dirtyInput, unrelated]);
    } finally {
      (commands as any).registerCommand = originalRegister;
    }
  });

});
