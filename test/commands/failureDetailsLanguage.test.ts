import { expect } from 'chai';
import * as vscode from 'vscode';

import { CourseMemberCommentsInputPanelProvider } from '../../src/ui/panels/CourseMemberCommentsInputPanel';
import { OfflineRepositoryManager } from '../../src/services/OfflineRepositoryManager';
import { BackendConnectionService } from '../../src/services/BackendConnectionService';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';

// German messages used to end in the raw, usually English, error after a
// colon ("…: Request failed with status code 500"), and the offline-mode
// prompts were English for everyone.
describe('failure messages and offline prompts in the reading language', () => {
  let shown: string[];
  const original: Record<string, any> = {};

  beforeEach(() => {
    shown = [];
    original.error = vscode.window.showErrorMessage;
    original.input = vscode.window.showInputBox;
    (vscode.window as any).showErrorMessage = async (message: string) => { shown.push(message); return undefined; };
  });

  afterEach(() => {
    (vscode.window as any).showErrorMessage = original.error;
    (vscode.window as any).showInputBox = original.input;
    setUiProfileLanguage(undefined);
  });

  function failingCommentPanel() {
    const api = { createCourseMemberComment: async () => { throw new Error('Request failed with status code 500'); } } as any;
    const panel = new CourseMemberCommentsInputPanelProvider(vscode.Uri.file('/ext'), api) as any;
    panel.state.courseMemberId = 'member-1';
    return panel;
  }

  it('leads with a German sentence and keeps the raw cause as Details', async () => {
    setUiProfileLanguage('de');
    await failingCommentPanel().handleCreateComment({ message: 'Gut gemacht' });
    expect(shown).to.deep.equal([
      'Der Kommentar konnte nicht gespeichert werden. Details: Request failed with status code 500'
    ]);
  });

  it('keeps the English form for an English reader', async () => {
    setUiProfileLanguage('en');
    await failingCommentPanel().handleCreateComment({ message: 'Well done' });
    expect(shown).to.deep.equal(['Failed to create comment: Request failed with status code 500']);
  });

  it('asks for the offline repository URL in German', async () => {
    setUiProfileLanguage('de');
    let options: any;
    (vscode.window as any).showInputBox = async (opts: any) => { options = opts; return undefined; };
    const manager = new OfflineRepositoryManager() as any;
    await manager.promptRepositoryUrl();
    expect(options.title).to.equal('Kurs hinzufügen – Repository-URL');
    expect(options.validateInput('')).to.equal('Die Repository-URL fehlt');
  });

  it('explains a refused backend connection in German, as the Settings view shows it', async () => {
    setUiProfileLanguage('de');
    // Port 9 (discard) on loopback is closed on any normal machine.
    const status = await BackendConnectionService.getInstance().checkBackendConnection('http://127.0.0.1:9');
    expect(status.isReachable).to.equal(false);
    expect(status.message).to.equal('Keine Verbindung zu Computor.');
  });
});
