import fetch, { Response, Headers } from 'node-fetch';
import { HttpMethod, HttpResponse, HttpRequestConfig, RequestInterceptor, ResponseInterceptor } from '../types/HttpTypes';
import { HttpError, NetworkError, TimeoutError, ValidationError } from './errors';
import { CacheStrategy, CacheKey } from './cache/CacheStrategy';
import { InMemoryCache } from './cache/InMemoryCache';
import { NoOpCache } from './cache/NoOpCache';

export abstract class HttpClient {
  protected baseUrl: string;
  protected timeout: number;
  protected headers: Record<string, string>;
  protected maxRetries: number;
  protected retryDelay: number;
  protected requestInterceptors: RequestInterceptor[] = [];
  protected responseInterceptors: ResponseInterceptor[] = [];
  protected cache: CacheStrategy;
  protected cacheEnabled: boolean;
  protected cacheTTL: number;
  protected respectCacheHeaders: boolean;

  constructor(
    baseUrl: string,
    timeout: number = 5000,
    maxRetries: number = 3,
    retryDelay: number = 1000,
    cacheConfig?: {
      enabled?: boolean;
      ttl?: number;
      respectCacheHeaders?: boolean;
      maxSize?: number;
    }
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = timeout;
    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'computor-vsc-extension',
    };
    
    this.cacheEnabled = cacheConfig?.enabled ?? false;
    this.cacheTTL = cacheConfig?.ttl ?? 300000; // 5 minutes default
    this.respectCacheHeaders = cacheConfig?.respectCacheHeaders ?? true;
    
