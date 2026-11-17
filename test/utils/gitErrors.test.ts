import { expect } from 'chai';

import { GitTimeoutError } from '../../src/exceptions/errors/GitExecError';
import { HttpError, MaintenanceError, NetworkError } from '../../src/exceptions/errors/HttpError';
import { classifyRepositorySetupFailure, extractAuthFailureOrigin, isGitAuthenticationError } from '../../src/utils/gitErrors';

/**
 * Misreading an error as a rejected credential is not a harmless false
 * positive: it deletes the stored token and re-prompts the student, and on a
 * managed Forgejo course it triggers a credential ROTATION, which invalidates
 * the token embedded in every one of their other clones on that server.
 *
 * The matcher used to test for the substring '401' anywhere in the text.
 */
describe('isGitAuthenticationError', () => {
  it('recognises git and curl phrasings of a rejected credential', () => {
    const rejections = [
      'fatal: Authentication failed for https://git.example.org/a/b.git',
      'remote: HTTP Basic: Access denied',
      'fatal: unable to access: The requested URL returned error: 401',
      'error: The requested URL returned error: 401 Unauthorized',
      'fatal: could not read Username for https://git.example.org',
      'remote: Invalid username or password'
    ];
    for (const message of rejections) {
      expect(isGitAuthenticationError({ message }), message).to.equal(true);
    }
  });

  it('does not fire on a course slug that merely contains 401', () => {
    // The regression: a repository path like `cs401` or a term like `ws2401`
    // read as a rejected credential and cost the student their token.
    const innocuous = [
      "fatal: repository 'https://git.example.org/cs401/student.git' not found",
      'error: pathspec ws2401/week_1.md did not match any file(s)',
      'fatal: unable to access: Could not resolve host: git.example.org (cs401)'
    ];
    for (const message of innocuous) {
      expect(isGitAuthenticationError({ message }), message).to.equal(false);
    }
  });

  it('does not fire on other failures', () => {
    const others = [
      'fatal: not a git repository',
      'error: Your local changes would be overwritten by merge',
      'fatal: unable to access: Could not resolve host: git.example.org',
      'The requested URL returned error: 500'
    ];
    for (const message of others) {
      expect(isGitAuthenticationError({ message }), message).to.equal(false);
    }
  });

  it('reads stderr as well as message', () => {
    expect(isGitAuthenticationError({ stderr: 'remote: HTTP Basic: Access denied' })).to.equal(true);
  });

  it('tolerates junk input', () => {
    expect(isGitAuthenticationError(undefined)).to.equal(false);
    expect(isGitAuthenticationError(null)).to.equal(false);
    expect(isGitAuthenticationError({})).to.equal(false);
  });
});

describe('extractAuthFailureOrigin', () => {
  it('reads the origin out of the URL git quoted back', () => {
    expect(extractAuthFailureOrigin({
      stderr: "fatal: Authentication failed for 'https://git.example.org/itp/student-42.git/'"
    })).to.equal('https://git.example.org');

    expect(extractAuthFailureOrigin({
      stderr: "fatal: could not read Username for 'https://git.example.org:8443': No such device or address"
    })).to.equal('https://git.example.org:8443');

    expect(extractAuthFailureOrigin({
      stderr: "fatal: unable to access 'https://git.example.org/itp/x.git/': The requested URL returned error: 401"
    })).to.equal('https://git.example.org');
  });

  it('drops the embedded credential — remotes carry the token in the URL', () => {
    expect(extractAuthFailureOrigin({
      stderr: "fatal: Authentication failed for 'https://oauth2:glpat-deadbeefdeadbeef@git.example.org/itp/x.git/'"
    })).to.equal('https://git.example.org');
  });

  it('returns undefined when git named no usable URL', () => {
    expect(extractAuthFailureOrigin({ stderr: 'remote: HTTP Basic: Access denied' })).to.equal(undefined);
    expect(extractAuthFailureOrigin({ message: "fatal: unable to access 'not a url'" })).to.equal(undefined);
    expect(extractAuthFailureOrigin(undefined)).to.equal(undefined);
  });
});

describe('classifyRepositorySetupFailure', () => {
  it('reads the provisioning call by error type and status', () => {
    expect(classifyRepositorySetupFailure(new HttpError('Forbidden', 403, 'Forbidden'))).to.equal('authentication');
    expect(classifyRepositorySetupFailure(new HttpError('Bad Gateway', 502, 'Bad Gateway'))).to.equal('server');
    expect(classifyRepositorySetupFailure(new MaintenanceError())).to.equal('server');
    expect(classifyRepositorySetupFailure(new NetworkError('offline'))).to.equal('unreachable');
    expect(classifyRepositorySetupFailure(new GitTimeoutError('git clone "***" "/ws"', 180_000))).to.equal('timeout');
  });

  it('reads the clone by its stderr', () => {
    const cases: Array<[string, string]> = [
      ['fatal: Authentication failed for https://git.example.org/a/b.git', 'authentication'],
      ["fatal: unable to access 'http://computor-git/a/b.git/': The requested URL returned error: 403", 'authentication'],
      ["fatal: unable to access 'http://computor-git/a/b.git/': Could not resolve host: computor-git", 'unreachable'],
      ['fatal: unable to access: Failed to connect to computor-git port 80 after 75000 ms: Connection refused', 'unreachable'],
      ["fatal: unable to access 'http://computor-git/a/b.git/': The requested URL returned error: 502", 'server'],
      ["fatal: repository 'https://git.example.org/cs401/student.git' not found", 'other']
    ];
    for (const [stderr, expected] of cases) {
      expect(classifyRepositorySetupFailure({ message: 'Command failed: git clone', stderr }), stderr).to.equal(expected);
    }
  });

  it('tolerates junk input', () => {
    expect(classifyRepositorySetupFailure(undefined)).to.equal('other');
    expect(classifyRepositorySetupFailure('boom')).to.equal('other');
  });
});
