import { expect } from 'chai';
import {
  hasExampleAssigned,
  getExampleVersionId,
  getDeploymentStatus,
  getDeploymentInfo
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
});
