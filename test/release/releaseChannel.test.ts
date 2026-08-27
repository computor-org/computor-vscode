import { expect } from 'chai';

// The release tooling is ESM with no build step, so the release workflow can
// run it straight from a checkout. It is loaded dynamically here through a
// non-literal path: these are plain JavaScript modules with no type
// declarations, and the tests exercise the same entry point the workflow uses.
const RELEASE_CHANNEL_PATH = '../../scripts/release-channel.mjs';
const VSCE_PATH = '../../scripts/vsce.mjs';

let releaseChannel: any;
let vsce: any;

before(async () => {
  releaseChannel = await import(RELEASE_CHANNEL_PATH);
  vsce = await import(VSCE_PATH);
});

describe('release version rules', () => {
  it('accepts semester CalVer for both semesters', () => {
    expect(releaseChannel.parseVersion('2026.10.1')).to.deep.equal({ year: 2026, month: 10, patch: 1 });
    expect(releaseChannel.parseVersion('2027.3.0')).to.deep.equal({ year: 2027, month: 3, patch: 0 });
  });

  it('rejects a zero-padded month, which is invalid semver', () => {
    // The release branch is release/2027.03; the version it produces is 2027.3.x.
    expect(() => releaseChannel.parseVersion('2027.03.1')).to.throw(/leading zero/);
  });

  it('rejects months that are not semester starts', () => {
    expect(() => releaseChannel.parseVersion('2026.9.1')).to.throw(/semester start month/);
    expect(() => releaseChannel.parseVersion('2026.11.1')).to.throw(/semester start month/);
  });

  it('rejects pre-release suffixes, which the Marketplace cannot accept', () => {
    expect(() => releaseChannel.parseVersion('2026.10.1-preview.abc')).to.throw(/YYYY\.M\.patch/);
  });

  it('maps a version back to its tag and zero-padded release branch', () => {
    expect(releaseChannel.releaseTag('2026.10.1')).to.equal('v2026.10.1');
    expect(releaseChannel.releaseBranch('2026.10.1')).to.equal('release/2026.10');
    expect(releaseChannel.releaseBranch('2027.3.4')).to.equal('release/2027.03');
  });
});

describe('GitHub release metadata', () => {
  it('accepts a tag and pre-release flag that agree with the requested channel', () => {
    expect(releaseChannel.validateGitHubRelease('2026.10.1', 'v2026.10.1', true, 'pre-release'))
      .to.equal('pre-release');
    expect(releaseChannel.validateGitHubRelease('2026.10.4', 'v2026.10.4', false, 'stable'))
      .to.equal('stable');
  });

  it('refuses a GitHub pre-release checkbox that contradicts the channel', () => {
    // This is the mistake that would publish a pre-release as stable.
    expect(() => releaseChannel.validateGitHubRelease('2026.10.1', 'v2026.10.1', false, 'pre-release'))
      .to.throw(/pre-release flag to be true/);
    expect(() => releaseChannel.validateGitHubRelease('2026.10.4', 'v2026.10.4', true, 'stable'))
      .to.throw(/pre-release flag to be false/);
  });

  it('refuses a tag that does not match the packaged version', () => {
    expect(() => releaseChannel.validateGitHubRelease('2026.10.1', 'v2026.10.2', true, 'pre-release'))
      .to.throw(/must match/);
  });

  it('refuses an unknown channel', () => {
    expect(() => releaseChannel.validateGitHubRelease('2026.10.1', 'v2026.10.1', true, 'beta'))
      .to.throw(/channel must be one of/);
  });
});

describe('vsce invocation', () => {
  it('passes --pre-release only for the pre-release channel', () => {
    expect(vsce.vsceArgs('package', '2026.10.1', 'pre-release')).to.include('--pre-release');
    expect(vsce.vsceArgs('package', '2026.10.4', 'stable')).to.not.include('--pre-release');
  });

  it('never lets vsce switch to yarn', () => {
    // A stray yarn.lock otherwise makes vsce shell out to yarn, which CI does
    // not install.
    expect(vsce.vsceArgs('package', '2026.10.1', 'pre-release')).to.include('--no-yarn');
  });

  it('refuses to run without an explicit channel', () => {
    expect(() => vsce.vsceArgs('package', '2026.10.1', undefined)).to.throw(/channel must be one of/);
  });

  it('publishes the already-built artifact rather than rebuilding it', () => {
    const args = vsce.vsceArgs('publish', '2026.10.1', 'pre-release');
    expect(args).to.include('--packagePath');
    expect(args).to.include('computor-2026.10.1.vsix');
  });

  it('falls back to the Entra credential when no PAT is present', () => {
    expect(vsce.vsceArgs('publish', '2026.10.1', 'pre-release', true)).to.include('--azure-credential');
    expect(vsce.vsceArgs('publish', '2026.10.1', 'pre-release', false)).to.not.include('--azure-credential');
  });
});
