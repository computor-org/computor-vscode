import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import JSZip from 'jszip';
import { commands, webviewPanels, window } from '../helpers/vscode-stub';
import { StudentCommands } from '../../src/commands/StudentCommands';
import { createStudentDescriptionSelectionHandler, registerContentDescription, SHOW_DESCRIPTION_COMMAND } from '../../src/ui/contentDescription';

describe('student description preview priority', () => {
  const context = { subscriptions: [], extensionUri: vscode.Uri.file(path.resolve(__dirname, '../..')) } as unknown as vscode.ExtensionContext;
  const originalRegister = commands.registerCommand;
  const originalExecute = commands.executeCommand;
  let handlers: Map<string, (...args: any[]) => Promise<void>>;
  let pending: Array<{ id: string; finish: (archive: Buffer) => void }>;
  let select: ReturnType<typeof createStudentDescriptionSelectionHandler>;

  const exercise = (id: string) => ({ contextValue: 'studentCourseContent.assignment', courseContent: { id, title: id, path: `unit.${id}` } });
  const book = () => handlers.get(SHOW_DESCRIPTION_COMMAND)!({ descriptionTitle: 'Unit book', descriptionMarkdown: '# Unit instructions' });
  async function archive(title: string): Promise<Buffer> {
    return new JSZip().file('README.md', `# ${title}`).generateAsync({ type: 'nodebuffer' });
  }

  beforeEach(() => {
    for (const panel of webviewPanels) panel.dispose();
    webviewPanels.length = 0;
    (window as any).tabGroups = { all: [{}, {}] };
    handlers = new Map();
    pending = [];
    (commands as any).registerCommand = (id: string, handler: (...args: any[]) => Promise<void>) => {
      handlers.set(id, handler);
      return { dispose() {} };
    };
    const student = Object.create(StudentCommands.prototype) as any;
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
    delete (window as any).tabGroups;
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
});
