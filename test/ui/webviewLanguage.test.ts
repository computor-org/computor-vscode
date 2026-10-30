import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { runInNewContext } from 'vm';
import * as vscode from 'vscode';
import { renderWebviewPage } from '../../src/ui/webviews/shared/webviewPage';
import { webviewPanels } from '../helpers/vscode-stub';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';
import { StudentCourseContentDetailsWebviewProvider } from '../../src/ui/webviews/StudentCourseContentDetailsWebviewProvider';
import { MessagesInputPanelProvider } from '../../src/ui/panels/MessagesInputPanel';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, 'webview-ui', file), 'utf8');

/** A DOM just large enough for base.js and comments-input.js to render into. */
function page(lang: string, savedState?: any) {
  const node = (): any => ({
    style: {}, dataset: {}, textContent: '', className: '', childNodes: [] as any[], attributes: {} as Record<string, string>,
    appendChild(child: any) { this.childNodes.push(child); return child; },
    addEventListener() {}, focus() {}, setSelectionRange() {}, setAttribute(key: string, value: string) { this.attributes[key] = value; },
    set innerHTML(_: string) { this.childNodes = []; }
  });
  const mount = node();
  const document = {
    documentElement: { lang },
    getElementById: () => mount,
    createElement: () => node(),
    createTextNode: (text: string) => ({ textContent: text }),
    addEventListener() {}
  };
  const listeners: Function[] = [];
  const window: any = { acquireVsCodeApi: () => ({ postMessage() {}, getState: () => savedState, setState() {} }),
    addEventListener(name: string, listener: Function) { if (name === 'message') listeners.push(listener); } };
  const context = { window, document, acquireVsCodeApi: window.acquireVsCodeApi, console };
  runInNewContext(read('shared/base.js'), context);
  /** Posts a message from the extension to every script on the page. */
  const deliver = (message: any) => { for (const listener of listeners) listener({ data: message }); };
  return { context, mount, deliver };
}

function texts(node: any): string[] {
  return [node.textContent, ...(node.childNodes ?? []).flatMap(texts)].filter(Boolean);
}

describe('webview language', () => {
  afterEach(() => { setUiProfileLanguage(undefined); });

  it('writes the reading language into the page', () => {
    const webview = { cspSource: 'vscode-resource:', asWebviewUri: (uri: vscode.Uri) => uri } as any;
    const render = () => renderWebviewPage(webview, vscode.Uri.file(root), { title: 'T', bodyHtml: '' });
    setUiProfileLanguage('de');
    expect(render()).to.contain('<html lang="de">');
    setUiProfileLanguage('en');
    expect(render()).to.contain('<html lang="en">');
  });

  it('renders the comment composer in the page language', () => {
    for (const [lang, expected] of [
      ['de', 'Öffne die Kommentare zu einem Kursmitglied, um hier einen Kommentar zu schreiben oder zu bearbeiten.'],
      ['en', 'Open a course member’s comments to add or edit a comment here.']
    ] as const) {
      const { context, mount } = page(lang);
      expect(context.window.ComputorWebview.say('Cancel', 'Abbrechen')).to.equal(lang === 'de' ? 'Abbrechen' : 'Cancel');
      runInNewContext(read('messaging/comments-input.js'), context);
      expect(texts(mount)).to.include(expected);
    }
  });

  it('redraws open content details in a new reading language, in place', async () => {
    const subscriptions: { dispose(): void }[] = [];
    const context = { extensionPath: root, extensionUri: vscode.Uri.file(root), subscriptions } as any;
    const details = new StudentCourseContentDetailsWebviewProvider(context);
    try {
      setUiProfileLanguage('en');
      await details.showDetails({ content: { id: 'a1', path: 'woche_1.konstanten', title: 'Konstanten' } } as any);
      const panel = webviewPanels[webviewPanels.length - 1]!;
      expect(panel.webview.html).to.contain('<html lang="en">');
      setUiProfileLanguage('de');
      await new Promise(resolve => setImmediate(resolve));
      expect(webviewPanels[webviewPanels.length - 1]).to.equal(panel);
      expect(panel.title).to.equal('Details: Konstanten');
      expect(panel.webview.html).to.contain('<html lang="de">');
    } finally {
      for (const subscription of subscriptions) subscription.dispose();
    }
  });

  it('relabels the comment composer on a switch and keeps the half-written comment', () => {
    const { context, mount, deliver } = page('de', { drafts: { 'member-1': 'Halb geschrieben' } });
    runInNewContext(read('messaging/comments-input.js'), context);
    deliver({ command: 'updateState', data: { courseMemberId: 'member-1', title: 'Ada', editingComment: null, loading: false } });
    expect(texts(mount)).to.include('Neuer Kommentar');
    deliver({ command: 'setLanguage', data: { language: 'en' } });
    expect(texts(mount)).to.include('New comment');
    const textarea = mount.childNodes[0].childNodes.find((node: any) => node.className === 'comments-input-textarea');
    expect(textarea.value).to.equal('Halb geschrieben');
    expect(context.document.documentElement.lang).to.equal('en');
  });

  it('switches the message composer in place instead of resetting it', () => {
    const posted: any[] = [];
    const panel = new MessagesInputPanelProvider(vscode.Uri.file(root), {} as any);
    (panel as any).view = { webview: { postMessage: (message: any) => { posted.push(message); return Promise.resolve(true); } } };
    setUiProfileLanguage('de');
    panel.refreshLanguage();
    expect(posted.map(message => message.command)).to.deep.equal(['setLanguage']);
    expect(posted[0].data.language).to.equal('de');
    expect(posted[0].data.editorPlaceholders.plain).to.match(/^Schreib deine Nachricht/);
  });
});
