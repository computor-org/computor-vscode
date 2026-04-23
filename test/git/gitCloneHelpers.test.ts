import { expect } from 'chai';
// Loaded via the shared .cjs helper because we mutate `execAsyncWithTimeout`
// through the CommonJS module cache — a pattern that only works in CJS
// context, not under Mocha's ESM loader path.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadGitCloneHelperWithStub } = require('../helpers/loadGitCloneHelperWithStub.cjs') as {
  loadGitCloneHelperWithStub: () => {
    execGitClone: typeof import('../../src/git/gitCloneHelpers').execGitClone;
    calls: Array<{ command: string; options: any }>;
    setResolved: (value: { stdout?: string; stderr?: string } | Error) => void;
  };
};

describe('execGitClone', () => {
  it('runs a git clone with the authenticated URL, default 40s timeout, GIT_TERMINAL_PROMPT=0', async () => {
    const { execGitClone, calls } = loadGitCloneHelperWithStub();

    await execGitClone('https://oauth2:token@gitlab.example/foo.git', '/tmp/foo');

    expect(calls).to.have.length(1);
    const call = calls[0]!;
    expect(call.command).to.equal('git clone "https://oauth2:token@gitlab.example/foo.git" "/tmp/foo"');
    expect(call.options.timeout).to.equal(40_000);
    expect(call.options.env.GIT_TERMINAL_PROMPT).to.equal('0');
  });

  it('propagates a custom timeout', async () => {
    const { execGitClone, calls } = loadGitCloneHelperWithStub();

    await execGitClone('https://x/y.git', '/tmp/y', { timeout: 10_000 });

    expect(calls[0]!.options.timeout).to.equal(10_000);
  });

  it('propagates cancellationToken and cwd', async () => {
    const { execGitClone, calls } = loadGitCloneHelperWithStub();
    const fakeToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

    await execGitClone('https://x/y.git', '.', { cancellationToken: fakeToken as any, cwd: '/work' });

    expect(calls[0]!.options.cancellationToken).to.equal(fakeToken);
    expect(calls[0]!.options.cwd).to.equal('/work');
  });

  it('keeps the parent env vars and only overrides GIT_TERMINAL_PROMPT', async () => {
    const { execGitClone, calls } = loadGitCloneHelperWithStub();
    const prevValue = process.env.PATH;
    expect(prevValue).to.be.a('string');

    await execGitClone('https://x/y.git', '/tmp/y');

    expect(calls[0]!.options.env.PATH).to.equal(prevValue);
    expect(calls[0]!.options.env.GIT_TERMINAL_PROMPT).to.equal('0');
  });

  it('propagates errors from execAsyncWithTimeout', async () => {
    const { execGitClone, setResolved } = loadGitCloneHelperWithStub();
    setResolved(new Error('clone failed'));

    try {
      await execGitClone('https://x/y.git', '/tmp/y');
      expect.fail('expected execGitClone to reject');
    } catch (err: any) {
      expect(err.message).to.equal('clone failed');
    }
  });
});
