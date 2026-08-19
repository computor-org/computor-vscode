import { expect } from 'chai';
import { isGitAuthenticationError } from '../../src/utils/gitErrors';

describe('isGitAuthenticationError', () => {
  it('recognizes the stderr shapes git uses for rejected credentials', () => {
    expect(isGitAuthenticationError(new Error("fatal: Authentication failed for 'http://computor-git/bpti-2027/x.git/'"))).to.be.true;
    expect(isGitAuthenticationError(new Error('remote: HTTP Basic: Access denied'))).to.be.true;
    expect(isGitAuthenticationError(new Error('The requested URL returned error: 401'))).to.be.true;
    expect(isGitAuthenticationError(new Error('Access denied'))).to.be.true;
  });

  it('does not classify network or timeout failures as auth errors', () => {
    expect(isGitAuthenticationError(new Error("fatal: unable to access 'http://computor-git/x.git/': Could not resolve host: computor-git"))).to.be.false;
    expect(isGitAuthenticationError(new Error('Connection timed out'))).to.be.false;
    expect(isGitAuthenticationError(new Error("fatal: unable to access 'http://computor-git/x.git/': Failed to connect"))).to.be.false;
  });

  it('tolerates non-Error inputs', () => {
    expect(isGitAuthenticationError(undefined)).to.be.false;
    expect(isGitAuthenticationError(null)).to.be.false;
    expect(isGitAuthenticationError('Authentication failed')).to.be.true;
  });
});
