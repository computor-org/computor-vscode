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

/** Native inputs and webview panels move without replacing dirty buffers. */
describe('learner responsive editor layout', () => {
  const vscode = require('../helpers/vscode-stub');
  const layout = require('../../src/ui/editorLayout');
  const preview = require('../../src/ui/webviews/markdownPreview');
  const originalExecute = commands.executeCommand;
  let groups: any[];
  let nativeLayout: any;
  let layouts: number[];
  let activeGroup: any;
  let selected: any[];
  let onSplit: (() => void) | undefined;
  let onReveal: ((stage: string) => void) | undefined;
  let opens: number;
  let reveals: number;
  let nativeMoves: number;
  let deferViewState: boolean;
  const pendingViewStates: Array<() => void> = [];
  const textSelections = new Set<(editor: any) => void>();
  const originalTextSelection = vscode.window.onDidChangeActiveTextEditor;
  const source = Uri.file('/exact/task/main.py');
  const dirtyInput = { input: { uri: source }, isDirty: true, buffer: 'unsaved learner solution' };
  const unrelated = { input: { uri: Uri.file('/notes/own.py') }, isDirty: true };
  const panels: any[] = [];
  const originalCreatePanel = vscode.window.createWebviewPanel;
  const viewStates = new Map<any, Set<(event: any) => void>>();

  beforeEach(async () => {
    groups = [{ viewColumn: 1, tabs: [dirtyInput, unrelated] }];
    nativeLayout = { orientation: 1, groups: [{}] };
    layouts = []; opens = 0; reveals = 0; nativeMoves = 0; deferViewState = false;
    vscode.window.onDidChangeActiveTextEditor = (callback: any) => {
      textSelections.add(callback); return { dispose: () => textSelections.delete(callback) };
    }; onSplit = undefined; onReveal = undefined;
    activeGroup = groups[0]; selected = [dirtyInput, unrelated];
    vscode.window.createWebviewPanel = (...args: any[]) => {
      const panel = originalCreatePanel(...args);
      const subscribe = panel.onDidChangeViewState;
      panel.onDidChangeViewState = (callback: any) => {
        const listeners = viewStates.get(panel) ?? new Set<any>();
        listeners.add(callback); viewStates.set(panel, listeners);
        const subscription = subscribe(callback);
        return { dispose: () => { listeners.delete(callback); subscription.dispose(); } };
      };
      return panel;
    };
    vscode.window.tabGroups = { get all() { return groups; }, close: () => { throw new Error('must not close tabs'); } };
    (commands as any).executeCommand = async (command: string, ...args: any[]) => {
      if (command === 'vscode.getEditorLayout') return nativeLayout;
      if (command === 'vscode.setEditorLayout') {
        nativeLayout = args[0]; layouts.push(nativeLayout.groups.length);
        if (nativeLayout.groups.length === 1) {
          groups[0].tabs.push(...groups[1].tabs); groups = [groups[0]];
          panels.forEach(panel => { panel.viewColumn = 1; });
        } else { groups.push({ viewColumn: 2, tabs: [] }); onSplit?.(); }
      } else if (command === 'vscode.open') {
        opens++;
        const [uri, options] = args;
        activeGroup = groups.find(group => group.viewColumn === options.viewColumn);
        let tab = activeGroup.tabs.find((item: any) => item.input.uri?.toString() === uri.toString());
        if (!tab) { tab = { input: { uri } }; activeGroup.tabs.push(tab); }
        selected = [tab];
      } else if (command === 'moveActiveEditor') {
        nativeMoves++;
        const target = groups[args[0].value - 1];
        for (const tab of selected) {
          activeGroup.tabs.splice(activeGroup.tabs.indexOf(tab), 1); target.tabs.push(tab);
          if (tab.input.panel) { tab.pinned = true; tab.input.panel.viewColumn = target.viewColumn; }
        }
        activeGroup = target;
        onReveal?.('move');
      } else throw new Error(`unexpected command ${command}`);
    };
    await layout.updateLearnerReadingWidth(390);
    await layout.openStudentFile(source, { preview: false });
  });
  afterEach(() => {
    panels.splice(0).forEach(panel => panel.dispose());
    vscode.window.createWebviewPanel = originalCreatePanel;
    viewStates.clear(); pendingViewStates.length = 0; textSelections.clear();
    vscode.window.onDidChangeActiveTextEditor = originalTextSelection;
    (commands as any).executeCommand = originalExecute;
    delete vscode.window.tabGroups;
  });

  async function reading(title: string, welcome = false): Promise<any> {
    await preview.showMarkdownTextPreview({ subscriptions: [], extensionUri: Uri.file(process.cwd()) }, `# ${title}`, title,
      { studentReading: true, ...(welcome ? { welcomeContentId: 'welcome' } : {}) });
    const panel = vscode.webviewPanels[vscode.webviewPanels.length - 1];
    const tab = { input: { panel }, pinned: true };
    groups[panel.viewColumn - 1].tabs.push(tab);
    panels.push(panel);
    Object.assign(panel, { active: !welcome, visible: true });
    panel.reveal = (column: number = panel.viewColumn, preserveFocus = false) => {
      reveals++;
      onReveal?.('open');
      panel.visible = false; // native selection may temporarily hide the reporting panel
      const old = groups.find(group => group.tabs.includes(tab));
      if (old !== groups[column - 1]) {
        const replaced = groups[column - 1].tabs.find((other: any) => other.pinned === false);
        if (replaced) {
          groups[column - 1].tabs.splice(groups[column - 1].tabs.indexOf(replaced), 1);
          replaced.input.panel?.dispose();
        }
        tab.pinned = false; // reveal opens in the destination without pinned:true
      }
      old.tabs.splice(old.tabs.indexOf(tab), 1);
      groups[column - 1].tabs.push(tab);
      panel.viewColumn = column;
      selected = [tab]; // selecting one exact panel clears native multi-selection
      panel.visible = true;
      if (!preserveFocus) activeGroup = groups[column - 1];
      // Native preserveFocus keeps group focus, but still selects its new tab.
      const active = activeGroup === groups[column - 1];
      for (const other of panels) {
        if (other === panel || (active && other.active)) {
          other.active = other === panel && active;
          const notify = () => viewStates.get(other)?.forEach(listener => listener({ webviewPanel: other }));
          if (deferViewState) pendingViewStates.push(notify); else notify();
        }
      }
      if (old !== groups[column - 1]) onReveal?.('move');
    };
    return panel;
  }
  function report(panel: any, width: number): Promise<void> {
    panel.fireMessage({ command: 'readingWidth', width, generation: 1 });
    return layout.updateLearnerReadingWidth(0);
  }
  function expectPlacement(welcome: any, readme: any): void {
    expect(groups[0].tabs).to.have.members([dirtyInput, unrelated]);
    expect(groups[0].tabs.find((tab: any) => tab === dirtyInput)).to.equal(dirtyInput);
    expect(welcome.disposed).to.equal(false);
    expect(groups[1].tabs.every((tab: any) => tab.pinned)).to.equal(true);
    expect(groups[1].tabs.map((tab: any) => tab.input.panel)).to.have.members([welcome, readme]);
    expect(welcome.viewColumn).to.equal(2);
    expect(readme.viewColumn).to.equal(2);
    expect(dirtyInput.isDirty).to.equal(true);
    expect(dirtyInput.buffer).to.equal('unsaved learner solution');
  }

  it('keeps both reading inputs right and the same dirty code left across narrow and wide layouts', async () => {
    const welcome = await reading('Welcome', true);
    const readme = await reading('README');
    expect(layouts).to.deep.equal([]); // opening learner reading alone does not split narrow screens
    await report(readme, 1100);
    expectPlacement(welcome, readme);
    const settledOpens = opens;
    const settledReveals = reveals;
    await report(readme, 600);
    expect(opens).to.equal(settledOpens);
    expect(reveals).to.equal(settledReveals);
    await report(readme, 300);
    expect(groups).to.have.length(1);
    expect(groups[0].tabs).to.have.length(4);
    await report(readme, 1100);
    expectPlacement(welcome, readme);
    expect(layouts).to.deep.equal([2, 1, 2]);
  });

  for (const event of ['split', 'split then hidden', 'open', 'move']) for (const width of [600, 700]) {
    it(`converges after an admitted ${width}px event during native ${event}`, async () => {
      const welcome = await reading('Welcome', true);
      const readme = await reading('README');
      await report(readme, 1100);
      await report(readme, 300);
      let observed: Promise<void> | undefined;
      const observe = () => { if (!observed) observed = report(readme, width); };
      if (event.startsWith('split')) onSplit = () => { observe(); if (event === 'split then hidden') readme.visible = false; };
      else onReveal = stage => { if (stage === event) observe(); };
      await report(readme, 1100);
      await observed;
      expectPlacement(welcome, readme);
    });
  }

  it('moves only the known existing dirty source left when adopting a saved simple layout', async () => {
    const welcome = await reading('Welcome', true);
    const readme = await reading('README');
    groups.push({ viewColumn: 2, tabs: [] });
    nativeLayout = { orientation: 0, groups: [{}, {}] };
    groups[0].tabs.splice(groups[0].tabs.indexOf(dirtyInput), 1);
    groups[1].tabs.push(dirtyInput);
    selected = [dirtyInput, unrelated];
    await report(readme, 600);
    expectPlacement(welcome, readme);
    expect(readme.active).to.equal(true);
    expect(welcome.active).to.equal(false);
  });

  it('restores the current right-hand README after moving an inactive left-hand Welcome into its active group', async () => {
    const welcome = await reading('Welcome', true);
    const readme = await reading('README');
    await report(readme, 1100);
    welcome.reveal(1, true);
    expect(readme.active).to.equal(true);
    await report(readme, 600);
    expectPlacement(welcome, readme);
    expect(readme.active).to.equal(true);
    expect(welcome.active).to.equal(false);
  });

  it('rejects queued geometry when the learner selects another existing reading owner', async () => {
    const welcome = await reading('Welcome', true);
    const readme = await reading('README');
    const pending = report(readme, 1100);
    welcome.reveal(1, false);
    await pending;
    expect(groups).to.have.length(1);
    expect(layouts).to.deep.equal([]);
    expect(welcome.active).to.equal(true);
    expect(readme.active).to.equal(false);
    expect(groups[0].tabs).to.include(dirtyInput).and.include(unrelated);
  });

  it('waits for the actual exact-panel selection notification before moving', async () => {
    const welcome = await reading('Welcome', true);
    const readme = await reading('README');
    deferViewState = true;
    let started!: () => void;
    const selecting = new Promise<void>(resolve => { started = resolve; });
    onReveal = stage => { if (stage === 'open') started(); };
    const pending = report(readme, 1100);
    await selecting;
    expect(nativeMoves).to.equal(0);
    deferViewState = false;
    pendingViewStates.splice(0).forEach(notify => notify());
    await pending;
    expectPlacement(welcome, readme);
  });

  it('leaves a fresh workspace showing only the course text in one group instead of splitting off an empty one', async () => {
    groups[0].tabs.splice(0);
    const welcome = await reading('Welcome', true);
    welcome.active = true;
    await report(welcome, 1100);
    expect(layouts).to.deep.equal([]);
    expect(groups).to.have.length(1);
    expect(welcome.viewColumn).to.equal(1);
    expect(nativeMoves).to.equal(0);
    // The next reading still goes to the second column, where code can join it on the left.
    expect(layout.learnerReadingColumn()).to.equal(2);
  });

  it('moves an already-active sole Welcome without waiting for a redundant selection event', async () => {
    const welcome = await reading('Welcome', true);
    welcome.active = true;
    deferViewState = true;
    await report(welcome, 1100);
    expect(welcome.viewColumn).to.equal(2);
    expect(welcome.disposed).to.equal(false);
    expect(groups[1].tabs[0].pinned).to.equal(true);
  });

  it('confirms geometry-only selection cleanup before allowing the queued owner to continue', async () => {
    const welcome = await reading('Welcome', true);
    const readme = await reading('README');
    let observed: Promise<void> | undefined;
    let restoring!: () => void;
    const restorationStarted = new Promise<void>(resolve => { restoring = resolve; });
    onReveal = stage => {
      if (stage !== 'open') return;
      if (!observed) observed = report(readme, 600);
      else if (reveals === 2) { deferViewState = true; restoring(); }
    };
    const pending = report(readme, 1100);
    await restorationStarted;
    expect(nativeMoves).to.equal(0);
    deferViewState = false;
    pendingViewStates.splice(0).forEach(notify => notify());
    await pending;
    await observed;
    expectPlacement(welcome, readme);
  });

  for (const cancellation of ['reading selection', 'source selection', 'disposal', 'missing notification']) {
    it(`releases pending native selection after ${cancellation} without moving or restoring over it`, async () => {
      const welcome = await reading('Welcome', true);
      const readme = await reading('README');
      deferViewState = true;
      let started!: () => void;
      const selecting = new Promise<void>(resolve => { started = resolve; });
      onReveal = stage => { if (stage === 'open') started(); };
      const originalTimeout = global.setTimeout;
      let expire: (() => void) | undefined;
      if (cancellation === 'missing notification') {
        global.setTimeout = ((callback: () => void, delay: number) => {
          if (delay === 1000) { expire = callback; return {} as any; }
          return originalTimeout(callback, delay);
        }) as any;
      }
      try {
        const pending = report(readme, 1100);
        await selecting;
        if (cancellation === 'disposal') welcome.dispose();
        else if (cancellation === 'missing notification') expire!();
        else if (cancellation === 'source selection') textSelections.forEach(notify => notify({ document: { uri: source } }));
        else {
          readme.active = true;
          viewStates.get(readme)?.forEach(notify => notify({ webviewPanel: readme }));
        }
        await pending;
        expect(nativeMoves).to.equal(0);
        expect(reveals).to.equal(1);
        expect(readme.viewColumn).to.equal(1);
        expect(groups[0].tabs).to.include(dirtyInput).and.include(unrelated);
      } finally { global.setTimeout = originalTimeout; }
    });
  }

  for (const cancellation of ['newer request', 'disposed owner', 'richer layout']) {
    it(`cancels remaining reading moves after ${cancellation}`, async () => {
      const welcome = await reading('Welcome', true);
      const readme = await reading('README');
      let observed: Promise<void> | undefined;
      onReveal = stage => {
        if (stage !== 'move' || observed) return;
        observed = report(readme, 600);
        if (cancellation === 'newer request') preview.beginMarkdownPreviewRequest();
        else if (cancellation === 'disposed owner') readme.dispose();
        else {
          groups.push({ viewColumn: 3, tabs: [] });
          nativeLayout = { orientation: 0, groups: [{}, {}, {}] };
        }
      };
      await report(readme, 1100);
      await observed;
      expect(welcome.disposed).to.equal(false);
      expect(groups[1].tabs.every((tab: any) => tab.pinned)).to.equal(true);
      expect(welcome.viewColumn).to.equal(2);
      expect(readme.viewColumn).to.equal(1);
      expect(groups[0].tabs).to.include(dirtyInput).and.include(unrelated);
    });
  }

  it('ignores hidden, superseded and richer geometry without moving unrelated inputs', async () => {
    const welcome = await reading('Welcome', true);
    const readme = await reading('README');
    readme.visible = false;
    await report(readme, 1100);
    expect(layouts).to.deep.equal([]);
    readme.visible = true;
    const older = layout.updateLearnerReadingWidth(1100, () => false);
    await older;
    for (const richer of [
      { orientation: 1, groups: [{}, {}] },
      { orientation: 0, groups: [{ groups: [{}] }, {}] },
      { orientation: 0, groups: [{}, {}, {}] }
    ]) {
      nativeLayout = richer;
      groups = [{ viewColumn: 1, tabs: [dirtyInput, unrelated] }, ...richer.groups.slice(1).map((_: any, i: number) => ({ viewColumn: i + 2, tabs: [] }))];
      await report(readme, 160);
      expect(layouts).to.deep.equal([]);
      expect(welcome.viewColumn).to.equal(1);
    }
    groups[0].tabs = [unrelated]; groups[2].tabs = [dirtyInput];
    await layout.openStudentFile(source, { preview: false });
    expect(groups[2].tabs[0]).to.equal(dirtyInput);
    expect(groups[0].tabs).to.deep.equal([unrelated]);
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
