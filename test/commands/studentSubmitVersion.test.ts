import { expect } from 'chai';
import { StudentCommands } from '../../src/commands/StudentCommands';

// Submit used to pick "the version that was tested" as simply the first artifact
// the list endpoint returned, without checking that it carried a result. An
// untested (or merely older) artifact could therefore be submitted in place of
// the student's current work - silently, and without a test run.
const pick = (artifacts: any[]) =>
  (StudentCommands as any).pickLatestTestedArtifact(artifacts);

const artifact = (over: Record<string, any> = {}) => ({
  id: 'a1',
  version_identifier: 'commit-a',
  uploaded_at: '2026-01-01T10:00:00Z',
  latest_result: { id: 'r1', result: 1 },
  ...over
});

describe('StudentCommands.pickLatestTestedArtifact', () => {
  it('returns null when there are no artifacts at all', () => {
    expect(pick([])).to.equal(null);
  });

  it('ignores artifacts that carry no result', () => {
    const untested = artifact({ id: 'untested', latest_result: null });
    expect(pick([untested])).to.equal(null);
  });

  it('never returns an untested artifact just because it is newest', () => {
    const newestUntested = artifact({
      id: 'untested',
      version_identifier: 'commit-new',
      uploaded_at: '2026-02-01T10:00:00Z',
      latest_result: null
    });
    const olderTested = artifact({
      id: 'tested',
      version_identifier: 'commit-old',
      uploaded_at: '2026-01-01T10:00:00Z'
    });

    expect(pick([newestUntested, olderTested]).id).to.equal('tested');
  });

  it('picks the newest tested artifact regardless of list order', () => {
    const older = artifact({ id: 'older', uploaded_at: '2026-01-01T10:00:00Z' });
    const newer = artifact({ id: 'newer', uploaded_at: '2026-03-01T10:00:00Z' });
    const middle = artifact({ id: 'middle', uploaded_at: '2026-02-01T10:00:00Z' });

    expect(pick([older, newer, middle]).id).to.equal('newer');
    expect(pick([newer, middle, older]).id).to.equal('newer');
  });

  it('falls back to created_at when uploaded_at is missing', () => {
    const older = artifact({ id: 'older', uploaded_at: undefined, created_at: '2026-01-01T10:00:00Z' });
    const newer = artifact({ id: 'newer', uploaded_at: undefined, created_at: '2026-05-01T10:00:00Z' });

    expect(pick([older, newer]).id).to.equal('newer');
  });

  it('skips artifacts without a version identifier - nothing to submit', () => {
    const versionless = artifact({ id: 'versionless', version_identifier: null });
    expect(pick([versionless])).to.equal(null);
  });

  it('tolerates unparsable timestamps instead of throwing', () => {
    const broken = artifact({ id: 'broken', uploaded_at: 'not-a-date' });
    const good = artifact({ id: 'good', uploaded_at: '2026-01-01T10:00:00Z' });

    expect(pick([broken, good]).id).to.equal('good');
  });
});