    if (this.cacheEnabled) {
      this.cache = new InMemoryCache(cacheConfig?.maxSize ?? 100);
    } else {
      this.cache = new NoOpCache();
    }
  }

  abstract authenticate(): Promise<void>;
  abstract isAuthenticated(): boolean;
  abstract getAuthHeaders(): Record<string, string>;

  async get<T>(endpoint: string, params?: Record<string, any>): Promise<HttpResponse<T>> {
    return this.request<T>('GET', endpoint, undefined, params);
  }

  async post<T>(endpoint: string, data?: any, params?: Record<string, any>): Promise<HttpResponse<T>> {
    return this.request<T>('POST', endpoint, data, params);
  }

  async put<T>(endpoint: string, data?: any, params?: Record<string, any>): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', endpoint, data, params);
  }

  async delete<T>(endpoint: string, params?: Record<string, any>): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', endpoint, undefined, params);
  }

  async patch<T>(endpoint: string, data?: any, params?: Record<string, any>): Promise<HttpResponse<T>> {
    return this.request<T>('PATCH', endpoint, data, params);
  }

  protected async request<T>(
    method: HttpMethod,
    endpoint: string,
    data?: any,
    params?: Record<string, any>
  ): Promise<HttpResponse<T>> {
    const config = await this.buildRequestConfig(method, endpoint, data, params);

    // Check cache for GET requests
    if (this.cacheEnabled && method === 'GET') {
      const cacheKey = this.createCacheKey(config);
      const cachedEntry = await this.cache.get<T>(cacheKey);

      if (cachedEntry && !this.cache.isExpired(cachedEntry)) {
        return cachedEntry.data as HttpResponse<T>;
      }
    }

    const startTime = Date.now();
    const maxTotalRetryTime = 30000; // 30 seconds maximum total retry time

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.executeRequest<T>(config);

        // Cache successful GET responses (200-299 range, but typically 200 for GET)
        if (this.cacheEnabled && method === 'GET' && response.status >= 200 && response.status < 300) {
          const cacheKey = this.createCacheKey(config);
          const ttl = this.getCacheTTL(response.headers);

          await this.cache.set(cacheKey, {
            data: response,
            timestamp: Date.now(),
            ttl,
            etag: response.headers['etag'],
            lastModified: response.headers['last-modified'],
          });
        }

        return response;
      } catch (error) {
        // Check if we've exceeded maximum total retry time
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime >= maxTotalRetryTime) {
          throw new Error(`Request failed after ${Math.round(elapsedTime / 1000)}s (max retry time exceeded): ${error instanceof Error ? error.message : String(error)}`);
        }

        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          throw error;
        }
        await this.delay(this.retryDelay * Math.pow(2, attempt));
      }
    }

    throw new Error('Max retries exceeded');
  }

  private async buildRequestConfig(
    method: HttpMethod,
    endpoint: string,
    data?: any,
    params?: Record<string, any>
  ): Promise<HttpRequestConfig> {
    const url = this.buildUrl(endpoint, params);
    const headers = { ...this.headers, ...this.getAuthHeaders() };

    if (data && this.isFormData(data)) {
      delete headers['Content-Type'];
      const formHeaders = typeof (data as any).getHeaders === 'function' ? (data as any).getHeaders() : {};
      Object.assign(headers, formHeaders);
    }

    let config: HttpRequestConfig = {
      method,
      url,
      headers,
      data,
      params,
      timeout: this.timeout,
    };

    for (const interceptor of this.requestInterceptors) {
      config = await interceptor.onRequest(config);
    }

    this.validateRequest(config);
    return config;
  }

  private async executeRequest<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const requestHeaders: Record<string, string> = { ...(config.headers ?? {}) };
      let body: any = undefined;
      if (config.data !== undefined && config.data !== null) {
        if (this.isFormData(config.data)) {
          body = config.data;
        } else if (Buffer.isBuffer(config.data) || config.data instanceof Uint8Array) {
          body = config.data;
        } else if (typeof config.data === 'string') {
          body = config.data;
          if (!requestHeaders['Content-Type']) {
            requestHeaders['Content-Type'] = 'text/plain';
          }
        } else {
          if (!requestHeaders['Content-Type']) {
            requestHeaders['Content-Type'] = 'application/json';
          }
          body = JSON.stringify(config.data);
        }
      }

      const response = await fetch(config.url, {
        method: config.method,
        headers: requestHeaders,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseData = await this.parseResponse<T>(response);
      const responseHeaders = this.parseHeaders(response.headers);

      let httpResponse: HttpResponse<T> = {
        data: responseData,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      };

      for (const interceptor of this.responseInterceptors) {
        httpResponse = await interceptor.onResponse(httpResponse);
      }

      if (!response.ok) {
        throw new HttpError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          response.statusText,
          responseData
        );
      }

      return httpResponse;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
        throw new TimeoutError(`Request timeout after ${config.timeout}ms`);
      }

      if (error instanceof HttpError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCause = error instanceof Error ? error : undefined;
      throw new NetworkError(`Network error: ${errorMessage}`, errorCause);
    }
  }

  private buildUrl(endpoint: string, params?: Record<string, any>): string {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    
    if (!params || Object.keys(params).length === 0) {
      return url;
    }

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }

    return `${url}?${searchParams.toString()}`;
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    // Handle 204 No Content responses - they have no body
    if (response.status === 204) {
      return null as unknown as T;
    }
    
    // Handle empty responses
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0') {
      return null as unknown as T;
    }
    
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      const text = await response.text();
      // Handle empty response body
      if (!text || text.trim() === '') {
        return null as unknown as T;
      }
      return JSON.parse(text) as T;
    }
    
    if (contentType?.includes('text/')) {
      return await response.text() as unknown as T;
    }
    
    return await response.arrayBuffer() as unknown as T;
  }

  private parseHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value: string, key: string) => {
      result[key] = value;
    });
    return result;
  }

  private validateRequest(config: HttpRequestConfig): void {
    if (!config.url) {
      throw new ValidationError('URL is required');
    }

    if (!config.method) {
      throw new ValidationError('HTTP method is required');
    }

    if (config.timeout && config.timeout < 0) {
      throw new ValidationError('Timeout must be positive');
    }
  }

  private isRetryableError(error: any): boolean {
    if (error instanceof TimeoutError) {
      return true;
    }

    if (error instanceof NetworkError) {
      return true;
    }

    if (error instanceof HttpError) {
      const status = error.status;

      // Retry rate limiting (429)
      if (status === 429) {
        return true;
      }

      // Retry request timeout (408)
      if (status === 408) {
        return true;
      }

      // Don't retry server errors (5xx) - they indicate backend problems
      // that won't be fixed by immediate retries
      if (status >= 500) {
        return false;
      }

      // Don't retry client errors (4xx) except those explicitly handled above
      // Common non-retryable errors: 400, 401, 403, 404, etc.
      if (status >= 400 && status < 500) {
        return false;
      }

      // For other status codes, don't retry
      return false;
    }

    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isFormData(data: any): data is { getHeaders?: () => Record<string, string>; append: Function } {
    if (!data || typeof data !== 'object') {
      return false;
    }
    const maybeForm = data as { getBoundary?: () => string; append?: Function };
    return typeof maybeForm.append === 'function' && typeof maybeForm.getBoundary === 'function';
  }

  public addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  public addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  public setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  public setTimeout(timeout: number): void {
    this.timeout = timeout;
  }

  public setDefaultHeaders(headers: Record<string, string>): void {
    this.headers = { ...this.headers, ...headers };
  }

  private createCacheKey(config: HttpRequestConfig): CacheKey {
    return {
      method: config.method,
      url: config.url,
      params: config.params ? JSON.stringify(config.params) : undefined,
      body: config.data && !this.isFormData(config.data) && !Buffer.isBuffer(config.data)
        ? JSON.stringify(config.data)
        : undefined,
    };
  }

  private getCacheTTL(headers: Record<string, string>): number {
    if (!this.respectCacheHeaders) {
      return this.cacheTTL;
    }

    const cacheControl = headers['cache-control'];
    if (cacheControl) {
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      if (maxAgeMatch && maxAgeMatch[1]) {
        return parseInt(maxAgeMatch[1], 10) * 1000; // Convert to milliseconds
      }
      
      if (cacheControl.includes('no-cache') || cacheControl.includes('no-store')) {
        return 0; // Don't cache
      }
    }

    return this.cacheTTL;
  }

  public async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  public async invalidateCacheEntry(endpoint: string, method: HttpMethod = 'GET', params?: Record<string, any>): Promise<void> {
    const url = this.buildUrl(endpoint, params);
    const cacheKey: CacheKey = {
      method,
      url,
      params: params ? JSON.stringify(params) : undefined,
    };
    await this.cache.delete(cacheKey);
  }

  public setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    if (enabled && this.cache instanceof NoOpCache) {
      this.cache = new InMemoryCache(100);
    } else if (!enabled && !(this.cache instanceof NoOpCache)) {
      this.cache = new NoOpCache();
    }
  }
}
