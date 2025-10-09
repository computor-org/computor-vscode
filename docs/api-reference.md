# API Integration Guide

This document explains how the VS Code extension integrates with the Computor backend API.

## Table of Contents

- [Overview](#overview)
- [Backend API Specification](#backend-api-specification)
- [Authentication](#authentication)
- [Using ComputorApiService](#using-computorapiservice)
- [Type Safety](#type-safety)
- [Error Handling](#error-handling)
- [Caching](#caching)
- [Examples](#examples)

---

## Overview

The extension communicates with the Computor backend through the `ComputorApiService` class, which provides a type-safe wrapper around the HTTP client.

**Key Components**:
- **ComputorApiService**: Main API service ([source](../src/services/ComputorApiService.ts))
- **HTTP Clients**: BasicAuth, ApiKey, and JWT implementations
- **Type Definitions**: Generated from backend schema ([types/generated/](../src/types/generated/))

---

## Backend API Specification

For the complete backend API specification with all endpoints, request/response models, and HTTP methods, see:

📋 **[client-endpoints.md](client-endpoints.md)**

This document is the authoritative source for:
- All available endpoints organized by client (CourseClient, ExampleClient, etc.)
- Request and response model types
- HTTP methods and paths
- Query parameters

---

## Authentication

The extension uses bearer token authentication with username/password login:

### Bearer Token Authentication
```typescript
const client = new BearerTokenHttpClient(baseUrl, timeout);
await client.authenticateWithCredentials(username, password);
```

**Headers**: `Authorization: Bearer <access-token>`

**Features**:
- Automatic token refresh using refresh tokens
- Secure token storage in VS Code's secret storage
- Token expiration handling with automatic re-authentication

**Authentication Flow**:
1. User provides username and password
2. Extension calls `/auth/login` endpoint
3. Backend returns access token and refresh token
4. Access token is used for API requests
5. When token expires, refresh token is used to get new access token

---

## Using ComputorApiService

### Initialization

The `ComputorApiService` is initialized during extension activation:

```typescript
const api = new ComputorApiService(context);
// HTTP client is injected
(api as any).httpClient = client;
```

### Making API Calls

The service provides typed methods for common operations:

```typescript
// Get courses
const courses = await api.getCourses({
  organization_id: 'org-123'
});

// Get course content
const content = await api.getCourseContent('content-456');

// Create course content
const newContent = await api.createCourseContent({
  course_id: 'course-789',
  title: 'Week 1',
  content_type_id: 'type-001'
});

// Update course content
await api.updateCourseContent('content-456', {
  title: 'Week 1: Updated'
});

// Delete course content
await api.deleteCourseContent('content-456');
```

### Generic HTTP Methods

For endpoints not yet wrapped in typed methods:

```typescript
// GET request
const data = await api.get<ResponseType>('/api/endpoint');

// POST request
const result = await api.post<ResponseType>(
  '/api/endpoint',
  requestBody
);

// PATCH request
await api.patch('/api/endpoint/123', updates);

// DELETE request
await api.delete('/api/endpoint/123');
```

### Query Parameters

Pass query parameters in the options:

```typescript
const examples = await api.getExamples({
  repository_id: 'repo-123',
  category: 'Algorithms',
  tags: ['sorting', 'searching']
});
```

### File Uploads

For multipart/form-data uploads:

```typescript
import FormData = require('form-data');

const formData = new FormData();
formData.append('file', fileBuffer, 'example.zip');
formData.append('title', 'Example Title');

const example = await api.uploadExample({
  repository_id: 'repo-123',
  identifier: 'my-example',
  title: 'Example Title',
  file: fileBuffer
});
```

### File Downloads

For downloading files (e.g., examples):

```typescript
const download = await api.downloadExample('example-123');
// Returns: { buffer: Buffer, filename: string }
```

---

## Type Safety

All API methods use TypeScript types from [types/generated/](../src/types/generated/):

```typescript
import {
  CourseGet,
  CourseCreate,
  CourseUpdate,
  CourseContentGet,
  ExampleUploadRequest
} from '../types/generated';

// Fully typed request
const createRequest: CourseContentCreate = {
  course_id: 'course-123',
  title: 'Assignment 1',
  content_type_id: 'type-001'
};

const content: CourseContentGet = await api.createCourseContent(
  createRequest
);

// TypeScript ensures type safety
console.log(content.id);       // ✓ Valid
console.log(content.invalid);  // ✗ Compile error
```

### Generated Type Structure

Types are organized by domain:
- **common.ts**: Shared types (pagination, errors)
- **courses.ts**: Course-related types
- **examples.ts**: Example repository types
- **messages.ts**: Message and comment types
- **users.ts**: User and profile types
- **organizations.ts**: Organization types
- **auth.ts**: Authentication types
- **tasks.ts**: Task and submission types

---

## Error Handling

### HTTP Errors

API calls throw `HttpError` on failure:

```typescript
import { HttpError } from '../http/errors/HttpError';

try {
  const courses = await api.getCourses();
} catch (error) {
  if (error instanceof HttpError) {
    console.error('HTTP Error:', error.statusCode, error.message);

    switch (error.statusCode) {
      case 401:
        // Unauthorized - re-authenticate
        break;
      case 404:
        // Not found
        break;
      case 500:
        // Server error
        break;
    }
  } else {
    // Network or other error
    console.error('Unexpected error:', error);
  }
}
```

### Error Recovery

Use `ErrorRecoveryService` for automatic retries:

```typescript
import { errorRecoveryService } from '../services/ErrorRecoveryService';

const data = await errorRecoveryService.executeWithRetry(
  async () => await api.getCourses(),
  {
    maxRetries: 3,
    backoffMultiplier: 2,
    initialDelay: 1000
  }
);
```

### User-Friendly Errors

Always show user-friendly error messages:

```typescript
try {
  await api.createCourseContent(data);
  vscode.window.showInformationMessage('Content created successfully');
} catch (error) {
  vscode.window.showErrorMessage(
    `Failed to create content: ${error.message}`
  );
}
```

---

## Caching

The API service uses multi-tier caching to reduce redundant requests:

### Automatic Caching

```typescript
// First call - fetches from API
const courses1 = await api.getCourses();

// Second call - returns from cache (within TTL)
const courses2 = await api.getCourses();
```

### Manual Cache Control

```typescript
import { multiTierCache } from '../services/CacheService';

// Clear entire cache
multiTierCache.clear();

// Set custom cache entry
const cacheKey = 'custom-data';
multiTierCache.set(cacheKey, data, 300000); // 5 min TTL

// Get from cache
const cached = multiTierCache.get<DataType>(cacheKey);
```

### Cache Invalidation

Cache is automatically cleared on mutations:

```typescript
// This clears relevant cache entries
await api.updateCourseContent('content-123', updates);

// Fresh data on next fetch
const updated = await api.getCourseContent('content-123');
```

---

## Examples

### Example 1: Fetching and Displaying Courses

```typescript
async function displayCourses(): Promise<void> {
  try {
    const courses = await api.getCourses();

    for (const course of courses.results) {
      console.log(`${course.name} (${course.id})`);
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to load courses: ${error.message}`
    );
  }
}
```

### Example 2: Creating Course Content with Progress

```typescript
async function createContent(
  courseId: string,
  title: string
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Creating content...',
      cancellable: false
    },
    async (progress) => {
      try {
        progress.report({ increment: 0 });

        const content = await api.createCourseContent({
          course_id: courseId,
          title: title
        });

        progress.report({ increment: 100 });

        vscode.window.showInformationMessage(
          `Content created: ${content.title}`
        );
      } catch (error) {
        throw error;
      }
    }
  );
}
```

### Example 3: Uploading Example with Validation

```typescript
async function uploadExample(
  zipPath: string,
  metadata: {
    repository_id: string;
    identifier: string;
    title: string;
  }
): Promise<void> {
  try {
    // Read file
    const fileBuffer = await fs.promises.readFile(zipPath);

    // Upload
    const example = await api.uploadExample({
      ...metadata,
      file: fileBuffer
    });

    vscode.window.showInformationMessage(
      `Example uploaded: ${example.title}`
    );
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 400) {
      vscode.window.showErrorMessage(
        'Invalid example format. Check meta.yaml file.'
      );
    } else {
      vscode.window.showErrorMessage(
        `Upload failed: ${error.message}`
      );
    }
  }
}
```

### Example 4: Fetching Student Submissions with Filtering

```typescript
async function getStudentSubmissions(
  courseContentId: string,
  courseMemberId: string
): Promise<void> {
  try {
    const submissions = await api.querySubmissions({
      course_content_id: courseContentId,
      course_member_id: courseMemberId
    });

    if (submissions.length === 0) {
      vscode.window.showInformationMessage(
        'No submissions found'
      );
      return;
    }

    for (const submission of submissions) {
      console.log(
        `Submission ${submission.id}: ` +
        `Status=${submission.status}, ` +
        `Grade=${submission.grade ?? 'Not graded'}`
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to fetch submissions: ${error.message}`
    );
  }
}
```

### Example 5: Batch Operations with Error Recovery

```typescript
async function batchCreateContent(
  courseId: string,
  titles: string[]
): Promise<void> {
  const results = {
    success: 0,
    failed: 0,
    errors: [] as string[]
  };

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Creating content...',
      cancellable: false
    },
    async (progress) => {
      for (let i = 0; i < titles.length; i++) {
        const title = titles[i];
        progress.report({
          increment: (100 / titles.length),
          message: `Creating "${title}"...`
        });

        try {
          await errorRecoveryService.executeWithRetry(
            async () => await api.createCourseContent({
              course_id: courseId,
              title: title
            }),
            { maxRetries: 2 }
          );
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push(`${title}: ${error.message}`);
        }
      }
    }
  );

  if (results.failed > 0) {
    vscode.window.showWarningMessage(
      `Created ${results.success}/${titles.length} items. ` +
      `${results.failed} failed.`
    );
    console.error('Errors:', results.errors);
  } else {
    vscode.window.showInformationMessage(
      `Successfully created ${results.success} items`
    );
  }
}
```

---

## Request Batching

The extension uses request batching to optimize multiple similar requests:

```typescript
import { requestBatchingService } from '../services/RequestBatchingService';

// Multiple requests batched automatically
const requests = studentIds.map(id =>
  requestBatchingService.addRequest('course-members', { id })
);

const members = await Promise.all(requests);
```

---

## Performance Monitoring

Track API performance with the monitoring service:

```typescript
import { performanceMonitor } from '../services/PerformanceMonitoringService';

performanceMonitor.startOperation('fetch-courses');
const courses = await api.getCourses();
performanceMonitor.endOperation('fetch-courses');

// Get metrics
const metrics = performanceMonitor.getMetrics('fetch-courses');
console.log('Average duration:', metrics.averageDuration);
```

---

## Testing API Integration

### Mock API Service

For testing, create a mock service:

```typescript
class MockComputorApiService extends ComputorApiService {
  async getCourses(): Promise<CourseList> {
    return {
      count: 2,
      results: [
        { id: '1', name: 'Course 1', ... },
        { id: '2', name: 'Course 2', ... }
      ]
    };
  }
}

// Use in tests
const mockApi = new MockComputorApiService(mockContext);
```

### Integration Tests

See [test/integration/](../test/integration/) for examples of API integration tests.

---

## Additional Resources

- **[Complete Backend API Spec](client-endpoints.md)** - All endpoints with request/response models
- **[ComputorApiService Source](../src/services/ComputorApiService.ts)** - Implementation details
- **[Type Definitions](../src/types/generated/)** - Generated TypeScript types
- **[HTTP Clients](../src/http/)** - HTTP client implementations
- **[Developer Guide](developer-guide.md)** - Development setup and patterns
