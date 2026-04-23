import { expect } from 'chai';
import * as path from 'path';

/**
 * Tests for execGitClone. The helper delegates to execAsyncWithTimeout
 * (src/utils/exec.ts); we intercept that by rewriting the module cache.
 */
type ExecArgs = { command: string; options: any };

function loadHelperWithStub(): {
  execGitClone: typeof import('../../src/git/gitCloneHelpers').execGitClone;
  calls: ExecArgs[];
  setResolved: (value: { stdout?: string; stderr?: string } | Error) => void;
} {
  const execPath = require.resolve(path.resolve(__dirname, '../../src/utils/exec.ts'));
  delete require.cache[execPath];

  const actual = require(path.resolve(__dirname, '../../src/utils/exec.ts'));
  const calls: ExecArgs[] = [];
  let pending: { stdout?: string; stderr?: string } | Error = { stdout: '', stderr: '' };

  // Overwrite just the function we care about; keep the error classes + other
  // exports intact so consumers that type-check against them still compile.
  actual.execAsyncWithTimeout = async (command: string, options: any) => {
    calls.push({ command, options });
    if (pending instanceof Error) throw pending;
    return pending;
  };

  const helperPath = path.resolve(__dirname, '../../src/git/gitCloneHelpers.ts');
  delete require.cache[require.resolve(helperPath)];
  const helper = require(helperPath) as typeof import('../../src/git/gitCloneHelpers');

  return {
    execGitClone: helper.execGitClone,
    calls,
    setResolved(value) { pending = value; }
  };
}

describe('execGitClone', () => {
  it('runs a git clone with the authenticated URL, default 40s timeout, GIT_TERMINAL_PROMPT=0', async () => {
    const { execGitClone, calls } = loadHelperWithStub();

    await execGitClone('https://oauth2:token@gitlab.example/foo.git', '/tmp/foo');

    expect(calls).to.have.length(1);
    const call = calls[0]!;
    expect(call.command).to.equal('git clone "https://oauth2:token@gitlab.example/foo.git" "/tmp/foo"');
    expect(call.options.timeout).to.equal(40_000);
    expect(call.options.env.GIT_TERMINAL_PROMPT).to.equal('0');
  });

  it('propagates a custom timeout', async () => {
    const { execGitClone, calls } = loadHelperWithStub();

    await execGitClone('https://x/y.git', '/tmp/y', { timeout: 10_000 });

    expect(calls[0]!.options.timeout).to.equal(10_000);
  });

  it('propagates cancellationToken and cwd', async () => {
    const { execGitClone, calls } = loadHelperWithStub();
    const fakeToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

    await execGitClone('https://x/y.git', '.', { cancellationToken: fakeToken as any, cwd: '/work' });

    expect(calls[0]!.options.cancellationToken).to.equal(fakeToken);
    expect(calls[0]!.options.cwd).to.equal('/work');
  });

  it('keeps the parent env vars and only overrides GIT_TERMINAL_PROMPT', async () => {
    const { execGitClone, calls } = loadHelperWithStub();
    const prevValue = process.env.PATH;
    expect(prevValue).to.be.a('string');

    await execGitClone('https://x/y.git', '/tmp/y');

    expect(calls[0]!.options.env.PATH).to.equal(prevValue);
    expect(calls[0]!.options.env.GIT_TERMINAL_PROMPT).to.equal('0');
  });

  it('propagates errors from execAsyncWithTimeout', async () => {
    const { execGitClone, setResolved } = loadHelperWithStub();
    setResolved(new Error('clone failed'));

    try {
      await execGitClone('https://x/y.git', '/tmp/y');
      expect.fail('expected execGitClone to reject');
    } catch (err: any) {
      expect(err.message).to.equal('clone failed');
    }
  });
});
