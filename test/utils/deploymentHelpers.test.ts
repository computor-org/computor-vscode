import { expect } from 'chai';
import {
  hasExampleAssigned,
  getExampleVersionId,
  getDeploymentStatus,
  getDeploymentInfo,
  getReleaseState,
  classifyReleaseContents
} from '../../src/utils/deploymentHelpers';

// We only need the fields these helpers read, so a thin cast lets us avoid
// reproducing the full generated CourseContentGet shape.
const asContent = (obj: Record<string, unknown>) => obj as any;

describe('deploymentHelpers', () => {
  describe('hasExampleAssigned', () => {
    it('returns true when has_deployment === true', () => {
      expect(hasExampleAssigned(asContent({ has_deployment: true }))).to.be.true;
    });

    it('returns false when has_deployment is null / undefined / false', () => {
      expect(hasExampleAssigned(asContent({ has_deployment: null }))).to.be.false;
      expect(hasExampleAssigned(asContent({ has_deployment: undefined }))).to.be.false;
      expect(hasExampleAssigned(asContent({ has_deployment: false }))).to.be.false;
    });

    it('returns true when a deployment object is attached', () => {
      expect(hasExampleAssigned(asContent({
        deployment: { example_version_id: 'v1' }
      }))).to.be.true;
    });

    it('falls back to the legacy example_version_id field', () => {
      expect(hasExampleAssigned(asContent({ example_version_id: 'v-legacy' }))).to.be.true;
    });

    it('returns false when nothing is assigned', () => {
      expect(hasExampleAssigned(asContent({}))).to.be.false;
    });
  });

  describe('getExampleVersionId', () => {
    it('prefers deployment.example_version_id', () => {
      expect(getExampleVersionId(asContent({
        deployment: { example_version_id: 'v-dep' },
        example_version_id: 'v-legacy'
      }))).to.equal('v-dep');
    });

    it('falls back to the legacy example_version_id', () => {
      expect(getExampleVersionId(asContent({ example_version_id: 'v-legacy' })))
        .to.equal('v-legacy');
    });

    it('returns null when nothing is set', () => {
      expect(getExampleVersionId(asContent({}))).to.equal(null);
    });
  });

  describe('getDeploymentStatus', () => {
    it('prefers deployment.deployment_status', () => {
      expect(getDeploymentStatus(asContent({
        deployment: { deployment_status: 'deployed' },
        deployment_status: 'pending'
      }))).to.equal('deployed');
    });

    it('falls back to the top-level deployment_status', () => {
      expect(getDeploymentStatus(asContent({ deployment_status: 'failed' })))
        .to.equal('failed');
    });

    it('returns null when nothing is set', () => {
      expect(getDeploymentStatus(asContent({}))).to.equal(null);
    });
  });

  describe('getDeploymentInfo', () => {
    it('aggregates hasExample / versionId / status / deployedAt from the deployment object', () => {
      const info = getDeploymentInfo(asContent({
        has_deployment: true,
        deployment: {
          example_version_id: 'v-1',
          deployment_status: 'deployed',
          deployed_at: '2026-04-01T10:00:00Z'
        }
      }));
      expect(info).to.deep.equal({
        hasExample: true,
        versionId: 'v-1',
        status: 'deployed',
        deployedAt: '2026-04-01T10:00:00Z'
      });
    });

    it('returns null fields when content has no deployment', () => {
      const info = getDeploymentInfo(asContent({}));
      expect(info).to.deep.equal({
        hasExample: false,
        versionId: null,
        status: null,
        deployedAt: null
      });
    });
  });
  describe('getReleaseState', () => {
    it("reports 'update-not-deployed' when pending on top of an earlier release", () => {
      expect(getReleaseState(asContent({
        deployment: { deployment_status: 'pending', deployed_at: '2026-04-01T10:00:00Z' }
      }))).to.equal('update-not-deployed');
    });

    it("reports 'never-deployed' when pending with nothing ever released", () => {
      expect(getReleaseState(asContent({
        deployment: { deployment_status: 'pending', deployed_at: null }
      }))).to.equal('never-deployed');
      expect(getReleaseState(asContent({ deployment_status: 'pending' }))).to.equal('never-deployed');
    });

    it('passes the terminal statuses through unchanged', () => {
      expect(getReleaseState(asContent({ deployment_status: 'deployed' }))).to.equal('deployed');
      expect(getReleaseState(asContent({ deployment_status: 'deploying' }))).to.equal('deploying');
      expect(getReleaseState(asContent({ deployment_status: 'failed' }))).to.equal('failed');
    });

    it("ignores 'deployed_at' for statuses other than pending", () => {
      expect(getReleaseState(asContent({
        deployment: { deployment_status: 'failed', deployed_at: '2026-04-01T10:00:00Z' }
      }))).to.equal('failed');
    });

    it('returns undefined when there is no release state to report', () => {
      expect(getReleaseState(asContent({}))).to.be.undefined;
      expect(getReleaseState(asContent({ deployment_status: 'unassigned' }))).to.be.undefined;
    });

    it('prefers an explicitly supplied status over the one on the content', () => {
      const content = asContent({
        deployment: { deployment_status: 'pending', deployed_at: '2026-04-01T10:00:00Z' }
      });
      expect(getReleaseState(content, 'deploying')).to.equal('deploying');
    });
  });

  describe('classifyReleaseContents', () => {
    // The batch endpoint is only consulted for already-deployed content.
    const apiStub = (deployments: Record<string, unknown>[] = []) => ({
      lecturerGetCourseDeployments: async () => ({ deployments })
    }) as any;

    it("classifies pending-on-top-of-a-release as 'update' and a first release as 'new'", async () => {
      const candidates = await classifyReleaseContents([
        asContent({ id: 'stale', deployment: { deployment_status: 'pending', deployed_at: '2026-04-01T10:00:00Z' } }),
        asContent({ id: 'fresh', deployment: { deployment_status: 'pending', deployed_at: null } })
      ], apiStub(), 'course-1');

      expect(candidates.map(c => [c.content.id, c.reason])).to.deep.equal([
        ['stale', 'update'],
        ['fresh', 'new']
      ]);
    });

    it("classifies a failed deployment as 'failed'", async () => {
      const candidates = await classifyReleaseContents(
        [asContent({ id: 'broken', deployment_status: 'failed' })],
        apiStub(),
        'course-1'
      );
      expect(candidates).to.have.lengthOf(1);
      expect(candidates[0]!.reason).to.equal('failed');
    });

    it("offers deployed content only when a newer example version exists", async () => {
      const contents = [asContent({ id: 'live', deployment_status: 'deployed' })];

      expect(await classifyReleaseContents(contents, apiStub(), 'course-1')).to.be.empty;

      const withNewer = await classifyReleaseContents(
        contents,
        apiStub([{ course_content_id: 'live', has_newer_version: true }]),
        'course-1'
      );
      expect(withNewer.map(c => c.reason)).to.deep.equal(['update']);
    });

    it('never offers unassigned or in-flight content', async () => {
      const candidates = await classifyReleaseContents([
        asContent({ id: 'none', deployment_status: 'unassigned' }),
        asContent({ id: 'running', deployment_status: 'deploying' }),
        asContent({ id: 'blank' })
      ], apiStub(), 'course-1');
      expect(candidates).to.be.empty;
    });
  });
});
