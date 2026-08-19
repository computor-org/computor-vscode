export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface HttpRequestConfig {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  data?: any;
  params?: Record<string, any>;
  timeout?: number;
  /**
   * Ask for the body verbatim instead of letting the response's Content-Type
   * decide. Without it a download is at the mercy of the header the server
   * chose: `text/*` comes back decoded as UTF-8 (so any byte that is not valid
   * UTF-8 is replaced), and `application/json` comes back parsed into an
   * object. Neither can be turned back into the bytes that were sent.
   */
  responseType?: 'arraybuffer';
}

export interface AuthResult {
  success: boolean;
  token?: string;
  refreshToken?: string;
  expiresAt?: Date;
  error?: string;
}

export interface KeycloakConfig {
  realm: string;
  clientId: string;
  serverUrl: string;
  redirectUri: string;
}

export interface HttpClientConfig {
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  retryDelay: number;
  headers: Record<string, string>;
  cache?: {
    enabled: boolean;
    ttl?: number; // Default TTL in milliseconds
    respectCacheHeaders?: boolean;
    maxSize?: number;
  };
}

export interface RequestInterceptor {
  onRequest(config: HttpRequestConfig): HttpRequestConfig | Promise<HttpRequestConfig>;
  onError(error: any): Promise<any>;
}

export interface ResponseInterceptor {
  onResponse<T>(response: HttpResponse<T>): HttpResponse<T> | Promise<HttpResponse<T>>;
  onError(error: any): Promise<any>;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  tokenType?: string;
}