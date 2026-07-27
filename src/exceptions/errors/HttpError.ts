import { errorCatalog } from '../ErrorCatalog';
import { BackendErrorDefinition } from '../types';

export class HttpError extends Error {
  public readonly errorCode?: string;
  public readonly backendError?: BackendErrorDefinition;

  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly response?: any
  ) {
    let errorCode: string | undefined;
    let backendError: BackendErrorDefinition | undefined;

    // The backend's specific, actionable text for THIS request (e.g. "Course
    // content is missing a testing service to link submissions"). Prefer it over
    // the generic per-code catalog text so the user sees the real reason — the
    // catalog message is only a fallback when the server sent no specific text.
    const serverDetail = HttpError.extractServerDetail(response);

    let enhancedMessage = message;
    if (response?.error_code && typeof response.error_code === 'string') {
      const code: string = response.error_code;
      errorCode = code;
      const catalogError = errorCatalog.getError(code);
      if (catalogError) {
        backendError = catalogError;
        enhancedMessage = serverDetail || backendError.message.plain;
      } else if (serverDetail) {
        enhancedMessage = `${message} - ${serverDetail}`;
      }
    } else if (serverDetail) {
      enhancedMessage = `${message} - ${serverDetail}`;
    }

    super(enhancedMessage);
    this.name = 'HttpError';
    this.errorCode = errorCode;
    this.backendError = backendError;
  }

  /**
   * Pull the server's specific human-readable reason out of an error response,
   * regardless of which field carries it: `message` (the backend's default),
   * `detail` (string), `detail[]` (FastAPI validation errors), or
   * `detail.message`. Returns undefined when there's nothing specific.
   */
  private static extractServerDetail(response: any): string | undefined {
    if (!response || typeof response !== 'object') {
      return undefined;
    }
    const detail = response.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail.trim();
    }
    if (Array.isArray(detail)) {
      const joined = detail
        .map((d: any) => (typeof d === 'string' ? d : d?.msg || JSON.stringify(d)))
        .filter(Boolean)
        .join(', ');
      if (joined) return joined;
    } else if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
      return detail.message;
    }
    if (typeof response.message === 'string' && response.message.trim()) {
      return response.message.trim();
    }
    return undefined;
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

export class MaintenanceError extends Error {
  constructor(message: string = 'System is under maintenance. Please try again later.') {
    super(message);
    this.name = 'MaintenanceError';
  }
}