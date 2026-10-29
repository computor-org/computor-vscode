import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { runInNewContext } from 'vm';
import * as vscode from 'vscode';
import { renderWebviewPage } from '../../src/ui/webviews/shared/webviewPage';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, 'webview-ui', file), 'utf8');

/** A DOM just large enough for base.js and comments-input.js to render into. */
function page(lang: string) {
  const node = (): any => ({
    style: {}, dataset: {}, textContent: '', className: '', childNodes: [] as any[], attributes: {} as Record<string, string>,
    appendChild(child: any) { this.childNodes.push(child); return child; },
    addEventListener() {}, setAttribute(key: string, value: string) { this.attributes[key] = value; },
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
  const listeners: Array<(event: { data: unknown }) => void> = [];
  const window: any = { acquireVsCodeApi: () => ({ postMessage() {}, getState() {}, setState() {} }),
    addEventListener(type: string, listener: (event: { data: unknown }) => void) { if (type === 'message') listeners.push(listener); } };
  const context = { window, document, acquireVsCodeApi: window.acquireVsCodeApi, console };
  runInNewContext(read('shared/base.js'), context);
  const deliver = (data: unknown) => listeners.forEach(listener => listener({ data }));
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

  it('switches an open page to a new language without reloading it', () => {
    const { context, mount, deliver } = page('en');
    runInNewContext(read('messaging/comments-input.js'), context);
    deliver({ command: 'setLanguage', data: 'de' });
    expect(context.window.ComputorWebview.say('Cancel', 'Abbrechen')).to.equal('Abbrechen');
    expect(context.window.ComputorWebview.language).to.equal('de');
    deliver({ command: 'updateState', data: { courseMemberId: '', title: '', editingComment: null, loading: false } });
    expect(texts(mount)).to.include('Öffne die Kommentare zu einem Kursmitglied, um hier einen Kommentar zu schreiben oder zu bearbeiten.');
  });
});
