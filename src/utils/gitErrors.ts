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

export function isGitAuthenticationError(error: unknown): boolean {
  const candidate = error as { message?: unknown; stderr?: unknown; toString?: () => string };
  const parts = [
    typeof candidate?.message === 'string' ? candidate.message : '',
    typeof candidate?.stderr === 'string' ? candidate.stderr : '',
  ];
  if (!parts.some(Boolean) && typeof candidate?.toString === 'function') {
    parts.push(candidate.toString());
  }
  const text = parts.join('\n');
  return AUTH_PATTERNS.some((pattern) => pattern.test(text));
}
