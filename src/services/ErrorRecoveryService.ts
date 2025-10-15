import * as vscode from 'vscode';
import { BackendConnectionService } from './BackendConnectionService';
import { HttpError } from '../http/errors/HttpError';
import { ErrorDisplayStrategyFactory } from '../exceptions/ErrorDisplayStrategy';

export interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  exponentialBackoff?: boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

export interface ErrorRecoveryStrategy {
  canRecover(error: Error): boolean;
  recover(error: Error): Promise<void>;
}

export class NetworkErrorStrategy implements ErrorRecoveryStrategy {
  private backendConnectionService = BackendConnectionService.getInstance();
  private lastDetailedCheckTime = 0;
  private detailedCheckInterval = 10000; // 10 seconds between detailed checks
  
  canRecover(error: Error): boolean {
    return error.message.includes('ECONNREFUSED') ||
           error.message.includes('ETIMEDOUT') ||
           error.message.includes('ENOTFOUND') ||
           error.message.includes('ENETUNREACH') ||
           error.message.includes('NetworkError') ||
           error.message.includes('fetch');
  }
  
  async recover(error: Error): Promise<void> {
    const now = Date.now();
    
    // If enough time has passed, do a detailed backend check
    if (now - this.lastDetailedCheckTime > this.detailedCheckInterval) {
      this.lastDetailedCheckTime = now;
      
      // Get backend URL from the backend connection service
      const baseUrl = this.backendConnectionService.getBaseUrl();
      
      // Check backend connection with detailed diagnostics
      const status = await this.backendConnectionService.checkBackendConnection(baseUrl);
      
      if (!status.isReachable) {
        // Show detailed error based on the specific problem
        await this.backendConnectionService.showConnectionError(status);
        throw error; // Still throw the error after showing detailed message
      }
    } else {
      // Show simple retry message for quick retries
      const retry = await vscode.window.showWarningMessage(
        'Network connection failed. The backend might not be running or there may be network issues.',
        'Retry',
        'Check Backend',
        'Cancel'
      );
      
      if (retry === 'Check Backend') {
        const baseUrl = this.backendConnectionService.getBaseUrl();
        const status = await this.backendConnectionService.checkBackendConnection(baseUrl);
        await this.backendConnectionService.showConnectionError(status);
        throw error;
      } else if (retry !== 'Retry') {
        throw error;
      }
    }
  }
}

export class AuthenticationErrorStrategy implements ErrorRecoveryStrategy {
  canRecover(error: Error): boolean {
    return error.message.includes('401') ||
           error.message.includes('Unauthorized');
  }

  async recover(error: Error): Promise<void> {
    const action = await vscode.window.showErrorMessage(
      'Authentication failed. Your session may have expired. Please reload the window to refresh your session.',
      'Reload Window',
      'Cancel'
    );

    if (action === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } else {
      throw error;
    }
  }
}

export class RateLimitErrorStrategy implements ErrorRecoveryStrategy {
  private lastRetryTime: number = 0;
  private readonly minRetryDelay = 5000; // 5 seconds

  canRecover(error: Error): boolean {
    if (error instanceof HttpError && error.hasBackendError()) {
      return error.getCategory() === 'rate_limit';
    }
    return error.message.includes('429') ||
           error.message.includes('Too Many Requests') ||
           error.message.includes('Rate limit');
  }

