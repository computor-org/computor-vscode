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
- **HTTP Clients**: `BearerTokenHttpClient` (SSO session token) and `ApiKeyHttpClient` (API token)
- **Type Definitions**: Generated from backend schema ([types/generated/](../src/types/generated/))

---

## Backend API Specification

For the complete backend API specification with all endpoints, request/response models, and HTTP methods, open the backend's interactive OpenAPI reference at `<backend URL>/docs`.

---

## Authentication

The extension signs in through the backend's Keycloak single sign-on, or with an API token for automation:

### Bearer Token Authentication
```typescript
const sso = await ssoBrowserLogin(baseUrl);
const client = new BearerTokenHttpClient(baseUrl, timeout);
client.setTokenData({ accessToken: sso.token, refreshToken: sso.refreshToken, /* ... */ });
```

**Headers**: `Authorization: Bearer <session-token>`

**Features**:
- Automatic token refresh using refresh tokens
- Secure token storage in VS Code's secret storage
- Token expiration handling with automatic re-authentication

**Authentication Flow**:
1. `Computor: Login` opens `{backend}/auth/keycloak/login` in the browser
2. The user signs in with the institution's identity provider
3. The backend redirects the session token and refresh token to a temporary loopback server of the extension
4. The session token is used for API requests
5. When the token is about to expire, `POST /auth/refresh` gets a new one

