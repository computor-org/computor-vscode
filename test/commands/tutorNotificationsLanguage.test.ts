import { expect } from 'chai';
import * as vscode from 'vscode';

import { TutorCommands } from '../../src/commands/TutorCommands';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';

describe('Tutor command messages follow the UI language', () => {
  let handlers: Map<string, (...args: any[]) => any>;
  let shown: string[];
  const original: Record<string, any> = {};

  beforeEach(() => {
    handlers = new Map();
    shown = [];
    original.register = vscode.commands.registerCommand;
    original.info = vscode.window.showInformationMessage;
    original.error = vscode.window.showErrorMessage;
    (vscode.commands as any).registerCommand = (id: string, handler: any) => {
      handlers.set(id, handler);
      return { dispose() {} };
    };
    const record = async (message: string) => { shown.push(message); return undefined; };
    (vscode.window as any).showInformationMessage = record;
    (vscode.window as any).showErrorMessage = record;

    const tutor = Object.create(TutorCommands.prototype) as any;
    tutor.context = { subscriptions: [] };
    tutor.apiService = { getUserViews: async () => ['tutor'] };
    tutor.registerCommands();
  });

  afterEach(() => {
    (vscode.commands as any).registerCommand = original.register;
    (vscode.window as any).showInformationMessage = original.info;
    (vscode.window as any).showErrorMessage = original.error;
    setUiProfileLanguage(undefined);
  });

  it('explains in German that progress views are for lecturers', async () => {
    setUiProfileLanguage('de');
    await handlers.get('computor.tutor.showCourseProgress')!();
    expect(shown).to.deep.equal(['Bewertungs- und Fortschrittsansichten stehen nur Lehrenden zur Verfügung.']);
  });

  it('asks in German for an assignment before grading limits', async () => {
    setUiProfileLanguage('de');
    await handlers.get('computor.tutor.setMaxTestRuns')!({});
    expect(shown).to.deep.equal(['Keine Aufgabe ausgewählt.']);
  });
});
