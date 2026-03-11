import * as path from 'path';
import * as fs from 'fs';
import { ClientErrorCatalogData, ClientErrorDefinition } from './client-error-types';

/**
 * Singleton class to load and query the client-side error catalog
 */
export class ClientErrorCatalog {
  private static instance: ClientErrorCatalog;
  private catalog: ClientErrorCatalogData | null = null;
  private initialized = false;

  private constructor() {}

  static getInstance(): ClientErrorCatalog {
    if (!ClientErrorCatalog.instance) {
      ClientErrorCatalog.instance = new ClientErrorCatalog();
    }
    return ClientErrorCatalog.instance;
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }

    try {
      const catalogPath = path.join(__dirname, 'exceptions', 'client-error-catalog.json');
      const catalogContent = fs.readFileSync(catalogPath, 'utf-8');
      this.catalog = JSON.parse(catalogContent) as ClientErrorCatalogData;
      this.initialized = true;
      console.log(`[ClientErrorCatalog] Loaded ${Object.keys(this.catalog.errors).length} error definitions`);
    } catch (error) {
      console.error('[ClientErrorCatalog] Failed to load:', error);
      this.catalog = null;
      this.initialized = false;
    }
  }

  getError(code: string): ClientErrorDefinition | undefined {
    if (!this.catalog) {
      console.warn('[ClientErrorCatalog] Catalog not loaded, call initialize() first');
      return undefined;
    }
    return this.catalog.errors[code];
  }

  isLoaded(): boolean {
    return this.initialized && this.catalog !== null;
  }
}

export const clientErrorCatalog = ClientErrorCatalog.getInstance();
