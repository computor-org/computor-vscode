/**
 * Backend error catalog types
 * Generic types matching the structure of error-catalog.vscode.json
 */

export type ErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'conflict'
  | 'database'
  | 'external_service'
  | 'internal'
  | 'not_found'
  | 'not_implemented'
  | 'rate_limit'
  | 'validation';

export type ErrorSeverity =
  | 'info'
  | 'warning'
  | 'error'
  | 'critical';

export interface ErrorMessage {
  plain: string;
  markdown: string;
  html: string;
}

export interface BackendErrorDefinition {
  code: string;
  http_status: number;
  category: ErrorCategory;
  severity: ErrorSeverity;
  title: string;
  message: ErrorMessage;
  retry_after: number | null;
}

export interface ErrorCatalogData {
  version: string;
  generated_at: string;
  error_count: number;
  errors: Record<string, BackendErrorDefinition>;
}

/**
 * Backend error response structure
 * This is what the backend actually returns in HTTP responses
 */
export interface BackendErrorResponse {
  error_code?: string;
  detail?: string | any;
  message?: string;
}
