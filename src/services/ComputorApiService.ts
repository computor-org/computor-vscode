import * as vscode from 'vscode';
import FormData = require('form-data');
import { HttpClient } from '../http/HttpClient';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { errorRecoveryService } from './ErrorRecoveryService';
import { requestBatchingService } from './RequestBatchingService';
import { multiTierCache } from './CacheService';
import { performanceMonitor } from './PerformanceMonitoringService';
import {
  OrganizationList,
  OrganizationGet,
  OrganizationUpdate,
  CourseFamilyList,
  CourseFamilyGet,
  CourseFamilyUpdate,
  CourseList,
  CourseGet,
  CourseUpdate,
  CourseContentList,
  CourseContentGet,
  CourseContentCreate,
  CourseContentUpdate,
  CourseContentKindList,
  CourseContentTypeList,
  CourseContentTypeGet,
  CourseContentTypeCreate,
  CourseContentTypeUpdate,
  CourseContentLecturerList,
  CourseContentLecturerGet,
  ExampleList,
  ExampleRepositoryList,
  ExampleRepositoryGet,
  ExampleGet,
  ExampleUploadRequest,
  ExampleDownloadResponse,
  CourseGroupList,
  CourseGroupGet,
  CourseGroupUpdate,
  CourseMemberList,
  CourseMemberGet,
  CourseMemberUpdate,
  CourseMemberReadinessStatus,
  CourseMemberImportResponse,
  UserPassword,
  UserGet,
  UserList,
  UserUpdate,
  CourseMemberValidationRequest,
  TaskResponse,
  TestCreate,
  CourseContentDeploymentGet,
  DeploymentHistoryGet,
  CourseContentStudentList,
  CourseContentStudentUpdate,
  ProfileGet,
  ProfileCreate,
  ProfileUpdate,
  LanguageList,
  StudentProfileGet,
  StudentProfileCreate,
  StudentProfileUpdate,
  MessageList,
  MessageGet,
  MessageCreate,
  MessageUpdate,
  CourseMemberCommentList,
  CourseContentStudentGet,
  ResultWithGrading,
  SubmissionCreate,
  SubmissionListItem,
  SubmissionQuery,
  SubmissionUploadResponseModel,
  SubmissionArtifactUpdate
} from '../types/generated';
import { TutorGradeCreate, TutorSubmissionGroupList, TutorSubmissionGroupGet, TutorSubmissionGroupQuery, SubmissionArtifactList, GitLabSyncRequest, GitLabSyncResult } from '../types/generated/common';

// Query interface for examples (not generated yet)
interface ExampleQuery {
  repository_id?: string;
  identifier?: string;
  title?: string;
  category?: string;
  tags?: string[];
  search?: string;
  directory?: string;
}

type MessageQueryParams = Partial<{
  id: string;
  parent_id: string;
  author_id: string;
  user_id: string;
  course_member_id: string;
  submission_group_id: string;
  course_group_id: string;
  course_content_id: string;
  course_id: string;
}>;

export class ComputorApiService {
  private static instance?: ComputorApiService;

  public httpClient?: HttpClient;
  private settingsManager: ComputorSettingsManager;

  // Batched method versions for improved performance
  public readonly batchedGetCourseContents: (courseId: string) => Promise<CourseContentList[] | undefined>;
  public readonly batchedGetCourseContentTypes: (courseId: string) => Promise<CourseContentTypeList[] | undefined>;

  constructor(context: vscode.ExtensionContext, httpClient?: HttpClient) {
    this.settingsManager = new ComputorSettingsManager(context);
    this.httpClient = httpClient;

    // Store as singleton instance
    ComputorApiService.instance = this;

    // Create batched versions of frequently called methods
    this.batchedGetCourseContents = requestBatchingService.createBatchedFunction(
      this.getCourseContents.bind(this),
      (courseId) => `getCourseContents-${courseId}`,
      { maxBatchSize: 5, batchDelay: 100 }
    );

    this.batchedGetCourseContentTypes = requestBatchingService.createBatchedFunction(
      this.getCourseContentTypes.bind(this),
      (courseId) => `getCourseContentTypes-${courseId}`,
      { maxBatchSize: 5, batchDelay: 100 }
    );
  }

  /**
   * Get the singleton instance of ComputorApiService
   * Returns undefined if not yet initialized (user not logged in)
   */
  static getInstance(): ComputorApiService | undefined {
    return ComputorApiService.instance;
  }

  private async getHttpClient(): Promise<HttpClient> {
    console.log('[getHttpClient] Checking httpClient availability:', !!this.httpClient);

    if (!this.httpClient) {
      throw new Error('Not authenticated. Please login first using the Computor: Login command.');
    }

    console.log('[getHttpClient] Returning httpClient:', {
      exists: !!this.httpClient,
      type: this.httpClient?.constructor?.name
    });

    return this.httpClient;
  }

