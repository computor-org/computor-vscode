import { expect } from 'chai';
import * as http from 'http';
import { AddressInfo } from 'net';

import { HttpClient } from '../../src/http/HttpClient';
import { HttpError } from '../../src/exceptions/errors';

// Signing out in another tab makes the gateway redirect API calls to the
// Keycloak login page; fetch follows it to a 200 text/html that used to be
// handed on as data and rendered in the Results view (computor-org/issues#481).

class TestHttpClient extends HttpClient {
  async authenticate(): Promise<void> {}
  isAuthenticated(): boolean { return true; }
  getAuthHeaders(): Record<string, string> { return {}; }
}

describe('HttpClient login-page answers', () => {
  let server: http.Server;
  let client: TestHttpClient;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/api/results') {
        res.writeHead(302, { Location: '/auth/login' });
        res.end();
      } else if (req.url === '/auth/login') {
        res.writeHead(200, { 'Content-Type': 'text/html;charset=UTF-8' });
        res.end('<html><body>Sign in to your account</body></html>');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    client = new TestHttpClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 5000, 0);
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('reports a redirect to a login page as an expired session (401)', async () => {
    try {
      await client.get('/api/results');
      expect.fail('expected an HttpError');
    } catch (error) {
      expect(error).to.be.instanceOf(HttpError);
      expect((error as HttpError).status).to.equal(401);
      expect((error as HttpError).message).to.match(/session has expired/i);
    }
  });

  it('still returns ordinary JSON', async () => {
    expect(((await client.get('/api/other')) as any).data).to.deep.equal({ ok: true });
  });
});
