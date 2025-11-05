import { errorCatalog } from '../../exceptions/ErrorCatalog';
import { BackendErrorDefinition } from '../../exceptions/types';

export class HttpError extends Error {
  public readonly errorCode?: string;
  public readonly backendError?: BackendErrorDefinition;

  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly response?: any
  ) {
    let enhancedMessage = message;
    let errorCode: string | undefined;
    let backendError: BackendErrorDefinition | undefined;

    // Check for backend error_code in response
    console.log('[HttpError] Response data:', JSON.stringify(response));
    if (response?.error_code && typeof response.error_code === 'string') {
      const codeFromResponse: string = response.error_code;
      errorCode = codeFromResponse;
      const catalogError = errorCatalog.getError(codeFromResponse);
      console.log(`[HttpError] Found error_code: ${codeFromResponse}, catalog entry:`, catalogError);
      if (catalogError) {
        backendError = catalogError;
        // If we found the error in catalog, use its user-friendly message
        enhancedMessage = backendError.message.plain;
        console.log(`[HttpError] Using backend error catalog for ${codeFromResponse}: ${backendError.title}`);
      } else {
        // Error code provided but not found in catalog
        console.warn(`[HttpError] Error code '${codeFromResponse}' not found in catalog. Available codes: ${errorCatalog.isLoaded() ? 'catalog loaded' : 'catalog not loaded'}`);
      }
    } else {
      console.log('[HttpError] No error_code found in response');
    }

    // Fallback to legacy error message extraction if no backend error found
    if (!backendError) {
      if (response?.detail) {
        // If detail is a string, append it
        if (typeof response.detail === 'string') {
          enhancedMessage = `${message} - ${response.detail}`;
        }
        // If detail is an array (validation errors), format them
        else if (Array.isArray(response.detail)) {
          const details = response.detail.map((d: any) =>
            typeof d === 'string' ? d : d.msg || JSON.stringify(d)
          ).join(', ');
          enhancedMessage = `${message} - ${details}`;
        }
        // If detail is an object, try to extract a message
        else if (typeof response.detail === 'object' && response.detail.message) {
          enhancedMessage = `${message} - ${response.detail.message}`;
        }
      }
      // Also check for 'message' field in response (some APIs use this)
      else if (response?.message && typeof response.message === 'string') {
        enhancedMessage = `${message} - ${response.message}`;
      }
    }

    super(enhancedMessage);
    this.name = 'HttpError';
    this.errorCode = errorCode;
    this.backendError = backendError;
  }

  /**
   * Check if this error has a backend error code
   */
  hasBackendError(): boolean {
    return this.backendError !== undefined;
  }

  /**
   * Get the error category if available
   */
  getCategory(): string | undefined {
    return this.backendError?.category;
  }

  /**
   * Get the error severity if available
   */
  getSeverity(): string | undefined {
    return this.backendError?.severity;
  }

  /**
   * Get retry_after value if available (in seconds)
   */
  getRetryAfter(): number | null | undefined {
    return this.backendError?.retry_after;
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}