  async getOrganizations(): Promise<OrganizationList[]> {
    return performanceMonitor.measureAsync('getOrganizations', async () => {
      const cacheKey = 'organizations';
      
      // Check cache first
      const cached = multiTierCache.get<OrganizationList[]>(cacheKey);
      if (cached) {
        // Cache hit - no need to fetch from API
        return cached;
      }
      
      // Fetch with error recovery
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<OrganizationList[]>('/organizations');
        return response.data;
      }, {
        maxRetries: 3,
        exponentialBackoff: true,
        onRetry: (attempt, error) => {
          console.log(`Retry attempt ${attempt} for getOrganizations: ${error.message}`);
        }
      });
      
      // Cache the result
      multiTierCache.set(cacheKey, result, 'warm');
      
      return result;
    }, 'api');
  }

  async updateOrganization(organizationId: string, updates: OrganizationUpdate): Promise<OrganizationGet> {
    const client = await this.getHttpClient();
    const response = await client.patch<OrganizationGet>(`/organizations/${organizationId}`, updates);
    
    // Invalidate related caches
    multiTierCache.clear(); // Clear all as organization change affects everything
    
    return response.data;
  }

  async getCourseFamilies(organizationId: string): Promise<CourseFamilyList[]> {
    const cacheKey = `courseFamilies-${organizationId}`;
    
    // Check cache first
    const cached = multiTierCache.get<CourseFamilyList[]>(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Fetch with error recovery
    const result = await errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.get<CourseFamilyList[]>('/course-families', {
        organization_id: organizationId
      });
      return response.data;
    }, {
      maxRetries: 3,
      exponentialBackoff: true
    });
    
    // Cache in cold tier (course families rarely change)
    multiTierCache.set(cacheKey, result, 'cold');
    
    return result;
  }

  async updateCourseFamily(familyId: string, updates: CourseFamilyUpdate): Promise<CourseFamilyGet> {
    const client = await this.getHttpClient();
    const response = await client.patch<CourseFamilyGet>(`/course-families/${familyId}`, updates);
    
    // Invalidate related caches
    // Clear course families cache and courses that depend on this family
    this.invalidateCachePattern('courseFamilies-');
    this.invalidateCachePattern('courses-');
    
    return response.data;
  }

  async getCourses(courseFamilyId: string): Promise<CourseList[]> {
    const cacheKey = `courses-${courseFamilyId}`;
    
    // Check cache first
    const cached = multiTierCache.get<CourseList[]>(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Fetch with error recovery
    const result = await errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.get<CourseList[]>('/courses', {
        course_family_id: courseFamilyId
      });
      return response.data;
    }, {
      maxRetries: 3,
      exponentialBackoff: true
    });
    
    // Cache in warm tier (courses change occasionally)
    multiTierCache.set(cacheKey, result, 'warm');
    
    return result;
  }

  async getCourse(courseId: string): Promise<CourseGet | undefined> {
    const cacheKey = `course-${courseId}`;
    
    // Check cache first
    const cached = multiTierCache.get<CourseGet>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<CourseGet>(`/courses/${courseId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get course:', error);
      return undefined;
    }
  }

  async getCourseFamily(familyId: string): Promise<CourseFamilyGet | undefined> {
    const cacheKey = `courseFamily-${familyId}`;
    
    // Check cache first
    const cached = multiTierCache.get<CourseFamilyGet>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<CourseFamilyGet>(`/course-families/${familyId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get course family:', error);
      return undefined;
    }
  }

  async getOrganization(organizationId: string): Promise<OrganizationGet | undefined> {
    const cacheKey = `organization-${organizationId}`;
    
    // Check cache first
    const cached = multiTierCache.get<OrganizationGet>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<OrganizationGet>(`/organizations/${organizationId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in cold tier (organizations rarely change)
      multiTierCache.set(cacheKey, result, 'cold');
      return result;
    } catch (error) {
      console.error('Failed to get organization:', error);
      return undefined;
    }
  }

  async updateCourse(courseId: string, updates: CourseUpdate): Promise<CourseGet> {
    const client = await this.getHttpClient();
    const response = await client.patch<CourseGet>(`/courses/${courseId}`, updates);
    
    // Invalidate course-specific caches
    this.invalidateCachePattern(`course-${courseId}`);
    this.invalidateCachePattern(`courseContents-${courseId}`);
    this.invalidateCachePattern(`courseContentTypes-${courseId}`);
    this.invalidateCachePattern(`courseGroups-${courseId}`);
    this.invalidateCachePattern(`courseMembers-${courseId}`);
    
    return response.data;
  }

  async getCourseContents(courseId: string, skipCache: boolean = false, includeDeployment: boolean = false): Promise<CourseContentList[]> {
    const cacheKey = `courseContents-${courseId}-${includeDeployment}`;
    
    // Check cache first (unless explicitly skipping)
    if (!skipCache) {
      const cached = multiTierCache.get<CourseContentList[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    // Fetch with error recovery
    const result = await errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const params = includeDeployment ? '&include=deployment' : '';
      const response = await client.get<CourseContentList[]>(`/course-contents?course_id=${courseId}${params}`);
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
    
    // Always update cache with fresh data, even if skipCache was true
    // This ensures the cache is always up-to-date after a fresh fetch
    multiTierCache.set(cacheKey, result, 'warm');
    
    return result;
  }


  async getCourseContent(contentId: string, includeDeployment: boolean = false): Promise<CourseContentGet | undefined> {
    const cacheKey = `courseContent-${contentId}-${includeDeployment}`;

    // Check cache first
    const cached = multiTierCache.get<CourseContentGet>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const params = includeDeployment ? '?include=deployment' : '';
        const response = await client.get<CourseContentGet>(`/course-contents/${contentId}${params}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });

      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get course content:', error);
      return undefined;
    }
  }

  async getLecturerCourseContents(courseId: string): Promise<CourseContentLecturerList[]> {
    const cacheKey = `lecturerCourseContents-${courseId}`;

    // Check cache first
    const cached = multiTierCache.get<CourseContentLecturerList[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<CourseContentLecturerList[]>(`/lecturers/course-contents?course_id=${courseId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });

      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get lecturer course contents:', error);
      return [];
    }
  }

  async getLecturerCourseContent(contentId: string): Promise<CourseContentLecturerGet | undefined> {
    const cacheKey = `lecturerCourseContent-${contentId}`;

    // Check cache first
    const cached = multiTierCache.get<CourseContentLecturerGet>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<CourseContentLecturerGet>(`/lecturers/course-contents/${contentId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });

      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get lecturer course content:', error);
      return undefined;
    }
  }

  async createCourseContent(courseId: string, content: CourseContentCreate): Promise<CourseContentGet> {
    const client = await this.getHttpClient();
    const response = await client.post<CourseContentGet>('/course-contents', content);
    
    // Invalidate course contents cache
    this.invalidateCachePattern(`courseContents-${courseId}`);
    
    return response.data;
  }

  async updateCourseContent(courseId: string, contentId: string, content: CourseContentUpdate): Promise<CourseContentGet> {
    const client = await this.getHttpClient();
    const response = await client.patch<CourseContentGet>(`/course-contents/${contentId}`, content);
    
    // Invalidate both list and individual caches
    this.invalidateCachePattern(`courseContents-${courseId}`);
    this.invalidateCachePattern(`courseContent-${contentId}`);
    
    return response.data;
  }

  async deleteCourseContent(courseId: string, contentId: string): Promise<void> {
    const client = await this.getHttpClient();
    await client.delete(`/course-contents/${contentId}`);
    
    // Delete the specific cache entry for this course's contents
    const cacheKey = `courseContents-${courseId}`;
    multiTierCache.delete(cacheKey);
  }

  async getCourseContentKinds(): Promise<CourseContentKindList[]> {
    const cacheKey = 'courseContentKinds';
    
    // Check cache first
    const cached = multiTierCache.get<CourseContentKindList[]>(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Fetch with error recovery
    const result = await errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.get<CourseContentKindList[]>('/course-content-kinds');
      return response.data;
    }, {
      maxRetries: 3,
      exponentialBackoff: true
    });
    
    // Cache in cold tier (content kinds rarely change)
    multiTierCache.set(cacheKey, result, 'cold');
    
    return result;
  }

  async getCourseContentTypes(courseId: string): Promise<CourseContentTypeList[]> {
    const cacheKey = `courseContentTypes-${courseId}`;
    
    // Check cache first
    const cached = multiTierCache.get<CourseContentTypeList[]>(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Fetch with error recovery
    const result = await errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.get<CourseContentTypeList[]>(`/course-content-types?course_id=${courseId}`);
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
    
    // Cache in warm tier (content types change occasionally)
    multiTierCache.set(cacheKey, result, 'warm');
    
    return result;
  }

  async getCourseContentType(typeId: string): Promise<CourseContentTypeGet | undefined> {
    const cacheKey = `courseContentType-${typeId}`;
    
    // Check cache first
    const cached = multiTierCache.get<CourseContentTypeGet>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<CourseContentTypeGet>(`/course-content-types/${typeId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get course content type:', error);
      return undefined;
    }
  }

  async createCourseContentType(contentType: CourseContentTypeCreate): Promise<CourseContentTypeGet> {
    const client = await this.getHttpClient();
    const response = await client.post<CourseContentTypeGet>('/course-content-types', contentType);
    
    // Invalidate content types cache for the course
    if (contentType.course_id) {
      this.invalidateCachePattern(`courseContentTypes-${contentType.course_id}`);
    }
    
    return response.data;
  }

  async updateCourseContentType(typeId: string, contentType: CourseContentTypeUpdate): Promise<CourseContentTypeGet> {
    const client = await this.getHttpClient();
    const response = await client.patch<CourseContentTypeGet>(`/course-content-types/${typeId}`, contentType);
    
    // Invalidate both list and individual caches
    this.invalidateCachePattern('courseContentTypes-');
    this.invalidateCachePattern(`courseContentType-${typeId}`);
    
    return response.data;
  }

  async deleteCourseContentType(typeId: string): Promise<void> {
    const client = await this.getHttpClient();
    await client.delete(`/course-content-types/${typeId}`);
    
    // Invalidate content types cache
    this.invalidateCachePattern('courseContentTypes-');
  }


  async getExampleRepository(repositoryId: string): Promise<ExampleRepositoryGet | undefined> {
    const cacheKey = `exampleRepository-${repositoryId}`;
    
    // Check cache first
    const cached = multiTierCache.get<ExampleRepositoryGet>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<ExampleRepositoryGet>(`/example-repositories/${repositoryId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in cold tier
      multiTierCache.set(cacheKey, result, 'cold');
      return result;
    } catch (error) {
      console.error('Failed to get example repository:', error);
      return undefined;
    }
  }


  async getExample(exampleId: string): Promise<ExampleGet | undefined> {
    const cacheKey = `example-${exampleId}`;
    
    // Check cache first
    const cached = multiTierCache.get<ExampleGet>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<ExampleGet>(`/examples/${exampleId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get example:', error);
      return undefined;
    }
  }

  async getExampleVersion(exampleVersionId: string): Promise<any | undefined> {
    const cacheKey = `exampleVersion-${exampleVersionId}`;
    
    // Check cache first
    const cached = multiTierCache.get<any>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        // Use the correct endpoint for fetching a specific example version
        const response = await client.get<any>(`/examples/versions/${exampleVersionId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in warm tier if we got a result
      if (result) {
        multiTierCache.set(cacheKey, result, 'warm');
      }
      return result;
    } catch (error) {
      console.error('Failed to get example version:', error);
      return undefined;
    }
  }

  async downloadExample(exampleId: string, withDependencies: boolean = false): Promise<ExampleDownloadResponse | undefined> {
    try {
      const client = await this.getHttpClient();
      const params = withDependencies ? '?with_dependencies=true' : '';
      const response = await client.get<ExampleDownloadResponse>(`/examples/${exampleId}/download${params}`);
      return response.data;
    } catch (error) {
      console.error('Failed to download example:', error);
      return undefined;
    }
  }

  async downloadCourseContentReference(courseContentId: string, withDependencies: boolean = true): Promise<Buffer | undefined> {
    try {
      const client = await this.getHttpClient();
      const settings = await this.settingsManager.getSettings();
      const params = withDependencies ? '?with_dependencies=true' : '';
      const endpoint = `/tutors/course-contents/${courseContentId}/reference${params}`;
      const url = `${settings.authentication.baseUrl}${endpoint}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: client.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error('Failed to download course content reference:', error);
      return undefined;
    }
  }

  async listSubmissionArtifacts(submissionGroupId: string): Promise<SubmissionArtifactList[] | undefined> {
    try {
      const client = await this.getHttpClient();
      const response = await client.get<SubmissionArtifactList[]>(`/submissions/artifacts`, {
        submission_group_id: submissionGroupId,
        with_latest_result: 'true',
        submit: true
      });
      return response.data;
    } catch (error) {
      console.error('Failed to list submission artifacts:', error);
      return undefined;
    }
  }

  async getSubmissionArtifact(artifactId: string): Promise<any | undefined> {
    try {
      const client = await this.getHttpClient();
      const response = await client.get<any>(`/submissions/artifacts/${artifactId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to get submission artifact:', error);
      return undefined;
    }
  }

  async downloadSubmissionArtifact(artifactId: string): Promise<Buffer | undefined> {
    try {
      const client = await this.getHttpClient();
      const settings = await this.settingsManager.getSettings();
      const endpoint = `/submissions/artifacts/${artifactId}/download`;
      const url = `${settings.authentication.baseUrl}${endpoint}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: client.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error('Failed to download submission artifact:', error);
      return undefined;
    }
  }

  async uploadExample(uploadRequest: ExampleUploadRequest): Promise<ExampleGet | undefined> {
    try {
      const client = await this.getHttpClient();
      const response = await client.post<ExampleGet>('/examples/upload', uploadRequest);
      return response.data;
    } catch (error) {
      console.error('Failed to upload example:', error);
      // Re-throw the error so the caller can handle it with details
      throw error;
    }
  }

  clearExamplesCache(): void {
    // Clear all cache entries related to examples
    // Since we don't have access to individual keys, we clear all cache
    // This ensures fresh data is loaded after uploads
    multiTierCache.clear();
    console.log('[ComputorApiService] Cleared examples cache');
  }

  /**
   * Assign example to course content (non-lecturer endpoint)
   * Uses the /course-contents/{id}/assign-example endpoint
   */
  async assignExampleSourceToCourseContent(
    contentId: string,
    exampleIdentifier: string,
    versionTag: string,
    deploymentMessage?: string
  ): Promise<CourseContentGet> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.post<CourseContentGet>(
        `/course-contents/${contentId}/assign-example`,
        {
          example_identifier: exampleIdentifier,
          version_tag: versionTag,
          deployment_message: deploymentMessage
        }
      );

      multiTierCache.delete(`courseContent-${contentId}-true`);
      multiTierCache.delete(`courseContent-${contentId}-false`);

      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  async unassignExampleFromCourseContent(courseId: string, contentId: string): Promise<CourseContentGet> {
    // Note: courseId is kept for API consistency but not used in the endpoint
    void courseId;
    
    const client = await this.getHttpClient();
    const response = await client.delete<CourseContentGet>(
      `/course-contents/${contentId}/deployment`
    );
    
    // Clear cache for this content
    multiTierCache.delete(`courseContent-${contentId}-true`);
    multiTierCache.delete(`courseContent-${contentId}-false`);
    
    return response.data;
  }

  /**
   * Get deployment information for a course content
   */
  async getCourseContentDeployment(contentId: string): Promise<CourseContentDeploymentGet | undefined> {
    try {
      const client = await this.getHttpClient();
      const response = await client.get<CourseContentDeploymentGet>(
        `/course-contents/${contentId}/deployment`
      );
      return response.data;
    } catch (error) {
      console.error('Failed to get deployment:', error);
      return undefined;
    }
  }

  /**
   * Get deployment history for a course content
   */
  async getCourseContentDeploymentHistory(contentId: string): Promise<DeploymentHistoryGet[]> {
    try {
      const client = await this.getHttpClient();
      const response = await client.get<DeploymentHistoryGet[]>(
        `/course-contents/${contentId}/deployment/history`
      );
      return response.data;
    } catch (error) {
      console.error('Failed to get deployment history:', error);
      return [];
    }
  }

  /**
   * Trigger deployment for a course content
   */
  async deployCourseContent(contentId: string, force: boolean = false): Promise<TaskResponse | undefined> {
    try {
      const client = await this.getHttpClient();
      const response = await client.post<TaskResponse>(
        `/course-contents/${contentId}/deploy`,
        { force }
      );

      // Clear cache for this content
      multiTierCache.delete(`courseContent-${contentId}-true`);
      multiTierCache.delete(`courseContent-${contentId}-false`);

      return response.data;
    } catch (error) {
      console.error('Failed to deploy content:', error);
      return undefined;
    }
  }

  /**
   * Lecturer: Assign example to course content
   * Uses the /lecturers/course-contents/{id}/assign-example endpoint
   */
  async lecturerAssignExample(
    contentId: string,
    request: { example_identifier: string; version_tag: string }
  ): Promise<any> {
    const endpoint = `/lecturers/course-contents/${contentId}/assign-example`;
    console.log('[lecturerAssignExample] Request:', {
      endpoint,
      contentId,
      request
    });

    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();

      try {
        const response = await client.post(endpoint, request);

        console.log('[lecturerAssignExample] Success response:', {
          status: response.status,
          data: response.data
        });

        // Clear cache for this content
        multiTierCache.delete(`courseContent-${contentId}-true`);
        multiTierCache.delete(`courseContent-${contentId}-false`);

        return response.data;
      } catch (error: any) {
        console.error('[lecturerAssignExample] Error response:', {
          endpoint,
          contentId,
          request,
          error: {
            message: error.message,
            status: error.status,
            statusText: error.statusText,
            response: error.response,
            errorCode: error.errorCode,
            backendError: error.backendError
          }
        });
        throw error;
      }
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  /**
   * Lecturer: Get deployment info for course content
   */
  async lecturerGetDeployment(contentId: string): Promise<any> {
    try {
      const client = await this.getHttpClient();
      const response = await client.get(
        `/lecturers/course-contents/${contentId}/deployment`
      );
      return response.data;
    } catch (error) {
      console.error('Failed to get lecturer deployment:', error);
      throw error;
    }
  }

  /**
   * Lecturer: Batch validate course content (checks if examples/versions exist)
   */
  async validateCourseContent(
    courseId: string,
    validations: Array<{ content_id: string; example_identifier: string; version_tag: string }>
  ): Promise<any> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.post(
        `/lecturers/courses/${courseId}/validate`,
        { content_validations: validations }
      );
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  /**
   * Lecturer: Unassign example from course content
   */
  async lecturerUnassignExample(contentId: string): Promise<any> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.delete(
        `/lecturers/course-contents/${contentId}/deployment`
      );

      // Clear cache for this content
      multiTierCache.delete(`courseContent-${contentId}-true`);
      multiTierCache.delete(`courseContent-${contentId}-false`);

      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  /**
   * Get list of available example versions for an example
   * @param exampleId The example ID
   * @param versionTag Optional version tag to filter for a specific version
   */
  async getExampleVersions(exampleId: string, versionTag?: string): Promise<any[]> {
    try {
      const client = await this.getHttpClient();
      const url = versionTag
        ? `/examples/${exampleId}/versions?version_tag=${encodeURIComponent(versionTag)}`
        : `/examples/${exampleId}/versions`;
      const response = await client.get<any[]>(url);
      return response.data || [];
    } catch (error) {
      console.error('Failed to get example versions:', error);
      return [];
    }
  }

  clearCourseCache(courseId: string): void {
    // Clear all caches related to a specific course
    const cacheKey = `courseContents-${courseId}`;
    multiTierCache.delete(cacheKey);

    // Also clear content types cache
    const contentTypesKey = `courseContentTypes-${courseId}`;
    multiTierCache.delete(contentTypesKey);

    // Clear course groups cache
    const groupsKey = `courseGroups-${courseId}`;
    multiTierCache.delete(groupsKey);

    // Clear course members cache
    const membersKey = `courseMembers-${courseId}`;
    multiTierCache.delete(membersKey);

    // Clear lecturer-specific caches
    const lecturerKey = `lecturerCourseContents-${courseId}`;
    multiTierCache.delete(lecturerKey);
  }

  // Tutor helpers: cache invalidation
  clearTutorMemberCourseContentsCache(memberId: string): void {
    multiTierCache.delete(`tutorContents-${memberId}`);
  }

  clearCourseContentKindsCache(): void {
    multiTierCache.delete('courseContentKinds');
  }

  clearTutorCourseMembersCache(courseId: string, groupId?: string): void {
    const cacheKey = groupId ? `tutorCourseMembers-${courseId}-${groupId}` : `tutorCourseMembers-${courseId}`;
    multiTierCache.delete(cacheKey);
  }

  clearStudentCourseContentCache(contentId: string): void {
    if (!contentId) {
      return;
    }
    multiTierCache.delete(`studentCourseContent-${contentId}`);
  }

  clearStudentCourseContentsCache(courseId?: string): void {
    if (courseId) {
      multiTierCache.delete(`studentCourseContents-${courseId}`);
    }
    multiTierCache.delete('studentCourseContents-all');
  }

  clearAllCaches(): void {
    // Clear ALL caches to force complete data refresh
    console.log('[ComputorApiService] Clearing all caches...');
    
    // Clear the entire cache
    multiTierCache.clear();
    
    console.log('[ComputorApiService] All caches cleared');
  }

  async getLecturerCourses(): Promise<any[] | undefined> {
    try {
      const client = await this.getHttpClient();
      const resp = await client.get<any[]>('/lecturers/courses');
      return resp.data || [];
    } catch (e) {
      console.warn('[API] getLecturerCourses failed:', e);
      return undefined;
    }
  }

  /**
   * Validate course for release (pre-flight check)
   * Returns validation errors if any assignments are missing examples
   */
  async validateCourseForRelease(courseId: string): Promise<any> {
    try {
      // Get all course contents with deployment info
      const contents = await this.getCourseContents(courseId, false, true);

      // Get content types to identify submittable content
      const contentTypes = await this.getCourseContentTypes(courseId);
      const submittableTypeIds = new Set<string>();

      for (const type of contentTypes) {
        const fullType = await this.getCourseContentType(type.id);
        if (fullType?.course_content_kind?.submittable) {
          submittableTypeIds.add(type.id);
        }
      }

      // Find assignments without examples
      const validationErrors: any[] = [];

      if (contents) {
        for (const content of contents) {
          const isSubmittable = submittableTypeIds.has(content.course_content_type_id);

          if (isSubmittable) {
            const hasDeployment = content.has_deployment;
            const deploymentStatus = content.deployment_status;

            if (!hasDeployment || deploymentStatus === 'unassigned') {
              validationErrors.push({
                course_content_id: content.id,
                title: content.title || content.path,
                path: content.path,
                issue: 'No example assigned'
              });
            }
          }
        }
      }

      if (validationErrors.length > 0) {
        return {
          valid: false,
          error: 'Cannot release: Some assignments are missing example assignments',
          validation_errors: validationErrors,
          total_issues: validationErrors.length
        };
      }

      return { valid: true };
    } catch (error) {
      console.error('Failed to validate course for release:', error);
      throw error;
    }
  }

  async generateStudentTemplate(
    courseId: string,
    payload: {
      commit_message?: string;
      force_redeploy?: boolean;
      release?: {
        course_content_ids?: string[];
        parent_id?: string;
        include_descendants?: boolean;
        all?: boolean;
        global_commit?: string;
        overrides?: any[];
      } | null;
    } = {}
  ): Promise<{ workflow_id: string; status?: string; contents_to_process?: number }> {
    const client = await this.getHttpClient();
    // Backend now returns a workflow-based response (Temporal): { workflow_id, status, contents_to_process }
    const response = await client.post<{ workflow_id: string; status?: string; contents_to_process?: number }>(
      `/system/courses/${courseId}/generate-student-template`,
      payload ?? {}
    );
    console.log('Generate student template response:', response.data);
    return response.data;
  }

  async generateAssignments(courseId: string, params: {
    assignments_url?: string;
    course_content_ids?: string[];
    parent_id?: string;
    include_descendants?: boolean;
    all?: boolean;
    overwrite_strategy?: 'skip_if_exists' | 'force_update';
    commit_message?: string;
  }): Promise<{ workflow_id: string; status?: string; contents_to_process?: number }> {
    const client = await this.getHttpClient();
    const response = await client.post<{ workflow_id: string; status?: string; contents_to_process?: number }>(
      `/system/courses/${courseId}/generate-assignments`,
      params
    );
    console.log('Generate assignments response:', response.data);
    return response.data;
  }

  async getTaskStatus(taskId: string): Promise<TaskResponse> {
    const client = await this.getHttpClient();
    const response = await client.get<TaskResponse>(`/tasks/${taskId}/status`);
    return response.data;
  }
  
  /**
   * Batch multiple API calls for improved performance
   */
  async batchApiCalls<T extends Record<string, any>>(
    calls: Array<{
      key: keyof T;
      fn: () => Promise<T[keyof T]>;
    }>
  ): Promise<T> {
    const batchedCalls = calls.map(call => ({
      key: String(call.key),
      fn: call.fn
    }));
    
    const results = await requestBatchingService.batchApiCalls(batchedCalls);
    
    const typedResults: any = {};
    for (const [key, value] of results.entries()) {
      typedResults[key] = value;
    }
    
    return typedResults as T;
  }

  async getAvailableExamples(params?: {
    search?: string;
    category?: string;
    language?: string;
    limit?: number;
    offset?: number;
  }): Promise<ExampleGet[]> {
    // Create cache key from parameters
    const cacheKey = `availableExamples-${JSON.stringify(params || {})}`;
    
    // Check cache first (hot tier for frequently accessed)
    const cached = multiTierCache.get<ExampleGet[]>(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Fetch with error recovery
    const result = await errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const queryParams = new URLSearchParams();
      
      if (params?.search) queryParams.append('search', params.search);
      if (params?.category) queryParams.append('category', params.category);
      if (params?.language) queryParams.append('language', params.language);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.offset) queryParams.append('offset', params.offset.toString());
      
      const url = queryParams.toString() 
        ? `/examples?${queryParams.toString()}`
        : '/examples';
      
      const response = await client.get<ExampleGet[]>(url);
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
    
    // Cache in hot tier for frequently accessed queries
    multiTierCache.set(cacheKey, result, 'hot');
    
    return result;
  }

  // Course Groups API methods
  async getCourseGroups(courseId: string): Promise<CourseGroupList[]> {
    const cacheKey = `courseGroups-${courseId}`;
    
    // Check cache first
    const cached = multiTierCache.get<CourseGroupList[]>(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Fetch with error recovery
    const result = await errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.get<CourseGroupList[]>(`/course-groups?course_id=${courseId}`);
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
    
    // Cache in warm tier (groups change occasionally)
    multiTierCache.set(cacheKey, result, 'warm');
    
    return result;
  }

  async createCourseGroup(courseId: string, title: string): Promise<CourseGroupGet> {
    const client = await this.getHttpClient();
    const response = await client.post<CourseGroupGet>('/course-groups', {
      course_id: courseId,
      title: title
    });
    
    // Invalidate course groups cache
    this.invalidateCachePattern(`courseGroups-${courseId}`);
    
    return response.data;
  }

  async getCourseGroup(groupId: string): Promise<CourseGroupGet | undefined> {
    const cacheKey = `courseGroup-${groupId}`;
    
    // Check cache first
    const cached = multiTierCache.get<CourseGroupGet>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<CourseGroupGet>(`/course-groups/${groupId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get course group:', error);
      return undefined;
    }
  }

  async updateCourseGroup(groupId: string, updates: CourseGroupUpdate): Promise<CourseGroupGet> {
    const client = await this.getHttpClient();
    const response = await client.patch<CourseGroupGet>(`/course-groups/${groupId}`, updates);

    // Invalidate related caches
    this.invalidateCachePattern('courseGroup-');
    this.invalidateCachePattern('courseGroups-');

    return response.data;
  }

  async deleteCourseGroup(groupId: string): Promise<void> {
    const client = await this.getHttpClient();
    await client.delete(`/course-groups/${groupId}`);

    // Invalidate related caches
    this.invalidateCachePattern('courseGroup-');
    this.invalidateCachePattern('courseGroups-');
    this.invalidateCachePattern('courseMembers-');
  }

  // Course Members API methods
  async getCourseMembers(courseId: string, groupId?: string): Promise<CourseMemberList[]> {
    const cacheKey = groupId ? `courseMembers-${courseId}-${groupId}` : `courseMembers-${courseId}`;

    // Check cache first
    const cached = multiTierCache.get<CourseMemberList[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch with error recovery
    const result = await errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const queryParams = new URLSearchParams();
      queryParams.append('course_id', courseId);
      if (groupId) {
        queryParams.append('course_group_id', groupId);
      }

      const response = await client.get<CourseMemberList[]>(`/course-members?${queryParams.toString()}`);
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });

    // Cache in warm tier (members change occasionally)
    multiTierCache.set(cacheKey, result, 'warm');

    return result;
  }

  async updateCourseMember(memberId: string, updates: CourseMemberUpdate): Promise<CourseMemberGet> {
    const client = await this.getHttpClient();
    const response = await client.patch<CourseMemberGet>(`/course-members/${memberId}`, updates);

    // Invalidate related caches
    this.invalidateCachePattern('courseMembers-');

    return response.data;
  }

  /**
   * Lecturer: Sync GitLab permissions for a course member
   */
  async syncMemberGitlabPermissions(
    courseMemberId: string,
    request: GitLabSyncRequest
  ): Promise<GitLabSyncResult> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const endpoint = `/lecturers/course-members/${courseMemberId}/sync-gitlab`;

      console.log('[syncMemberGitlabPermissions] Request:', {
        endpoint,
        courseMemberId,
        hasAccessToken: !!request.access_token
      });

      const response = await client.post<GitLabSyncResult>(endpoint, request);

      console.log('[syncMemberGitlabPermissions] Success:', {
        status: response.status,
        data: response.data
      });

      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  async validateCourseReadiness(
    courseId: string,
    providerAccessToken: string
  ): Promise<CourseMemberReadinessStatus> {
    try {
      const token = providerAccessToken?.trim();
      if (!token) {
        throw new Error('Provider access token is required for readiness validation.');
      }
      const client = await this.getHttpClient();
      const payload: CourseMemberValidationRequest = {
        provider_access_token: token
      };
      const response = await client.post<CourseMemberReadinessStatus>(
        `/user/courses/${courseId}/validate`,
        payload
      );
      return response.data;
    } catch (error) {
      console.error('Failed to validate course readiness:', error);
      const status = (error as any)?.response?.status;
      const message = (error as any)?.response?.data?.detail || (error as Error)?.message;
      if (message && status !== 401) {
        vscode.window.showWarningMessage(`Course readiness check failed: ${message}`);
      }
      throw error;
    }
  }

  /**
   * Helper method to invalidate cache entries matching a pattern
   */
  private invalidateCachePattern(pattern: string): void {
    // Since our MultiTierCache doesn't have a pattern-based invalidation,
    // we'll need to track keys or clear specific tiers
    // For now, we'll clear the appropriate tier based on the pattern
    if (pattern.includes('organization') || pattern.includes('courseFamilies')) {
      // These are in cold tier, rarely change
      multiTierCache.clear();
    } else if (pattern.includes('course') || pattern.includes('contentTypes') || pattern.includes('groups') || pattern.includes('members')) {
      // These are in warm tier
      // Since we can't selectively clear, we'll clear all for now
      // In production, you'd want to implement selective cache invalidation
      multiTierCache.clear();
    } else if (pattern.includes('example')) {
      // These are in hot tier
      multiTierCache.clear();
    }
  }

  private invalidateUserCaches(targets: { user?: boolean; profile?: boolean; studentProfiles?: boolean } = { user: true, profile: true, studentProfiles: true }): void {
    if (targets.user) {
      multiTierCache.delete('currentUser');
    }
    if (targets.profile) {
      multiTierCache.delete('userProfile');
    }
    if (targets.studentProfiles) {
      multiTierCache.delete('userStudentProfiles');
    }
  }

  /**
   * Get the current user's ID directly from the authentication token.
   * This method does NOT make an API call and returns immediately.
   */
  getCurrentUserId(): string | undefined {
    try {
      const client = this.httpClient;
      if (client && typeof (client as any).getUserId === 'function') {
        const userId = (client as any).getUserId();
        return userId || undefined;
      }
      return undefined;
    } catch (error) {
      console.error('Failed to get current user ID:', error);
      return undefined;
    }
  }

  // Student API methods
  async getCurrentUser(options?: { force?: boolean }): Promise<{ id: string; username: string; full_name?: string } | undefined> {
    const cacheKey = 'currentUser';

    if (options?.force) {
      multiTierCache.delete(cacheKey);
    } else {
      const cached = multiTierCache.get<any>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<any>('/user');
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });

      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get current user:', error);
      return undefined;
    }
  }

  async getUserAccount(options?: { force?: boolean }): Promise<UserGet | undefined> {
    const user = await this.getCurrentUser(options);
    if (!user) {
      return undefined;
    }
    return user as UserGet;
  }

  async getUserViews(): Promise<string[]> {
    const cacheKey = 'userViews';

    // Check cache first
    const cached = multiTierCache.get<string[]>(cacheKey);
    if (cached) {
      console.log('[getUserViews] Returning cached views:', cached);
      return cached;
    }

    try {
      console.log('[getUserViews] Fetching user views from API...');
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        console.log('[getUserViews] HTTP client obtained, making GET request to /user/views');
        const response = await client.get<string[]>('/user/views');
        console.log('[getUserViews] Response received:', response);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });

      console.log('[getUserViews] Successfully fetched views:', result);
      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('[getUserViews] Failed to get user views:', error);
      console.error('[getUserViews] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        error
      });
      throw error;
    }
  }

  async updateUserAccount(updates: UserUpdate): Promise<UserGet> {
    try {
      const client = await this.getHttpClient();
      const response = await client.put<UserGet>('/user', updates);
      const user = response.data;
      this.invalidateUserCaches({ user: true, profile: false, studentProfiles: true });
      if (user) {
        multiTierCache.set('currentUser', user, 'warm');
        if (Array.isArray(user.student_profiles)) {
          multiTierCache.set('userStudentProfiles', user.student_profiles, 'warm');
        }
      }
      return user;
    } catch (error) {
      console.error('Failed to update user account:', error);
      throw error;
    }
  }

  async getUserProfile(options?: { force?: boolean }): Promise<ProfileGet | undefined> {
    const cacheKey = 'userProfile';

    if (options?.force) {
      multiTierCache.delete(cacheKey);
    } else {
      const cached = multiTierCache.get<ProfileGet>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const client = await this.getHttpClient();
      const response = await client.get<ProfileGet>('/profiles');
      const profile = response.data;
      if (profile) {
        multiTierCache.set(cacheKey, profile, 'warm');
      }
      return profile ?? undefined;
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      if (status === 404) {
        multiTierCache.delete(cacheKey);
        return undefined;
      }
      console.error('Failed to load user profile:', error);
      throw error;
    }
  }

  async createUserProfile(payload: ProfileCreate): Promise<ProfileGet> {
    try {
      const client = await this.getHttpClient();
      const response = await client.post<ProfileGet>('/profiles', payload);
      const profile = response.data;
      this.invalidateUserCaches({ user: false, profile: true, studentProfiles: false });
      if (profile) {
        multiTierCache.set('userProfile', profile, 'warm');
      }
      return profile;
    } catch (error) {
      console.error('Failed to create user profile:', error);
      throw error;
    }
  }

  async updateUserProfile(profileId: string, updates: ProfileUpdate): Promise<ProfileGet> {
    try {
      const client = await this.getHttpClient();
      const response = await client.patch<ProfileGet>(`/profiles/${profileId}`, updates);
      const profile = response.data;
      this.invalidateUserCaches({ user: false, profile: true, studentProfiles: false });
      if (profile) {
        multiTierCache.set('userProfile', profile, 'warm');
      }
      return profile;
    } catch (error) {
      console.error('Failed to update user profile:', error);
      throw error;
    }
  }

  async getLanguages(options?: { force?: boolean }): Promise<LanguageList[]> {
    const cacheKey = 'languages';

    if (options?.force) {
      multiTierCache.delete(cacheKey);
    } else {
      const cached = multiTierCache.get<LanguageList[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const client = await this.getHttpClient();
      const response = await client.get<LanguageList[]>('/languages');
      const languages = Array.isArray(response.data) ? response.data : [];
      multiTierCache.set(cacheKey, languages, 'cold');
      return languages;
    } catch (error) {
      console.error('Failed to load languages:', error);
      throw error;
    }
  }

  async getStudentProfiles(options?: { force?: boolean }): Promise<StudentProfileGet[]> {
    const cacheKey = 'userStudentProfiles';

    if (options?.force) {
      multiTierCache.delete(cacheKey);
    } else {
      const cached = multiTierCache.get<StudentProfileGet[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const client = await this.getHttpClient();
      const response = await client.get<StudentProfileGet[]>('/student-profiles');
      const profiles = Array.isArray(response.data) ? response.data : [];
      multiTierCache.set(cacheKey, profiles, 'warm');
      return profiles;
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      if (status === 404) {
        multiTierCache.delete(cacheKey);
        return [];
      }
      console.error('Failed to load student profiles:', error);
      throw error;
    }
  }

  async createStudentProfile(payload: StudentProfileCreate): Promise<StudentProfileGet> {
    try {
      const client = await this.getHttpClient();
      const response = await client.post<StudentProfileGet>('/student-profiles', payload);
      const profile = response.data;
      this.invalidateUserCaches({ user: true, profile: false, studentProfiles: true });
      return profile;
    } catch (error) {
      console.error('Failed to create student profile:', error);
      throw error;
    }
  }

  async updateStudentProfile(profileId: string, updates: StudentProfileUpdate): Promise<StudentProfileGet> {
    try {
      const client = await this.getHttpClient();
      const response = await client.patch<StudentProfileGet>(`/student-profiles/${profileId}`, updates);
      const profile = response.data;
      this.invalidateUserCaches({ user: true, profile: false, studentProfiles: true });
      return profile;
    } catch (error) {
      console.error(`Failed to update student profile ${profileId}:`, error);
      throw error;
    }
  }

  async getStudentCourses(): Promise<any[]> {
    const cacheKey = 'studentCourses';
    
    // Check cache first
    const cached = multiTierCache.get<any[]>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<any[]>('/students/courses');
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get student courses:', error);
      return [];
    }
  }

  async getStudentCourse(courseId: string): Promise<any | undefined> {
    const cacheKey = `studentCourse-${courseId}`;
    
    // Check cache first
    const cached = multiTierCache.get<any>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<any>(`/students/courses/${courseId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get student course:', error);
      return undefined;
    }
  }

  async getStudentCourseContents(
    courseId?: string,
    options?: { force?: boolean }
  ): Promise<CourseContentStudentList[]> {
    const cacheKey = courseId ? `studentCourseContents-${courseId}` : 'studentCourseContents-all';

    if (options?.force) {
      multiTierCache.delete(cacheKey);
      if (courseId) {
        multiTierCache.delete('studentCourseContents-all');
      }
    } else {
      const cached = multiTierCache.get<CourseContentStudentList[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const params = courseId ? `?course_id=${courseId}` : '';
        const response = await client.get<CourseContentStudentList[]>(`/students/course-contents${params}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get student course contents:', error);
      return [];
    }
  }

  async getStudentCourseContent(
    contentId: string,
    options?: { force?: boolean }
  ): Promise<CourseContentStudentGet | undefined> {
    const cacheKey = `studentCourseContent-${contentId}`;

    if (options?.force) {
      multiTierCache.delete(cacheKey);
    } else {
      const cached = multiTierCache.get<CourseContentStudentGet>(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<CourseContentStudentGet>(`/students/course-contents/${contentId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get student course content:', error);
      return undefined;
    }
  }

  async getStudentCourseContentDetails(
    contentId: string,
    options?: { force?: boolean }
  ): Promise<CourseContentStudentGet | undefined> {
    const cacheKey = `studentCourseContentDetails-${contentId}`;

    if (options?.force) {
      multiTierCache.delete(cacheKey);
    } else {
      const cached = multiTierCache.get<CourseContentStudentGet>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<CourseContentStudentGet>(`/students/course-contents/${contentId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });

      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get student course content details:', error);
      return undefined;
    }
  }

  async getStudentCourseContentResults(
    contentId: string,
    options?: { submissionGroupId?: string; limit?: number; force?: boolean }
  ): Promise<ResultWithGrading[]> {
    const cacheKey = [
      'studentCourseContentResults',
      contentId,
      options?.submissionGroupId ?? 'all',
      options?.limit ?? 'all'
    ].join('-');

    if (options?.force) {
      multiTierCache.delete(cacheKey);
    } else {
      const cached = multiTierCache.get<ResultWithGrading[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const client = await this.getHttpClient();
      const params: Record<string, any> = {
        course_content_id: contentId
      };
      if (options?.limit) {
        params.limit = options.limit;
      }
      if (options?.submissionGroupId) {
        params.submission_group_id = options.submissionGroupId;
      }

      const response = await client.get<ResultWithGrading[] | { items?: ResultWithGrading[] }>(
        '/results',
        params
      );

      const payload = Array.isArray(response.data)
        ? response.data
        : Array.isArray((response.data as any)?.items)
          ? (response.data as any).items
          : [];

      multiTierCache.set(cacheKey, payload, 'warm');
      return payload;
    } catch (error) {
      console.error('Failed to get student course content results:', error);
      return [];
    }
  }

  async getCourseMember(memberId: string): Promise<CourseMemberGet | undefined> {
    const cacheKey = `courseMember-${memberId}`;
    
    // Check cache first
    const cached = multiTierCache.get<CourseMemberGet>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<CourseMemberGet>(`/course-members/${memberId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in warm tier
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error('Failed to get course member:', error);
      return undefined;
    }
  }

  async getStudentSubmissionGroups(params?: {
    course_id?: string;
    course_content_id?: string;
    has_repository?: boolean;
    is_graded?: boolean;
  }): Promise<CourseContentStudentList[]> {
    // Get course contents with submission groups
    try {
      const courseContents = await this.getStudentCourseContents(params?.course_id);
      
      // Filter course contents that have submission groups
      const contentsWithSubmissionGroups: CourseContentStudentList[] = [];
      
      for (const content of courseContents) {
        if (content.submission_group) {
          // Filter based on params
          if (params?.course_content_id && content.id !== params.course_content_id) {
            continue;
          }
          if (params?.has_repository !== undefined) {
            const hasRepo = !!content.submission_group.repository;
            if (hasRepo !== params.has_repository) continue;
          }
          if (params?.is_graded !== undefined) {
            const isGraded = typeof content.submission_group?.grading === 'number';
            if (isGraded !== params.is_graded) continue;
          }
          
          // Add the full course content with its submission group
          contentsWithSubmissionGroups.push(content);
        }
      }
      
      return contentsWithSubmissionGroups;
    } catch (error) {
      console.error('Failed to get student submission groups:', error);
      return [];
    }
  }

  async getExampleRepositories(organizationId?: string): Promise<ExampleRepositoryList[]> {
    const queryParams = organizationId ? `?organization_id=${organizationId}` : '';
    const cacheKey = `exampleRepositories-${organizationId || 'all'}`;
    
    // Check cache first
    const cached = multiTierCache.get<ExampleRepositoryList[]>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<ExampleRepositoryList[]>(`/example-repositories${queryParams}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });
      
      // Cache in cold tier (repositories rarely change)
      multiTierCache.set(cacheKey, result, 'cold');
      return result || [];
    } catch (error) {
      console.error('Failed to get example repositories:', error);
      return [];
    }
  }

  async getExamples(repositoryId?: string): Promise<ExampleList[]> {
    const query: ExampleQuery = repositoryId ? { repository_id: repositoryId } : {};
    const cacheKey = `examples-${JSON.stringify(query)}`;

    // Check cache first
    const cached = multiTierCache.get<ExampleList[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const params = new URLSearchParams();

        if (query.repository_id) {
          params.append('repository_id', query.repository_id);
        }
        if (query.identifier) {
          params.append('identifier', query.identifier);
        }
        if (query.title) {
          params.append('title', query.title);
        }
        if (query.category) {
          params.append('category', query.category);
        }
        if (query.tags && query.tags.length > 0) {
          query.tags.forEach(tag => params.append('tags', tag));
        }
        if (query.search) {
          params.append('search', query.search);
        }
        if (query.directory) {
          params.append('directory', query.directory);
        }

        const url = params.toString() ? `/examples?${params.toString()}` : '/examples';
        const response = await client.get<ExampleList[]>(url);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });

      // Cache in hot tier for frequently accessed queries
      multiTierCache.set(cacheKey, result, 'hot');
      return result || [];
    } catch (error) {
      console.error('Failed to get examples:', error);
      return [];
    }
  }

  async getExampleByIdentifier(identifier: string): Promise<ExampleList | null> {
    const cacheKey = `example-identifier-${identifier}`;

    const cached = multiTierCache.get<ExampleList | null>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const params = new URLSearchParams();
        params.append('identifier', identifier);

        const response = await client.get<ExampleList[]>(`/examples?${params.toString()}`);
        return response.data && response.data.length > 0 ? response.data[0] : null;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });

      multiTierCache.set(cacheKey, result ?? null, 'hot');
      return result ?? null;
    } catch (error) {
      console.error(`Failed to get example by identifier "${identifier}":`, error);
      return null;
    }
  }

  // Tutor API methods
  async getTutorCourses(useRecovery: boolean = true): Promise<any[]> {
    const cacheKey = 'tutorCourses';
    const cached = multiTierCache.get<any[]>(cacheKey);
    if (cached) return cached;
    try {
      const fetchCourses = async () => {
        const client = await this.getHttpClient();
        const response = await client.get<any[]>('/tutors/courses');
        return response.data;
      };

      const result = useRecovery
        ? await errorRecoveryService.executeWithRecovery(fetchCourses, { maxRetries: 2, exponentialBackoff: true })
        : await fetchCourses();
      multiTierCache.set(cacheKey, result, 'warm');
      return result || [];
    } catch (error) {
      console.error('Failed to get tutor courses:', error);
      return [];
    }
  }

  async getTutorCourse(courseId: string): Promise<any | undefined> {
    const cacheKey = `tutorCourse-${courseId}`;
    const cached = multiTierCache.get<any>(cacheKey);
    if (cached) return cached;
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<any>(`/tutors/courses/${courseId}`);
        return response.data;
      }, { maxRetries: 2, exponentialBackoff: true });
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (e) {
      console.error('Failed to get tutor course:', e);
      return undefined;
    }
  }

  // Placeholder Tutor API for course groups and members (to be aligned with backend)
  async getTutorCourseGroups(courseId: string): Promise<any[]> {
    // Use generic course groups endpoint with course filter
    return await this.getCourseGroups(courseId);
  }

  async getTutorCourseMembers(courseId: string, groupId?: string): Promise<any[]> {
    const cacheKey = groupId ? `tutorCourseMembers-${courseId}-${groupId}` : `tutorCourseMembers-${courseId}`;
    const cached = multiTierCache.get<any[]>(cacheKey);
    if (cached) return cached;
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const params = new URLSearchParams();
        if (courseId) params.append('course_id', courseId);
        if (groupId) params.append('course_group_id', groupId);
        const url = params.toString() ? `/tutors/course-members?${params.toString()}` : '/tutors/course-members';
        const response = await client.get<any[]>(url);
        return response.data;
      }, { maxRetries: 2, exponentialBackoff: true });
      multiTierCache.set(cacheKey, result, 'warm');
      return result || [];
    } catch (e) {
      console.error('Failed to get tutor course members:', e);
      return [];
    }
  }

  async getTutorSubmissionGroups(query?: TutorSubmissionGroupQuery): Promise<TutorSubmissionGroupList[]> {
    const cacheKey = `tutorSubmissionGroups-${JSON.stringify(query || {})}`;
    const cached = multiTierCache.get<TutorSubmissionGroupList[]>(cacheKey);
    if (cached) return cached;
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const params = new URLSearchParams();
        if (query?.course_id) params.append('course_id', query.course_id);
        if (query?.course_content_id) params.append('course_content_id', query.course_content_id);
        if (query?.course_group_id) params.append('course_group_id', query.course_group_id);
        if (query?.has_submissions !== undefined && query.has_submissions !== null) {
          params.append('has_submissions', String(query.has_submissions));
        }
        if (query?.has_ungraded_submissions !== undefined && query.has_ungraded_submissions !== null) {
          params.append('has_ungraded_submissions', String(query.has_ungraded_submissions));
        }
        if (query?.limit !== undefined && query.limit !== null) params.append('limit', String(query.limit));
        if (query?.offset !== undefined && query.offset !== null) params.append('offset', String(query.offset));
        const url = params.toString() ? `/tutors/submission-groups?${params.toString()}` : '/tutors/submission-groups';
        const response = await client.get<TutorSubmissionGroupList[]>(url);
        return response.data;
      }, { maxRetries: 2, exponentialBackoff: true });
      multiTierCache.set(cacheKey, result, 'warm');
      return result || [];
    } catch (e) {
      console.error('Failed to get tutor submission groups:', e);
      return [];
    }
  }

  async getTutorSubmissionGroup(submissionGroupId: string): Promise<TutorSubmissionGroupGet | null> {
    const cacheKey = `tutorSubmissionGroup-${submissionGroupId}`;
    const cached = multiTierCache.get<TutorSubmissionGroupGet>(cacheKey);
    if (cached) return cached;
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<TutorSubmissionGroupGet>(`/tutors/submission-groups/${submissionGroupId}`);
        return response.data;
      }, { maxRetries: 2, exponentialBackoff: true });
      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (e) {
      console.error('Failed to get tutor submission group:', e);
      return null;
    }
  }

  async updateUserPassword(payload: UserPassword): Promise<void> {
    const client = await this.getHttpClient();
    await client.post('/user/password', payload);
  }

  // User Management: List all users
  async getUsers(options?: { force?: boolean }): Promise<UserList[]> {
    const cacheKey = 'allUsers';

    if (!options?.force) {
      const cached = multiTierCache.get<UserList[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<UserList[]>('/users');
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });

      multiTierCache.set(cacheKey, result, 'warm');
      return result || [];
    } catch (error) {
      console.error('[getUsers] Failed to fetch users:', error);
      throw error;
    }
  }

  // User Management: Get a specific user by ID
  async getUserById(userId: string, options?: { force?: boolean }): Promise<UserGet | undefined> {
    const cacheKey = `user-${userId}`;

    if (!options?.force) {
      const cached = multiTierCache.get<UserGet>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<UserGet>(`/users/${userId}`);
        return response.data;
      }, {
        maxRetries: 2,
        exponentialBackoff: true
      });

      multiTierCache.set(cacheKey, result, 'warm');
      return result;
    } catch (error) {
      console.error(`[getUserById] Failed to fetch user ${userId}:`, error);
      throw error;
    }
  }

  // User Management: Update a user
  async updateUser(userId: string, updates: UserUpdate): Promise<UserGet> {
    try {
      const client = await this.getHttpClient();
      const response = await client.patch<UserGet>(`/users/${userId}`, updates);

      multiTierCache.delete(`user-${userId}`);
      multiTierCache.delete('allUsers');

      return response.data;
    } catch (error) {
      console.error(`[updateUser] Failed to update user ${userId}:`, error);
      throw error;
    }
  }

  // User Management: Reset user password
  async resetUserPassword(userId: string, managerPassword: string): Promise<void> {
    try {
      const client = await this.getHttpClient();
      await client.post('/password/reset', {
        user_id: userId,
        manager_password: managerPassword
      });

      multiTierCache.delete(`user-${userId}`);
    } catch (error) {
      console.error(`[resetUserPassword] Failed to reset password for user ${userId}:`, error);
      throw error;
    }
  }

  // Tutor: course contents for a specific member in a course
  async getTutorCourseContents(courseId: string, memberId: string): Promise<any[]> {
    const cacheKey = `tutorContents-${memberId}`;
    const cached = multiTierCache.get<any[]>(cacheKey);
    if (cached) return cached.filter(c => !courseId || c.course_id === courseId);
    try {
      const result = await errorRecoveryService.executeWithRecovery(async () => {
        const client = await this.getHttpClient();
        const response = await client.get<any[]>(`/tutors/course-members/${memberId}/course-contents`);
        return response.data;
      }, { maxRetries: 2, exponentialBackoff: true });
      multiTierCache.set(cacheKey, result, 'warm');
      return (result || []).filter((c: any) => !courseId || c.course_id === courseId);
    } catch (e) {
      console.error('Failed to get tutor member course contents:', e);
      return [];
    }
  }

  // Tutor: student repository metadata for a course/member pair
  async getTutorStudentRepository(courseId: string, memberId: string): Promise<{ remote_url: string } | undefined> {
    void courseId; // Not yet used if backend returns scoped by member
    try {
      const client = await this.getHttpClient();
      // Pending backend path: guessing /tutors/course-members/{id}
      const response = await client.get<any>(`/tutors/course-members/${memberId}`);
      const repoUrl = response.data?.repository?.clone_url || response.data?.repository?.url || response.data?.repository?.web_url;
      return repoUrl ? { remote_url: repoUrl } : undefined;
    } catch (e) {
      // Keep silent; command will prompt for URL
      return undefined;
    }
  }

  // Tutor: submission branch for a student's assignment
  async getTutorSubmissionBranch(courseId: string, memberId: string, courseContentId: string): Promise<string | undefined> {
    void courseId;
    try {
      const client = await this.getHttpClient();
      const response = await client.get<any>(`/tutors/course-members/${memberId}/course-contents/${courseContentId}`);
      const branch = response.data?.submission_branch || response.data?.latest_submission?.branch;
      return branch;
    } catch {
      return undefined;
    }
  }

  // Tutor: get a specific member's course content (fresh)
  async getTutorMemberCourseContent(memberId: string, courseContentId: string): Promise<any | undefined> {
    try {
      const client = await this.getHttpClient();
      const response = await client.get<any>(`/tutors/course-members/${memberId}/course-contents/${courseContentId}`);
      return response.data;
    } catch (e) {
      console.error('Failed to get tutor member course content:', e);
      return undefined;
    }
  }

  /**
   * Tutor: update a student's course content grading/status (deprecated - use submitTutorGrade instead)
   */
  async updateTutorCourseContentStudent(
    memberId: string,
    courseContentId: string,
    update: CourseContentStudentUpdate
  ): Promise<any> {
    const client = await this.getHttpClient();
    const response = await client.patch<any>(
      `/tutors/course-members/${memberId}/course-contents/${courseContentId}`,
      update
    );
    // Invalidate caches related to this member/content so UI refresh shows changes
    multiTierCache.delete(`tutorContents-${memberId}`);
    multiTierCache.delete(`studentCourseContent-${courseContentId}`);
    return response.data;
  }

  /**
   * Tutor: submit a grade for a student's course content
   */
  async submitTutorGrade(
    memberId: string,
    courseContentId: string,
    grade: TutorGradeCreate
  ): Promise<any> {
    const client = await this.getHttpClient();
    const response = await client.patch<any>(
      `/tutors/course-members/${memberId}/course-contents/${courseContentId}`,
      grade
    );
    // Invalidate caches related to this member/content so UI refresh shows changes
    multiTierCache.delete(`tutorContents-${memberId}`);
    multiTierCache.delete(`studentCourseContent-${courseContentId}`);
    return response.data;
  }

  /**
   * Submit a test for an assignment
   * @param testData The test submission data
   * @returns The test run response with result ID
   */
  async submitTest(testData: TestCreate): Promise<any> {
    try {
      if (!this.httpClient) {
        throw new Error('HTTP client not initialized');
      }
      const response = await this.httpClient.post<any>('/tests', testData);
      return response.data;
    } catch (error: any) {
      console.error('Failed to submit test:', error);
      // Re-throw HttpError as-is to preserve error_code, severity, and other metadata
      throw error;
    }
  }

  /**
   * Get the status of a test result
   * @param resultId The result ID to check
   * @returns The status string or undefined
   */
  async getResultStatus(resultId: string): Promise<string | undefined> {
    try {
      if (!this.httpClient) {
        throw new Error('HTTP client not initialized');
      }
      const response = await this.httpClient.get<string>(`/results/${resultId}/status`);
      return response.data;
    } catch (error: any) {
      console.error('Failed to get result status:', error);
      return undefined;
    }
  }

  async listMessages(params: MessageQueryParams = {}): Promise<MessageList[]> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();

      // If both course_content_id and submission_group_id are present,
      // make two separate calls and merge results (backend does AND, we want OR)
      if (params.course_content_id && params.submission_group_id) {
        const [contentMessages, submissionMessages] = await Promise.all([
          client.get<MessageList[]>('/messages', {
            course_content_id: params.course_content_id
          }).then(r => r.data),
          client.get<MessageList[]>('/messages', {
            submission_group_id: params.submission_group_id
          }).then(r => r.data)
        ]);

        // Merge and deduplicate by message id
        const messageMap = new Map<string, MessageList>();
        for (const msg of [...contentMessages, ...submissionMessages]) {
          messageMap.set(msg.id, msg);
        }
        return Array.from(messageMap.values());
      }

      // Otherwise, make a single call with all params
      const query = Object.fromEntries(
        Object.entries(params).filter(([, value]) => value !== undefined && value !== null)
      );
      const response = await client.get<MessageList[]>('/messages', query);
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  async getMessage(id: string): Promise<MessageGet | undefined> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.get<MessageGet>(`/messages/${id}`);
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  async createMessage(payload: MessageCreate): Promise<MessageGet> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.post<MessageGet>('/messages', payload);
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  async updateMessage(id: string, updates: MessageUpdate): Promise<MessageGet> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.patch<MessageGet>(`/messages/${id}`, updates);
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  async deleteMessage(id: string): Promise<void> {
    const client = await this.getHttpClient();
    await client.delete(`/messages/${id}`);
  }

  async markMessageRead(id: string): Promise<void> {
    const client = await this.getHttpClient();
    await client.post(`/messages/${id}/reads`);
  }

  async markMessageUnread(id: string): Promise<void> {
    const client = await this.getHttpClient();
    await client.delete(`/messages/${id}/reads`);
  }

  async listCourseMemberComments(courseMemberId: string): Promise<CourseMemberCommentList[]> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.get<CourseMemberCommentList[]>(
        '/course-member-comments',
        { course_member_id: courseMemberId }
      );
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  async createCourseMemberComment(courseMemberId: string, message: string): Promise<CourseMemberCommentList[]> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.post<CourseMemberCommentList[]>(
        '/course-member-comments',
        { course_member_id: courseMemberId, message }
      );
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  async updateCourseMemberComment(courseMemberId: string, commentId: string, message: string): Promise<CourseMemberCommentList[]> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.patch<CourseMemberCommentList[]>(
        `/course-member-comments/${commentId}`,
        { message }
      );
      return response.data;
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  async deleteCourseMemberComment(courseMemberId: string, commentId: string): Promise<CourseMemberCommentList[]> {
    return errorRecoveryService.executeWithRecovery(async () => {
      const client = await this.getHttpClient();
      const response = await client.delete<CourseMemberCommentList[] | null>(
        `/course-member-comments/${commentId}`,
        { course_member_id: courseMemberId }
      );

      if (Array.isArray(response.data)) {
        return response.data;
      }

      const refreshed = await client.get<CourseMemberCommentList[]>(
        '/course-member-comments',
        { course_member_id: courseMemberId }
      );
      return refreshed.data || [];
    }, {
      maxRetries: 2,
      exponentialBackoff: true
    });
  }

  /**
   * Get full test result details
   * @param resultId The result ID to fetch
   * @returns The full result data or undefined
   */
  async getResult(resultId: string): Promise<any> {
    try {
      if (!this.httpClient) {
        throw new Error('HTTP client not initialized');
      }
      const response = await this.httpClient.get<any>(`/results/${resultId}`);
      return response.data;
    } catch (error: any) {
      console.error('Failed to get result:', error);
      return undefined;
    }
  }

  /**
   * Clear the cached HTTP client instance.
   * This should be called when credentials change or on logout.
   */
  public clearHttpClient(): void {
    this.httpClient = undefined;
  }

  /**
   * Check if the service is authenticated
   */
  public isAuthenticated(): boolean {
    return !!this.httpClient && this.httpClient.isAuthenticated();
  }

  // Student submission API
  async listStudentSubmissionArtifacts(params?: SubmissionQuery | null): Promise<SubmissionListItem[]> {
    try {
      const client = await this.getHttpClient();
      const response = await client.get<SubmissionListItem[]>('/submissions/artifacts', params ?? undefined);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      console.error('Failed to list student submissions:', error);
      return [];
    }
  }

  async createStudentSubmission(
    payload: SubmissionCreate,
    archive: { buffer: Buffer; fileName: string; contentType?: string }
  ): Promise<SubmissionUploadResponseModel | undefined> {
    try {
      const client = await this.getHttpClient();
      const formData = new FormData();
      formData.append('submission_create', JSON.stringify(payload));
      formData.append('file', archive.buffer, {
        filename: archive.fileName,
        contentType: archive.contentType || 'application/zip'
      });

      const response = await client.post<SubmissionUploadResponseModel>(
        '/submissions/artifacts',
        formData
      );
      return response.data;
    } catch (error: any) {
      console.error('Failed to create student submission:', error);
      throw error;
    }
  }

  async updateStudentSubmission(
    artifactId: string,
    payload: SubmissionArtifactUpdate
  ): Promise<SubmissionUploadResponseModel | undefined> {
    try {
      const client = await this.getHttpClient();
      const response = await client.patch<SubmissionUploadResponseModel>(
        `/submissions/artifacts/${artifactId}`,
        payload
      );
      return response.data;
    } catch (error: any) {
      console.error('Failed to update student submission:', error);
      throw error;
    }
  }

  async uploadCourseMemberImport(
    courseId: string,
    file: Buffer,
    options?: {
      defaultRoleId?: string;
      updateExisting?: boolean;
      createMissingGroups?: boolean;
    }
  ): Promise<CourseMemberImportResponse | undefined> {
    try {
      const client = await this.getHttpClient();
      const formData = new FormData();

      formData.append('file', file, {
        filename: 'course-members.xml',
        contentType: 'application/xml'
      });

      if (options?.defaultRoleId) {
        formData.append('default_role', options.defaultRoleId);
      }

      if (options?.updateExisting !== undefined) {
        formData.append('update_existing', String(options.updateExisting));
      }

      if (options?.createMissingGroups !== undefined) {
        formData.append('create_missing_groups', String(options.createMissingGroups));
      }

      const response = await client.post<CourseMemberImportResponse>(
        `/course-member-import/upload/${courseId}`,
        formData
      );

      return response.data;
    } catch (error: any) {
      console.error('Failed to upload course member import:', error);
      throw error;
    }
  }

}
