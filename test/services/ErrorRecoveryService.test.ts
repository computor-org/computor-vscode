import { expect } from 'chai';
import { ErrorRecoveryService } from '../../src/services/ErrorRecoveryService';
import { HttpError } from '../../src/http/errors/HttpError';

describe('ErrorRecoveryService.executeWithRecovery', () => {
  let svc: ErrorRecoveryService;

  beforeEach(() => {
    svc = new ErrorRecoveryService();
  });

  it('returns the value on the first successful attempt (no retries, no onRetry)', async () => {
    let calls = 0;
    const retries: Array<{ attempt: number; error: Error }> = [];
    const result = await svc.executeWithRecovery(async () => {
      calls++;
      return 42;
    }, {
      maxRetries: 3,
      onRetry: (attempt, error) => { retries.push({ attempt, error }); }
    });

    expect(result).to.equal(42);
    expect(calls).to.equal(1);
    expect(retries).to.be.empty;
  });

  describe('non-retryable HTTP client errors bubble immediately', () => {
    for (const status of [400, 401, 403, 404, 405, 409, 410]) {
      it(`HttpError ${status} is thrown without retries`, async () => {
        let calls = 0;
        const err = new HttpError('x', status, 'reason');
        try {
          await svc.executeWithRecovery(async () => {
            calls++;
            throw err;
          }, { maxRetries: 5, retryDelay: 0 });
          expect.fail('expected the call to reject');
        } catch (caught: any) {
          expect(caught).to.equal(err);
        }
        expect(calls).to.equal(1);
      });
    }
  });

  it('parses HTTP NNN out of the error message when the error is not an HttpError', async () => {
    let calls = 0;
    try {
      await svc.executeWithRecovery(async () => {
        calls++;
        throw new Error('Request failed: HTTP 403 Forbidden');
      }, { maxRetries: 3, retryDelay: 0 });
      expect.fail('expected rejection');
    } catch (err: any) {
      expect(err.message).to.include('403');
    }
    expect(calls).to.equal(1);
  });

  it('408 is treated as retryable (not thrown immediately)', async () => {
    // An HttpError 408 does NOT match the non-retryable fast-path. Without a
    // matching recovery strategy the loop falls through to the retry path.
    // To avoid triggering any vscode-coupled strategy we resolve after the
    // first failure by returning a value on attempt 2.
    let calls = 0;
    const result = await svc.executeWithRecovery(async () => {
      calls++;
      if (calls === 1) throw new HttpError('timeout', 408, 'Request Timeout');
      return 'ok';
    }, { maxRetries: 2, retryDelay: 0 });

    expect(result).to.equal('ok');
    expect(calls).to.equal(2);
  });

  it('429 is treated as retryable the same way as 408', async () => {
    let calls = 0;
    const result = await svc.executeWithRecovery(async () => {
      calls++;
      if (calls === 1) throw new HttpError('slow down', 429, 'Too Many Requests');
      return 'ok';
    }, { maxRetries: 2, retryDelay: 0 });

    expect(result).to.equal('ok');
    expect(calls).to.equal(2);
  });

  it('succeeds on the second attempt after a generic error', async () => {
    let calls = 0;
    const result = await svc.executeWithRecovery(async () => {
      calls++;
      if (calls === 1) throw new Error('transient');
      return 'recovered';
    }, { maxRetries: 3, retryDelay: 0 });

    expect(result).to.equal('recovered');
    expect(calls).to.equal(2);
  });

  it('after maxRetries consecutive generic failures, wraps the final error', async () => {
    let calls = 0;
    try {
      await svc.executeWithRecovery(async () => {
        calls++;
        throw new Error('nope');
      }, { maxRetries: 2, retryDelay: 0 });
      expect.fail('expected rejection');
    } catch (err: any) {
      // enhanceError wraps the message; original text is still present
      expect(err.message).to.include('nope');
    }
    // Initial attempt + maxRetries retries (guaranteed upper bound)
    expect(calls).to.be.at.most(3);
    expect(calls).to.be.at.least(2);
  });
});
