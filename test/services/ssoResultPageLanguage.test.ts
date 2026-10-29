import { expect } from 'chai';
import * as http from 'http';
import * as vscode from 'vscode';

import { ssoBrowserLogin } from '../../src/authentication/SsoLoginService';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';

/** GET a loopback URL and return the page body. */
function fetchPage(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

/**
 * The tab the browser is left on after the Keycloak round-trip. The login
 * pages already follow the reading language (`ui_locales`); this page has to
 * match them, including `<html lang>`.
 */
describe('sign-in result page language', () => {
  const env = vscode.env as unknown as { openExternal: (uri: vscode.Uri) => Thenable<boolean> };
  const savedOpen = env.openExternal;

  afterEach(() => {
    env.openExternal = savedOpen;
    setUiProfileLanguage(undefined);
  });

  async function callbackPage(query: string): Promise<string> {
    let loginUrl: URL | undefined;
    const opened = new Promise<void>((resolve) => {
      env.openExternal = async (uri: vscode.Uri) => { loginUrl = new URL(uri.toString(true)); resolve(); return true; };
    });
    const login = ssoBrowserLogin('https://computor.example/api', { timeoutMs: 5000 });
    login.catch(() => undefined);
    await opened;
    const redirect = loginUrl!.searchParams.get('redirect_uri')!;
    const page = await fetchPage(`${redirect}?${query}`);
    await login.catch(() => undefined);
    return page;
  }

  it('says "signed in" in German for a German reader', async () => {
    setUiProfileLanguage('de');
    const page = await callbackPage('token=t1');
    expect(page).to.contain('<html lang="de">');
    expect(page).to.contain('Bei Computor angemeldet');
    expect(page).to.contain('Du kannst diesen Tab schließen');
  });

  it('says "sign-in failed" in German for a German reader', async () => {
    setUiProfileLanguage('de');
    const page = await callbackPage('error=access_denied');
    expect(page).to.contain('<html lang="de">');
    expect(page).to.contain('Anmeldung fehlgeschlagen');
  });

  it('stays English for an English reader', async () => {
    setUiProfileLanguage('en');
    const page = await callbackPage('token=t1');
    expect(page).to.contain('<html lang="en">');
    expect(page).to.contain('Signed in to Computor');
  });
});
