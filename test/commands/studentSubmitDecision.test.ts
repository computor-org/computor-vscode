import { expect } from 'chai';
import { StudentCommands } from '../../src/commands/StudentCommands';

// Submit used to decide "have I already submitted this?" by re-reading the
// artifact after its test run. A submit-triggered run whose test budget is spent
// is paid for by the backend with a submission - it sets `submit` on that very
// artifact - so a first-ever submit read back its own submission as somebody's
// earlier one and warned "already submitted. No action taken."
// (computor-org/issues#381). The answer must come from before the run.

const pickForVersion = (artifacts: any[]) =>
  (StudentCommands as any).pickArtifactForVersion(artifacts);

const decide = (artifact: any, submittedBeforeRun: boolean) =>
  (StudentCommands as any).decideSubmitAction(artifact, submittedBeforeRun);

const artifact = (over: Record<string, any> = {}) => ({
  id: 'a1',
  version_identifier: 'commit-a',
  uploaded_at: '2026-01-01T10:00:00Z',
  submit: false,
  latest_result: null,
  ...over
});

describe('StudentCommands.pickArtifactForVersion', () => {
  it('returns undefined when the version has no artifacts', () => {
    expect(pickForVersion([])).to.equal(undefined);
  });

  it('prefers the submitted artifact over a newer unsubmitted one', () => {
    // Otherwise submit marks the newer one too, and the student is charged a
    // second submission for a commit they have already handed in.
    const submitted = artifact({ id: 'submitted', submit: true, uploaded_at: '2026-01-01T10:00:00Z' });
    const newer = artifact({ id: 'newer', uploaded_at: '2026-03-01T10:00:00Z' });

    expect(pickForVersion([newer, submitted]).id).to.equal('submitted');
  });

  it('prefers a tested artifact over an untested one', () => {
    const tested = artifact({ id: 'tested', latest_result: { id: 'r1' } });
    const untested = artifact({ id: 'untested', uploaded_at: '2026-03-01T10:00:00Z' });

    expect(pickForVersion([untested, tested]).id).to.equal('tested');
  });

  it('falls back to the newest when nothing else separates them', () => {
    const older = artifact({ id: 'older', uploaded_at: '2026-01-01T10:00:00Z' });
    const newer = artifact({ id: 'newer', uploaded_at: '2026-03-01T10:00:00Z' });

    expect(pickForVersion([older, newer]).id).to.equal('newer');
    expect(pickForVersion([newer, older]).id).to.equal('newer');
  });

  it('uses created_at when uploaded_at is missing', () => {
    const older = artifact({ id: 'older', uploaded_at: undefined, created_at: '2026-01-01T10:00:00Z' });
    const newer = artifact({ id: 'newer', uploaded_at: undefined, created_at: '2026-05-01T10:00:00Z' });

    expect(pickForVersion([older, newer]).id).to.equal('newer');
  });

  it('does not mutate the list it was given', () => {
    const older = artifact({ id: 'older', uploaded_at: '2026-01-01T10:00:00Z' });
    const newer = artifact({ id: 'newer', uploaded_at: '2026-03-01T10:00:00Z' });
    const artifacts = [older, newer];

    pickForVersion(artifacts);

    expect(artifacts.map(a => a.id)).to.deep.equal(['older', 'newer']);
  });
});

describe('StudentCommands.decideSubmitAction', () => {
  it('uploads when the version has no artifact at all', () => {
    expect(decide(undefined, false)).to.equal('create');
  });

  it('uploads when the artifact carries no id', () => {
    expect(decide(artifact({ id: undefined }), false)).to.equal('create');
  });

  it('marks a tested artifact as submitted', () => {
    expect(decide(artifact({ latest_result: { id: 'r1' } }), false)).to.equal('mark-submitted');
  });

  it('still submits when the test run itself flipped submit (issue #381)', () => {
    // The artifact reads submit=true now, but it did not before this run: the
    // backend spent a submission so the submit-triggered test could go ahead.
    // That submission is ours - report it as one, and let the idempotent PATCH
    // confirm it rather than warning that nothing happened.
    const flippedByOurTestRun = artifact({ submit: true, latest_result: { id: 'r1' } });

    expect(decide(flippedByOurTestRun, false)).to.equal('mark-submitted');
  });

  it('does nothing when this commit was already submitted before the run', () => {
    expect(decide(artifact({ submit: true }), true)).to.equal('already-submitted');
  });
});
