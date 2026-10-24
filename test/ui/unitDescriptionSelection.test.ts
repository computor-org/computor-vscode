import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import { runInNewContext } from 'vm';
import { commands, webviewPanels, window, env } from '../helpers/vscode-stub';
import { createStudentDescriptionSelectionHandler, setDescriptionLanguageResolver } from '../../src/ui/contentDescription';
import { showMarkdownTextPreview } from '../../src/ui/webviews/markdownPreview';
import { registerCourseWelcome, showWorkspaceCourseLanding, showWorkspaceCourseUnit } from '../../src/services/WorkspaceCourseLanding';

describe('student unit description selection', () => {
  const context = { subscriptions: [], extensionUri: vscode.Uri.file(path.resolve(__dirname, '../..')) } as unknown as vscode.ExtensionContext;
  const originalExecute = commands.executeCommand;
  const closePanels = () => { webviewPanels.forEach(panel => panel.dispose()); webviewPanels.length = 0; };
  const unit = (title: string, description = `# ${title} instructions`) => ({
    contextValue: 'studentCourseUnit.hasDescription', descriptionTitle: title, descriptionMarkdown: description
  });
  beforeEach(() => { closePanels(); (window as any).tabGroups = { all: [{}, {}] }; });
  afterEach(() => { closePanels(); (commands as any).executeCommand = originalExecute;
    delete (window as any).tabGroups; env.uiKind = vscode.UIKind.Desktop; setDescriptionLanguageResolver(undefined); });

  it('leaves an in-flight task untouched when a week is selected or expanded', async () => {
    let finish!: () => void;
    const select = createStudentDescriptionSelectionHandler(context, async (_item, options) => {
      await new Promise<void>(resolve => { finish = resolve; });
      await showMarkdownTextPreview(context, '# Exact task', 'Task', options);
    });
    const task = select({ contextValue: 'studentCourseContent.assignment' }, true);
    await select(unit('Week 1'));
    finish(); await task;
    expect(webviewPanels).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('Task');
  });

  it('keeps the authored Welcome tab when tasks change and reuses it for manual recovery', async () => {
    const welcome = { id: 'w', course_id: 'c', path: 'welcome', title: 'Welcome',
      course_content_kind_id: 'unit', description: '# Authored Welcome' } as any;
    const api = { getStudentCourseContents: async () => [welcome], getUserAccount: async () => ({ profile: { language_code: 'en' } }) } as any;
    await showWorkspaceCourseLanding(context, api, { id: 'c', path: 'c' } as any);
    const welcomePanel = webviewPanels[0]!;
    await showMarkdownTextPreview(context, '# First task', 'First', { studentReading: true });
    await showMarkdownTextPreview(context, '# Second task', 'Second', { studentReading: true });
    expect(webviewPanels).to.have.length(2);
    expect(welcomePanel.webview.html).to.contain('# Authored Welcome');
    expect(webviewPanels[1]!.webview.html).to.contain('# Second task');
    await showWorkspaceCourseUnit(context, api, welcome);
    expect(webviewPanels).to.have.length(2);
    expect(welcomePanel.disposed).to.equal(false);
    expect(welcomePanel.viewColumn).to.equal(vscode.ViewColumn.One);
    expect(webviewPanels[1]!.title).to.equal('Second');
    welcomePanel.dispose();
    await showWorkspaceCourseUnit(context, api, welcome);
    expect(webviewPanels.at(-1)!.webview.html).to.contain('# Authored Welcome');
  });

  it('uses the resolved exact Welcome ID for explicit description recovery', async () => {
    const welcome = { id: 'actual', course_id: 'c', path: 'welcome', title: 'Welcome', course_content_kind_id: 'unit', description: '# Welcome' } as any;
    registerCourseWelcome([welcome]);
    const select = createStudentDescriptionSelectionHandler(context);
    await select({ ...unit('Welcome'), node: { courseContent: welcome } }, true);
    await select(unit('Week 1'), true);
    expect(webviewPanels).to.have.length(2);
    expect(webviewPanels[0]!.title).to.equal('Welcome');
    expect(webviewPanels[1]!.title).to.equal('Week 1');
  });

  it('lets a newer explicit description beat a slow localized unit without hiding Welcome', async () => {
    let finish!: (language: string) => void;
    setDescriptionLanguageResolver(() => new Promise(resolve => { finish = resolve; }));
    const select = createStudentDescriptionSelectionHandler(context);
    const older = select(unit('Older'), true);
    await showMarkdownTextPreview(context, '# Newer task', 'Newer', { studentReading: true });
    finish('en'); await older;
    expect(webviewPanels).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('Newer');
  });

  it('retains the native side-preview placement for explicit and nonlearner previews', async () => {
    await showMarkdownTextPreview(context, '# Help', 'Help');
    expect(webviewPanels[0]!.viewColumn).to.equal(vscode.ViewColumn.Two);
    const reveals: unknown[] = [];
    webviewPanels[0]!.reveal = ((...args: unknown[]) => { reveals.push(args); }) as any;
    await showMarkdownTextPreview(context, '# Task', 'Task', { studentReading: true, viewColumn: vscode.ViewColumn.Two });
    expect(reveals).to.deep.equal([[vscode.ViewColumn.Two, true]]);
  });

  it('ignores hidden or superseded frame geometry while a visible reading tab responds without code focus', async () => {
    const group = { viewColumn: 1, tabs: [] };
    (window as any).tabGroups = { all: [group] };
    let splits = 0;
    (commands as any).executeCommand = async (command: string, layout?: any) => {
      if (command === 'vscode.getEditorLayout') return { orientation: 0, groups: [{}] };
      if (command === 'vscode.setEditorLayout') { splits++; (window as any).tabGroups.all = layout.groups.map((_: unknown, i: number) => ({ viewColumn: i + 1, tabs: [] })); }
      return undefined;
    };
    await showMarkdownTextPreview(context, '# Welcome', 'Welcome', { studentReading: true, welcomeContentId: 'w' });
    const welcome = webviewPanels[0]!;
    Object.assign(welcome, { visible: false, active: false });
    await showMarkdownTextPreview(context, '# Task', 'Task', { studentReading: true });
    const task = webviewPanels[1]!;
    Object.assign(task, { visible: true, active: false }); // Python owns keyboard focus.
    welcome.fireMessage({ command: 'readingWidth', width: 1000, generation: 1 });
    await new Promise(resolve => setImmediate(resolve));
    expect(splits).to.equal(0);
    await showMarkdownTextPreview(context, '# New task', 'New task', { studentReading: true });
    task.fireMessage({ command: 'readingWidth', width: 1000, generation: 1 }); // old HTML frame
    await new Promise(resolve => setImmediate(resolve));
    expect(splits).to.equal(0);
    task.fireMessage({ command: 'readingWidth', width: 1000, generation: 2 });
    await new Promise(resolve => setImmediate(resolve));
    expect(splits).to.equal(1);
  });

  it('shares one pending assignment action between selection and its row command', async () => {
    let finish!: () => void;
    let opens = 0;
    const select = createStudentDescriptionSelectionHandler(context, async (_item, options) => {
      opens++;
      await new Promise<void>(resolve => { finish = resolve; });
      await showMarkdownTextPreview(context, '# Task', 'Task', options);
    });
    const row = { contextValue: 'studentCourseContent.assignment' };
    const selected = select(row);
    const clicked = select(row, true);
    expect(opens).to.equal(1);
    finish(); await Promise.all([selected, clicked]);
    expect(webviewPanels).to.have.length(1);
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
        acquireVsCodeApi: () => ({ postMessage() {} }),
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
      acquireVsCodeApi: () => ({ postMessage() {} }), document: { body, createElement: () => sentinel, getElementById: () => element },
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

});
