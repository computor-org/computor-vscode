import { expect } from 'chai';

import { isGitAuthenticationError } from '../../src/utils/gitErrors';

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