An API token (`ctp_…`) is sent as `X-API-Token` by `ApiKeyHttpClient`. See [Architecture Overview](architecture.md#authentication-system).

---

## Using ComputorApiService

### Initialization

The `ComputorApiService` is initialized during extension activation:

```typescript
const api = new ComputorApiService(context, client);
```

### Making API Calls

The service provides typed methods for common operations:

```typescript
// Get the courses of a course family
const courses = await api.getCourses('family-123');

// Get course content
const content = await api.getCourseContent('content-456');

// Create content
const newContent = await api.createCourseContent('course-789', {
  course_id: 'course-789',
  path: 'week1',
  title: 'Week 1',
  course_content_type_id: 'type-001'
});

// Update course content
await api.updateCourseContent('course-789', 'content-456', {
  title: 'Week 1: Updated'
});

// Delete course content
await api.deleteCourseContent('course-789', 'content-456');
```

### Generic HTTP Methods

`ComputorApiService` has no public generic request methods. A new endpoint gets
its own typed method, which uses the HTTP client inside the service:

```typescript
const client = await this.getHttpClient();

// GET request
const response = await client.get<ResponseType>('/endpoint', queryParams);
return response.data;

// POST, PATCH, PUT and DELETE work the same way
await client.post<ResponseType>('/endpoint', requestBody);
await client.patch<ResponseType>('/endpoint/123', updates);
await client.delete('/endpoint/123');
```

### Query Parameters

Pass query parameters as the second argument of `client.get`. Typed methods
take their filters as arguments:

```typescript
const examples = await api.getExamples('repo-123');
```

### File Uploads

Examples are uploaded as a map of file paths to contents:

```typescript
const example = await api.uploadExample({
  repository_id: 'repo-123',
  directory: 'my-example',
  files: {
    'meta.yaml': metaYamlText,
    'main.py': sourceText
  }
});
```

### File Downloads

For downloading files (e.g., examples):

```typescript
const download = await api.downloadExample('example-123');
// Returns: { example_id, version_tag, directory, files, meta, ... }
```

---

## Type Safety

All API methods use TypeScript types from [types/generated/](../src/types/generated/):

```typescript
import {
  CourseGet,
  CourseCreate,
  CourseUpdate,
  CourseContentCreate,
  CourseContentGet,
  ExampleUploadRequest
} from '../types/generated';

// Fully typed request
const createRequest: CourseContentCreate = {
  course_id: 'course-123',
  path: 'assignment1',
  title: 'Assignment 1',
  course_content_type_id: 'type-001'
};

const content: CourseContentGet = await api.createCourseContent(
  'course-123',
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
- **roles.ts**, **sso.ts**, **websocket.ts**: Roles, SSO providers and WebSocket events

---

## Error Handling

### HTTP Errors

API calls throw `HttpError` on failure:

```typescript
import { HttpError } from '../exceptions/errors/HttpError';

try {
  const courses = await api.getCourses(courseFamilyId);
} catch (error) {
  if (error instanceof HttpError) {
    console.error('HTTP Error:', error.status, error.message);

    switch (error.status) {
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

const data = await errorRecoveryService.executeWithRecovery(
  async () => await api.getCourses(courseFamilyId),
  {
    maxRetries: 3,
    retryDelay: 1000,
    exponentialBackoff: true
  }
);
```

Errors that carry a backend error code are described in the
[error handling guide](../src/exceptions/USAGE.md).

### User-Friendly Errors

Always show user-friendly error messages:

```typescript
try {
  await api.createCourseContent(courseId, data);
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
const courses1 = await api.getCourses(courseFamilyId);

// Second call - returns from cache (within TTL)
const courses2 = await api.getCourses(courseFamilyId);
```

### Manual Cache Control

```typescript
import { multiTierCache } from '../services/CacheService';

// Clear entire cache
multiTierCache.clear();

// Set custom cache entry in the 'hot', 'warm' or 'cold' tier
const cacheKey = 'custom-data';
multiTierCache.set(cacheKey, data, 'warm');

// Get from cache
const cached = multiTierCache.get<DataType>(cacheKey);
```

### Cache Invalidation

Cache is automatically cleared on mutations:

```typescript
// This clears relevant cache entries
await api.updateCourseContent('course-789', 'content-123', updates);

// Fresh data on next fetch
const updated = await api.getCourseContent('content-123');
```

---

## Examples

### Example 1: Fetching and Displaying Courses

```typescript
async function displayCourses(): Promise<void> {
  try {
    const courses = await api.getCourses(courseFamilyId);

    for (const course of courses) {
      console.log(`${course.title ?? course.path} (${course.id})`);
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
  contentTypeId: string,
  path: string,
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

        const content = await api.createCourseContent(courseId, {
          course_id: courseId,
          course_content_type_id: contentTypeId,
          path,
          title
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
  repositoryId: string,
  directory: string,
  files: Record<string, string>
): Promise<void> {
  try {
    const example = await api.uploadExample({
      repository_id: repositoryId,
      directory,
      files
    });

    vscode.window.showInformationMessage(
      `Example uploaded: ${example?.title}`
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) {
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
async function getUngradedSubmissions(
  courseId: string,
  courseContentId: string
): Promise<void> {
  try {
    const groups = await api.getTutorSubmissionGroups({
      course_id: courseId,
      course_content_id: courseContentId,
      has_ungraded_submissions: true
    });

    if (groups.length === 0) {
      vscode.window.showInformationMessage(
        'No submissions found'
      );
      return;
    }

    for (const group of groups) {
      console.log(
        `${group.display_name}: ` +
        `${group.submission_count ?? 0} submissions, ` +
        `latest ${group.latest_submission_at ?? 'never'}`
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
  contentTypeId: string,
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
          await errorRecoveryService.executeWithRecovery(
            async () => await api.createCourseContent(courseId, {
              course_id: courseId,
              course_content_type_id: contentTypeId,
              path: `item${i + 1}`,
              title
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

// Requests with the same batch key are collected and run together
const requests = memberIds.map(id =>
  requestBatchingService.batch('course-members', id, () => api.getCourseMember(id))
);

const members = await Promise.all(requests);
```

---

## Performance Monitoring

Track API performance with the monitoring service:

```typescript
import { performanceMonitor } from '../services/PerformanceMonitoringService';

const courses = await performanceMonitor.measureAsync(
  'fetch-courses',
  () => api.getCourses(courseFamilyId)
);

// Get metrics
const stats = performanceMonitor.getStats('fetch-courses');
console.log(performanceMonitor.generateReport());
```

---

## Testing API Integration

### Mock API Service

For testing, create a mock service:

```typescript
class MockComputorApiService extends ComputorApiService {
  async getCourses(courseFamilyId: string): Promise<CourseList[]> {
    return [
      { id: '1', path: 'course1', title: 'Course 1', ... },
      { id: '2', path: 'course2', title: 'Course 2', ... }
    ];
  }
}

// Use in tests
const mockApi = new MockComputorApiService(mockContext);
```

### Integration Tests

See [test/services/](../test/services/) and [test/http/](../test/http/) for tests of the API layer.

---

## Additional Resources

- **Complete Backend API Spec** - the backend's OpenAPI reference at `<backend URL>/docs`
- **[ComputorApiService Source](../src/services/ComputorApiService.ts)** - Implementation details
- **[Type Definitions](../src/types/generated/)** - Generated TypeScript types
- **[HTTP Clients](../src/http/)** - HTTP client implementations
- **[Developer Guide](developer-guide.md)** - Development setup and patterns
