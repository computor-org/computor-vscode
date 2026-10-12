import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import { commands, webviewPanels, window } from '../helpers/vscode-stub';
import { createStudentDescriptionSelectionHandler, PREVIEW_STUDENT_DESCRIPTION_COMMAND } from '../../src/ui/contentDescription';
import { isRestoringSelection, suppressSelectionSideEffects } from '../../src/ui/treeRestore';
import { StudentCourseContentTreeProvider } from '../../src/ui/tree/student/StudentCourseContentTreeProvider';
import { showMarkdownTextPreview } from '../../src/ui/webviews/markdownPreview';

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
  });

  it('opens a selected unit beside source code while leaving focus in the tree', async () => {
    await select(unit('A'));
    expect(created).to.have.length(1);
    expect(created[0]![2]).to.deep.equal({ viewColumn: vscode.ViewColumn.Two, preserveFocus: true });
    expect(webviewPanels[0]!.webview.html).to.contain('# A instructions');
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
