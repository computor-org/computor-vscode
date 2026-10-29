import { expect } from 'chai';
import * as vscode from 'vscode';

import { StudentCommands } from '../../src/commands/StudentCommands';
import { statusLabel } from '../../src/ui/tree/student/StudentCourseContentTreeProvider';
import { validateSegment } from '../../src/utils/studentFsOperations';
import { submittedWarning } from '../../src/utils/submittedFiles';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';

// A German profile still got English toasts and pickers from the student
// commands, because only some of their messages went through say().

describe('Student command messages follow the UI language', () => {
  let handlers: Map<string, (...args: any[]) => any>;
  let shown: string[];
  const original: Record<string, any> = {};

  beforeEach(() => {
    handlers = new Map();
    shown = [];
    original.register = vscode.commands.registerCommand;
    original.info = vscode.window.showInformationMessage;
    original.warning = vscode.window.showWarningMessage;
    original.error = vscode.window.showErrorMessage;
    original.editor = (vscode.window as any).activeTextEditor;

    (vscode.commands as any).registerCommand = (id: string, handler: any) => {
      handlers.set(id, handler);
      return { dispose() {} };
    };
    const record = async (message: string) => { shown.push(message); return undefined; };
    (vscode.window as any).showInformationMessage = record;
    (vscode.window as any).showWarningMessage = record;
    (vscode.window as any).showErrorMessage = record;
    (vscode.window as any).activeTextEditor = undefined;

    const student = Object.create(StudentCommands.prototype) as any;
    student.context = { subscriptions: [] };
    student.apiService = {};
    student.provisioningService = { localRepoPath: async () => undefined };
    student.treeDataProvider = { refreshNode() {} };
    student.registerCommands();
  });

  afterEach(() => {
    (vscode.commands as any).registerCommand = original.register;
    (vscode.window as any).showInformationMessage = original.info;
    (vscode.window as any).showWarningMessage = original.warning;
    (vscode.window as any).showErrorMessage = original.error;
    (vscode.window as any).activeTextEditor = original.editor;
    setUiProfileLanguage(undefined);
  });

  const run = async (command: string, ...args: any[]): Promise<string[]> => {
    await handlers.get(command)!(...args);
    return shown;
  };

  it('commit course without a local repository', async () => {
    setUiProfileLanguage('de');
    expect(await run('computor.student.commitCourse', { courseId: 'c-1', title: 'Physik' }))
      .to.deep.equal(['Für diesen Kurs gibt es noch kein lokales Repository. Wähle zuerst „Repository einrichten“.']);
  });

  it('export without a course', async () => {
    setUiProfileLanguage('de');
    expect(await run('computor.student.exportCourseExamples', {}))
      .to.deep.equal(['Kein Kurs für den Export ausgewählt.']);
  });

  it('repository sign-in repair outside a student session', async () => {
    setUiProfileLanguage('de');
    expect(await run('computor.student.fixRepositoryAuth'))
      .to.deep.equal(['In dieser Sitzung lassen sich keine Repositorys verwalten.']);
  });

  it('test from the palette with no assignment selected', async () => {
    setUiProfileLanguage('de');
    expect(await run('computor.student.testAssignment'))
      .to.deep.equal(['Wähle zuerst eine Aufgabe aus und starte dann „Aufgabe testen“.']);
  });

  it('keeps English for an English profile', async () => {
    setUiProfileLanguage('en');
    expect(await run('computor.student.testAssignment'))
      .to.deep.equal(['Select an assignment first, then run Test Assignment.']);
  });
});

describe('Student tree and file dialogs follow the UI language', () => {
  afterEach(() => setUiProfileLanguage(undefined));

  it('names the correction_possible status in German', () => {
    setUiProfileLanguage('de');
    expect(statusLabel('correction_possible')).to.equal('Verbesserung möglich');
    setUiProfileLanguage('en');
    expect(statusLabel('correction_possible')).to.equal('Correction Possible');
  });

  it('explains a refused file name and a submitted file in German', () => {
    setUiProfileLanguage('de');
    expect(validateSegment('')).to.equal('Der Name darf nicht leer sein.');
    expect(submittedWarning({ submitted: true, paths: ['a.py'] } as any, false))
      .to.equal('Diese Datei gehört zu einer Abgabe, die du bereits eingereicht hast.');
  });
});
