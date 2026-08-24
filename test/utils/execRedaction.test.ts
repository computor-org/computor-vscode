import { expect } from 'chai';

import { execAsync, redactExecError } from '../../src/utils/exec';

/**
 * Credentials must not survive a failed git call.
 *
 * Node rejects with `Command failed: <the whole command>`, so a git call
 * carrying `https://user:token@host` reproduces the token verbatim — and
 * several callers put that message straight into a log line or a notification
 * popup. `execAsync` had no redaction at all, and `execAsyncWithTimeout`
 * covered `.message`/`.cmd` but not `.stderr`/`.stdout`.
 */
describe('redactExecError', () => {
  it('scrubs the credential from every field that carries the command back', () => {
    const error = {
      message: 'Command failed: git remote set-url origin "https://user:glpat-secret@git.example.org/a/b.git"',
      cmd: 'git remote set-url origin "https://user:glpat-secret@git.example.org/a/b.git"',
      stderr: 'fatal: could not read https://user:glpat-secret@git.example.org/a/b.git',
      stdout: 'pushing to https://user:glpat-secret@git.example.org/a/b.git'
    };

    redactExecError(error);

    for (const field of ['message', 'cmd', 'stderr', 'stdout'] as const) {
      expect(error[field], field).to.not.include('glpat-secret');
      expect(error[field], field).to.include('***@');
    }
  });

  it('leaves an error without credentials untouched', () => {
    const error = { message: 'fatal: not a git repository' };
    redactExecError(error);
    expect(error.message).to.equal('fatal: not a git repository');
  });

  it('tolerates missing and non-string fields', () => {
    const error = { message: undefined, cmd: 7, stderr: null };
    expect(() => redactExecError(error)).to.not.throw();
  });
});

describe('execAsync', () => {
  it('redacts the credential when the command fails', async () => {
    // `git` with a bogus subcommand fails fast and echoes the command back.
    const url = 'https://user:glpat-supersecret@git.invalid/a/b.git';
    let caught: any;
    try {
      await execAsync(`git no-such-subcommand "${url}"`);
    } catch (error) {
      caught = error;
    }

    expect(caught, 'the command was expected to fail').to.exist;
    const combined = `${caught.message ?? ''}${caught.cmd ?? ''}${caught.stderr ?? ''}`;
    expect(combined).to.not.include('glpat-supersecret');
  });

  it('returns stdout and stderr on success', async () => {
    const { stdout } = await execAsync('git --version');
    expect(stdout).to.match(/^git version /);
  });
});
