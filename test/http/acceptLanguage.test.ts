import { expect } from 'chai';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as vscode from 'vscode';

import { HttpClient } from '../../src/http/HttpClient';
import { ComputorApiService } from '../../src/services/ComputorApiService';
import { setUiAccount, setWorkspaceLaunchLanguage } from '../../src/utils/uiLanguage';
import { multiTierCache } from '../../src/services/CacheService';

class TestHttpClient extends HttpClient {
  async authenticate(): Promise<void> {}
  isAuthenticated(): boolean { return true; }
  getAuthHeaders(): Record<string, string> { return {}; }
}

/**
 * The backend resolves effective_language, and the language stored with a
 * message, from Accept-Language, and takes German when it is missing: an
 * English VS Code on Automatic would read German.
 */
describe('Accept-Language on backend requests', () => {
  const env = vscode.env as { language: string };
  const display = env.language;
  let server: http.Server;
  let seen: (string | undefined)[];
  let api: ComputorApiService;

  beforeEach(async () => {
    seen = [];
    server = http.createServer((req, res) => {
      seen.push(req.headers['accept-language']);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'u1', is_service: false }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new TestHttpClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 2000, 0, 0);
    api = new ComputorApiService({} as any, client);
  });

  afterEach(async () => {
    env.language = display;
    setUiAccount({});
    setWorkspaceLaunchLanguage(undefined);
    multiTierCache.delete('currentUser');
    await new Promise(resolve => server.close(resolve));
  });

  it('sends the Automatic language, following the display language and a hosted launch as they change', async () => {
    env.language = 'en-US';
    await api.getUserAccount({ force: true });
    env.language = 'de-AT';
    await api.getUserAccount({ force: true });
    env.language = 'fr';
    await api.getUserAccount({ force: true });
    setWorkspaceLaunchLanguage('de');
    await api.getUserAccount({ force: true });
    expect(seen).to.deep.equal(['en', 'de', 'en', 'de']);
  });

  it('does not send an earlier profile language back as the browser\'s', async () => {
    env.language = 'en';
    setUiAccount({ profile: { language_code: 'de' } });
    await api.getUserAccount({ force: true });
    expect(seen).to.deep.equal(['en']);
  });
});
