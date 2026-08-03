import { expect } from 'chai';
import * as vscode from 'vscode';
import { TestResultService } from '../../src/services/TestResultService';

// The poll callback is async. Without a try/catch inside it, a transient
// backend failure became an unhandled promise rejection and the user learnt
// nothing until the 5-minute timeout; without a re-entry guard, a poll slower
// than the interval let callbacks overlap and fire concurrent requests.

const freshService = (): TestResultService => {
  (TestResultService as any).instance = undefined;
  const service = TestResultService.getInstance();
  // Real timers, but fast ones - these are the private tuning constants.
  (service as any).POLL_INTERVAL = 5;
  (service as any).MAX_POLL_DURATION = 5000;
  return service;
};

const progress = { report: () => {} } as vscode.Progress<{ message?: string; increment?: number }>;

describe('TestResultService polling resilience', () => {
  const originals = {
    info: vscode.window.showInformationMessage,
    warn: vscode.window.showWarningMessage,
    error: vscode.window.showErrorMessage
  };
  let unhandled: unknown[];
  const collectUnhandled = (reason: unknown) => { unhandled.push(reason); };

  beforeEach(() => {
    unhandled = [];
    process.on('unhandledRejection', collectUnhandled);
    (vscode.window as any).showInformationMessage = async () => undefined;
    (vscode.window as any).showWarningMessage = async () => undefined;
    (vscode.window as any).showErrorMessage = async () => undefined;
  });

  afterEach(() => {
    process.off('unhandledRejection', collectUnhandled);
    (vscode.window as any).showInformationMessage = originals.info;
    (vscode.window as any).showWarningMessage = originals.warn;
    (vscode.window as any).showErrorMessage = originals.error;
  });

  it('keeps polling through transient failures instead of crashing out', async () => {
    const service = freshService();
    let calls = 0;
    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    service.setApiService({
      submitTest: async () => ({ id: 'result-1' }),
      getResultStatus: async () => {
        calls++;
        if (calls <= 2) {
          throw new Error('backend hiccup');
        }
        if (calls >= 4) {
          // Poll survived the failures; end the run through cancellation so no
          // result rendering is involved.
          (token as any).isCancellationRequested = true;
        }
        return 5; // non-terminal status
      }
    } as any);

    const outcome = await service.submitTestByArtifactAndAwaitResults(
      'artifact-1', 'Assignment', false, { progress, token }
    );

    expect(outcome?.status).to.equal('CANCELLED');
    expect(calls).to.be.greaterThan(2);
    expect(unhandled, 'a failed poll must not become an unhandled rejection').to.deep.equal([]);
  });

  it('gives up with an error rather than hanging until the timeout', async () => {
    const service = freshService();
    let calls = 0;

    service.setApiService({
      submitTest: async () => ({ id: 'result-2' }),
      getResultStatus: async () => {
        calls++;
        throw new Error('backend down');
      }
    } as any);

    const outcome = await service.submitTestByArtifactAndAwaitResults(
      'artifact-2', 'Assignment', false, { progress }
    );

    expect(outcome?.status).to.equal('ERROR');
    expect(calls).to.equal((service as any).MAX_CONSECUTIVE_POLL_FAILURES);
    expect(unhandled).to.deep.equal([]);
  });

  it('never runs two polls at once when the backend is slower than the interval', async () => {
    const service = freshService();
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    service.setApiService({
      submitTest: async () => ({ id: 'result-3' }),
      getResultStatus: async () => {
        calls++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Four times the poll interval - overlapping callbacks would stack up.
        await new Promise(resolve => setTimeout(resolve, 20));
        inFlight--;
        if (calls >= 3) {
          (token as any).isCancellationRequested = true;
        }
        return 5;
      }
    } as any);

    await service.submitTestByArtifactAndAwaitResults(
      'artifact-3', 'Assignment', false, { progress, token }
    );

    expect(maxInFlight, 'polls must not overlap').to.equal(1);
  });
});
