import { expect } from 'chai';
import * as http from 'http';
import { AddressInfo } from 'net';

import { HttpClient } from '../../src/http/HttpClient';
import { HttpError } from '../../src/exceptions/errors';

/**
 * `getBuffer` is how every download reaches the extension — documents, ZIP
 * archives, test artifacts. It used to hand the response to `parseResponse`,
 * which decides what a body *is* from its Content-Type: `text/*` came back
 * decoded as a UTF-8 string and `application/json` came back parsed into an
 * object, so whether a file survived the trip was the server's choice of
 * header rather than anything the caller could control. A byte that is not
 * valid UTF-8 does not survive being decoded and re-encoded, and an object
 * cannot be turned back into bytes at all.
 *
 * These tests serve the awkward headers on purpose.
 */

class TestHttpClient extends HttpClient {
  async authenticate(): Promise<void> {}
  isAuthenticated(): boolean { return true; }
  getAuthHeaders(): Record<string, string> { return {}; }
}

/** Bytes no UTF-8 decoder can round-trip: a PNG magic number and a lone 0xFF. */
const BINARY_BODY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe]);

let server: http.Server;
let client: TestHttpClient;

describe('HttpClient.getBuffer', () => {
  beforeEach(async () => {
    server = http.createServer((req, res) => {
      switch (req.url?.split('?')[0]) {
        // A backend that labels a binary file as text — the case that decided
        // whether a download arrived intact.
        case '/mislabelled':
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(BINARY_BODY);
          return;
        case '/json':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"note":"a .json document is a file too"}');
          return;
        case '/empty':
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '0' });
          res.end();
          return;
        case '/no-content':
          res.writeHead(204);
          res.end();
          return;
        case '/missing':
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end('{"detail":"No such document"}');
          return;
        default:
          res.writeHead(200, { 'Content-Type': 'application/pdf' });
          res.end(BINARY_BODY);
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    client = new TestHttpClient(`http://127.0.0.1:${port}`, 5000, 0);
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('keeps every byte when the server calls a binary file text', async () => {
    const bytes = await client.getBuffer('/mislabelled');
    expect(bytes.equals(BINARY_BODY)).to.equal(true);
  });

  it('returns a JSON document as its bytes, not as a parsed object', async () => {
    const bytes = await client.getBuffer('/json');
    expect(bytes.toString('utf8')).to.equal('{"note":"a .json document is a file too"}');
  });

  it('reads a binary file with a binary content type, as it always did', async () => {
    const bytes = await client.getBuffer('/lecture.pdf');
    expect(bytes.equals(BINARY_BODY)).to.equal(true);
  });

  it('treats an empty body as an empty file', async () => {
    // Every document created by "New File" starts empty; Buffer.from(null)
    // used to throw here and surface as "Failed to download document".
    const bytes = await client.getBuffer('/empty');
    expect(bytes.length).to.equal(0);
  });

  it('treats 204 No Content as an empty file', async () => {
    const bytes = await client.getBuffer('/no-content');
    expect(bytes.length).to.equal(0);
  });

  it('still reports what the backend said when a download fails', async () => {
    // The raw path is for successful bodies only — an error is a message.
    try {
      await client.getBuffer('/missing');
      expect.fail('expected the 404 to throw');
    } catch (err) {
      expect(err).to.be.instanceOf(HttpError);
      expect((err as HttpError).status).to.equal(404);
      expect((err as HttpError).response).to.deep.equal({ detail: 'No such document' });
    }
  });
});
