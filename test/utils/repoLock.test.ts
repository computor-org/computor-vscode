import { expect } from 'chai';
import * as path from 'path';

import { clearRepoLocks, isRepoLocked, withRepoLock } from '../../src/utils/repoLock';

/**
 * Guards the serialization of git operations on one clone. Several entry points
 * reach for the same repository — the startup sync, the refresh command, tree
 * expansion, and two fire-and-forget credential rewriters — and interleaved
 * stash/checkout/merge/remote steps corrupt each other.
 */
describe('withRepoLock', () => {
  beforeEach(() => clearRepoLocks());
  afterEach(() => clearRepoLocks());

  const repo = '/tmp/course/student-repo';

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  it('runs operations on the same repository one at a time', async () => {
    const events: string[] = [];
    const first = deferred<void>();

    const a = withRepoLock(repo, async () => {
      events.push('a:start');
      await first.promise;
      events.push('a:end');
    });
    const b = withRepoLock(repo, async () => {
      events.push('b:start');
      events.push('b:end');
    });

    // b must not have started while a is still in flight.
    await Promise.resolve();
    expect(events).to.deep.equal(['a:start']);

    first.resolve();
    await Promise.all([a, b]);
    expect(events).to.deep.equal(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('lets different repositories run concurrently', async () => {
    const events: string[] = [];
    const block = deferred<void>();

    const a = withRepoLock('/tmp/course/repo-a', async () => {
      events.push('a:start');
      await block.promise;
    });
    const b = withRepoLock('/tmp/course/repo-b', async () => {
      events.push('b:start');
    });

    await b;
    expect(events).to.include('b:start');

    block.resolve();
    await a;
  });

  it('treats equivalent paths as the same repository', async () => {
    const events: string[] = [];
    const block = deferred<void>();

    const a = withRepoLock(repo, async () => {
      events.push('a:start');
      await block.promise;
    });
    const b = withRepoLock(path.join(repo, '.', ''), async () => {
      events.push('b:start');
    });

    await Promise.resolve();
    expect(events).to.deep.equal(['a:start']);

    block.resolve();
    await Promise.all([a, b]);
    expect(events).to.deep.equal(['a:start', 'b:start']);
  });

  it('does not let a failed operation block the queue', async () => {
    const failing = withRepoLock(repo, async () => {
      throw new Error('fetch exploded');
    });
    await failing.catch(() => undefined);

    const result = await withRepoLock(repo, async () => 'ran anyway');
    expect(result).to.equal('ran anyway');
  });

  it('propagates the operation result and its errors to the caller', async () => {
    expect(await withRepoLock(repo, async () => 42)).to.equal(42);

    let caught: unknown;
    try {
      await withRepoLock(repo, async () => { throw new Error('boom'); });
    } catch (error) {
      caught = error;
    }
    expect((caught as Error)?.message).to.equal('boom');
  });

  it('releases the lock once the queue drains', async () => {
    await withRepoLock(repo, async () => undefined);
    // Let the bookkeeping microtask run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isRepoLocked(repo)).to.equal(false);
  });
});
