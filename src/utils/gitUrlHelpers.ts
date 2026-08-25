import { URL } from 'url';

export function addTokenToGitUrl(url: string, token: string): string {
  if (url.startsWith('https://')) {
    return url.replace('https://', `https://oauth2:${token}@`);
  }
  if (url.startsWith('http://')) {
    return url.replace('http://', `http://oauth2:${token}@`);
  }
  return url;
}

/**
 * Inject `username:password` basic credentials into an http(s) git URL — used for
 * Forgejo clone tokens (`https://<clone_username>:<clone_token>@host/...`).
 * Both parts are percent-encoded. Returns the URL unchanged if it isn't http(s).
 */
export function addBasicCredentialsToGitUrl(url: string, username: string, password: string): string {
  const creds = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  if (url.startsWith('https://')) {
    return url.replace('https://', `https://${creds}`);
  }
  if (url.startsWith('http://')) {
    return url.replace('http://', `http://${creds}`);
  }
  return url;
}

/**
 * True when an http(s) git URL embeds basic credentials in a shape OTHER than
 * the `oauth2:<token>@` one produced by {@link addTokenToGitUrl} — i.e. a
 * Forgejo managed clone credential (`<clone_username>:<clone_token>@`) or
 * user-supplied basic auth. Callers that rewrite remotes with a GitLab-style
 * token use this to leave such origins alone (computor-org/issues#332).
 */
export function hasNonOAuthEmbeddedCredentials(url: string): boolean {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }
  try {
    const urlObj = new URL(trimmed);
    if (!urlObj.username && !urlObj.password) {
      return false;
    }
    return urlObj.username !== 'oauth2';
  } catch {
    return false;
  }
}

/**
 * Redact embedded credentials from any text that may carry an authenticated git
 * URL — e.g. an exec/clone error whose `.message`/`.cmd` includes the command
 * (`git clone "https://user:token@host/…"`). Turns the userinfo into `***`. Run
 * this over any error text BEFORE logging it or showing it to the user so clone
 * tokens / PATs don't leak to the console or a notification.
 */
export function redactGitCredentials(text: string): string {
  return text.replace(/(https?:\/\/)[^/@\s]+@/gi, '$1***@');
}

export function stripCredentialsFromGitUrl(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }

  try {
    const urlObj = new URL(trimmed);
    urlObj.username = '';
    urlObj.password = '';
    return urlObj.toString();
  } catch {
    return undefined;
  }
}

/**
 * The namespace a repository lives in, as a browsable URL: the repo URL minus
 * its last path segment and any `.git` suffix.
 *
 * `https://git.example.org/phys-2027/student-template.git` becomes
 * `https://git.example.org/phys-2027` — the org (Forgejo) or group (GitLab)
 * that also holds the course's assignments and reference repositories. Any
 * embedded credentials are dropped, since the result is handed to a browser.
 *
 * Returns undefined for anything that is not an http(s) URL with at least one
 * path segment beyond the host (an ssh remote has no browsable equivalent we
 * could derive without knowing the server's web root).
 */
export function parentRepositoryUrl(repositoryUrl: string): string | undefined {
  const trimmed = repositoryUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }

  try {
    const urlObj = new URL(trimmed);
    urlObj.username = '';
    urlObj.password = '';
    urlObj.hash = '';
    urlObj.search = '';

    const segments = urlObj.pathname.split('/').filter((segment) => segment.length > 0);
    if (segments.length < 2) {
      return undefined;
    }
    segments.pop();

    urlObj.pathname = `/${segments.join('/')}`;
    return urlObj.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export function extractOriginFromGitUrl(remoteUrl: string): string | undefined {
  try {
    const normalized = remoteUrl.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      return undefined;
    }
    const urlObj = new URL(normalized);
    return `${urlObj.protocol}//${urlObj.host}`;
  } catch {
    return undefined;
  }
}
