import { expect } from 'chai';
import { ApiKeyHttpClient } from '../../src/http/ApiKeyHttpClient';
import { AuthenticationError } from '../../src/exceptions/errors';

describe('ApiKeyHttpClient', () => {
  let client: ApiKeyHttpClient;

  beforeEach(() => {
    client = new ApiKeyHttpClient('https://api.example.com', 'test-api-key-123');
  });

  describe('constructor', () => {
    it('should initialize with API key', () => {
      expect(client.getApiKey()).to.equal('test-api-key-123');
      expect(client.getHeaderName()).to.equal('X-API-Key');
      expect(client.getHeaderPrefix()).to.equal('');
    });

    it('should initialize with custom header name and prefix', () => {
      const customClient = new ApiKeyHttpClient(
        'https://api.example.com',
        'token123',
        'Authorization',
        'Bearer'
      );
      
      expect(customClient.getHeaderName()).to.equal('Authorization');
      expect(customClient.getHeaderPrefix()).to.equal('Bearer');
    });
  });

  describe('authentication', () => {
    it('should throw error when API key is missing', async () => {
      const clientWithoutKey = new ApiKeyHttpClient('https://api.example.com', '');
      
      try {
        await clientWithoutKey.authenticate();
        expect.fail('Should have thrown AuthenticationError');
      } catch (error) {
        expect(error).to.be.instanceOf(AuthenticationError);
        if (error instanceof Error) {
          expect(error.message).to.equal('API key is required');
        }
      }
    });

    it('should set authenticated state after successful validation', async () => {
      // Mock successful validation
      // @ts-ignore - mocking for test
      client.get = async () => ({ data: {}, status: 200, statusText: 'OK', headers: {} });
      
      await client.authenticate();
      expect(client.isAuthenticated()).to.be.true;
    });

    it('should handle validation failure', async () => {
      // Mock failed validation
      // @ts-ignore - mocking for test
      client.get = async () => {
        throw new Error('Unauthorized');
      };

      try {
        await client.authenticate();
        expect.fail('Should have thrown AuthenticationError');
      } catch (error) {
        expect(error).to.be.instanceOf(AuthenticationError);
        if (error instanceof Error) {
          expect(error.message).to.include('API key validation failed');
        }
        expect(client.isAuthenticated()).to.be.false;
      }
    });
  });

  describe('auth headers', () => {
    it('should generate correct API key header without prefix', () => {
      const headers = client.getAuthHeaders();
      expect(headers['X-API-Key']).to.equal('test-api-key-123');
    });

    it('should generate correct API key header with prefix', () => {
      const clientWithPrefix = new ApiKeyHttpClient(
        'https://api.example.com',
        'token123',
        'Authorization',
        'Bearer'
      );
      
      const headers = clientWithPrefix.getAuthHeaders();
      expect(headers['Authorization']).to.equal('Bearer token123');
    });

    it('should return empty headers when API key is missing', () => {
      const clientWithoutKey = new ApiKeyHttpClient('https://api.example.com', '');
      const headers = clientWithoutKey.getAuthHeaders();
      expect(headers).to.be.empty;
    });
  });

  describe('configuration', () => {
    it('should update API key', () => {
      client.setApiKey('new-api-key');
      expect(client.getApiKey()).to.equal('new-api-key');
      expect(client.isAuthenticated()).to.be.false;
    });

    it('should update header name', () => {
      client.setHeaderName('X-Custom-Key');
      expect(client.getHeaderName()).to.equal('X-Custom-Key');
    });

    it('should update header prefix', () => {
      client.setHeaderPrefix('Token');
      expect(client.getHeaderPrefix()).to.equal('Token');
    });

    it('should update auth headers after configuration change', () => {
      client.setHeaderName('Authorization');
      client.setHeaderPrefix('Bearer');
      
      const headers = client.getAuthHeaders();
      expect(headers['Authorization']).to.equal('Bearer test-api-key-123');
    });
  });

  describe('factory methods', () => {
    it('should create GitLab token client', () => {
      const gitlabClient = ApiKeyHttpClient.createGitLabTokenClient(
        'https://gitlab.example.com',
        'glpat-token123'
      );
      
      expect(gitlabClient.getApiKey()).to.equal('glpat-token123');
      expect(gitlabClient.getHeaderName()).to.equal('Authorization');
      expect(gitlabClient.getHeaderPrefix()).to.equal('Bearer');
      
      const headers = gitlabClient.getAuthHeaders();
      expect(headers['Authorization']).to.equal('Bearer glpat-token123');
    });

    it('should create generic token client', () => {
      const genericClient = ApiKeyHttpClient.createGenericTokenClient(
        'https://api.example.com',
        'generic-token123'
      );
      
      expect(genericClient.getApiKey()).to.equal('generic-token123');
      expect(genericClient.getHeaderName()).to.equal('X-API-Key');
      expect(genericClient.getHeaderPrefix()).to.equal('');
      
      const headers = genericClient.getAuthHeaders();
      expect(headers['X-API-Key']).to.equal('generic-token123');
    });
  });

  describe('authentication state', () => {
    it('should return false when not authenticated', () => {
      expect(client.isAuthenticated()).to.be.false;
    });

    it('should return false when API key is empty', () => {
      client.setApiKey('');
      expect(client.isAuthenticated()).to.be.false;
    });

    it('should return true when authenticated and API key exists', async () => {
      // Mock successful authentication
      // @ts-ignore - mocking for test
      client.get = async () => ({ data: {}, status: 200, statusText: 'OK', headers: {} });
      
      await client.authenticate();
      expect(client.isAuthenticated()).to.be.true;
    });
  });
});