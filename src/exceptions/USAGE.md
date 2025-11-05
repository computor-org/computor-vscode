# Backend Error Handling - Usage Guide

This guide shows how to use the new backend error catalog system integrated into the extension.

## Overview

The backend error catalog system provides:
- **50 standardized error codes** from the backend (e.g., `AUTH_001`, `VAL_003`, `NF_001`)
- **User-friendly error messages** in multiple formats (plain text, markdown, HTML)
- **Error categories and severity levels** for better error handling
- **Retry information** from the backend (`retry_after`)
- **Display strategies** for showing errors to users

## Quick Start

The error catalog is automatically initialized when the extension activates. No setup required!

## Basic Usage

### 1. Automatic Error Handling

When you catch an `HttpError`, it automatically includes backend error information if available:

```typescript
try {
  await apiService.getCourse(courseId);
} catch (error) {
  if (error instanceof HttpError) {
    // The error message is already user-friendly from the backend catalog
    vscode.window.showErrorMessage(error.message);

    // Check if it has backend error info
    if (error.hasBackendError()) {
      console.log('Error code:', error.errorCode);
      console.log('Category:', error.getCategory());
      console.log('Severity:', error.getSeverity());
    }
  }
}
```

### 2. Using Error Display Strategies

For better user experience, use the display strategies:

```typescript
import { errorRecoveryService } from '../services/ErrorRecoveryService';
import { HttpError } from '../http/errors/HttpError';

try {
  await apiService.submitAssignment(data);
} catch (error) {
  if (error instanceof HttpError && error.hasBackendError()) {
    // Show with interactive buttons (Retry, Show Details)
    errorRecoveryService.displayBackendError(
      error,
      'interactive',
      {
        retry: async () => {
          await apiService.submitAssignment(data);
        }
      }
    );
  } else {
    // Fallback for non-backend errors
    vscode.window.showErrorMessage(`Failed: ${error}`);
  }
}
```

### 3. Display Strategy Types

#### Notification (Simple)
Shows a simple VS Code notification based on severity:

```typescript
errorRecoveryService.displayBackendError(error, 'notification');
```

#### Interactive (With Buttons)
Shows error with Retry and Show Details buttons:

```typescript
errorRecoveryService.displayBackendError(error, 'interactive', {
  retry: async () => {
    // Retry logic here
  }
});
```

#### Detailed (Markdown Document)
Opens a detailed markdown document with full error information:

```typescript
errorRecoveryService.displayBackendError(error, 'detailed');
```

### 4. Using Error Recovery Service

The `ErrorRecoveryService` now automatically detects backend errors:

```typescript
import { errorRecoveryService } from '../services/ErrorRecoveryService';

const result = await errorRecoveryService.executeWithRecovery(
  async () => {
    return await apiService.getCourseContents(courseId);
  },
  {
    maxRetries: 3,
    exponentialBackoff: true
  }
);
```

The service will:
- Detect rate limit errors and use `retry_after` from backend
- Show user-friendly messages from the error catalog
- Automatically retry based on error category

### 5. Querying the Error Catalog Directly

```typescript
import { errorCatalog } from '../exceptions/ErrorCatalog';

// Get specific error definition
const authError = errorCatalog.getError('AUTH_001');
if (authError) {
  console.log('Title:', authError.title);
  console.log('Message:', authError.message.plain);
  console.log('HTTP Status:', authError.http_status);
}

// Get all errors in a category
const validationErrors = errorCatalog.getErrorsByCategory('validation');
console.log(`Found ${validationErrors.length} validation errors`);

// Get catalog metadata
const metadata = errorCatalog.getMetadata();
console.log(`Error catalog version: ${metadata?.version}`);
console.log(`Total errors: ${metadata?.error_count}`);
```

## Error Categories

The backend defines these error categories:
- `authentication` - Login, token, SSO errors
- `authorization` - Permission, access control errors
- `validation` - Invalid input, format errors
- `not_found` - Resource not found errors
- `conflict` - Duplicate, concurrent modification errors
- `rate_limit` - Too many requests
- `database` - Database connection, query errors
- `external_service` - GitLab, MinIO, Temporal errors
- `internal` - Server errors
- `not_implemented` - Feature not yet available

