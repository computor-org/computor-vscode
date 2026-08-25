import { expect } from 'chai';

import { PushHealthRegistry } from '../../src/services/PushHealthRegistry';

/**
 * The registry now tracks two distinct problems, because they need different
 * words in the UI: a broken push credential (work is committed but not
 * reaching the server) and a failed fetch (what is on screen may be stale).
 * The second used to be swallowed entirely.
 */
describe('PushHealthRegistry', () => {
  const repo = '/tmp/course/repo';

  beforeEach(() => PushHealthRegistry.clear());
  afterEach(() => PushHealthRegistry.clear());

  it('defaults to a push problem, preserving the original call shape', () => {
    PushHealthRegistry.markFailing(repo);
    expect(PushHealthRegistry.isFailing(repo)).to.equal(true);
    expect(PushHealthRegistry.problem(repo)).to.equal('push');
  });

  it('records a sync problem distinctly', () => {
    PushHealthRegistry.markFailing(repo, 'sync');
    expect(PushHealthRegistry.problem(repo)).to.equal('sync');
  });

  it('lets a push problem outrank a sync one', () => {
    // A failing push is the more actionable of the two, so a later sync failure
    // must not overwrite it and soften the message.
    PushHealthRegistry.markFailing(repo, 'push');
    PushHealthRegistry.markFailing(repo, 'sync');
    expect(PushHealthRegistry.problem(repo)).to.equal('push');
  });

  it('lets a push problem replace a sync one', () => {
    PushHealthRegistry.markFailing(repo, 'sync');
    PushHealthRegistry.markFailing(repo, 'push');
    expect(PushHealthRegistry.problem(repo)).to.equal('push');
  });

  it('clears on recovery', () => {
    PushHealthRegistry.markFailing(repo, 'sync');
    PushHealthRegistry.markHealthy(repo);
    expect(PushHealthRegistry.isFailing(repo)).to.equal(false);
    expect(PushHealthRegistry.problem(repo)).to.equal(undefined);
  });

  it('notifies listeners so a tree can refresh its badges', () => {
    // Nothing fired on mutation before, so a repository could go bad and the
    // badge only appeared on the next unrelated refresh.
    let changes = 0;
    const subscription = PushHealthRegistry.onDidChange(() => { changes++; });

    PushHealthRegistry.markFailing(repo, 'sync');
    PushHealthRegistry.markFailing(repo, 'push');
    PushHealthRegistry.markHealthy(repo);

    expect(changes).to.equal(3);
    subscription.dispose();

    PushHealthRegistry.markFailing(repo);
    expect(changes).to.equal(3);
  });

  it('does not notify when nothing actually changed', () => {
    let changes = 0;
    const subscription = PushHealthRegistry.onDidChange(() => { changes++; });

    PushHealthRegistry.markFailing(repo, 'push');
    PushHealthRegistry.markFailing(repo, 'push');
    PushHealthRegistry.markHealthy('/tmp/course/other');

    expect(changes).to.equal(1);
    subscription.dispose();
  });

  it('tracks repositories independently', () => {
    PushHealthRegistry.markFailing('/tmp/a', 'push');
    PushHealthRegistry.markFailing('/tmp/b', 'sync');
    expect(PushHealthRegistry.problem('/tmp/a')).to.equal('push');
    expect(PushHealthRegistry.problem('/tmp/b')).to.equal('sync');
    expect(PushHealthRegistry.isFailing('/tmp/c')).to.equal(false);
  });
});
