import { expect } from 'chai';
import * as vscode from 'vscode';

import { LecturerCommands } from '../../src/commands/LecturerCommands';
import { LecturerExampleCommands } from '../../src/commands/LecturerExampleCommands';
import { formatCascadePreview } from '../../src/services/CascadePreview';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';

describe('Lecturer command messages follow the UI language', () => {
  let handlers: Map<string, (...args: any[]) => any>;
  let shown: string[];
  const original: Record<string, any> = {};

  beforeEach(() => {
    handlers = new Map();
    shown = [];
    original.register = vscode.commands.registerCommand;
    original.info = vscode.window.showInformationMessage;
    original.warning = vscode.window.showWarningMessage;
    (vscode.commands as any).registerCommand = (id: string, handler: any) => {
      handlers.set(id, handler);
      return { dispose() {} };
    };
    const record = async (message: string) => { shown.push(message); return undefined; };
    (vscode.window as any).showInformationMessage = record;
    (vscode.window as any).showWarningMessage = record;
  });

  afterEach(() => {
    (vscode.commands as any).registerCommand = original.register;
    (vscode.window as any).showInformationMessage = original.info;
    (vscode.window as any).showWarningMessage = original.warning;
    setUiProfileLanguage(undefined);
  });

  function registerLecturer(): void {
    const lecturer = Object.create(LecturerCommands.prototype) as any;
    lecturer.context = { subscriptions: [] };
    lecturer.apiService = { getUserScopes: async () => ({}) };
    lecturer.registerCommands();
  }

  function registerExamples(): void {
    const examples = Object.create(LecturerExampleCommands.prototype) as any;
    examples.context = { subscriptions: [] };
    examples.treeProvider = { clearSearch() {} };
    examples.registerCommands();
  }

  it('tells in German where to delete an organization', async () => {
    setUiProfileLanguage('de');
    registerLecturer();
    await handlers.get('computor.lecturer.deleteOrganization')!();
    expect(shown).to.deep.equal([
      'Klicke in der Lehrenden-Ansicht mit der rechten Maustaste auf eine Organisation, um sie zu löschen.'
    ]);
  });

  it('asks in German for an assignment before revealing its files', async () => {
    setUiProfileLanguage('de');
    registerLecturer();
    await handlers.get('computor.lecturer.openAssignmentFolder')!(undefined);
    expect(shown).to.deep.equal(['Wähle eine Aufgabe aus.']);
  });

  it('keeps English for an English reading language', async () => {
    setUiProfileLanguage('en');
    registerLecturer();
    await handlers.get('computor.lecturer.deleteOrganization')!();
    expect(shown).to.deep.equal(['Right-click an organization in the Lecturer tree to delete it.']);
  });

  it('confirms a cleared example search in German', async () => {
    setUiProfileLanguage('de');
    registerExamples();
    await handlers.get('computor.lecturer.clearExampleSearch')!();
    expect(shown).to.deep.equal(['Suche zurückgesetzt.']);
  });

  it('writes the delete preview in German', () => {
    setUiProfileLanguage('de');
    const text = formatCascadePreview({
      dry_run: true,
      entity_type: 'course',
      entity_id: 'c-1',
      deleted_counts: { student_submissions: 3 },
      errors: [],
      student_repositories_kept: 2
    } as any, { kind: 'course' });
    expect(text).to.contain('Abgaben von Studierenden: 3');
    expect(text).to.contain('Die Repositorys der Studierenden bleiben erhalten (2)');
    expect(text).not.to.contain('There is no undo.');
  });
});
