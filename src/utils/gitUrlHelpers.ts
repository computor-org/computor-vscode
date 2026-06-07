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
