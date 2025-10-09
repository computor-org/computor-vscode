import fetch from 'node-fetch';
import { HttpClient } from './HttpClient';
import { AuthenticationError } from './errors';
import { LocalLoginRequest, LocalLoginResponse, LocalTokenRefreshRequest, LocalTokenRefreshResponse } from '../types/generated/auth';

export class BearerTokenHttpClient extends HttpClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private userId: string | null = null;

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
    super(baseUrl, timeout, 3, 1000, cacheConfig);
  }

  async authenticateWithCredentials(username: string, password: string): Promise<void> {
    try {
      const request: LocalLoginRequest = {
        username,
        password
      };

      const response = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AuthenticationError(`Login failed: ${response.status} ${errorText}`);
      }

      const loginResponse = await response.json() as LocalLoginResponse;
      this.setTokensFromResponse(loginResponse);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new AuthenticationError(`Authentication failed: ${error.message}`);
      }
      throw new AuthenticationError('Authentication failed with unknown error');
    }
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
    if (!this.refreshToken) {
      throw new AuthenticationError('No refresh token available');
    }

    try {
      const request: LocalTokenRefreshRequest = {
        refresh_token: this.refreshToken
      };

      const response = await fetch(`${this.baseUrl}/auth/refresh/local`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
      }

      const refreshResponse = await response.json() as LocalTokenRefreshResponse;
      this.updateTokensFromRefresh(refreshResponse);
    } catch (error) {
      this.clearTokens();
      if (error instanceof Error) {
        throw new AuthenticationError(`Token refresh failed: ${error.message}`);
      }
      throw new AuthenticationError('Token refresh failed with unknown error');
    }
  }

  protected async request<T>(
    method: import('../types/HttpTypes').HttpMethod,
    endpoint: string,
    data?: any,
    params?: Record<string, any>
  ): Promise<import('../types/HttpTypes').HttpResponse<T>> {
    // Proactive refresh: check if token is expired before making request
    if (this.isTokenExpired() && this.refreshToken) {
      await this.refreshAuth();
    }

    try {
      // Make the request
      const response = await super.request<T>(method, endpoint, data, params);
      return response;
    } catch (error: any) {
      // Reactive refresh: handle 401 Unauthorized by refreshing and retrying
      if (error?.status === 401 && this.refreshToken && !this.isTokenExpired()) {
        console.log('[BearerTokenHttpClient] Received 401, attempting token refresh and retry');

        try {
          // Refresh the token
          await this.refreshAuth();

          // Retry the original request with new token
          console.log('[BearerTokenHttpClient] Token refreshed, retrying request');
          return await super.request<T>(method, endpoint, data, params);
        } catch (refreshError: any) {
          console.error('[BearerTokenHttpClient] Token refresh failed:', refreshError);
          throw error; // Throw original 401 error
        }
      }

      // For all other errors, just rethrow
      throw error;
    }
  }

  private setTokensFromResponse(loginResponse: LocalLoginResponse): void {
    this.accessToken = loginResponse.access_token;
    this.refreshToken = loginResponse.refresh_token;
    this.userId = loginResponse.user_id;

    if (loginResponse.expires_in) {
      this.tokenExpiry = new Date(Date.now() + loginResponse.expires_in * 1000);
    }
  }

  private updateTokensFromRefresh(refreshResponse: LocalTokenRefreshResponse): void {
    this.accessToken = refreshResponse.access_token;

    if (refreshResponse.refresh_token) {
      this.refreshToken = refreshResponse.refresh_token;
    }

    if (refreshResponse.expires_in) {
      this.tokenExpiry = new Date(Date.now() + refreshResponse.expires_in * 1000);
    }
  }

  private clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.userId = null;
  }

  private isTokenExpired(): boolean {
    if (!this.tokenExpiry) {
      return false;
    }

    const now = new Date();
    // Refresh 1 hour (3600 seconds) before expiration as recommended by backend
    const expiryWithBuffer = new Date(this.tokenExpiry.getTime() - 3600000);
    return now >= expiryWithBuffer;
  }

  public setTokens(accessToken: string, refreshToken?: string, expiresAt?: Date, userId?: string): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken || null;
    this.tokenExpiry = expiresAt || null;
    this.userId = userId || null;
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

  public getTokenData(): { accessToken: string | null; refreshToken: string | null; expiresAt: Date | null; userId: string | null } {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.tokenExpiry,
      userId: this.userId
    };
  }
}