  async recover(error: Error): Promise<void> {
    const now = Date.now();
    let waitTime = this.minRetryDelay;

    // Use retry_after from backend if available
    if (error instanceof HttpError && error.hasBackendError()) {
      const retryAfter = error.getRetryAfter();
      if (retryAfter && retryAfter > 0) {
        waitTime = retryAfter * 1000; // Convert seconds to milliseconds
      }
    }

    const timeSinceLastRetry = now - this.lastRetryTime;

    if (timeSinceLastRetry < waitTime) {
      const remainingWait = Math.ceil((waitTime - timeSinceLastRetry) / 1000);
      throw new Error(`Rate limited. Please wait ${remainingWait} seconds before retrying.`);
    }

    this.lastRetryTime = now;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Rate limited. Waiting ${Math.ceil(waitTime / 1000)} seconds before retry...`,
      cancellable: false
    }, async (progress) => {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    });
  }
}

export class ErrorRecoveryService {
  private strategies: ErrorRecoveryStrategy[] = [
    new NetworkErrorStrategy(),
    new AuthenticationErrorStrategy(),
    new RateLimitErrorStrategy()
  ];
  
  /**
   * Check if error is a non-retryable HTTP client error (4xx except 401, 408, 429)
   */
  private isNonRetryableClientError(error: Error): boolean {
    const message = error.message;

    // Check for HTTP 4xx errors in the message
    const httpErrorMatch = message.match(/HTTP (\d{3})/);
    if (httpErrorMatch && httpErrorMatch[1]) {
      const statusCode = parseInt(httpErrorMatch[1], 10);

      // Don't retry client errors (400-499) except:
      // - 401 (handled by AuthenticationErrorStrategy)
      // - 408 (Request Timeout - can retry)
      // - 429 (Rate Limit - handled by RateLimitErrorStrategy)
      if (statusCode >= 400 && statusCode < 500) {
        return statusCode !== 401 && statusCode !== 408 && statusCode !== 429;
      }
    }

    return false;
  }

  /**
   * Execute a function with automatic retry and error recovery
   */
  async executeWithRecovery<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      retryDelay = 1000,
      exponentialBackoff = true,
      onRetry
    } = options;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry non-retryable client errors (like 403, 404, etc.)
        if (this.isNonRetryableClientError(lastError)) {
          throw lastError;
        }

        // Try to recover using strategies
        const strategy = this.strategies.find(s => s.canRecover(lastError!));

        if (strategy && attempt < maxRetries) {
          try {
            await strategy.recover(lastError);

            if (onRetry) {
              onRetry(attempt + 1, lastError);
            }

            // Calculate delay with exponential backoff
            const delay = exponentialBackoff
              ? retryDelay * Math.pow(2, attempt)
              : retryDelay;

            if (delay > 0) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }

            continue; // Retry
          } catch (recoveryError) {
            // Recovery failed, propagate error
            throw recoveryError;
          }
        }

        // No recovery possible or max retries reached
        if (attempt === maxRetries) {
          throw this.enhanceError(lastError, attempt);
        }
      }
    }

    throw lastError || new Error('Operation failed');
  }
  
  /**
   * Enhance error with additional context
   */
  private enhanceError(error: Error, attempts: number): Error {
    const enhancedError = new Error(
      `${error.message} (failed after ${attempts} attempts)`
    );
    enhancedError.stack = error.stack;
    return enhancedError;
  }
  
  /**
   * Register a custom recovery strategy
   */
  registerStrategy(strategy: ErrorRecoveryStrategy): void {
    this.strategies.unshift(strategy); // Add at beginning for priority
  }
  
  /**
   * Create a circuit breaker for a function
   */
  createCircuitBreaker<T>(
    fn: () => Promise<T>,
    threshold: number = 5,
    timeout: number = 60000
  ): () => Promise<T> {
    let failures = 0;
    let lastFailureTime = 0;
    let isOpen = false;
    
    return async () => {
      // Check if circuit is open
      if (isOpen) {
        const timeSinceFailure = Date.now() - lastFailureTime;
        
        if (timeSinceFailure < timeout) {
          throw new Error('Circuit breaker is open. Service temporarily unavailable.');
        }
        
        // Try to close circuit
        isOpen = false;
        failures = 0;
      }
      
      try {
        const result = await fn();
        failures = 0; // Reset on success
        return result;
      } catch (error) {
        failures++;
        lastFailureTime = Date.now();
        
        if (failures >= threshold) {
          isOpen = true;
          throw new Error('Service unavailable. Too many failures detected.');
        }
        
        throw error;
      }
    };
  }
  
  /**
   * Show error with recovery options
   */
  async showErrorWithRecovery(
    message: string,
    error: Error,
    recoveryOptions?: {
      retry?: () => Promise<void>;
      alternative?: () => Promise<void>;
      alternativeLabel?: string;
    }
  ): Promise<void> {
    // If this is an HttpError with backend error definition, use the display strategy
    if (error instanceof HttpError && error.hasBackendError() && error.backendError) {
      const displayStrategy = ErrorDisplayStrategyFactory.createStrategy('interactive', {
        onRetry: recoveryOptions?.retry,
        onShowDetails: (backendError) => {
          const detailedStrategy = ErrorDisplayStrategyFactory.createStrategy('detailed');
          void detailedStrategy.display(backendError);
        }
      });

      await displayStrategy.display(error.backendError);
      return;
    }

    // Fallback to legacy error display
    const actions: string[] = [];

    if (recoveryOptions?.retry) {
      actions.push('Retry');
    }

    if (recoveryOptions?.alternative) {
      actions.push(recoveryOptions.alternativeLabel || 'Alternative Action');
    }

    actions.push('Show Details');

    const selection = await vscode.window.showErrorMessage(message, ...actions);

    if (selection === 'Retry' && recoveryOptions?.retry) {
      try {
        await recoveryOptions.retry();
      } catch (retryError) {
        vscode.window.showErrorMessage(`Retry failed: ${retryError}`);
      }
    } else if (selection === recoveryOptions?.alternativeLabel && recoveryOptions?.alternative) {
      try {
        await recoveryOptions.alternative();
      } catch (altError) {
        vscode.window.showErrorMessage(`Alternative action failed: ${altError}`);
      }
    } else if (selection === 'Show Details') {
      const details = `Error: ${error.message}\n\nStack trace:\n${error.stack}`;
      vscode.window.showErrorMessage(details, { modal: true });
    }
  }

  /**
   * Display a backend error using appropriate strategy
   */
  displayBackendError(
    error: HttpError,
    strategyType: 'notification' | 'interactive' | 'detailed' = 'notification',
    recoveryOptions?: {
      retry?: () => Promise<void>;
    }
  ): void {
    if (!error.hasBackendError() || !error.backendError) {
      // Fallback to simple error message
      vscode.window.showErrorMessage(error.message);
      return;
    }

    const displayStrategy = ErrorDisplayStrategyFactory.createStrategy(strategyType, {
      onRetry: recoveryOptions?.retry,
      onShowDetails: (backendError) => {
        const detailedStrategy = ErrorDisplayStrategyFactory.createStrategy('detailed');
        void detailedStrategy.display(backendError);
      }
    });

    void displayStrategy.display(error.backendError);
  }
}

// Export singleton instance
export const errorRecoveryService = new ErrorRecoveryService();