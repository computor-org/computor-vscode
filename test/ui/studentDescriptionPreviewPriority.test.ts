import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import JSZip from 'jszip';
import { commands, webviewPanels, window } from '../helpers/vscode-stub';
import { updateLearnerReadingWidth } from '../../src/ui/editorLayout';
import { beginMarkdownPreviewRequest } from '../../src/ui/webviews/markdownPreview';
import { StudentCommands } from '../../src/commands/StudentCommands';
import { createStudentDescriptionSelectionHandler, registerContentDescription, SHOW_DESCRIPTION_COMMAND } from '../../src/ui/contentDescription';

describe('student description preview priority', () => {
  const context = { subscriptions: [], extensionUri: vscode.Uri.file(path.resolve(__dirname, '../..')) } as unknown as vscode.ExtensionContext;
  const originalRegister = commands.registerCommand;
  const originalExecute = commands.executeCommand;
  const originalCreate = window.createWebviewPanel;
  let handlers: Map<string, (...args: any[]) => Promise<void>>;
  let pending: Array<{ id: string; finish: (archive: Buffer) => void }>;
  let student: any;
  let previousDocuments: any;
  let previousActive: any;
  let select: ReturnType<typeof createStudentDescriptionSelectionHandler>;

  const exercise = (id: string) => ({ contextValue: 'studentCourseContent.assignment', courseContent: { id, title: id, path: `unit.${id}` } });
  const book = () => handlers.get(SHOW_DESCRIPTION_COMMAND)!({ descriptionTitle: 'Unit book', descriptionMarkdown: '# Unit instructions' });
  async function archive(title: string): Promise<Buffer> {
    return new JSZip().file('README.md', `# ${title}`).generateAsync({ type: 'nodebuffer' });
  }

  beforeEach(() => {
    for (const panel of webviewPanels) panel.dispose();
    webviewPanels.length = 0;
    (window as any).tabGroups = { all: [{ viewColumn: 1, tabs: [] }, { viewColumn: 2, tabs: [] }] };
    previousDocuments = (vscode.workspace as any).textDocuments;
    previousActive = (window as any).activeTextEditor;
    handlers = new Map();
    pending = [];
    (commands as any).registerCommand = (id: string, handler: (...args: any[]) => Promise<void>) => {
      handlers.set(id, handler);
      return { dispose() {} };
    };
    student = Object.create(StudentCommands.prototype) as any;
    student.context = context;
    student.apiService = {
      downloadStudentCourseContentDescription: (id: string) => new Promise<Buffer>(finish => pending.push({ id, finish })),
      getUserAccount: async () => ({ profile: { language_code: 'en' } })
    };
    student.registerCommands();
    registerContentDescription(context);
    select = createStudentDescriptionSelectionHandler(context,
      (item, options) => student.previewDescription(item, { ...options, silent: true }));
  });

  afterEach(() => {
    for (const panel of webviewPanels) panel.dispose();
    webviewPanels.length = 0;
    (commands as any).registerCommand = originalRegister;
    (commands as any).executeCommand = originalExecute;
    (window as any).createWebviewPanel = originalCreate;
    delete (window as any).tabGroups;
    (vscode.workspace as any).textDocuments = previousDocuments;
    (window as any).activeTextEditor = previousActive;
  });

  it('does not start a launch preview after a newer manual book supersedes its reserved request', async () => {
    const request = beginMarkdownPreviewRequest();
    await book();
    await student.openWorkspaceAssignment(exercise('Requested exercise'), {
      request, sourceFiles: [{ uri: vscode.Uri.file('/workspace/requested/main.py'), type: vscode.FileType.File }]
    });
    expect(pending).to.be.empty;
    expect(webviewPanels[0]!.title).to.equal('Unit book');
  });

  it('keeps a newer explicit unit book after an older automatic exercise ZIP completes', async () => {
    const automatic = select(exercise('Old exercise'), true);
    expect(pending.map(request => request.id)).to.deep.equal(['Old exercise']);
    await book();
    expect(webviewPanels[0]!.title).to.equal('Unit book');
    pending[0]!.finish(await archive('Old exercise instructions'));
    await automatic;
    expect(webviewPanels).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('Unit book');
    expect(webviewPanels[0]!.webview.html).to.contain('# Unit instructions');
    expect(webviewPanels[0]!.webview.html).not.to.contain('Old exercise instructions');
  });

  it('also supersedes an older explicit exercise book while its ZIP is loading', async () => {
    const olderBook = handlers.get('computor.student.showPreview')!(exercise('Old exercise'));
    await book();
    pending[0]!.finish(await archive('Old exercise instructions'));
    await olderBook;
    expect(webviewPanels[0]!.title).to.equal('Unit book');
  });

  it('reserves explicit exercise priority before download so an older automatic preview cannot flash over it', async () => {
    const automatic = select(exercise('Old exercise'), true);
    const explicit = handlers.get('computor.student.showPreview')!(exercise('New exercise'));
    expect(pending.map(request => request.id)).to.deep.equal(['Old exercise', 'New exercise']);
    pending[0]!.finish(await archive('Old exercise instructions'));
    await automatic;
    expect(webviewPanels).to.be.empty;
    pending[1]!.finish(await archive('New exercise instructions'));
    await explicit;
    expect(webviewPanels).to.have.length(1);
    expect(webviewPanels[0]!.title).to.equal('New exercise');
  });

  it('allows a repeated exercise click to supersede a book instead of sharing its canceled old download', async () => {
    const item = exercise('Exercise');
    const older = select(item, true);
    await book();
    const newer = select(item, true);
    expect(pending).to.have.length(2);
    pending[0]!.finish(await archive('Canceled instructions'));
    await older;
    expect(webviewPanels[0]!.title).to.equal('Unit book');
    pending[1]!.finish(await archive('New exercise instructions'));
    await newer;
    expect(webviewPanels[0]!.title).to.equal('Exercise');
    expect(webviewPanels[0]!.webview.html).to.contain('New exercise instructions');
  });
  it('opens the exact native Python child and keeps its unsaved document instead of another starter', async () => {
    const first = vscode.Uri.file('/exact/first.py');
    const dirty = vscode.Uri.file('/exact/working.py');
    const document = { uri: dirty, isDirty: true, getText: () => 'unsaved answer', save: () => { throw new Error('must not save'); } };
    (vscode.workspace as any).textDocuments = [document];
    const tabs: any[] = [];
    let active: any;
    (window as any).tabGroups = { all: [{ viewColumn: 1, tabs }] };
    (commands as any).executeCommand = async () => ({ orientation: 0, groups: [{}] });
    await updateLearnerReadingWidth(390);
    (window as any).createWebviewPanel = (...args: any[]) => {
      const panel = originalCreate(args[0], args[1], args[2], args[3]);
      tabs.push(panel); active = panel;
      panel.reveal = (() => { active = panel; }) as any;
      return panel;
    };
    const opens: any[][] = [];
    (commands as any).executeCommand = async (...args: any[]) => { opens.push(args); tabs.push(document); active = document; };
    const opening = student.openWorkspaceAssignment(exercise('Exact'), { sourceFiles: [
      { resourceUri: first, type: vscode.FileType.File }, { resourceUri: dirty, type: vscode.FileType.File },
      { resourceUri: vscode.Uri.file('/different/README.md'), type: vscode.FileType.File }
    ] });
    pending[0]!.finish(await archive('Exact task README')); await opening;
    expect(webviewPanels[0]!.webview.html).to.contain('Exact task README');
    expect(opens).to.have.length(1);
    expect(opens[0]![0]).to.equal('vscode.open');
    expect(opens[0]![1]).to.equal(dirty);
    expect((vscode.workspace as any).textDocuments[0]).to.equal(document);
    expect(document.getText()).to.equal('unsaved answer');
    expect(tabs).to.deep.equal([webviewPanels[0], document]);
    expect(active).to.equal(webviewPanels[0]);
  });

  it('keeps the already selected exact-task Python file when its saved work has no dirty document', async () => {
    const first = vscode.Uri.file('/exact/first.py');
    const selected = vscode.Uri.file('/exact/chosen.py');
    (vscode.workspace as any).textDocuments = [];
    (window as any).activeTextEditor = { document: { uri: selected } };
    const opens: any[][] = [];
    (commands as any).executeCommand = async (...args: any[]) => { opens.push(args); };
    const opening = student.openWorkspaceAssignment(exercise('Exact'), { sourceFiles: [
      { resourceUri: first, type: vscode.FileType.File }, { resourceUri: selected, type: vscode.FileType.File }
    ] });
    pending[0]!.finish(await archive('Exact task README')); await opening;
    expect(opens[0]![1]).to.equal(selected);
  });

  it('does not open late Python code after a newer explicit reading wins', async () => {
    const opens: any[][] = [];
    (commands as any).executeCommand = async (...args: any[]) => { opens.push(args); };
    const opening = student.openWorkspaceAssignment(exercise('Old'), { sourceFiles: [
      { resourceUri: vscode.Uri.file('/old/main.py'), type: vscode.FileType.File }
    ] });
    await book();
    pending[0]!.finish(await archive('Old task README')); await opening;
    expect(opens).to.deep.equal([]);
    expect(webviewPanels[0]!.title).to.equal('Unit book');
  });

});
