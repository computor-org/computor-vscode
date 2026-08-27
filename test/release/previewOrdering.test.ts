import { expect } from 'chai';
import * as semver from 'semver';

/**
 * The preview VSIX is sideload-only: the Marketplace rejects semver
 * pre-release suffixes outright, so these artifacts can never be published.
 * What matters is where they sort relative to the published track, because
 * VS Code updates an installed extension to the highest version it can see.
 */
describe('preview VSIX ordering', () => {
  const published = '2026.10.3';
  const nextPatch = '2026.10.4';
  const preview = `${nextPatch}-preview.deadbeef.12345678`;

  it('sorts above the currently published build so a pinned preview survives', () => {
    expect(semver.gt(preview, published)).to.equal(true);
  });

  it('sorts below the patch it graduates into', () => {
    expect(semver.lt(preview, nextPatch)).to.equal(true);
  });

  it('would be replaced mid-workshop if it were pinned to .0 instead', () => {
    // Regression guard for the original scheme, which hardcoded 2026.10.0 and
    // therefore put every preview below the entire Marketplace line.
    expect(semver.lt('2026.10.0-preview.deadbeef.12345678', published)).to.equal(true);
  });

  it('orders two previews of the same patch deterministically', () => {
    expect(semver.lt(`${nextPatch}-preview.aaaaaaaa.1`, `${nextPatch}-preview.bbbbbbbb.1`)).to.equal(true);
  });

  it('keeps the whole winter line below the next summer semester', () => {
    expect(semver.lt('2026.10.99', '2027.3.0')).to.equal(true);
  });
});
