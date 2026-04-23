import { expect } from 'chai';
import {
  addTokenToGitUrl,
  stripCredentialsFromGitUrl,
  extractOriginFromGitUrl
} from '../../src/utils/gitUrlHelpers';

describe('gitUrlHelpers', () => {
  describe('addTokenToGitUrl', () => {
    it('injects oauth2 user + token into an https URL', () => {
      expect(addTokenToGitUrl('https://gitlab.example/foo/bar.git', 'glpat-abc'))
        .to.equal('https://oauth2:glpat-abc@gitlab.example/foo/bar.git');
    });

    it('injects oauth2 user + token into an http URL', () => {
      expect(addTokenToGitUrl('http://localhost:8080/foo.git', 't123'))
        .to.equal('http://oauth2:t123@localhost:8080/foo.git');
    });

    it('returns the input unchanged for ssh URLs', () => {
      const ssh = 'git@gitlab.example:foo/bar.git';
      expect(addTokenToGitUrl(ssh, 't123')).to.equal(ssh);
    });

    it('returns the input unchanged for git+ssh URLs', () => {
      const url = 'ssh://git@gitlab.example/foo/bar.git';
      expect(addTokenToGitUrl(url, 't123')).to.equal(url);
    });
  });

  describe('stripCredentialsFromGitUrl', () => {
    it('removes the user:password portion from an https URL', () => {
      expect(stripCredentialsFromGitUrl('https://oauth2:secret@gitlab.example/foo/bar.git'))
        .to.equal('https://gitlab.example/foo/bar.git');
    });

    it('returns the URL unchanged when there are no credentials', () => {
      expect(stripCredentialsFromGitUrl('https://gitlab.example/foo/bar.git'))
        .to.equal('https://gitlab.example/foo/bar.git');
    });

    it('handles http URLs too', () => {
      expect(stripCredentialsFromGitUrl('http://oauth2:x@localhost/r.git'))
        .to.equal('http://localhost/r.git');
    });

    it('returns undefined for empty / whitespace input', () => {
      expect(stripCredentialsFromGitUrl('')).to.be.undefined;
      expect(stripCredentialsFromGitUrl('   ')).to.be.undefined;
    });

    it('returns undefined for non-http(s) URLs', () => {
      expect(stripCredentialsFromGitUrl('git@gitlab.example:foo.git')).to.be.undefined;
      expect(stripCredentialsFromGitUrl('ssh://git@host/repo.git')).to.be.undefined;
    });

    it('returns undefined for a malformed URL', () => {
      expect(stripCredentialsFromGitUrl('https://:::::')).to.be.undefined;
    });
  });

  describe('extractOriginFromGitUrl', () => {
    it('returns protocol + host for an https URL', () => {
      expect(extractOriginFromGitUrl('https://gitlab.example/foo/bar.git'))
        .to.equal('https://gitlab.example');
    });

    it('preserves a non-default port', () => {
      expect(extractOriginFromGitUrl('http://localhost:8084/foo.git'))
        .to.equal('http://localhost:8084');
    });

    it('strips the user:password portion of the host', () => {
      expect(extractOriginFromGitUrl('https://oauth2:secret@gitlab.example/foo.git'))
        .to.equal('https://gitlab.example');
    });

    it('returns undefined for ssh URLs and malformed input', () => {
      expect(extractOriginFromGitUrl('git@gitlab.example:foo.git')).to.be.undefined;
      expect(extractOriginFromGitUrl('https://:::::')).to.be.undefined;
      expect(extractOriginFromGitUrl('')).to.be.undefined;
    });
  });
});
