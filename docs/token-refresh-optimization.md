# Token Refresh Optimization

## Overview

This document describes the optimized token refresh implementation in the Computor VS Code extension. The implementation ensures efficient token management for both short-lived (30s) and long-lived (15min) tokens.

## Problem Statement

**Original Issue**: The frontend was refreshing tokens on almost every API call, which was inefficient.

**Backend Configuration**:
- Access tokens expire in 30 seconds (testing) / 15 minutes (production)
- Refresh tokens expire in 14 days
- Refresh endpoint: `POST /auth/refresh/local` (no Authorization header needed)

## Solution

### 1. Smart Token Refresh Threshold

**Implementation**: Refresh tokens when **< 10% of total lifetime** remains.

- **30-second tokens**: Refresh when < 3 seconds remain
- **15-minute tokens**: Refresh when < 90 seconds remain

**Code**: [BearerTokenHttpClient.ts](../src/http/BearerTokenHttpClient.ts)

```typescript
private shouldRefreshToken(): boolean {
  if (!this.tokenExpiry || !this.tokenIssuedAt || !this.accessToken) {
    return false;
  }

  const now = Date.now();
  const expiryTime = this.tokenExpiry.getTime();
  const issuedTime = this.tokenIssuedAt.getTime();

  // Already expired
  if (now >= expiryTime) {
    return true;
  }

  // Calculate the total token lifetime and remaining time
  const totalLifetimeMs = expiryTime - issuedTime;
  const remainingMs = expiryTime - now;

  // Refresh when less than 10% of the TOTAL lifetime remains
  const thresholdMs = totalLifetimeMs * this.REFRESH_THRESHOLD_PERCENTAGE;

  return remainingMs <= thresholdMs;
}
```

### 2. Concurrent Refresh Deduplication

**Problem**: Multiple simultaneous API calls could trigger multiple refresh requests.

**Solution**: Use a Promise-based locking mechanism to ensure only one refresh happens at a time.

```typescript
public async refreshAuth(): Promise<void> {
  // Prevent duplicate concurrent refresh calls
  if (this.refreshPromise) {
    console.log('[BearerTokenHttpClient] Refresh already in progress, waiting...');
    return this.refreshPromise;
  }

  if (!this.refreshToken) {
    throw new AuthenticationError('No refresh token available');
  }

  this.refreshPromise = this.performRefresh();

  try {
    await this.refreshPromise;
  } finally {
    this.refreshPromise = null;
  }
}
```

**Behavior**:
- First call: Starts the refresh process
- Concurrent calls: Wait for the same Promise to resolve
- Result: Only one HTTP request to `/auth/refresh/local`

### 3. Token Persistence Across Page Reloads

**Implementation**: Store token data including issue time in VS Code's secure storage.

**Stored Data**:
```typescript
interface StoredAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;      // ISO date string
  issuedAt?: string;       // ISO date string - NEW
  userId?: string;
}
```

**Storage Location**: VS Code Secret Storage (OS keychain integration)

**Restoration**: On extension activation, tokens are restored from secure storage:

```typescript
function buildHttpClient(baseUrl: string, auth: StoredAuth): BearerTokenHttpClient {
  const client = new BearerTokenHttpClient(baseUrl, 5000);
  client.setTokenData({
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    expiresAt: auth.expiresAt ? new Date(auth.expiresAt) : undefined,
    issuedAt: auth.issuedAt ? new Date(auth.issuedAt) : undefined,
    userId: auth.userId
  });
  return client;
}
```

### 4. Proactive vs Reactive Refresh

**Proactive Refresh** (preferred):
- Check before every API request
- Refresh if token is close to expiring (< 10% lifetime)
- Prevents 401 errors

**Reactive Refresh** (fallback):
- Handle 401 Unauthorized responses
- Refresh and retry the request
- Ensures resilience even if proactive refresh fails

```typescript
protected async request<T>(
  method: HttpMethod,
  endpoint: string,
  data?: any,
  params?: Record<string, any>
): Promise<HttpResponse<T>> {
  // Proactive refresh
  if (this.shouldRefreshToken() && this.refreshToken) {
    console.log('[BearerTokenHttpClient] Token close to expiry, proactively refreshing');
    await this.refreshAuth();
  }

  try {
    return await super.request<T>(method, endpoint, data, params);
  } catch (error: any) {
    // Reactive refresh on 401
    if (error?.status === 401 && this.refreshToken) {
      console.log('[BearerTokenHttpClient] Received 401, attempting token refresh and retry');
      await this.refreshAuth();
      return await super.request<T>(method, endpoint, data, params);
    }
    throw error;
  }
}
```

## Benefits

### 1. Reduced Network Traffic
- **Before**: Refresh on almost every request
- **After**: Refresh only when < 10% lifetime remains

**Example for 30s tokens**:
- Tokens valid for 27 seconds before refresh needed
- With 5 API calls per second: ~135 calls with 1 token vs 1 call with 1 token

