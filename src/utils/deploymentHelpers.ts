import { CourseContentGet, CourseContentList } from '../types/generated';
import type { CourseDeploymentList } from '../types/generated';
import type { ComputorApiService } from '../services/ComputorApiService';

export type ReleaseReason = 'new' | 'update' | 'failed';

/**
 * What still has to happen before students see the assigned example version.
 *
 * The backend reuses `pending` for two very different situations: content that
 * was never released, and content whose released version is now stale because a
 * new version was assigned on top of it. Only `deployed_at` tells them apart,
 * so derive it once here rather than in every view.
 */
export type ReleaseState =
  | 'deployed'
  | 'deploying'
  | 'failed'
  | 'update-not-deployed'   // pending, but an older version is already live
  | 'never-deployed';       // pending, nothing ever released

export interface ReleaseCandidate {
  content: CourseContentGet | CourseContentList;
  reason: ReleaseReason;
}

/**
 * Helper functions to work with the new deployment model
 */

/**
 * Check if a course content has an example/deployment assigned
 */
export function hasExampleAssigned(content: CourseContentGet | CourseContentList): boolean {
  // Check has_deployment flag (only trust explicit true/false, not null)
  if ('has_deployment' in content && content.has_deployment === true) {
    return true;
  }

  // Check if deployment object exists
  if ('deployment' in content && content.deployment) {
    return true;
  }

  // Fallback to deprecated field if available
  if ('example_version_id' in content && content.example_version_id) {
    return true;
  }

  return false;
}

/**
 * Get the example version ID from course content
 */
export function getExampleVersionId(content: CourseContentGet | CourseContentList): string | null | undefined {
  // Check deployment object first
  if ('deployment' in content && content.deployment?.example_version_id) {
    return content.deployment.example_version_id;
  }
  
  // Fallback to deprecated field in CourseContentGet
  if ('example_version_id' in content) {
    return content.example_version_id;
  }
  
  return null;
}

/**
 * Get the deployment status from course content
 */
export function getDeploymentStatus(content: CourseContentGet | CourseContentList): string | null | undefined {
  if ('deployment' in content && content.deployment?.deployment_status) {
    return content.deployment.deployment_status;
  }

  if ('deployment_status' in content) {
    return content.deployment_status;
  }

  return null;
}

/**
 * Resolve the release state of a course content.
 *
 * `statusOverride` lets callers that already resolved the status (the lecturer
 * tree keeps it on its assignment info) pass it in rather than re-reading it.
 */
export function getReleaseState(
  content: CourseContentGet | CourseContentList,
  statusOverride?: string | null
): ReleaseState | undefined {
  const status = statusOverride || getDeploymentStatus(content);
  if (!status) {
    return undefined;
  }

  switch (status) {
    case 'deployed':
      return 'deployed';
    case 'deploying':
      return 'deploying';
    case 'failed':
      return 'failed';
    case 'pending': {
      // The one bit that separates "never released" from "released, now stale".
      const deployedAt = 'deployment' in content ? content.deployment?.deployed_at : undefined;
      return deployedAt ? 'update-not-deployed' : 'never-deployed';
    }
    default:
      // 'unassigned', and anything the backend does not actually emit.
      return undefined;
  }
}

/**
 * Get deployment info for display
 */
export function getDeploymentInfo(content: CourseContentGet | CourseContentList): {
  hasExample: boolean;
  versionId: string | null | undefined;
  status: string | null | undefined;
  deployedAt: string | null | undefined;
} {
  const hasExample = hasExampleAssigned(content);
  const versionId = getExampleVersionId(content);
  const status = getDeploymentStatus(content);
  
  let deployedAt: string | null | undefined = null;
  if ('deployment' in content && content.deployment?.deployed_at) {
    deployedAt = content.deployment.deployed_at;
  }
  
  return {
    hasExample,
    versionId,
    status,
    deployedAt
  };
}

/**
 * Classify contents into release candidates with reasons (new / update / failed).
 * Uses batch endpoint to check has_newer_version for all deployed items in one call.
 */
export async function classifyReleaseContents(
  contents: (CourseContentGet | CourseContentList)[],
  apiService: ComputorApiService,
  courseId: string
): Promise<ReleaseCandidate[]> {
  const candidates: ReleaseCandidate[] = [];

  // Batch-fetch all deployments with has_newer_version in one call
  const deploymentMap = new Map<string, CourseDeploymentList>();
  try {
    const batch = await apiService.lecturerGetCourseDeployments(courseId);
    for (const dep of batch.deployments || []) {
      deploymentMap.set(dep.course_content_id, dep);
    }
  } catch {
    // Fallback: deployed items won't be classified as updates
  }

  for (const content of contents) {
    const state = getReleaseState(content);

    if (state === 'update-not-deployed') {
      candidates.push({ content, reason: 'update' });
      continue;
    }

    if (state === 'never-deployed') {
      candidates.push({ content, reason: 'new' });
      continue;
    }

    if (state === 'failed') {
      candidates.push({ content, reason: 'failed' });
      continue;
    }

    if (state === 'deployed') {
      const dep = deploymentMap.get(content.id);
      if (dep?.has_newer_version) {
        candidates.push({ content, reason: 'update' });
      }
    }
  }

  return candidates;
}