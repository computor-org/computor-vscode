import fetch from 'node-fetch';
import { HttpClient } from './HttpClient';
import { AuthenticationError, MaintenanceError } from '../exceptions/errors';
import { TokenRefreshRequest, TokenRefreshResponse } from '../types/generated/auth';

/** Endpoints that bypass the maintenance mode block. */
const MAINTENANCE_EXEMPT_PREFIXES = ['/auth/', '/system/maintenance'];

/** The only SSO provider the extension talks to (institute IdPs are brokered behind it). */
const SSO_PROVIDER = 'keycloak';

export class BearerTokenHttpClient extends HttpClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private tokenIssuedAt: Date | null = null;
  private userId: string | null = null;
  private refreshPromise: Promise<void> | null = null;
  private _maintenanceMode = false;
  private _maintenanceMessage: string | null = null;

  // Auth circuit breaker: once the session is known-dead (a 401 that refresh
  // can't fix), stop hitting the backend entirely until re-authentication.
  // Without this, every tree refresh / message poll keeps firing doomed requests
  // (each also triggering a refresh POST), hammering the backend for nothing.
  // 401 is safe to trip on: the backend uses 403 for permission denials, so a
  // 401 always means the token/session itself is invalid.
  private sessionInvalid = false;
  private onUnauthorizedCb?: () => void;

  private readonly REFRESH_THRESHOLD_PERCENTAGE = 0.1; // Refresh when <10% lifetime remains

  constructor(
    baseUrl: string,
    timeout?: number,
    cacheConfig?: {
      enabled?: boolean;
      ttl?: number;
      respectCacheHeaders?: boolean;
      maxSize?: number;
    }
  ) {
    // maxRetries=0: heavy endpoints (e.g. tutor aggregations) take longer than
    // the timeout for cold members, and the underlying retry would just fire
    // a second backend request while the first still completes. Retry policy
    // belongs in errorRecoveryService at the call site, not in the transport.
    super(baseUrl, timeout, 0, 1000, cacheConfig);
  }

  async authenticate(): Promise<void> {
    if (!this.accessToken) {
      throw new AuthenticationError('No access token available. Please login first.');
    }
  }

  isAuthenticated(): boolean {
    return !!this.accessToken && !this.isTokenExpired();
  }

  getAuthHeaders(): Record<string, string> {
    if (!this.accessToken) {
      return {};
    }

    return {
      'Authorization': `Bearer ${this.accessToken}`,
    };
  }

  public async refreshAuth(): Promise<void> {
    // Once the breaker has tripped, refreshing is pointless (we already proved
    // the session can't be renewed) and would just spam POST /auth/refresh.
    if (this.sessionInvalid) {
      throw new AuthenticationError('Session invalid; refresh suppressed until re-authentication');
    }

    // Prevent duplicate concurrent refresh calls
    if (this.refreshPromise) {
      console.log('[BearerTokenHttpClient] Refresh already in progress, waiting...');
      return this.refreshPromise;
    }

    if (!this.refreshToken) {
      throw new AuthenticationError('No refresh token available');
    }

    this.refreshPromise = this.performRefresh();

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async performRefresh(): Promise<void> {
    // SSO refresh requires a still-valid session token in the Authorization
    // header (the backend resolves the principal before rotating the token).
    // Once the session has expired server-side this endpoint 401s too — in
    // that case we clear tokens below and the caller falls back to re-login.
    if (!this.accessToken) {
      this.clearTokens();
      throw new AuthenticationError('No session token available to refresh');
    }

    // Bound the request so a stalled refresh can't hang the whole login/activate
    // flow forever (the rest of the client is gated on this completing).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    try {
      const request: TokenRefreshRequest = {
        refresh_token: this.refreshToken!,
        provider: SSO_PROVIDER
      };

      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
      }

      const refreshResponse = await response.json() as TokenRefreshResponse;
      this.updateTokensFromRefresh(refreshResponse);
      console.log('[BearerTokenHttpClient] Token refreshed successfully');
    } catch (error) {
      // Deliberately do NOT clear tokens here. A failed refresh does not mean the
      // current session token is dead — the server keeps a sliding TTL alive while
      // we're active. Wiping it would make every later request go out with no
      // Authorization header ("No authorization provided"). Refresh is best-effort;
      // a truly-dead session surfaces as a 401 on a real request, which re-login fixes.
      if (error instanceof Error) {
        throw new AuthenticationError(`Token refresh failed: ${error.message}`);
      }
      throw new AuthenticationError('Token refresh failed with unknown error');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  protected async request<T>(
    method: import('../types/HttpTypes').HttpMethod,
    endpoint: string,
    data?: any,
    params?: Record<string, any>
  ): Promise<import('../types/HttpTypes').HttpResponse<T>> {
    // Block requests during maintenance mode (except auth and maintenance status endpoints)
    if (this._maintenanceMode && !MAINTENANCE_EXEMPT_PREFIXES.some(p => endpoint.startsWith(p))) {
      throw new MaintenanceError(this._maintenanceMessage || undefined);
    }

    // Auth circuit breaker: while the session is known-dead, fail fast locally
    // instead of firing a doomed request at the backend.
    if (this.sessionInvalid) {
      throw new AuthenticationError('Session expired. Please sign in again.');
    }

    // Proactive refresh: best-effort top-up before the request. A failure must
    // not break the request or discard the still-valid token — proceed with the
    // current token and let the server's sliding TTL keep the session alive.
    if (this.shouldRefreshToken() && this.refreshToken) {
      console.log('[BearerTokenHttpClient] Token close to expiry, proactively refreshing');
      try {
        await this.refreshAuth();
      } catch (err) {
        console.warn('[BearerTokenHttpClient] Proactive refresh failed, using current token:', err);
      }
    }

    try {
      // Make the request
      const response = await super.request<T>(method, endpoint, data, params);
      return response;
    } catch (error: any) {
      if (error?.status !== 401) {
        throw error; // Non-auth error: rethrow untouched.
      }

      // 401: try to recover via a single refresh + retry.
      if (this.refreshToken && !this.sessionInvalid) {
        console.log('[BearerTokenHttpClient] Received 401, attempting token refresh and retry');
        try {
          await this.refreshAuth();
          console.log('[BearerTokenHttpClient] Token refreshed, retrying request');
          return await super.request<T>(method, endpoint, data, params);
        } catch (refreshError: any) {
          // Refresh failed (or the retry still 401'd) → the session can't be
          // renewed. Trip the breaker so we stop hammering the backend.
          console.error('[BearerTokenHttpClient] Token refresh failed:', refreshError);
          this.tripBreaker();
          throw error; // Throw original 401 error
        }
      }

      // No refresh token (or breaker already tripped) → session is dead.
      this.tripBreaker();
      throw error;
    }
  }

  /**
   * Mark the session dead and notify once. Subsequent requests fail fast (no
   * network) until new tokens are set (re-login), which resets the breaker.
   */
  private tripBreaker(): void {
    if (this.sessionInvalid) {
      return;
    }
    this.sessionInvalid = true;
    console.warn('[BearerTokenHttpClient] Session marked invalid; suppressing requests until re-authentication');
    try {
      this.onUnauthorizedCb?.();
    } catch (err) {
      console.warn('[BearerTokenHttpClient] onUnauthorized handler threw:', err);
    }
  }

  /** Register a one-shot handler invoked when the session becomes unrecoverable. */
  public setOnUnauthorized(handler: () => void): void {
    this.onUnauthorizedCb = handler;
  }

  private updateTokensFromRefresh(refreshResponse: TokenRefreshResponse): void {
    this.accessToken = refreshResponse.access_token;

    if (refreshResponse.refresh_token) {
      this.refreshToken = refreshResponse.refresh_token;
    }

    const now = Date.now();
    this.tokenIssuedAt = new Date(now);

    if (refreshResponse.expires_in) {
      this.tokenExpiry = new Date(now + refreshResponse.expires_in * 1000);
    }

    this.sessionInvalid = false; // A successful refresh means the session is alive again.
  }

  private clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.tokenIssuedAt = null;
    this.userId = null;
  }

  /**
   * Check if token should be refreshed based on remaining lifetime.
   * Returns true when less than 10% of token lifetime remains.
   * This prevents excessive refreshing while ensuring tokens stay valid.
   *
   * Examples:
   * - 30s token: refreshes when <3s remain
   * - 15min token: refreshes when <90s remain
   */
  private shouldRefreshToken(): boolean {
    if (!this.tokenExpiry || !this.tokenIssuedAt || !this.accessToken) {
      return false;
    }

    const now = Date.now();
    const expiryTime = this.tokenExpiry.getTime();
    const issuedTime = this.tokenIssuedAt.getTime();

    // Already expired
    if (now >= expiryTime) {
      return true;
    }

    // Calculate the total token lifetime and remaining time
    const totalLifetimeMs = expiryTime - issuedTime;
    const remainingMs = expiryTime - now;

    // Refresh when less than 10% of the TOTAL lifetime remains
    const thresholdMs = totalLifetimeMs * this.REFRESH_THRESHOLD_PERCENTAGE;

    return remainingMs <= thresholdMs;
  }

  /**
   * Check if token is actually expired (for backward compatibility)
   */
  private isTokenExpired(): boolean {
    if (!this.tokenExpiry) {
      return false;
    }

    return Date.now() >= this.tokenExpiry.getTime();
  }

  public setTokens(accessToken: string, refreshToken?: string, expiresAt?: Date, userId?: string): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken || null;
    this.tokenExpiry = expiresAt || null;
    this.userId = userId || null;
    this.sessionInvalid = false; // New tokens → reset the auth circuit breaker.

    // When restoring tokens, we don't know the exact issue time
    // Estimate it based on expiry time (assume it was just issued if we don't know better)
    if (expiresAt && !this.tokenIssuedAt) {
      // Assume a default lifetime for estimation purposes
      // This is imperfect but better than nothing
      this.tokenIssuedAt = new Date();
    }
  }

  public getAccessToken(): string | null {
    return this.accessToken;
  }

  public getRefreshToken(): string | null {
    return this.refreshToken;
  }

  public getTokenExpiry(): Date | null {
    return this.tokenExpiry;
  }

  public getUserId(): string | null {
    return this.userId;
  }

  public logout(): void {
    this.clearTokens();
  }

  public getTokenData(): {
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: Date | null;
    issuedAt: Date | null;
    userId: string | null;
  } {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.tokenExpiry,
      issuedAt: this.tokenIssuedAt,
      userId: this.userId
    };
  }

  public setTokenData(data: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    issuedAt?: Date;
    userId?: string;
  }): void {
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken || null;
    this.tokenExpiry = data.expiresAt || null;
    this.tokenIssuedAt = data.issuedAt || null;
    this.userId = data.userId || null;
    this.sessionInvalid = false; // New tokens → reset the auth circuit breaker.
  }

  public setMaintenanceMode(active: boolean, message?: string): void {
    this._maintenanceMode = active;
    this._maintenanceMessage = message || null;
    console.log(`[BearerTokenHttpClient] Maintenance mode ${active ? 'ENABLED' : 'DISABLED'}${message ? ': ' + message : ''}`);
  }

  public isMaintenanceMode(): boolean {
    return this._maintenanceMode;
  }
}
