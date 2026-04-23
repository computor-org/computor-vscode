import { expect } from 'chai';
import { HttpClient } from '../../src/http/HttpClient';
import { HttpError, AuthenticationError, NetworkError, TimeoutError } from '../../src/http/errors';

class TestHttpClient extends HttpClient {
  private authenticated = false;
  private authHeaders: Record<string, string> = {};

  async authenticate(): Promise<void> {
    this.authenticated = true;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  getAuthHeaders(): Record<string, string> {
    return this.authHeaders;
  }

  setAuthHeaders(headers: Record<string, string>): void {
    this.authHeaders = headers;
  }

  setAuthenticated(authenticated: boolean): void {
    this.authenticated = authenticated;
  }

  // Test helpers to access protected properties
  getBaseUrl(): string {
    return this.baseUrl;
  }

  getTimeout(): number {
    return this.timeout;
  }

  getHeaders(): Record<string, string> {
    return this.headers;
  }
}

describe('HttpClient', () => {
  let client: TestHttpClient;

  beforeEach(() => {
    client = new TestHttpClient('https://api.example.com');
  });

  describe('constructor', () => {
    it('should initialize with base URL', () => {
      expect(client.getBaseUrl()).to.equal('https://api.example.com');
    });

    it('should remove trailing slash from base URL', () => {
      const clientWithSlash = new TestHttpClient('https://api.example.com/');
      expect(clientWithSlash.getBaseUrl()).to.equal('https://api.example.com');
    });

    it('should set default timeout', () => {
      expect(client.getTimeout()).to.equal(5000);
    });

    it('should set custom timeout', () => {
      const customClient = new TestHttpClient('https://api.example.com', 10000);
      expect(customClient.getTimeout()).to.equal(10000);
    });
  });

  describe('authentication', () => {
    it('should authenticate successfully', async () => {
      await client.authenticate();
      expect(client.isAuthenticated()).to.be.true;
    });

    it('should return auth headers', () => {
      const headers = { 'Authorization': 'Bearer token123' };
      client.setAuthHeaders(headers);
      expect(client.getAuthHeaders()).to.deep.equal(headers);
    });
  });

  describe('URL building', () => {
    it('should build URL with endpoint', () => {
      const url = client['buildUrl']('/users');
      expect(url).to.equal('https://api.example.com/users');
    });

    it('should build URL with endpoint without leading slash', () => {
      const url = client['buildUrl']('users');
      expect(url).to.equal('https://api.example.com/users');
    });

    it('should build URL with query parameters', () => {
      const url = client['buildUrl']('/users', { page: 1, limit: 10 });
      expect(url).to.equal('https://api.example.com/users?page=1&limit=10');
    });

    it('should ignore null and undefined parameters', () => {
      const url = client['buildUrl']('/users', { page: 1, limit: null, sort: undefined });
      expect(url).to.equal('https://api.example.com/users?page=1');
    });
  });

  describe('request validation', () => {
    it('should validate request config', () => {
      const validConfig = {
        method: 'GET' as const,
        url: 'https://api.example.com/users',
        headers: {},
        timeout: 5000,
      };

      expect(() => client['validateRequest'](validConfig)).to.not.throw();
    });

    it('should throw error for missing URL', () => {
      const invalidConfig = {
        method: 'GET' as const,
        url: '',
        headers: {},
        timeout: 5000,
      };

      expect(() => client['validateRequest'](invalidConfig)).to.throw('URL is required');
    });

    it('should throw error for negative timeout', () => {
      const invalidConfig = {
        method: 'GET' as const,
        url: 'https://api.example.com/users',
        headers: {},
        timeout: -1000,
      };

      expect(() => client['validateRequest'](invalidConfig)).to.throw('Timeout must be positive');
    });
  });

  describe('retryable errors', () => {
    it('should identify timeout errors as retryable', () => {
      const timeoutError = new TimeoutError('Request timeout');
      expect(client['isRetryableError'](timeoutError)).to.be.true;
    });

    it('should identify network errors as retryable', () => {
      const networkError = new NetworkError('Network error');
      expect(client['isRetryableError'](networkError)).to.be.true;
    });

    it('should not identify 500 errors as retryable (intentional: immediate retry will not fix a backend fault)', () => {
      const serverError = new HttpError('Server error', 500, 'Internal Server Error');
      expect(client['isRetryableError'](serverError)).to.be.false;
    });

    it('should identify 429 errors as retryable', () => {
      const rateLimitError = new HttpError('Rate limited', 429, 'Too Many Requests');
      expect(client['isRetryableError'](rateLimitError)).to.be.true;
    });

    it('should not identify 400 errors as retryable', () => {
      const badRequestError = new HttpError('Bad request', 400, 'Bad Request');
      expect(client['isRetryableError'](badRequestError)).to.be.false;
    });

    it('should not identify authentication errors as retryable', () => {
      const authError = new AuthenticationError('Authentication failed');
      expect(client['isRetryableError'](authError)).to.be.false;
    });
  });

  describe('configuration', () => {
    it('should set base URL', () => {
      client.setBaseUrl('https://new-api.example.com');
      expect(client.getBaseUrl()).to.equal('https://new-api.example.com');
    });

    it('should set timeout', () => {
      client.setTimeout(10000);
      expect(client.getTimeout()).to.equal(10000);
    });

    it('should set default headers', () => {
      const headers = { 'X-Custom-Header': 'value' };
      client.setDefaultHeaders(headers);
      expect(client.getHeaders()).to.include(headers);
    });
  });

  describe('interceptors', () => {
    it('should add request interceptor', () => {
      const interceptor = {
        onRequest: (config: any) => config,
        onError: (error: any) => Promise.reject(error),
      };

      client.addRequestInterceptor(interceptor);
      expect(client['requestInterceptors']).to.include(interceptor);
    });

    it('should add response interceptor', () => {
      const interceptor = {
        onResponse: (response: any) => response,
        onError: (error: any) => Promise.reject(error),
      };

      client.addResponseInterceptor(interceptor);
      expect(client['responseInterceptors']).to.include(interceptor);
    });
  });
});