import { expect } from 'chai';
import { RequestBatchingService } from '../../src/services/RequestBatchingService';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('RequestBatchingService', () => {
  describe('batch()', () => {
    it('resolves to the value returned by the executed function', async () => {
      const svc = new RequestBatchingService();
      const value = await svc.batch('k', 'req-1', async () => 'hello', { batchDelay: 10, maxBatchSize: 5, maxWaitTime: 100 });
      expect(value).to.equal('hello');
    });

    it('rejects when the executed function throws', async () => {
      const svc = new RequestBatchingService();
      try {
        await svc.batch('k', 'req-1', async () => { throw new Error('boom'); }, { batchDelay: 5, maxBatchSize: 5, maxWaitTime: 50 });
        expect.fail('expected rejection');
      } catch (err: any) {
        expect(err.message).to.equal('boom');
      }
    });

    it('runs each request\'s execute function in parallel when multiple are enqueued under one batchKey', async () => {
      const svc = new RequestBatchingService();
      let concurrent = 0;
      let maxConcurrent = 0;
      const makeTask = (id: number) => async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await wait(5);
        concurrent--;
        return id;
      };

      const results = await Promise.all([
        svc.batch('k', 'r1', makeTask(1), { batchDelay: 10, maxBatchSize: 10, maxWaitTime: 100 }),
        svc.batch('k', 'r2', makeTask(2), { batchDelay: 10, maxBatchSize: 10, maxWaitTime: 100 }),
        svc.batch('k', 'r3', makeTask(3), { batchDelay: 10, maxBatchSize: 10, maxWaitTime: 100 })
      ]);

      expect(results).to.deep.equal([1, 2, 3]);
      expect(maxConcurrent).to.be.at.least(2);
    });

    it('flushes immediately once maxBatchSize is reached', async () => {
      const svc = new RequestBatchingService();
      const started: number[] = [];
      const executedAt = (id: number) => async () => {
        started.push(id);
        return id;
      };
      const batchDelay = 500; // deliberately high; the size trigger should win

      const submitted = Promise.all([
        svc.batch('k', 'r1', executedAt(1), { batchDelay, maxBatchSize: 3, maxWaitTime: 1000 }),
        svc.batch('k', 'r2', executedAt(2), { batchDelay, maxBatchSize: 3, maxWaitTime: 1000 }),
        svc.batch('k', 'r3', executedAt(3), { batchDelay, maxBatchSize: 3, maxWaitTime: 1000 })
      ]);

      await wait(50);
      expect(started).to.have.length(3); // triggered by size, not by timer
      await submitted;
    });

    it('keeps requests under different batchKeys independent', async () => {
      const svc = new RequestBatchingService();
      const results = await Promise.all([
        svc.batch('a', 'r1', async () => 'A', { batchDelay: 5, maxBatchSize: 5, maxWaitTime: 50 }),
        svc.batch('b', 'r2', async () => 'B', { batchDelay: 5, maxBatchSize: 5, maxWaitTime: 50 })
      ]);
      expect(results).to.deep.equal(['A', 'B']);
    });

    it('caps the total wait at maxWaitTime even when further requests keep arriving', async () => {
      const svc = new RequestBatchingService();
      let executed = false;
      const firstPromise = svc.batch('k', 'r1', async () => {
        executed = true;
        return 'done';
      }, { batchDelay: 50, maxBatchSize: 100, maxWaitTime: 60 });

      // Keep arriving requests within the batchDelay window; the scheduler
      // should still fire at maxWaitTime regardless.
      for (let i = 0; i < 3; i++) {
        await wait(20);
        void svc.batch('k', `r${i + 2}`, async () => i, { batchDelay: 50, maxBatchSize: 100, maxWaitTime: 60 });
      }

      const result = await firstPromise;
      expect(result).to.equal('done');
      expect(executed).to.be.true;
    });
  });

  describe('createBatchedFunction', () => {
    it('produces a function that batches calls with matching keys', async () => {
      const svc = new RequestBatchingService();
      const calls: number[] = [];
      const fn = async (id: number): Promise<number> => {
        calls.push(id);
        return id * 2;
      };
      const batched = svc.createBatchedFunction(fn, () => 'all', { batchDelay: 5, maxBatchSize: 5, maxWaitTime: 50 });

      const results = await Promise.all([batched(1), batched(2), batched(3)]);
      expect(results).to.deep.equal([2, 4, 6]);
      expect(calls.sort()).to.deep.equal([1, 2, 3]);
    });
  });

  describe('clearAll', () => {
    it('rejects every pending request with "Batch cancelled"', async () => {
      const svc = new RequestBatchingService();
      const pending = svc.batch('k', 'r1', async () => 'should-not-run', { batchDelay: 500, maxBatchSize: 100, maxWaitTime: 5000 });

      svc.clearAll();

      try {
        await pending;
        expect.fail('expected rejection');
      } catch (err: any) {
        expect(err.message).to.equal('Batch cancelled');
      }
    });

    it('is safe to call when there is nothing pending', () => {
      const svc = new RequestBatchingService();
      expect(() => svc.clearAll()).to.not.throw();
    });
  });
});
