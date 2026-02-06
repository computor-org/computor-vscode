import { HttpClient } from './HttpClient';
import { AuthenticationError } from './errors';

export class ApiKeyHttpClient extends HttpClient {
  private apiKey: string;
  private headerName: string;
  private headerPrefix: string;
  private isAuth: boolean = false;

  constructor(
    baseUrl: string,
    apiKey: string,
    headerName: string = 'X-API-Key',
    headerPrefix: string = '',
    timeout?: number,
    cacheConfig?: {
      enabled?: boolean;
      ttl?: number;
      respectCacheHeaders?: boolean;
      maxSize?: number;
    }
  ) {
    super(baseUrl, timeout, 3, 1000, cacheConfig);
    this.apiKey = apiKey;
    this.headerName = headerName;
    this.headerPrefix = headerPrefix;
  }

  async authenticate(): Promise<void> {
    if (!this.apiKey) {
      throw new AuthenticationError('API key is required');
    }

    try {
      await this.get('/user');
      this.isAuth = true;
    } catch (error) {
      this.isAuth = false;
      if (error instanceof Error) {
        throw new AuthenticationError(`API key validation failed: ${error.message}`);
      }
      throw new AuthenticationError('API key validation failed with unknown error');
    }
  }

  isAuthenticated(): boolean {
    return this.isAuth && !!this.apiKey;
  }

  getAuthHeaders(): Record<string, string> {
    if (!this.apiKey) {
      return {};
    }

    const headerValue = this.headerPrefix ? `${this.headerPrefix} ${this.apiKey}` : this.apiKey;
    return {
      [this.headerName]: headerValue,
    };
  }

  public setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.isAuth = false;
  }

  public setHeaderName(headerName: string): void {
    this.headerName = headerName;
  }

  public setHeaderPrefix(headerPrefix: string): void {
    this.headerPrefix = headerPrefix;
  }

  public getApiKey(): string {
    return this.apiKey;
  }

  public getAccessToken(): string | null {
    return this.apiKey || null;
  }

  public getHeaderName(): string {
    return this.headerName;
  }

  public getHeaderPrefix(): string {
    return this.headerPrefix;
  }

  public static createGitLabTokenClient(baseUrl: string, token: string, timeout?: number): ApiKeyHttpClient {
    return new ApiKeyHttpClient(baseUrl, token, 'Authorization', 'Bearer', timeout);
  }

  public static createGenericTokenClient(baseUrl: string, token: string, timeout?: number): ApiKeyHttpClient {
    return new ApiKeyHttpClient(baseUrl, token, 'X-API-Key', '', timeout);
  }
}