## Error Severity Levels

- `info` - Informational (e.g., resource not found)
- `warning` - Warning (e.g., insufficient permissions)
- `error` - Error (e.g., external service unavailable)
- `critical` - Critical (e.g., database failure)

## Advanced Usage

### Custom Display Strategy

You can create your own display strategy:

```typescript
import { ErrorDisplayStrategy, BackendErrorDefinition } from '../exceptions';

class CustomDisplayStrategy implements ErrorDisplayStrategy {
  display(error: BackendErrorDefinition, additionalContext?: string): void {
    // Custom display logic here
    const panel = vscode.window.createWebviewPanel(
      'errorDetails',
      error.title,
      vscode.ViewColumn.One,
      {}
    );

    panel.webview.html = `
      <html>
        <body>
          <h1>${error.title}</h1>
          ${error.message.html}
        </body>
      </html>
    `;
  }
}
```

### Handling Specific Error Codes

```typescript
try {
  await apiService.createCourseContent(data);
} catch (error) {
  if (error instanceof HttpError) {
    switch (error.errorCode) {
      case 'AUTH_001':
        // Handle authentication required
        await vscode.commands.executeCommand('computor.login');
        break;
      case 'AUTHZ_001':
        // Handle insufficient permissions
        vscode.window.showWarningMessage('You need lecturer permissions for this action');
        break;
      case 'RATE_001':
        // Handle rate limit
        const retryAfter = error.getRetryAfter();
        vscode.window.showWarningMessage(`Rate limited. Please wait ${retryAfter} seconds.`);
        break;
      default:
        // Generic error handling
        vscode.window.showErrorMessage(error.message);
    }
  }
}
```

## Best Practices

1. **Always check for HttpError**: Use `instanceof HttpError` to detect backend errors
2. **Use display strategies**: Don't manually format error messages - use the display strategies
3. **Provide retry options**: For retryable errors, offer a retry button
4. **Log error codes**: Always log the error code for debugging: `console.error('[Operation] Error:', error.errorCode, error.message)`
5. **Fallback gracefully**: Always have fallback error handling for non-backend errors

## Migration from Old Error Handling

### Before
```typescript
try {
  await apiService.getCourse(id);
} catch (error: any) {
  const message = error?.message || 'Unknown error';
  vscode.window.showErrorMessage(`Failed: ${message}`);
}
```

### After
```typescript
import { HttpError } from '../http/errors/HttpError';

try {
  await apiService.getCourse(id);
} catch (error) {
  if (error instanceof HttpError) {
    // User-friendly message automatically from catalog
    vscode.window.showErrorMessage(error.message);
  } else {
    vscode.window.showErrorMessage(`Failed: ${error}`);
  }
}
```

Or even better, use the error recovery service:

```typescript
import { errorRecoveryService } from '../services/ErrorRecoveryService';

try {
  await apiService.getCourse(id);
} catch (error) {
  await errorRecoveryService.showErrorWithRecovery(
    'Failed to load course',
    error instanceof Error ? error : new Error(String(error)),
    {
      retry: async () => {
        await apiService.getCourse(id);
      }
    }
  );
}
```

## Troubleshooting

### Error catalog not loading
If you see warnings like "Catalog not loaded", check:
1. The `error-catalog.vscode.json` file exists in `src/exceptions/`
2. The file is included in webpack bundle (check `webpack.config.js`)
3. The extension is properly compiled

### Backend error not detected
If backend errors aren't being recognized:
1. Check that backend is sending `error_code` field in responses
2. Verify the error code exists in the catalog
3. Check console logs for catalog lookup results

## Examples in Codebase

See these files for real-world usage examples:
- [src/services/ErrorRecoveryService.ts](../services/ErrorRecoveryService.ts) - Error recovery strategies
- [src/http/errors/HttpError.ts](../http/errors/HttpError.ts) - Enhanced HttpError class
- [src/services/ComputorApiService.ts](../services/ComputorApiService.ts) - API error handling

## Reference

- [Error Catalog JSON](./error-catalog.vscode.json) - Complete error definitions
- [Error Codes Documentation](./ERROR_CODES.md) - Human-readable error reference
- [Type Definitions](./types.ts) - TypeScript interfaces
