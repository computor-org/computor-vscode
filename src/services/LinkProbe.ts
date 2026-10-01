import fetch from 'node-fetch';

/**
 * Asking the web whether a link still leads somewhere.
 *
 * The distinction that matters for a report is not "worked / did not work" but
 * "is broken" versus "would not let us check": publishers, journals and a good
 * part of the web answer an automated request with 403 or 429 while serving the
 * same URL perfectly to a browser (computor-org/issues#362). Mixing those two
 * into one list would make the report untrustworthy — a lecturer who finds
 * three false alarms stops reading the other twenty.
 */

export type LinkStatus = 'ok' | 'broken' | 'blocked';

export interface ProbeResult {
  status: LinkStatus;
  /** HTTP status code, when there was a response. */
  code?: number;
  /** Short human-readable reason, for the report. */
  reason: string;
}

export interface ProbeOptions {
  /** Per-request timeout. */
  timeoutMs?: number;
  /** How many probes are in flight at once. */
  concurrency?: number;
  /**
   * Extra headers for a URL. Lets the caller authenticate probes against
   * hosts it owns — the instance's own /docs store 401s anonymous requests,
   * which filed every own-document link under "Not checkable" (#362).
   */
  headersFor?: (url: string) => Record<string, string> | undefined;
}

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_CONCURRENCY = 8;

/**
 * A browser-ish User-Agent.
 *
 * Not to deceive anyone: a plain node-fetch agent is refused by a surprising
 * number of perfectly public pages, and every such refusal is a false alarm in
 * the report. Requests stay ordinary GET/HEAD traffic, one per link.
 */
const USER_AGENT =
  'Mozilla/5.0 (compatible; ComputorLinkCheck/1.0; +https://github.com/computor-org)';

/** Codes that mean "we were refused a look", not "this is gone". */
const BLOCKED_CODES = new Set([401, 403, 405, 406, 429, 999]);

function describe(code: number): string {
  switch (code) {
    case 401: return 'needs a login';
    case 403: return 'refused the check (403)';
    case 404: return 'not found (404)';
    case 405: return 'refused the check (405)';
    case 410: return 'gone (410)';
    case 429: return 'rate-limited the check (429)';
    case 500: return 'server error (500)';
    case 503: return 'service unavailable (503)';
    default:
      return code >= 500 ? `server error (${code})` : `not reachable (${code})`;
  }
}

/** One request, with its own timeout. */
async function request(
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
  extraHeaders?: Record<string, string>
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        // Sites that content-negotiate answer a bare request with 406.
        Accept: '*/*',
        ...(extraHeaders ?? {})
      },
      signal: controller.signal as any
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe one URL.
 *
 * HEAD first because it costs a fraction of a GET across a whole course; a
 * server that dislikes HEAD (many do, and answer 4xx or hang up) gets a second
 * chance with GET before the link is called broken.
 */
export async function probeLink(url: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const extraHeaders = options.headersFor?.(url);

  let headCode: number | undefined;
  try {
    const head = await request(url, 'HEAD', timeoutMs, extraHeaders);
    if (head.ok) {
      return { status: 'ok', code: head.status, reason: 'reachable' };
    }
    headCode = head.status;
  } catch {
    // Fall through to GET: a refused HEAD is not an answer about the URL.
  }

  try {
    const response = await request(url, 'GET', timeoutMs, extraHeaders);
    if (response.ok) {
      return { status: 'ok', code: response.status, reason: 'reachable' };
    }
    const code = response.status;
    return {
      status: BLOCKED_CODES.has(code) ? 'blocked' : 'broken',
      code,
      reason: describe(code)
    };
  } catch (error) {
    if (headCode !== undefined) {
      return {
        status: BLOCKED_CODES.has(headCode) ? 'blocked' : 'broken',
        code: headCode,
        reason: describe(headCode)
      };
    }
    return { status: 'broken', code: undefined, reason: networkReason(error) };
  }
}

/** What a failed connection means, in words a lecturer can act on. */
function networkReason(error: unknown): string {
  const raw = error as { name?: string; code?: string; message?: string };
  if (raw?.name === 'AbortError') {
    return 'no answer in time';
  }
  switch (raw?.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'host does not exist';
    case 'ECONNREFUSED':
      return 'connection refused';
    case 'ECONNRESET':
      return 'connection reset';
    case 'CERT_HAS_EXPIRED':
      return 'certificate expired';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'certificate not trusted';
    default:
      return raw?.message ? `could not connect (${raw.message})` : 'could not connect';
  }
}

/**
 * Probe many URLs, a few at a time.
 *
 * Every distinct address is asked once, no matter how many assignments use it —
 * a course reusing the same reading list across twenty exercises should cost
 * one request, not twenty. `onProgress` reports finished probes for the
 * progress notification, and `isCancelled` is consulted between them so a check
 * over a large course can be called off.
 */
export async function probeAll(
  urls: string[],
  options: ProbeOptions & {
    onProgress?: (done: number, total: number, url: string) => void;
    isCancelled?: () => boolean;
  } = {}
): Promise<Map<string, ProbeResult>> {
  const results = new Map<string, ProbeResult>();
  const queue = Array.from(new Set(urls));
  const total = queue.length;
  let done = 0;
  let next = 0;

  const worker = async () => {
    for (;;) {
      if (options.isCancelled?.()) {
        return;
      }
      const index = next;
      next += 1;
      const url = queue[index];
      if (url === undefined) {
        return;
      }

      let result: ProbeResult;
      try {
        result = await probeLink(url, options);
      } catch (error) {
        // probeLink is written not to throw; if it ever does, one bad link must
        // not take the whole report down with it.
        result = { status: 'broken', code: undefined, reason: networkReason(error) };
      }
      results.set(url, result);
      done += 1;
      options.onProgress?.(done, total, url);
    }
  };

  const workers = Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, Math.max(total, 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  return results;
}
