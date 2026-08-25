import { expect } from 'chai';
import * as http from 'http';
import type { AddressInfo } from 'net';

import { probeAll, probeLink } from '../../src/services/LinkProbe';

/**
 * The prober, against a real local server (computor-org/issues#362).
 *
 * The classification is the whole value of the report. "Unreachable" has to
 * mean the link is genuinely gone, and everything that merely refused an
 * automated look has to land in the other list — a lecturer who finds a working
 * link on the broken list stops trusting the rest of the page.
 */
describe('LinkProbe', () => {
  let server: http.Server;
  let base: string;
  const seen: string[] = [];

  before(async () => {
    server = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      const url = req.url ?? '/';

      if (url === '/ok') {
        res.writeHead(200); res.end('fine'); return;
      }
      if (url === '/missing') {
        res.writeHead(404); res.end('nope'); return;
      }
      if (url === '/forbidden') {
        res.writeHead(403); res.end('go away'); return;
      }
      if (url === '/rate-limited') {
        res.writeHead(429); res.end('slow down'); return;
      }
      if (url === '/boom') {
        res.writeHead(500); res.end('broken'); return;
      }
      // A server that rejects HEAD but serves GET — common enough that the
      // prober must not call such a link broken.
      if (url === '/get-only') {
        if (req.method === 'HEAD') { res.writeHead(405); res.end(); return; }
        res.writeHead(200); res.end('fine'); return;
      }
      if (url === '/redirect') {
        res.writeHead(302, { Location: '/ok' }); res.end(); return;
      }
      res.writeHead(404); res.end();
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  beforeEach(() => { seen.length = 0; });

  it('calls a reachable link ok', async () => {
    const result = await probeLink(`${base}/ok`);
    expect(result.status).to.equal('ok');
    expect(result.code).to.equal(200);
  });

  it('follows a redirect to the real page', async () => {
    expect((await probeLink(`${base}/redirect`)).status).to.equal('ok');
  });

  it('calls a 404 broken', async () => {
    const result = await probeLink(`${base}/missing`);
    expect(result.status).to.equal('broken');
    expect(result.reason).to.contain('404');
  });

  it('calls a 500 broken', async () => {
    expect((await probeLink(`${base}/boom`)).status).to.equal('broken');
  });

  /** The distinction the issue explicitly asked for. */
  it('calls a 403 not-checkable rather than broken', async () => {
    const result = await probeLink(`${base}/forbidden`);
    expect(result.status).to.equal('blocked');
    expect(result.reason).to.contain('403');
  });

  it('calls a 429 not-checkable rather than broken', async () => {
    expect((await probeLink(`${base}/rate-limited`)).status).to.equal('blocked');
  });

  it('retries with GET when HEAD is refused', async () => {
    const result = await probeLink(`${base}/get-only`);
    expect(result.status).to.equal('ok');
    expect(seen).to.deep.equal([`HEAD /get-only`, `GET /get-only`]);
  });

  it('tries HEAD first, and stops there when it answers', async () => {
    await probeLink(`${base}/ok`);
    expect(seen).to.deep.equal([`HEAD /ok`]);
  });

  it('calls an unresolvable host broken, without throwing', async () => {
    const result = await probeLink('http://nonexistent.invalid/x', { timeoutMs: 3000 });
    expect(result.status).to.equal('broken');
  });

  describe('probeAll', () => {
    it('asks each distinct address exactly once', async () => {
      const results = await probeAll([`${base}/ok`, `${base}/ok`, `${base}/missing`]);
      expect(results.size).to.equal(2);
      expect(seen.filter(entry => entry.endsWith('/ok'))).to.have.length(1);
    });

    it('reports progress as probes finish', async () => {
      const progress: number[] = [];
      await probeAll([`${base}/ok`, `${base}/missing`, `${base}/boom`], {
        onProgress: (done) => progress.push(done)
      });
      expect(progress).to.deep.equal([1, 2, 3]);
    });

    it('stops when cancelled', async () => {
      const results = await probeAll([`${base}/ok`, `${base}/missing`], {
        concurrency: 1,
        isCancelled: () => true
      });
      expect(results.size).to.equal(0);
    });

    it('has nothing to do for an empty list', async () => {
      expect((await probeAll([])).size).to.equal(0);
    });
  });
});
