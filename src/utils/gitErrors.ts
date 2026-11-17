/**
 * Does this error (from a git exec) indicate a rejected credential — as opposed
 * to a network failure, timeout, or any other git error? Git surfaces auth
 * rejections only as stderr text, so string matching is all there is; the exec
 * error's message carries that stderr.
 *
 * The patterns are anchored deliberately. A bare `'401'` substring matched
 * anywhere in the text, so a course slug or repository path containing those
 * digits — `cs401`, `ws2401` — read as a rejected credential. That is not a
 * harmless false positive: it deletes the stored token and re-prompts the
 * student, and on a managed Forgejo course it triggers a credential ROTATION,
 * which invalidates the token embedded in every one of their other clones on
 * that server.
 */
const AUTH_PATTERNS: RegExp[] = [
  /Authentication failed/i,
  /Access denied/i,
  /HTTP Basic: Access denied/i,
  // git/curl phrasings for a 401, each with the status as its own token.
  /\bHTTP(?:\/[\d.]+)?\s+401\b/i,
  /requested URL returned error:\s*401\b/i,
  /\b401\s+Unauthorized\b/i,
  /could not read Username/i,
  /Invalid username or password/i,
  /Support for password authentication was removed/i
];

/** Everything a git exec error can carry text in, joined into one haystack. */
function errorText(error: unknown): string {
  const candidate = error as { message?: unknown; stderr?: unknown; toString?: () => string };
  const parts = [
    typeof candidate?.message === 'string' ? candidate.message : '',
    typeof candidate?.stderr === 'string' ? candidate.stderr : '',
  ];
  if (!parts.some(Boolean) && typeof candidate?.toString === 'function') {
    parts.push(candidate.toString());
  }
  return parts.join('\n');
}

export function isGitAuthenticationError(error: unknown): boolean {
  const text = errorText(error);
  return AUTH_PATTERNS.some((pattern) => pattern.test(text));
}

/** Why a repository setup failed, in the classes a learner can act on (issues#433). */
export type RepositorySetupFailure = 'authentication' | 'unreachable' | 'timeout' | 'server' | 'other';

// A 403 is a missing grant rather than a rejected credential, so it is not in
// AUTH_PATTERNS (that would rotate the token); for the learner it is the same.
const ACCESS_PATTERNS: RegExp[] = [
  /requested URL returned error:\s*403\b/i,
  /\bHTTP(?:\/[\d.]+)?\s+403\b/i,
  /\b403\s+Forbidden\b/i
];

const UNREACHABLE_PATTERNS: RegExp[] = [
  /Could not resolve host/i,
  /Failed to connect to/i,
  /Connection refused/i,
  /Connection timed out/i,
  /Network is unreachable/i,
  /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH)\b/
];

const SERVER_PATTERNS: RegExp[] = [
  /requested URL returned error:\s*5\d\d\b/i,
  /\bHTTP(?:\/[\d.]+)?\s+5\d\d\b/i
];

/**
 * Classify a failed repository setup: the provisioning API call (HttpError and
 * friends, by name and status) or the git clone (stderr text).
 */
export function classifyRepositorySetupFailure(error: unknown): RepositorySetupFailure {
  const { name, status } = (error ?? {}) as { name?: unknown; status?: unknown };
  if (name === 'GitTimeoutError' || name === 'TimeoutError') {
    return 'timeout';
  }
  if (name === 'AuthenticationError' || status === 401 || status === 403) {
    return 'authentication';
  }
  if (name === 'NetworkError') {
    return 'unreachable';
  }
  if (name === 'MaintenanceError' || (typeof status === 'number' && status >= 500)) {
    return 'server';
  }
  const text = errorText(error);
  if (isGitAuthenticationError(error) || ACCESS_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'authentication';
  }
  if (UNREACHABLE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'unreachable';
  }
  if (SERVER_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'server';
  }
  return 'other';
}

/**
 * The remote git quoted back when it rejected the credential, reduced to its
 * origin — the identity of the token that has to be replaced. Undefined when
 * git named no URL (some transports don't) or the quoted URL isn't parseable.
 *
 * `URL.origin` drops any userinfo, so a remote carrying an embedded token
 * (`https://user:glpat-…@host/…`, which is how the extension writes them) can
 * never leak that token into a notification or a webview.
 */
const REMOTE_URL_PATTERNS: RegExp[] = [
  /Authentication failed for '([^']+)'/i,
  /could not read Username for '([^']+)'/i,
  /unable to access '([^']+)'/i
];

export function extractAuthFailureOrigin(error: unknown): string | undefined {
  const text = errorText(error);
  for (const pattern of REMOTE_URL_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.[1]) {
      continue;
    }
    try {
      return new URL(match[1]).origin;
    } catch {
      // Not a URL git can be held to — keep looking.
    }
  }
  return undefined;
}
