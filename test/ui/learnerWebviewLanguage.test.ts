import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { runInNewContext } from 'vm';
import * as vscode from 'vscode';

import { showGettingStarted } from '../../src/commands/showGettingStarted';
import { UserProfileWebviewProvider } from '../../src/ui/webviews/UserProfileWebviewProvider';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';
import { webviewPanels } from '../helpers/vscode-stub';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, 'webview-ui', file), 'utf8');

/** base.js in a page whose <html lang> is `lang`, in a webview whose own locale is `display`. */
function page(lang: string, display = 'en-US') {
  let html = '';
  const mount: any = {
    set innerHTML(value: string) { html = value; }, get innerHTML() { return html; },
    querySelector: () => null, querySelectorAll: () => []
  };
  const document = {
    documentElement: { lang },
    getElementById: () => mount,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const window: any = { acquireVsCodeApi: () => ({ postMessage() {}, getState() {}, setState() {} }), addEventListener() {} };
  const context = { window, document, navigator: { language: display }, acquireVsCodeApi: window.acquireVsCodeApi, console };
  runInNewContext(read('shared/base.js'), context);
  return { context, html: () => html };
}

describe('learner webviews in the reading language', () => {
  afterEach(() => { setUiProfileLanguage(undefined); });

  it('writes dates in the page language, not the webview locale', () => {
    const cw = page('de', 'en-US').context.window.ComputorWebview;
    const day = 24 * 3600 * 1000;
    expect(cw.formatRelativeDate(new Date().toISOString())).to.equal('heute');
    expect(cw.formatRelativeDate(new Date(Date.now() - day).toISOString())).to.equal('gestern');
    expect(cw.formatRelativeDate(new Date(Date.now() - 3 * day).toISOString())).to.equal('vor 3 Tagen');
    expect(cw.formatDate('2026-10-29T12:00:00Z')).to.equal('29.10.2026');
    expect(cw.formatDateTime('2026-10-29T12:00:00Z')).to.match(/^29\.10\.2026, \d\d:\d\d:\d\d$/);

    const en = page('en', 'en-GB').context.window.ComputorWebview;
    expect(en.formatRelativeDate(new Date(Date.now() - 3 * day).toISOString())).to.equal('3 days ago');
    expect(en.formatDate('2026-10-29T12:00:00Z')).to.equal('29/10/2026');
  });

  it('renders the profile panel in the page language', () => {
    const { context, html } = page('de');
    context.window.__INITIAL_STATE__ = { user: { given_name: 'Ada' }, profile: {}, languages: [] };
    // The page draws on DOMContentLoaded or on an update message; send the latter.
    const listeners: ((event: unknown) => void)[] = [];
    context.window.addEventListener = (_: string, fn: (event: unknown) => void) => listeners.push(fn);
    runInNewContext(read('admin/user-profile.js'), context);
    listeners.forEach(fn => fn({ data: { command: 'updateState', data: {} } }));
    expect(html()).to.contain('Vorname');
    expect(html()).to.contain('Profil speichern');
    expect(html()).to.contain('Automatisch');
    expect(html()).not.to.contain('Given Name');
  });

  it('titles the profile panel in the reading language', async () => {
    setUiProfileLanguage('de');
    const api = {
      getUserAccount: async () => ({ id: 'u1', profile: null }),
      getLanguages: async () => [],
      getOrganizations: async () => [],
      getStudentProfiles: async () => []
    } as any;
    const context = { extensionPath: root, extensionUri: vscode.Uri.file(root), subscriptions: [] as { dispose(): void }[] } as any;
    try {
      await new UserProfileWebviewProvider(context, api).open();
      const panel = webviewPanels[webviewPanels.length - 1]!;
      expect(panel.title).to.equal('Mein Profil');
      expect(panel.webview.html).to.contain('<html lang="de">');
      setUiProfileLanguage('en');
      await new Promise(resolve => setImmediate(resolve));
      expect(panel.title).to.equal('My Profile');
      expect(panel.webview.html).to.contain('<html lang="en">');
    } finally {
      for (const subscription of context.subscriptions) subscription.dispose();
    }
  });

  it('opens the help page in the reading language for "Getting Started"', async () => {
    setUiProfileLanguage('de');
    const context = { extensionPath: root, extensionUri: vscode.Uri.file(root), subscriptions: [] } as any;
    await showGettingStarted(context);
    const panel = webviewPanels[webviewPanels.length - 1]!;
    expect(panel.title).to.equal('Erste Schritte');
    expect(panel.webview.html).to.contain('Ein Kurs umfasst alles');
    expect(panel.webview.html).not.to.contain('Computor VS Code Extension');
  });
});
