import * as path from 'path';
import * as fs from 'fs';
import { ErrorCatalogData, BackendErrorDefinition } from './types';

/**
 * Singleton class to load and query the backend error catalog
 */
export class ErrorCatalog {
  private static instance: ErrorCatalog;
  private catalog: ErrorCatalogData | null = null;
  private initialized = false;

  private constructor() {}

  static getInstance(): ErrorCatalog {
    if (!ErrorCatalog.instance) {
      ErrorCatalog.instance = new ErrorCatalog();
    }
    return ErrorCatalog.instance;
  }

  /**
   * Initialize the error catalog by loading the JSON file
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    try {
      const catalogPath = path.join(__dirname, 'error-catalog.vscode.json');
      const catalogContent = fs.readFileSync(catalogPath, 'utf-8');
      this.catalog = JSON.parse(catalogContent) as ErrorCatalogData;
      this.initialized = true;
      console.log(`[ErrorCatalog] Loaded ${this.catalog.error_count} error definitions (version ${this.catalog.version})`);
    } catch (error) {
      console.error('[ErrorCatalog] Failed to load error catalog:', error);
      this.catalog = null;
      this.initialized = false;
    }
  }

  /**
   * Get error definition by error code
   */
  getError(errorCode: string): BackendErrorDefinition | undefined {
    if (!this.catalog) {
      console.warn('[ErrorCatalog] Catalog not loaded, call initialize() first');
      return undefined;
    }

    return this.catalog.errors[errorCode];
  }

  /**
   * Get all errors in a specific category
   */
  getErrorsByCategory(category: string): BackendErrorDefinition[] {
    if (!this.catalog) {
      return [];
    }

    return Object.values(this.catalog.errors).filter(
      error => error.category === category
    );
  }

  /**
   * Get all errors with a specific HTTP status code
   */
  getErrorsByStatus(httpStatus: number): BackendErrorDefinition[] {
    if (!this.catalog) {
      return [];
    }

    return Object.values(this.catalog.errors).filter(
      error => error.http_status === httpStatus
    );
  }

  /**
   * Check if catalog is loaded
   */
  isLoaded(): boolean {
    return this.initialized && this.catalog !== null;
  }

  /**
   * Get catalog metadata
   */
  getMetadata(): { version: string; generated_at: string; error_count: number } | null {
    if (!this.catalog) {
      return null;
    }

    return {
      version: this.catalog.version,
      generated_at: this.catalog.generated_at,
      error_count: this.catalog.error_count
    };
  }
}

// Export singleton instance
export const errorCatalog = ErrorCatalog.getInstance();
