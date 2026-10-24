import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import { runInNewContext } from 'vm';
import { commands, webviewPanels, window, env } from '../helpers/vscode-stub';
import { createStudentDescriptionSelectionHandler, registerContentDescription, PREVIEW_STUDENT_DESCRIPTION_COMMAND, setDescriptionLanguageResolver } from '../../src/ui/contentDescription';
import { isRestoringSelection, suppressSelectionSideEffects } from '../../src/ui/treeRestore';
import { StudentCourseContentTreeProvider } from '../../src/ui/tree/student/StudentCourseContentTreeProvider';
import { beginMarkdownPreviewRequest, showMarkdownTextPreview } from '../../src/ui/webviews/markdownPreview';

describe('student unit description selection', () => {
  const context = { extensionUri: vscode.Uri.file(path.resolve(__dirname, '../..')) } as vscode.ExtensionContext;
  const originalCreate = window.createWebviewPanel;
  const originalExecute = commands.executeCommand;
  let created: any[][];
  let revealed: any[][];
  let select: ReturnType<typeof createStudentDescriptionSelectionHandler>;

  function unit(title: string, description = `# ${title} instructions`) {
    return { contextValue: 'studentCourseUnit.hasDescription', descriptionTitle: title, descriptionMarkdown: description };
  }

  before(async () => {
    // Other tree-restore tests leave the shared production suppression window
    // active. Begin these user-navigation checks after that window expires.
    if (isRestoringSelection()) await new Promise(resolve => setTimeout(resolve, 1550));
  });

  beforeEach(() => {
    for (const panel of webviewPanels) panel.dispose();
    webviewPanels.length = 0;
    created = [];
    revealed = [];
    select = createStudentDescriptionSelectionHandler(context);
    (window as any).tabGroups = { all: [{}, {}] };
    (window as any).createWebviewPanel = (...args: any[]) => {
      created.push(args);
      const panel = originalCreate(args[0], args[1], args[2], args[3]);
      (panel as any).reveal = (...options: any[]) => { revealed.push(options); };
      return panel;
    };
  });

  afterEach(() => {
    for (const panel of webviewPanels) panel.dispose();
    webviewPanels.length = 0;
    (window as any).createWebviewPanel = originalCreate;
    (commands as any).executeCommand = originalExecute;
    delete (window as any).tabGroups;
    env.uiKind = vscode.UIKind.Desktop;
  });

  it('opens a selected unit beside source code while leaving focus in the tree', async () => {
    await select(unit('A'));
    expect(created).to.have.length(1);
    expect(created[0]![2]).to.deep.equal({ viewColumn: vscode.ViewColumn.Two, preserveFocus: true });
    expect(webviewPanels[0]!.webview.html).to.contain('# A instructions');
  });

  function welcomeUnit() {
    return { ...unit('Willkommen'), courseContent: {
      id: 'welcome', path: 'welcome', title: 'Willkommen',
      course_content_kind_id: 'unit', description: '# Willkommen'
    } as any };
  }

  it('opens the course welcome in the source group without creating a split', async () => {
    (window as any).tabGroups = { all: [{}] };
    const layoutCommands: string[] = [];
    (commands as any).executeCommand = async (command: string) => { layoutCommands.push(command); };
    await select(welcomeUnit());
    expect(created[0]![2]).to.deep.equal({ viewColumn: vscode.ViewColumn.One, preserveFocus: true });
    expect(layoutCommands).not.to.include('vscode.setEditorLayout');
    await select(unit('Week 1'));
    expect(revealed).to.deep.equal([[vscode.ViewColumn.Two, true]]);
  });

  it('uses the same welcome placement from the explicit description command', async () => {
    const originalRegister = commands.registerCommand;
    let show: ((item: any) => Promise<void>) | undefined;
    (commands as any).registerCommand = (_id: string, handler: typeof show) => {
      show = handler;
      return { dispose() {} };
    };
    try {
      registerContentDescription({ ...context, subscriptions: [] });
      await show!(welcomeUnit());
      expect(created[0]![2]).to.equal(vscode.ViewColumn.One);
    } finally {
      (commands as any).registerCommand = originalRegister;
    }
  });

  it('keeps hosted student reading in the source group with other tabs present', async () => {
    env.uiKind = vscode.UIKind.Web;
    await select(unit('Week 1'));
    expect(created[0]![2]).to.deep.equal({ viewColumn: vscode.ViewColumn.One, preserveFocus: true });
  });

  it('leaves generic web previews and explicit side previews in the auxiliary group', async () => {
    env.uiKind = vscode.UIKind.Web;
    await showMarkdownTextPreview(context, '# Help', 'Help');
    expect(created[0]![2]).to.equal(vscode.ViewColumn.Two);
    await showMarkdownTextPreview(context, '# Task', 'Task', { studentReading: true, viewColumn: vscode.ViewColumn.Two });
    expect(revealed).to.deep.equal([[vscode.ViewColumn.Two, true]]);
  });

  it('closes only an obsolete empty auxiliary group for hosted student reading', async () => {
    env.uiKind = vscode.UIKind.Web;
    const source = { viewColumn: vscode.ViewColumn.One, tabs: [{ label: 'mathc.py' }] };
    const auxiliary = { viewColumn: vscode.ViewColumn.Two, tabs: [] };
    const closed: unknown[] = [];
    (window as any).tabGroups = { all: [source, auxiliary], close: async (group: unknown, preserveFocus: boolean) => {
      closed.push([group, preserveFocus]); return true;
    } };
    await select(unit('Week 1'));
    expect(closed).to.deep.equal([[auxiliary, true]]);
    expect(source.tabs).to.deep.equal([{ label: 'mathc.py' }]);
    closed.length = 0;
    auxiliary.tabs = [{ label: 'Figure' }] as any;
    await select(unit('Week 2'));
    expect(closed).to.deep.equal([]);
  });

  it('waits for a reused preview to move before closing its old empty group', async () => {
    env.uiKind = vscode.UIKind.Web;
    await showMarkdownTextPreview(context, '# Help', 'Help');
    const panel = webviewPanels[0]!;
    let moved: (() => void) | undefined;
    panel.onDidChangeViewState = (listener: any) => { moved = listener; return { dispose() {} }; };
    const closed: unknown[] = [];
    const auxiliary = { viewColumn: vscode.ViewColumn.Two, tabs: [] };
    (window as any).tabGroups = { all: [{ viewColumn: vscode.ViewColumn.One, tabs: [] }, auxiliary],
      close: async (group: unknown) => { closed.push(group); return true; } };
    await select(unit('Week 1'));
    expect(closed).to.deep.equal([]);
    panel.viewColumn = vscode.ViewColumn.One;
    moved!();
    await Promise.resolve();
    expect(closed).to.deep.equal([auxiliary]);
  });

  it('waits for lagging tab state and disposes cleanup listeners after the auxiliary group empties', async () => {
    env.uiKind = vscode.UIKind.Web;
    const auxiliary = { viewColumn: vscode.ViewColumn.Two, tabs: [{ label: 'old preview' }] };
    const closed: unknown[] = [];
    let changed: (() => void) | undefined;
    let disposed = 0;
    (window as any).tabGroups = { all: [{ viewColumn: vscode.ViewColumn.One, tabs: [] }, auxiliary],
      close: async (group: unknown) => { closed.push(group); return true; },
      onDidChangeTabs: (listener: () => void) => { changed = listener; return { dispose() { disposed++; } }; },
      onDidChangeTabGroups: () => ({ dispose() { disposed++; } }) };
    await select(unit('Week 1'));
    expect(closed).to.deep.equal([]);
    auxiliary.tabs = [];
    changed!();
    await Promise.resolve();
    expect(closed).to.deep.equal([auxiliary]);
    expect(disposed).to.equal(2);
    auxiliary.tabs = [{ label: 'old preview' }];
    await select(unit('Week 2'));
    beginMarkdownPreviewRequest();
    expect(disposed).to.equal(4);
  });

  it('starts a different reading document at the top without resetting the same document', async () => {
    async function render(markdown: string, title: string, fragment?: string) {
      await showMarkdownTextPreview(context, markdown, title, { viewColumn: vscode.ViewColumn.One, fragment });
      const html = webviewPanels[0]!.webview.html;
      const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)![1]!;
      let scrollY = 0;
      const frames: Array<() => void> = [];
      // The native webview bootstrap restores the previous frame's Y on load
      // when the new document has not already scrolled to a fragment.
      const loads: Array<() => void> = [() => { if (scrollY === 0) scrollY = 700; }];
      const element = { innerHTML: '', querySelectorAll: () => [], addEventListener() {} };
      runInNewContext(script, {
        acquireVsCodeApi: () => ({}),
        requestAnimationFrame: (callback: () => void) => frames.push(callback),
        document: { getElementById: () => element },
        window: { __INITIAL_STATE__: { markdown, fragment },
          ComputorWebview: { renderMarkdown: (text: string) => text, scrollToFragment: () => { scrollY = 350; } },
          scrollTo: (_x: number, y: number) => { scrollY = y; },
          addEventListener: (name: string, callback: () => void) => { if (name === 'load') loads.push(callback); } }
      });
      loads.forEach(callback => callback());
      frames.forEach(callback => callback());
      return scrollY;
    }
    await render('# Welcome', 'Welcome');
    expect(await render('# First exercise', 'Exercise')).to.equal(0);
    expect(await render('# First exercise', 'Exercise')).to.equal(700);
    expect(await render('# Another exercise', 'Another', 'part')).to.equal(350);
    expect(webviewPanels).to.have.length(1);
  });

  it('fits fully visible frame resizes in the same hosted reading document', async () => {
    env.uiKind = vscode.UIKind.Web;
    await showMarkdownTextPreview(context, '# Same document', 'Reading', { studentReading: true });
    const html = webviewPanels[0]!.webview.html;
    const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)![1]!;
    let width = 162;
    let resized: (() => void) | undefined;
    let pagehide: (() => void) | undefined;
    let disconnected = 0;
    const body = { style: {} as Record<string, string>, classList: { add() {} }, appendChild() {} };
    const sentinel = { style: {}, setAttribute() {} };
    const element = { innerHTML: '', querySelectorAll: () => [], addEventListener() {} };
    class IntersectionObserver {
      constructor(private notify: (entries: unknown[]) => void) {}
      observe() { this.notify([{ intersectionRect: { width }, intersectionRatio: 1 }]); }
      unobserve() {}
      disconnect() { disconnected++; }
    }
    class ResizeObserver {
      constructor(notify: () => void) { resized = notify; }
      observe() {}
      disconnect() { disconnected++; }
    }
    runInNewContext(script, { IntersectionObserver, ResizeObserver,
      acquireVsCodeApi: () => ({}), document: { body, createElement: () => sentinel, getElementById: () => element },
      window: { __INITIAL_STATE__: { markdown: '# Same document' }, ComputorWebview: { renderMarkdown: (text: string) => text },
        addEventListener: (_name: string, listener: () => void) => { pagehide = listener; } } });
    expect(body.style.maxWidth).to.equal('162px');
    width = 1212;
    resized?.();
    expect(body.style.maxWidth).to.equal('1212px');
    width = 162;
    resized?.();
    expect(body.style.maxWidth).to.equal('162px');
    expect(element.innerHTML).to.equal('# Same document');
    pagehide!();
    expect(disconnected).to.equal(2);
  });

  it('shows a unit description in the reading language', async () => {
    setDescriptionLanguageResolver(async () => 'en');
    try {
      await select(unit('Willkommen', '<!-- lang: de -->\nHallo du\n<!-- lang: en -->\nHello you'));
    } finally {
      setDescriptionLanguageResolver(undefined);
    }
    expect(webviewPanels[0]!.webview.html).to.contain('Hello you');
    expect(webviewPanels[0]!.webview.html).to.not.contain('Hallo du');
  });

  it('reuses one preview for successive keyboard selections', async () => {
    await select(unit('A'));
    await select(unit('B'));
    expect(created).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('B');
    expect(webviewPanels[0]!.webview.html).to.contain('# B instructions');
    expect(webviewPanels[0]!.webview.html).not.to.contain('# A instructions');
    expect(revealed).to.deep.equal([[vscode.ViewColumn.Two, true]]);
  });

  it('reopens a closed preview on an explicit click of the already-selected unit', async () => {
    const item = unit('A');
    await select(item);
    webviewPanels[0]!.dispose();
    await select(item, true);
    expect(created).to.have.length(2);
    expect(webviewPanels[1]!.title).to.equal('A');
    expect(webviewPanels[1]!.disposed).to.equal(false);
  });

  it('leaves empty units, other rows and cleared selections navigable without UI commands', async () => {
    await select(unit('Empty', '  \n '));
    await select({ ...unit('Assignment'), contextValue: 'studentCourseContent.assignment' });
    await select(undefined);
    expect(created).to.deep.equal([]);
  });

  it('does not replay a restored highlight, but an explicit title click still works', async () => {
    await suppressSelectionSideEffects(async () => {
      await select(unit('A'));
      expect(created).to.deep.equal([]);
      await select(unit('A'), true);
      expect(created).to.have.length(1);
    });
    // Let the production suppression window expire before unrelated tests run.
    await new Promise(resolve => setTimeout(resolve, 1550));
  });

  function deferLayouts(): Array<() => void> {
    (window as any).tabGroups = { all: [{}] };
    const pending: Array<() => void> = [];
    (commands as any).executeCommand = async (command: string) => {
      expect(command).to.equal('vscode.setEditorLayout');
      await new Promise<void>(resolve => pending.push(resolve));
    };
    return pending;
  }

  it('does not let a slow earlier layout overwrite the latest unit', async () => {
    const pending = deferLayouts();
    const first = select(unit('A'), true);
    const latest = select(unit('B'));
    expect(pending).to.have.length(2);
    pending[1]!();
    await latest;
    pending[0]!();
    await first;
    expect(created).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('B');
  });

  it('cancels a pending title preview when selection moves to an empty unit', async () => {
    const pending = deferLayouts();
    const first = select(unit('A'), true);
    await select(unit('Empty', ''));
    pending[0]!();
    await first;
    expect(created).to.deep.equal([]);
  });

  it('does not overwrite a newer explicit description with a pending selection', async () => {
    const pending = deferLayouts();
    const first = select(unit('A'));
    (window as any).tabGroups = { all: [{}, {}] };
    await showMarkdownTextPreview(context, '# Explicit README', 'README');
    pending[0]!();
    await first;
    expect(created).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('README');
  });

  it('gives described unit titles an explicit reopen command and leaves empty units alone', () => {
    const tree = new StudentCourseContentTreeProvider({} as any, {} as any);
    const root = { children: new Map(['A', 'Empty'].map(name => [name, {
      name, isUnit: true, children: new Map(),
      courseContent: { id: name, title: name, description: name === 'A' ? '# A instructions' : ' ' }
    }])) };
    const items = (tree as any).createTreeItems(root);
    const described = items.find((item: any) => item.id === 'A');
    const empty = items.find((item: any) => item.id === 'Empty');
    expect(described.command.command).to.equal(PREVIEW_STUDENT_DESCRIPTION_COMMAND);
    expect(described.command.arguments).to.deep.equal([described]);
    expect(empty.command).to.equal(undefined);
  });

  it('gives exercise titles the same reopen command without loading their files', () => {
    const tree = new StudentCourseContentTreeProvider({} as any, {} as any);
    const root = { children: new Map([['Exercise', {
      isUnit: false, children: new Map(),
      courseContent: { id: 'exercise', title: 'Exercise', path: 'unit.exercise' },
      contentType: { course_content_kind_id: 'assignment' }
    }]]) };
    const [exercise] = (tree as any).createTreeItems(root);
    expect(exercise.command.command).to.equal(PREVIEW_STUDENT_DESCRIPTION_COMMAND);
    expect(exercise.command.arguments).to.deep.equal([exercise]);
    expect(exercise.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
  });

  it('shares concurrent title/selection work and permits an explicit exercise reopen afterwards', async () => {
    let finish!: () => void;
    let loads = 0;
    select = createStudentDescriptionSelectionHandler(context, async (_item, options) => {
      loads++;
      if (loads === 1) await new Promise<void>(resolve => { finish = resolve; });
      await showMarkdownTextPreview(context, '# Exercise instructions', 'Exercise', options);
    });
    const exercise = { contextValue: 'studentCourseContent.assignment', courseContent: { id: 'exercise' } };
    const first = select(exercise);
    const duplicate = select(exercise, true);
    expect(loads).to.equal(1);
    finish();
    await Promise.all([first, duplicate]);
    webviewPanels[0]!.dispose();
    await select(exercise, true);
    expect(loads).to.equal(2);
    expect(webviewPanels[1]!.title).to.equal('Exercise');
  });

  it('keeps the latest unit when an earlier exercise download completes late', async () => {
    let finish!: () => void;
    select = createStudentDescriptionSelectionHandler(context, async (_item, options) => {
      await new Promise<void>(resolve => { finish = resolve; });
      await showMarkdownTextPreview(context, '# Old exercise', 'Exercise', options);
    });
    const first = select({ contextValue: 'studentCourseContent.assignment', courseContent: { id: 'exercise' } });
    await select(unit('B'));
    finish();
    await first;
    expect(created).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('B');
  });

  it('does not let a stale exercise cancel the latest unit while its layout is pending', async () => {
    let finish!: () => void;
    select = createStudentDescriptionSelectionHandler(context, async (_item, options) => {
      await new Promise<void>(resolve => { finish = resolve; });
      await showMarkdownTextPreview(context, '# Old exercise', 'Exercise', options);
    });
    const first = select({ contextValue: 'studentCourseContent.assignment', courseContent: { id: 'exercise' } });
    const pending = deferLayouts();
    const latest = select(unit('B'));
    finish();
    await first;
    pending[0]!();
    await latest;
    expect(created).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('B');
  });
});
