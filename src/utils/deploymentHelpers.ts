import { CourseContentGet, CourseContentList } from '../types/generated';

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
  // Check deployment object first
  if ('deployment' in content && content.deployment?.deployment_status) {
    console.log(`Debug getDeploymentStatus: Found deployment.deployment_status = ${content.deployment.deployment_status}`);
    return content.deployment.deployment_status;
  }
  
  // For CourseContentList, check the deprecated deployment_status field
  if ('deployment_status' in content) {
    console.log(`Debug getDeploymentStatus: Using deprecated deployment_status = ${content.deployment_status}`);
    return content.deployment_status;
  }
  
  console.log(`Debug getDeploymentStatus: No deployment status found for content`);
  return null;
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
 * NOTE: example_id is completely removed from the new model.
 * To get example information, you need to:
 * 1. Get the example_version_id from deployment
 * 2. Fetch the ExampleVersion which contains example_id
 * 3. Fetch the Example using that ID
 * 
 * This is an intentional design change to ensure version tracking.
 */