import * as vscode from 'vscode';
import * as http from 'http';
import * as crypto from 'crypto';
import { AddressInfo } from 'net';

/**
 * Tokens returned by the Keycloak SSO browser flow.
 *
 * `token` is an opaque Computor session token (NOT a JWT — do not decode it).
 * It is consumed exactly like the legacy bearer token: `Authorization: Bearer <token>`.
 * `refreshToken` is the raw Keycloak/OIDC refresh token, passed straight through
 * to `POST /auth/refresh`.
 */
export interface SsoLoginResult {
  token: string;
  refreshToken?: string;
  userId?: string;
  accountId?: string;
  isNewUser: boolean;
}

export interface SsoLoginOptions {
  /** How long to wait for the browser round-trip before giving up. Default 5 min. */
  timeoutMs?: number;
  /** Cancels the pending login (e.g. user dismissed the progress notification). */
  cancellationToken?: vscode.CancellationToken;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Computor</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background:#1e1e1e; color:#e0e0e0;
         display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
  .card { text-align:center; max-width:420px; padding:2rem; }
  .check { font-size:3rem; color:#4caf50; }
  h1 { font-size:1.25rem; font-weight:600; margin:.5rem 0; }
  p { color:#a0a0a0; line-height:1.5; }
</style></head>
<body><div class="card">
  <div class="check">&#10003;</div>
  <h1>Signed in to Computor</h1>
  <p>You can close this tab and return to VS Code.</p>
</div></body></html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Computor</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background:#1e1e1e; color:#e0e0e0;
         display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
  .card { text-align:center; max-width:420px; padding:2rem; }
  .x { font-size:3rem; color:#f44336; }
  h1 { font-size:1.25rem; font-weight:600; margin:.5rem 0; }
  p { color:#a0a0a0; line-height:1.5; }
</style></head>
<body><div class="card">
  <div class="x">&#10007;</div>
  <h1>Sign-in failed</h1>
  <p>Return to VS Code and try again.</p>
</div></body></html>`;

/**
 * Run the Keycloak SSO login in the system browser using a temporary loopback
 * HTTP server (the RFC 8252 native-app pattern). Requires no backend changes:
 * the backend treats `redirect_uri` as free-form and 302s the freshly-minted
 * session token back to us as query params.
 *
 * Flow:
 *   1. Start an ephemeral server on http://127.0.0.1:<random-port>/<nonce>.
 *   2. Open `{backend}/auth/keycloak/login?redirect_uri=<that URL>` in the browser.
 *   3. User authenticates at Keycloak; the backend 302s the browser back to us
 *      with `?token=…&refresh_token=…&user_id=…&account_id=…&is_new_user=…`.
 *   4. Read the `token` query param and resolve.
 *
 * Note: this uses a host-local loopback server, so it does not yet work in
 * Remote-SSH / Codespaces windows (the browser runs on a different host). The
 * API-token path remains available for those environments.
 */
export function ssoBrowserLogin(backendUrl: string, options?: SsoLoginOptions): Promise<SsoLoginResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Path-embedded nonce: defends against another local process hitting our port.
  // It lives in the path (not the query) because the backend appends its params
  // with a literal `?`, which would collide with a pre-existing query string.
  const nonce = crypto.randomBytes(16).toString('hex');

  return new Promise<SsoLoginResult>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let cancelListener: vscode.Disposable | undefined;

    const cleanup = () => {
      if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = undefined; }
      cancelListener?.dispose();
      cancelListener = undefined;
      server.close();
    };

    const settle = (action: () => void) => {
      if (settled) { return; }
      settled = true;
      cleanup();
      action();
    };

    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');

      // Ignore stray requests (e.g. the browser asking for /favicon.ico) that
      // don't carry our nonce — don't resolve or reject on them.
      if (!requestUrl.pathname.includes(nonce)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const token = requestUrl.searchParams.get('token');
      const errorParam = requestUrl.searchParams.get('error');

      if (!token) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(ERROR_HTML);
        settle(() => reject(new Error(errorParam
          ? `SSO login failed: ${errorParam}`
          : 'SSO callback did not include a session token.')));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(SUCCESS_HTML);
      settle(() => resolve({
        token,
        refreshToken: requestUrl.searchParams.get('refresh_token') ?? undefined,
        userId: requestUrl.searchParams.get('user_id') ?? undefined,
        accountId: requestUrl.searchParams.get('account_id') ?? undefined,
        isNewUser: requestUrl.searchParams.get('is_new_user') === 'true'
      }));
    });

    server.on('error', (err) => {
      settle(() => reject(new Error(`Could not start local SSO callback server: ${err.message}`)));
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}/${nonce}`;
      const loginUrl = `${backendUrl.replace(/\/$/, '')}/auth/keycloak/login?redirect_uri=${encodeURIComponent(redirectUri)}`;

      timeoutHandle = setTimeout(() => {
        settle(() => reject(new Error('SSO login timed out. Please try again.')));
      }, timeoutMs);

      if (options?.cancellationToken) {
        cancelListener = options.cancellationToken.onCancellationRequested(() => {
          settle(() => reject(new Error('SSO login cancelled.')));
        });
      }

      void vscode.env.openExternal(vscode.Uri.parse(loginUrl));
    });
  });
}