### 2. Better Performance
- No unnecessary refresh delays
- Concurrent requests share the same refresh operation
- Proactive refresh prevents 401 errors and retries

### 3. Correct Behavior
- Works with both 30s (testing) and 15min (production) tokens
- Automatically adapts to token lifetime
- Persists across extension reloads

## Testing

### Manual Testing

1. **Short-lived tokens (30s)**:
   ```bash
   # Set backend to testing mode with 30s tokens
   # Login via extension
   # Make multiple API calls within 27 seconds
   # Verify: No refresh happens
   # Wait until < 3s remain
   # Make API call
   # Verify: Token refreshes before request
   ```

2. **Concurrent requests**:
   ```bash
   # Login via extension
   # Trigger multiple operations simultaneously
   # Check console logs
   # Verify: Only one "Token refreshed successfully" message
   ```

3. **Persistence**:
   ```bash
   # Login via extension
   # Reload VS Code window
   # Make API call
   # Verify: Token still valid, no re-login needed
   ```

### Debugging

Enable console logging to see token refresh behavior:

```typescript
// Console logs added:
console.log('[BearerTokenHttpClient] Token close to expiry, proactively refreshing');
console.log('[BearerTokenHttpClient] Refresh already in progress, waiting...');
console.log('[BearerTokenHttpClient] Token refreshed successfully');
console.log('[BearerTokenHttpClient] Received 401, attempting token refresh and retry');
```

## Architecture

### Key Components

1. **BearerTokenHttpClient** ([src/http/BearerTokenHttpClient.ts](../src/http/BearerTokenHttpClient.ts))
   - Token storage and management
   - Refresh logic and deduplication
   - HTTP request interception

2. **Extension.ts** ([src/extension.ts](../src/extension.ts))
   - Token persistence to VS Code secrets
   - Client initialization with stored tokens

3. **ComputorApiService** ([src/services/ComputorApiService.ts](../src/services/ComputorApiService.ts))
   - High-level API wrapper
   - Uses BearerTokenHttpClient transparently

### Data Flow

```
┌─────────────────────────────────────────────────────┐
│                   API Request                        │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  shouldRefreshToken() - Check if < 10% remains      │
└───────────────────────┬─────────────────────────────┘
                        │
                ┌───────┴────────┐
                │                │
           YES  ▼                ▼  NO
┌──────────────────────┐   ┌─────────────────┐
│  refreshAuth()       │   │  Make Request   │
│  (with dedup lock)   │   └─────────────────┘
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ POST /auth/refresh   │
│ Update tokens        │
│ Save to storage      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Make Request        │
└──────────────────────┘
```

## Configuration

The refresh threshold is configurable:

```typescript
private readonly REFRESH_THRESHOLD_PERCENTAGE = 0.1; // 10%
```

**To adjust**:
- Increase for more aggressive refresh (e.g., 0.2 = 20%)
- Decrease for less frequent refresh (e.g., 0.05 = 5%)

**Recommendation**: Keep at 10% for optimal balance.

## Security Considerations

1. **Secure Storage**: Tokens stored in VS Code Secret Storage (OS keychain)
2. **No Authorization Header on Refresh**: `/auth/refresh/local` doesn't require Bearer token
3. **Token Cleanup**: On refresh failure, tokens are cleared to prevent invalid state
4. **HTTPS**: Production should use HTTPS to protect tokens in transit

## API Reference

### BearerTokenHttpClient Methods

#### `authenticateWithCredentials(username: string, password: string): Promise<void>`
Authenticate with username/password and store tokens.

#### `refreshAuth(): Promise<void>`
Refresh the access token using the refresh token. Deduplicated for concurrent calls.

#### `getTokenData(): TokenData`
Get current token state including issue time.

```typescript
{
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  issuedAt: Date | null;
  userId: string | null;
}
```

#### `setTokenData(data: TokenData): void`
Restore token state from storage.

#### `isAuthenticated(): boolean`
Check if currently authenticated with valid token.

## Migration Notes

### Breaking Changes

**New field in StoredAuth**:
```typescript
interface StoredAuth {
  // ... existing fields
  issuedAt?: string;  // NEW - ISO date string
}
```

**Impact**: Existing stored tokens will work but won't have `issuedAt`. The system will estimate it as "now" on first use, which may cause one extra refresh but will self-correct.

### Backward Compatibility

The implementation is backward compatible:
- Old tokens without `issuedAt` still work
- System estimates issue time conservatively
- Next refresh will store proper `issuedAt`

## Future Improvements

1. **Token Rotation**: Handle refresh token rotation if backend implements it
2. **Background Refresh**: Refresh tokens in background before they expire
3. **Multiple Contexts**: Support multiple authentication contexts simultaneously
4. **Metrics**: Track refresh frequency for monitoring

## References

- **Backend Auth Docs**: See backend API documentation for `/auth/login` and `/auth/refresh/local`
- **Type Definitions**: [src/types/generated/auth.ts](../src/types/generated/auth.ts)
- **Architecture**: [docs/architecture.md](architecture.md)
