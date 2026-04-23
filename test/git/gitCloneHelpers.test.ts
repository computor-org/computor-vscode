import { expect } from 'chai';
import { execGitClone } from '../../src/git/gitCloneHelpers';

// The helper accepts an `exec` option that lets tests substitute the real
// execAsyncWithTimeout. No module-cache tricks → works under both CJS and
// ESM Mocha loader paths.

type ExecArgs = { command: string; options: any };

function createFakeExec(result: { stdout?: string; stderr?: string } | Error = { stdout: '', stderr: '' }) {
  const calls: ExecArgs[] = [];
  const impl = async (command: string, options: any) => {
    calls.push({ command, options });
    if (result instanceof Error) throw result;
    return result;
  };
  return { impl, calls };
}

describe('execGitClone', () => {
  it('runs a git clone with the authenticated URL, default 40s timeout, GIT_TERMINAL_PROMPT=0', async () => {
    const { impl, calls } = createFakeExec();

    await execGitClone('https://oauth2:token@gitlab.example/foo.git', '/tmp/foo', { exec: impl as any });

    expect(calls).to.have.length(1);
    const call = calls[0]!;
    expect(call.command).to.equal('git clone "https://oauth2:token@gitlab.example/foo.git" "/tmp/foo"');
    expect(call.options.timeout).to.equal(40_000);
    expect(call.options.env.GIT_TERMINAL_PROMPT).to.equal('0');
  });

  it('propagates a custom timeout', async () => {
    const { impl, calls } = createFakeExec();

    await execGitClone('https://x/y.git', '/tmp/y', { timeout: 10_000, exec: impl as any });

    expect(calls[0]!.options.timeout).to.equal(10_000);
  });

  it('propagates cancellationToken and cwd', async () => {
    const { impl, calls } = createFakeExec();
    const fakeToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

    await execGitClone('https://x/y.git', '.', { cancellationToken: fakeToken as any, cwd: '/work', exec: impl as any });

    expect(calls[0]!.options.cancellationToken).to.equal(fakeToken);
    expect(calls[0]!.options.cwd).to.equal('/work');
  });

  it('keeps the parent env vars and only overrides GIT_TERMINAL_PROMPT', async () => {
    const { impl, calls } = createFakeExec();
    const prevValue = process.env.PATH;
    expect(prevValue).to.be.a('string');

    await execGitClone('https://x/y.git', '/tmp/y', { exec: impl as any });

    expect(calls[0]!.options.env.PATH).to.equal(prevValue);
    expect(calls[0]!.options.env.GIT_TERMINAL_PROMPT).to.equal('0');
  });

  it('propagates errors from the exec implementation', async () => {
    const { impl } = createFakeExec(new Error('clone failed'));

    try {
      await execGitClone('https://x/y.git', '/tmp/y', { exec: impl as any });
      expect.fail('expected execGitClone to reject');
    } catch (err: any) {
      expect(err.message).to.equal('clone failed');
    }
  });
});
