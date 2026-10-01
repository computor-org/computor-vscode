import { expect } from 'chai';
import {
  pickLatestSubmissionArtifactId,
  sortSubmissionArtifactsByRecency,
  submissionArtifactTime
} from '../../src/utils/submissionArtifacts';

// Artifact directories are named by id, so "the latest submission" can only
// come from the upload dates. Reading it off the listing order instead - which
// the tutor test runner did, taking the last entry readdir handed back - tested
// whichever id happened to sort last.

describe('submission artifact ordering', () => {
  const older = { id: 'b', uploaded_at: '2026-08-01T10:00:00Z' };
  const newer = { id: 'a', uploaded_at: '2026-08-20T10:00:00Z' };

  it('sorts newest first, whatever order it was given', () => {
    expect(sortSubmissionArtifactsByRecency([older, newer]).map(a => a.id)).to.deep.equal(['a', 'b']);
    expect(sortSubmissionArtifactsByRecency([newer, older]).map(a => a.id)).to.deep.equal(['a', 'b']);
  });

  it('leaves the array it was given alone', () => {
    const artifacts = [older, newer];
    sortSubmissionArtifactsByRecency(artifacts);
    expect(artifacts.map(a => a.id)).to.deep.equal(['b', 'a']);
  });

  it('falls back to created_at when nothing was uploaded_at', () => {
    const byCreation = [
      { id: 'old', created_at: '2026-01-01T00:00:00Z' },
      { id: 'new', created_at: '2026-06-01T00:00:00Z' }
    ];
    expect(sortSubmissionArtifactsByRecency(byCreation).map(a => a.id)).to.deep.equal(['new', 'old']);
  });

  it('sorts an unusable timestamp oldest instead of scrambling the order', () => {
    // `new Date('').getTime()` is NaN, and a comparator that returns NaN lets a
    // sort produce any order at all.
    expect(submissionArtifactTime({ uploaded_at: 'not a date' })).to.equal(0);
    expect(submissionArtifactTime({})).to.equal(0);

    const mixed = [{ id: 'unstamped' }, newer, older];
    expect(sortSubmissionArtifactsByRecency(mixed).map(a => a.id)).to.deep.equal(['a', 'b', 'unstamped']);
  });
});

describe('picking the submission to test', () => {
  const downloaded = [
    { id: 'ffff', downloadedAt: 100 },
    { id: 'aaaa', downloadedAt: 200 }
  ];

  it('takes the newest upload, not the last directory in the listing', () => {
    const artifacts = [
      { id: 'ffff', uploaded_at: '2026-08-20T10:00:00Z' },
      { id: 'aaaa', uploaded_at: '2026-08-01T10:00:00Z' }
    ];
    expect(pickLatestSubmissionArtifactId(downloaded, artifacts)).to.equal('ffff');
  });

  it('ignores submissions that were never downloaded', () => {
    const artifacts = [
      { id: 'never-fetched', uploaded_at: '2026-08-25T10:00:00Z' },
      { id: 'ffff', uploaded_at: '2026-08-20T10:00:00Z' }
    ];
    expect(pickLatestSubmissionArtifactId(downloaded, artifacts)).to.equal('ffff');
  });

  it('falls back to the most recently downloaded when the server list is unavailable', () => {
    expect(pickLatestSubmissionArtifactId(downloaded, undefined)).to.equal('aaaa');
    expect(pickLatestSubmissionArtifactId(downloaded, [])).to.equal('aaaa');
  });

  it('has nothing to offer when nothing is downloaded', () => {
    expect(pickLatestSubmissionArtifactId([], [{ id: 'ffff', uploaded_at: '2026-08-20T10:00:00Z' }])).to.be.undefined;
  });
});
