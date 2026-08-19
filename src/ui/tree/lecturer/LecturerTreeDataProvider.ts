import * as vscode from 'vscode';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerRepositoryManager } from '../../../services/LecturerRepositoryManager';
import * as fs from 'fs';
import * as path from 'path';
import { RepositoryTokenManager } from '../../../services/RepositoryTokenManager';
import type { WebSocketService } from '../../../services/WebSocketService';
import { CourseChannelSubscription } from '../courseChannelSubscription';
import { errorRecoveryService } from '../../../services/ErrorRecoveryService';
import { isConsentRequiredError, handleConsentError } from '../../../utils/consentGate';
import { performanceMonitor } from '../../../services/PerformanceMonitoringService';
import { UiStateService } from '../../../services/UiStateService';
import { VirtualScrollingService } from '../../../services/VirtualScrollingService';
import { DragDropManager } from '../../../services/DragDropManager';
import { GitWrapper } from '../../../git/GitWrapper';
import { hasExampleAssigned } from '../../../utils/deploymentHelpers';
import { BaseTreeDataProvider } from '../BaseTreeDataProvider';
import { notify } from '../../../utils/notify';
import {
  courseContentCollapsibleState,
  OrganizationTreeItem,
  CourseFamilyTreeItem,
  CourseTreeItem,
  CourseContentTreeItem,
  CourseFolderTreeItem,
  CourseContentTypeTreeItem,
  ExampleTreeItem,
  CourseGroupTreeItem,
  NoGroupTreeItem,
  CourseMemberTreeItem,
  LoadMoreTreeItem,
  CourseContentAssignmentInfo,
  compareMembersByName
} from './LecturerTreeItems';
import type {
  CourseContentLecturerList,
  CourseContentCreate,
  CourseContentUpdate,
  CourseContentGet,
  CourseList,
  CourseFamilyList,
  OrganizationList,
  CourseContentTypeList,
  CourseGroupList,
  CourseMemberList
} from '../../../types/generated';

type TreeItem =
  | OrganizationTreeItem
  | CourseFamilyTreeItem
  | CourseTreeItem
  | CourseContentTreeItem
  | CourseFolderTreeItem
  | CourseContentTypeTreeItem
  | ExampleTreeItem
  | CourseGroupTreeItem
  | NoGroupTreeItem
  | CourseMemberTreeItem
  | LoadMoreTreeItem
  | InfoItem;

interface NodeUpdateData {
  course_id?: string;
  [key: string]: unknown;
}

interface AssignmentDirectoryStatus {
  message: string;
  severity: 'info' | 'warning' | 'error';
}

interface AssignmentDirectoryResolution {
  absolutePath: string | null;
  repositoryPath: string | null;
  exists: boolean;
  statusMessage?: AssignmentDirectoryStatus;
}

interface PaginationInfo {
  offset: number;
  limit: number;
  total?: number;
  hasMore: boolean;
}

export class LecturerTreeDataProvider extends BaseTreeDataProvider<TreeItem> implements vscode.TreeDragAndDropController<TreeItem> {
  // Drag and drop support
  public readonly dropMimeTypes = ['application/vnd.code.tree.computorexample', 'application/vnd.code.tree.lecturermember', 'application/vnd.code.tree.lecturercontent'];
  public readonly dragMimeTypes: string[] = ['application/vnd.code.tree.lecturermember', 'application/vnd.code.tree.lecturercontent'];

  private apiService: ComputorApiService;
  private gitLabTokenManager: RepositoryTokenManager;
  private expandedStates: Record<string, boolean> = {};
  private readonly uiState = UiStateService.getInstanceOrUndefined();
  
  // Pagination state for different node types
  private paginationState: Map<string, PaginationInfo> = new Map();
  
  // Virtual scrolling services for large datasets
  private virtualScrollServices: Map<string, VirtualScrollingService<any>> = new Map();

  private gitWrapper: GitWrapper;
  private repositoryManager: LecturerRepositoryManager;
  private assignmentIdentifierCache: Map<string, string | null> = new Map();
  private fullCourseCache: Map<string, Promise<any>> = new Map();
  private rolesTitleCache: Map<string, string> = new Map();
  private wsSubscription = new CourseChannelSubscription('lecturer-tree');

  constructor(context: vscode.ExtensionContext, apiService?: ComputorApiService) {
    super();
    // Use provided apiService or create a new one
    this.apiService = apiService || new ComputorApiService(context);
    this.gitLabTokenManager = RepositoryTokenManager.getInstance(context);
    this.gitWrapper = new GitWrapper();
    this.repositoryManager = new LecturerRepositoryManager(context, this.apiService as any);
    
    this.loadExpandedStates();
  }

  setWebSocketService(wsService: WebSocketService): void {
    this.wsSubscription.setService(wsService);
  }

  private subscribeToCourseChannels(courseIds: string[]): void {
    this.wsSubscription.subscribeCourses(courseIds, {
      onDeploymentStatusChanged: (event) => {
        console.log(`[LecturerTree/WS] Deployment status changed: ${event.course_content_id} -> ${event.new_status}`);
        void this.forceRefreshCourse(event.course_id);
      },
      onDeploymentAssigned: (event) => {
        console.log(`[LecturerTree/WS] Deployment assigned: ${event.course_content_id}`);
        void this.forceRefreshCourse(event.course_id);
      },
      onDeploymentUnassigned: (event) => {
        console.log(`[LecturerTree/WS] Deployment unassigned: ${event.course_content_id}`);
        void this.forceRefreshCourse(event.course_id);
      },
      onCourseContentUpdated: (event) => {
        console.log(`[LecturerTree/WS] Course content updated: ${event.course_content_id} (${event.change_type})`);
        void this.forceRefreshCourse(event.course_id);
      },
    });
  }

  override refresh(): void {
    // Clear ALL backend API caches - organizations, courses, course families, etc.
    this.clearAllCaches();
    this.paginationState.clear();
    this.assignmentIdentifierCache.clear();
    this.fullCourseCache.clear();
    this.rolesTitleCache.clear();
    
    // Clear all virtual scrolling services
    for (const service of this.virtualScrollServices.values()) {
      service.reset();
    }
    this.virtualScrollServices.clear();
    
    // NOTE: We do NOT clear expandedStates here - we want to preserve them across refreshes
    
    // Fire with undefined to refresh entire tree
    super.refresh();
  }

  refreshNode(element?: TreeItem): void {
    this.onDidChangeTreeDataEmitter.fire(element);
  }
  
  /**
   * Force refresh a specific course by clearing its cache and pre-fetching data
   * This ensures the data is refreshed even if the node is collapsed
   */
  async forceRefreshCourse(courseId: string): Promise<void> {
    // Clear API cache FIRST, then tree cache
    this.apiService.clearCourseCache(courseId);
    this.clearCourseCache(courseId);
    
    // Fire tree data change event with undefined to refresh entire tree
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }
  
  /**
   * Load more items for paginated lists
   */
  async loadMore(loadMoreItem: LoadMoreTreeItem): Promise<void> {
    const virtualKey = `${loadMoreItem.parentType}-${loadMoreItem.parentId}`;
    const virtualService = this.virtualScrollServices.get(virtualKey);
    
    if (virtualService) {
      // Load next page using virtual scrolling
      void loadMoreItem.currentOffset; // currentOffset - accessed but not used in this context
      void loadMoreItem.pageSize; // pageSize - accessed but not used in this context
      
      // Trigger refresh to load more items
      this.onDidChangeTreeDataEmitter.fire(undefined);
    } else {
      // Fallback to pagination state
      const paginationKey = `${loadMoreItem.parentType}-${loadMoreItem.parentId}`;
      const pagination = this.paginationState.get(paginationKey);
      
      if (pagination) {
        // Update offset to load more items
        pagination.offset = loadMoreItem.currentOffset;
        
        // Find the parent element and refresh it
        // This will trigger getChildren again with the updated pagination
        this.onDidChangeTreeDataEmitter.fire(undefined);
      }
    }
  }

  /**
   * Clear cache for a specific course
   */
  private clearCourseCache(courseId: string): void {
    // Use backend API cache clearing
    this.apiService.clearCourseCache(courseId);
  }

  /**
   * Clear ALL caches to force a complete refresh
   */
  private clearAllCaches(): void {
    // Clear all cache entries in the API service
    this.apiService.clearAllCaches();
  }

  /**
   * Update a specific node and refresh related parts of the tree
   */
  updateNode(nodeType: string, nodeId: string, updates: NodeUpdateData): void {
    switch (nodeType) {
      case 'organization':
        // Full refresh for organization changes
        this.refresh();
        break;
        
      case 'courseFamily':
        // Clear course family cache and refresh
        // Courses cache cleared in API
        this.refresh();
        break;
        
      case 'course':
        // Clear course-specific caches
        this.clearCourseCache(nodeId);
        this.refresh();
        break;
        
      case 'courseContent':
        // Clear course content cache and refresh affected course
        if (updates.course_id) {
          this.clearCourseCache(updates.course_id);
        }
        this.refresh();
        break;
        
      case 'courseContentType':
        // Clear content type cache and refresh affected course
        if (updates.course_id) {
          this.clearCourseCache(updates.course_id);
          // Content types cache cleared in API
        }
        this.refresh();
        break;
        
      default:
        // Default to full refresh
        this.refresh();
    }
  }

  /**
   * Invalidate cache entries related to a specific item
   */
  invalidateCache(itemType: string, itemId?: string, relatedIds?: { courseId?: string; organizationId?: string }): void {
    switch (itemType) {
      case 'course':
        if (itemId) {
          this.clearCourseCache(itemId);
        }
        break;
        
      case 'courseFamily':
        // Clear courses cache when course family changes
        // Courses cache cleared in API
        break;
        
      case 'organization':
        // Clear all caches when organization changes
        // Contents cache cleared in API
        // Content types cache cleared in API
        // Content types by ID cache cleared in API
        // Courses cache cleared in API
        break;
        
      case 'example':
        // Clear examples cache
        if (itemId) {
          // Example cache cleared in API
        } else {
          // Examples cache cleared in API
        }
        break;
        
      case 'courseContent':
        // Clear course content cache for related course
        if (relatedIds?.courseId) {
          this.clearCourseCache(relatedIds.courseId);
        }
        break;
        
      case 'courseContentType':
        // Clear content type caches
        if (itemId) {
          // Content type cache cleared in API
        }
        if (relatedIds?.courseId) {
          // Content types cache cleared in API
        }
        break;
        
      case 'courseGroup':
        // Clear course group and member caches
        if (relatedIds?.courseId) {
          // Groups cache cleared in API
          
          // Members cache cleared in API
        }
        break;
    }
  }

  /**
   * Smart refresh - only refreshes the minimal tree parts needed
   */
  smartRefresh(changes: Array<{
    type: 'create' | 'update' | 'delete';
    nodeType: string;
    nodeId: string;
    relatedIds?: { courseId?: string; parentId?: string; organizationId?: string };
  }>): void {
    const affectedCourses = new Set<string>();
    let needsFullRefresh = false;

    changes.forEach(change => {
      switch (change.nodeType) {
        case 'organization':
          needsFullRefresh = true;
          break;
          
        case 'courseFamily':
          // Courses cache cleared in API
          needsFullRefresh = true;
          break;
          
        case 'course':
          if (change.relatedIds?.courseId) {
            affectedCourses.add(change.relatedIds.courseId);
          }
          break;
          
        case 'courseContent':
        case 'courseContentType':
          if (change.relatedIds?.courseId) {
            affectedCourses.add(change.relatedIds.courseId);
          }
          break;
      }
      
      // Invalidate relevant caches
      this.invalidateCache(change.nodeType, change.nodeId, change.relatedIds);
    });

    if (needsFullRefresh) {
      this.refresh();
    } else {
      // Refresh only affected parts
      affectedCourses.forEach(courseId => {
        this.clearCourseCache(courseId);
      });
      this.refresh();
    }
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    // The expanded state is now handled when creating the tree items
    // This method just returns the element as-is
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    return performanceMonitor.measureAsync(
      `getChildren-${element?.contextValue || 'root'}`,
      async () => this.getChildrenInternal(element),
      'tree',
      { elementType: element?.contextValue || 'root' }
    );
  }
  
  private async getChildrenInternal(element?: TreeItem): Promise<TreeItem[]> {
    try {
      if (!element) {
        // Root level - show organizations with error recovery
        const organizations = await errorRecoveryService.executeWithRecovery(
          () => this.apiService.getOrganizations(),
          { 
            maxRetries: 3,
            onRetry: (attempt) => {
              notify.info(`Retrying connection... (attempt ${attempt})`);
            }
          }
        );
        return organizations.map(org => {
          const nodeId = `org-${org.id}`;
          const expandedState = this.expandedStates[nodeId] ? 
            vscode.TreeItemCollapsibleState.Expanded : 
            vscode.TreeItemCollapsibleState.Collapsed;
          return new OrganizationTreeItem(org, expandedState);
        });
      }

      if (element instanceof OrganizationTreeItem) {
        // Show course families for organization
        const families = await this.apiService.getCourseFamilies(element.organization.id);
        return families.map(family => {
          const nodeId = `family-${family.id}`;
          const expandedState = this.expandedStates[nodeId] ? 
            vscode.TreeItemCollapsibleState.Expanded : 
            vscode.TreeItemCollapsibleState.Collapsed;
          return new CourseFamilyTreeItem(family, element.organization, expandedState);
        });
      }

      if (element instanceof CourseFamilyTreeItem) {
        // Show courses for course family
        const courses = await this.apiService.getCourses(element.courseFamily.id);
        
        // Check for unique GitLab URLs and ensure we have tokens
        await this.ensureGitLabTokensForCourses(courses);
        
        // Cache courses for later use
        // Courses fetched directly from API
        
        // Subscribe to WS channels for loaded courses
        this.subscribeToCourseChannels(courses.map(c => c.id));

        return courses.map(course => {
          const nodeId = `course-${course.id}`;
          const expandedState = this.expandedStates[nodeId] ?
            vscode.TreeItemCollapsibleState.Expanded :
            vscode.TreeItemCollapsibleState.Collapsed;
          return new CourseTreeItem(course, element.courseFamily, element.organization, expandedState);
        });
      }

      if (element instanceof CourseTreeItem) {
        // Show three folders: Groups, Content Types, and Contents
        const folderTypes: ('groups' | 'contentTypes' | 'contents')[] = ['groups', 'contentTypes', 'contents'];
        return folderTypes.map(folderType => {
          const nodeId = `${folderType}-${element.course.id}`;
          const expandedState = this.expandedStates[nodeId] ? 
            vscode.TreeItemCollapsibleState.Expanded : 
            vscode.TreeItemCollapsibleState.Collapsed;
          return new CourseFolderTreeItem(folderType, element.course, element.courseFamily, element.organization, expandedState);
        });
      }

      if (element instanceof CourseFolderTreeItem) {
        if (element.folderType === 'contents') {
          await this.getCourseContentTypes(element.course.id);
          const allContents = await this.getCourseContents(element.course.id);
          const rootContents = this.getRootContents(allContents);

          return Promise.all(rootContents.map(content =>
            this.buildContentTreeItem(content, allContents, element.course, element.courseFamily, element.organization)
          ));
        } else if (element.folderType === 'groups') {
          // Show course groups and ungrouped members
          const groups = await this.getCourseGroups(element.course.id);
          const allMembers = await this.getCourseMembers(element.course.id);
          
          const result: TreeItem[] = [];
          
          // Add group nodes
          for (const group of groups) {
            const groupMembers = allMembers.filter((m: CourseMemberList) => m.course_group_id === group.id);
            const nodeId = `group-${group.id}`;
            const expandedState = this.expandedStates[nodeId] ? 
              vscode.TreeItemCollapsibleState.Expanded : 
              vscode.TreeItemCollapsibleState.Collapsed;
            result.push(new CourseGroupTreeItem(
              group,
              element.course,
              element.courseFamily,
              element.organization,
              groupMembers.length,
              expandedState
            ));
          }
          
          // Add "No Group" node for ungrouped members
          const ungroupedMembers = allMembers.filter((m: CourseMemberList) => !m.course_group_id);
          if (ungroupedMembers.length > 0 || groups.length === 0) {
            const nodeId = `no-group-${element.course.id}`;
            const expandedState = ungroupedMembers.length > 0 ? 
              (this.expandedStates[nodeId] ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) :
              vscode.TreeItemCollapsibleState.None;
            result.push(new NoGroupTreeItem(
              element.course,
              element.courseFamily,
              element.organization,
              ungroupedMembers.length,
              expandedState
            ));
          }
          
          return result;
        } else {
          // Show course content types with content kind titles
          const contentTypes = await this.getCourseContentTypes(element.course.id);
          const contentKinds = await this.apiService.getCourseContentKinds();
          const kindMap = new Map(contentKinds.map(k => [k.id, k.title || undefined]));

          const sortedContentTypes = [...contentTypes].sort((a, b) => {
            const titleA = (a.title || a.slug || '').toLowerCase();
            const titleB = (b.title || b.slug || '').toLowerCase();
            return titleA.localeCompare(titleB);
          });

          return sortedContentTypes.map(type => new CourseContentTypeTreeItem(
            type,
            element.course,
            element.courseFamily,
            element.organization,
            type.course_content_kind?.title || kindMap.get(type.course_content_kind_id)
          ));
        }
      }

      if (element instanceof CourseContentTreeItem) {
        // Units expand into their child contents. Assignments are leaves — their
        // files are reached through "Open Assignment Folder", not the tree.
        const allContents = await this.getCourseContents(element.course.id);
        const childContents = this.getChildContents(element.courseContent as CourseContentLecturerList, allContents);

        return Promise.all(childContents.map(content =>
          this.buildContentTreeItem(content, allContents, element.course, element.courseFamily, element.organization)
        ));
      }

      if (element instanceof CourseGroupTreeItem) {
        const members = await this.getCourseMembers(element.course.id, element.group.id);
        const sorted = [...members].sort(compareMembersByName);

        if (sorted.length > 100) {
          const virtualKey = `members-${element.course.id}-${element.group.id}`;

          let virtualService = this.virtualScrollServices.get(virtualKey);
          if (!virtualService) {
            virtualService = new VirtualScrollingService(
              async (page: number, pageSize: number) => {
                const start = page * pageSize;
                const pageMembers = sorted.slice(start, start + pageSize);
                const treeItems = await this.buildSortedMemberTreeItems(
                  pageMembers, element.course, element.courseFamily, element.organization, element.group
                );
                return { items: treeItems, total: sorted.length };
              },
              { pageSize: 50, preloadPages: 1, maxCachedPages: 5 }
            );

            this.virtualScrollServices.set(virtualKey, virtualService);
          }

          const items = await virtualService.getItems(0, 50);

          if (sorted.length > items.length) {
            items.push(new LoadMoreTreeItem(
              element.group.id,
              'members',
              items.length,
              50
            ));
          }

          return items;
        } else {
          return this.buildSortedMemberTreeItems(sorted, element.course, element.courseFamily, element.organization, element.group);
        }
      }

      if (element instanceof NoGroupTreeItem) {
        // Show members not in any group
        const members = await this.getCourseMembers(element.course.id);
        const ungroupedMembers = members.filter((m: CourseMemberList) => !m.course_group_id);
        const sorted = [...ungroupedMembers].sort(compareMembersByName);

        // Use virtual scrolling for large member lists (> 100)
        if (sorted.length > 100) {
          const virtualKey = `members-${element.course.id}-ungrouped`;

          let virtualService = this.virtualScrollServices.get(virtualKey);
          if (!virtualService) {
            virtualService = new VirtualScrollingService(
              async (page: number, pageSize: number) => {
                const start = page * pageSize;
                const pageMembers = sorted.slice(start, start + pageSize);
                const treeItems = await this.buildSortedMemberTreeItems(
                  pageMembers, element.course, element.courseFamily, element.organization
                );
                return { items: treeItems, total: sorted.length };
              },
              { pageSize: 50, preloadPages: 1, maxCachedPages: 5 }
            );

            this.virtualScrollServices.set(virtualKey, virtualService);
          }

          const items = await virtualService.getItems(0, 50);

          if (sorted.length > items.length) {
            items.push(new LoadMoreTreeItem(
              element.course.id,
              'members-ungrouped',
              items.length,
              50
            ));
          }

          return items;
        } else {
          return this.buildSortedMemberTreeItems(sorted, element.course, element.courseFamily, element.organization);
        }
      }

      return [];
    } catch (error) {
      // Consent gate: show a clear, clickable node (and one throttled prompt)
      // instead of dumping an opaque "HTTP 403: Forbidden".
      if (isConsentRequiredError(error)) {
        void handleConsentError(error);
        const item = new InfoItem('Accept the privacy policy to continue', 'warning');
        item.command = {
          command: 'computor.acceptPrivacyPolicy',
          title: 'Open Web App to accept the privacy policy',
        };
        return [item];
      }
      notify.error(`Failed to load tree data: ${error}`);
      return [];
    }
  }

  private async buildContentTreeItem(
    content: CourseContentLecturerList,
    allContents: CourseContentLecturerList[],
    course: CourseList,
    courseFamily: CourseFamilyList,
    organization: OrganizationList
  ): Promise<CourseContentTreeItem> {
    const hasChildren = this.hasChildContents(content, allContents);

    // Use deployment data from the list endpoint (already includes example_version)
    let exampleInfo = null;
    let exampleVersionInfo = null;
    const deployment = (content as any).deployment;
    if (hasExampleAssigned(content) && deployment) {
      if (deployment.example_version) {
        exampleVersionInfo = deployment.example_version;
      }
      if (deployment.example_identifier) {
        exampleInfo = {
          identifier: deployment.example_identifier,
          title: deployment.example_identifier
        } as any;
      }
    }

    const contentTypes = await this.getCourseContentTypes(course.id);
    const contentType = contentTypes.find(t => t.id === content.course_content_type_id);
    const isSubmittable = this.isContentSubmittable(contentType);
    let assignmentDirectory: string | undefined;
    let assignmentInfo: CourseContentAssignmentInfo | undefined;

    if (isSubmittable) {
      assignmentDirectory = this.resolveAssignmentDirectoryName(content);
      assignmentInfo = await this.computeAssignmentInfo(course, content, assignmentDirectory);
    }

    const nodeId = `content-${content.id}`;
    const expandedState = courseContentCollapsibleState({
      hasChildren,
      expanded: this.expandedStates[nodeId] === true
    });

    return new CourseContentTreeItem({
      courseContent: content,
      course,
      courseFamily,
      organization,
      hasChildren,
      exampleInfo,
      contentType,
      isSubmittable,
      exampleVersionInfo,
      collapsibleState: expandedState,
      assignmentInfo,
      assignmentDirectory
    });
  }

  private resolveAssignmentDirectoryName(content: CourseContentLecturerList): string | undefined {
    const cached = this.assignmentIdentifierCache.get(content.id);
    if (cached !== undefined) {
      return cached || undefined;
    }

    // Use deployment data from the list endpoint (no extra API call needed)
    const deployment = (content as any).deployment;
    if (deployment) {
      const identifier = deployment.example_identifier || deployment.version_identifier;
      if (identifier) {
        const sanitized = this.sanitizeAssignmentDirectoryName(identifier);
        this.assignmentIdentifierCache.set(content.id, sanitized ?? null);
        if (sanitized) {
          return sanitized;
        }
      }
    }

    const fallback = this.extractSlugFromPath(content.path);
    const sanitizedFallback = this.sanitizeAssignmentDirectoryName(fallback);
    this.assignmentIdentifierCache.set(content.id, sanitizedFallback ?? null);
    return sanitizedFallback;
  }

  private extractSlugFromPath(pathValue: string): string | undefined {
    if (!pathValue) {
      return undefined;
    }
    const segments = pathValue.split('.').filter(Boolean);
    if (segments.length === 0) {
      return undefined;
    }
    return segments[segments.length - 1];
  }

  private sanitizeAssignmentDirectoryName(raw: string | undefined): string | undefined {
    if (!raw) {
      return undefined;
    }
    const normalized = path.normalize(raw).replace(/^([/\\]+)/, '');
    if (!normalized || normalized === '.' || normalized === '..') {
      return undefined;
    }
    const safeSegments = normalized.split(/[\\/]+/).filter(segment => segment && segment !== '..');
    return safeSegments.join(path.sep);
  }

  private async resolveAssignmentDirectory(
    course: CourseList,
    directoryName: string
  ): Promise<AssignmentDirectoryResolution> {
    const fullCourse = await this.getFullCourse(course);
    const repoRoot = this.repositoryManager.getAssignmentsRepoRoot(fullCourse);

    if (!repoRoot) {
      return {
        absolutePath: null,
        repositoryPath: null,
        exists: false,
        statusMessage: { message: 'Assignments repository not configured for this course', severity: 'warning' }
      };
    }

    const sanitizedDirectoryName = this.sanitizeAssignmentDirectoryName(directoryName);
    if (!sanitizedDirectoryName) {
      return {
        absolutePath: null,
        repositoryPath: repoRoot,
        exists: false,
        statusMessage: { message: 'Assignment directory name is invalid', severity: 'warning' }
      };
    }

    // Read-only: this feeds tooltips and context decorations while the tree
    // renders, so it must never kick off a clone. Syncing is the
    // "Sync Assignments Repositories" command's job.
    const folder = this.repositoryManager.getAssignmentFolderPath(fullCourse, sanitizedDirectoryName);
    if (!folder) {
      return {
        absolutePath: null,
        repositoryPath: repoRoot,
        exists: false,
        statusMessage: { message: 'Assignment directory not configured', severity: 'warning' }
      };
    }

    const folderExists = fs.existsSync(folder);
    const statusMessage: AssignmentDirectoryStatus | undefined = folderExists
      ? undefined
      : { message: 'Assignment folder missing locally — run "Sync Assignments"', severity: 'warning' };

    return {
      absolutePath: folder,
      repositoryPath: repoRoot,
      exists: folderExists,
      statusMessage
    };
  }

  private async computeAssignmentInfo(
    course: CourseList,
    content: CourseContentLecturerList,
    directoryName?: string
  ): Promise<CourseContentAssignmentInfo | undefined> {
    // Use deployment data from the list endpoint (includes has_newer_version)
    const deployment = (content as any).deployment;
    let deploymentStatus: string | null = deployment?.deployment_status || content.deployment_status || null;
    let hasDeployment = deployment ? true : (content.has_deployment || false);
    let hasNewerVersion = deployment?.has_newer_version === true;

    const info: CourseContentAssignmentInfo = {
      directoryName,
      versionIdentifier: undefined,
      versionTag: undefined,
      deploymentStatus,
      hasDeployment,
      hasNewerVersion
    };

    if (!directoryName) {
      return info;
    }

    const resolution = await this.resolveAssignmentDirectory(course, directoryName);
    info.folderExists = resolution.exists;
    info.statusMessage = resolution.statusMessage;

    if (!resolution.repositoryPath || !resolution.absolutePath || !resolution.exists) {
      return info;
    }

    const repoPath = resolution.repositoryPath;
    const directoryPath = resolution.absolutePath;
    const relativePath = path.relative(repoPath, directoryPath) || '.';
    const normalizedPath = relativePath.split(path.sep).join('/');

    try {
      const repo = await this.gitWrapper.getRepository(repoPath);

      let commitExists = false;
      if (info.versionIdentifier) {
        try {
          await repo.revparse([`${info.versionIdentifier}^{commit}`]);
          commitExists = true;
        } catch {
          info.commitMissing = true;
        }
      }

      let hasDiff = false;
      if (info.versionIdentifier && commitExists) {
        const diffSummary = await repo.diffSummary([info.versionIdentifier, '--', normalizedPath === '.' ? '.' : normalizedPath]);
        hasDiff = diffSummary.changed > 0;
      }

      const status = await this.gitWrapper.status(repoPath);
      const prefix = normalizedPath === '.' ? '' : (normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`);
      const hasStatusChanges = this.statusContainsPath(status, prefix);

      info.hasLocalChanges = hasDiff || hasStatusChanges;
    } catch (error) {
      info.diffError = error instanceof Error ? error.message : String(error);
    }

    return info;
  }

  private statusContainsPath(status: any, prefix: string): boolean {
    if (!status) {
      return false;
    }

    if (!prefix) {
      return !status.isClean;
    }

    const matches = (value: string | undefined) => Boolean(value && value.startsWith(prefix));
    if (status.files?.some((file: { path: string }) => matches(file.path))) {
      return true;
    }
    if (status.created?.some((file: string) => matches(file))) {
      return true;
    }
    if (status.modified?.some((file: string) => matches(file))) {
      return true;
    }
    if (status.deleted?.some((file: string) => matches(file))) {
      return true;
    }
    if (status.conflicted?.some((file: string) => matches(file))) {
      return true;
    }
    if (status.renamed?.some((file: { from: string; to: string }) => matches(file.from) || matches(file.to))) {
      return true;
    }
    return false;
  }

  private getFullCourse(course: CourseList): Promise<any> {
    const cached = this.fullCourseCache.get(course.id);
    if (cached) {
      return cached;
    }

    const promise = (async () => {
      let fullCourse: any = await this.apiService.getCourse(course.id);
      if (!fullCourse) {
        fullCourse = { ...course };
      }

      if (!fullCourse.organization && fullCourse.organization_id) {
        try {
          fullCourse.organization = await (this.apiService as any).getOrganization(fullCourse.organization_id);
        } catch (error) {
          console.warn('Failed to load organization for course', error);
        }
      }

      return fullCourse;
    })();

    this.fullCourseCache.set(course.id, promise);
    return promise;
  }

  public rememberAssignmentIdentifier(contentId: string, identifier: string): void {
    this.assignmentIdentifierCache.set(contentId, identifier);
  }

  private async getCourseContents(courseId: string): Promise<CourseContentLecturerList[]> {
    // Use new lecturer-specific endpoint that includes repository info
    const contents = await this.apiService.getLecturerCourseContents(courseId);
    return contents || [];
  }

  private async getCourseContentTypes(courseId: string): Promise<CourseContentTypeList[]> {
    // Always fetch fresh data from API
    const types = await this.apiService.getCourseContentTypes(courseId);
    await this.loadContentKinds();
    return types || [];
  }
  
  private async loadContentKinds(): Promise<void> {
    // Content kinds fetched from API on demand
    await this.apiService.getCourseContentKinds();
    // Process kinds if needed
  }

  private async getCourseGroups(courseId: string): Promise<CourseGroupList[]> {
    // Always fetch fresh data from API
    const groups = await this.apiService.getCourseGroups(courseId);
    return groups || [];
  }

  private async getCourseMembers(courseId: string, groupId?: string): Promise<CourseMemberList[]> {
    const members = await this.apiService.getCourseMembers(courseId, groupId);
    return members || [];
  }

  private async getRoleTitle(roleId: string): Promise<string | undefined> {
    if (this.rolesTitleCache.has(roleId)) {
      return this.rolesTitleCache.get(roleId);
    }
    try {
      const roles = await this.apiService.getCourseRoles();
      for (const role of roles) {
        if (role.title) {
          this.rolesTitleCache.set(role.id, role.title);
        }
      }
    } catch {
      // Role resolution is best-effort
    }
    return this.rolesTitleCache.get(roleId);
  }

  private async buildSortedMemberTreeItems(
    sortedMembers: CourseMemberList[],
    course: CourseList,
    courseFamily: CourseFamilyList,
    organization: OrganizationList,
    group?: CourseGroupList
  ): Promise<CourseMemberTreeItem[]> {
    const roleTitles = new Map<string, string | undefined>();
    for (const member of sortedMembers) {
      if (!roleTitles.has(member.course_role_id)) {
        roleTitles.set(member.course_role_id, await this.getRoleTitle(member.course_role_id));
      }
    }
    return sortedMembers.map(member => new CourseMemberTreeItem(
      member, course, courseFamily, organization, group, roleTitles.get(member.course_role_id)
    ));
  }

  private getRootContents(contents: CourseContentLecturerList[]): CourseContentLecturerList[] {
    // Get contents that have no parent (root level)
    return contents.filter(content => {
      const pathParts = content.path.split('.');
      return pathParts.length === 1;
    }).sort((a, b) => a.position - b.position);
  }

  private getChildContents(parent: CourseContentLecturerList, allContents: CourseContentLecturerList[]): CourseContentLecturerList[] {
    // Get direct children of the parent content
    const parentPath = parent.path;
    const parentDepth = parentPath.split('.').length;
    
    return allContents.filter(content => {
      const contentPath = content.path;
      const contentDepth = contentPath.split('.').length;
      
      // Check if this is a direct child (one level deeper and starts with parent path)
      return contentPath.startsWith(parentPath + '.') && contentDepth === parentDepth + 1;
    }).sort((a, b) => a.position - b.position);
  }

  private hasChildContents(content: CourseContentLecturerList, allContents: CourseContentLecturerList[]): boolean {
    const contentPath = content.path;
    return allContents.some(c => c.path.startsWith(contentPath + '.') && c.path !== contentPath);
  }

  async getParent(element: TreeItem): Promise<TreeItem | undefined> {
    if (element instanceof CourseFamilyTreeItem) {
      return new OrganizationTreeItem(element.organization);
    }
    
    if (element instanceof CourseTreeItem) {
      return new CourseFamilyTreeItem(element.courseFamily, element.organization);
    }
    
    if (element instanceof CourseFolderTreeItem) {
      return new CourseTreeItem(element.course, element.courseFamily, element.organization);
    }
    
    if (element instanceof CourseContentTypeTreeItem) {
      return new CourseFolderTreeItem('contentTypes', element.course, element.courseFamily, element.organization);
    }
    
    if (element instanceof CourseContentTreeItem) {
      const pathParts = element.courseContent.path.split('.');
      if (pathParts.length === 1) {
        // Root content - parent is contents folder
        return new CourseFolderTreeItem('contents', element.course, element.courseFamily, element.organization);
      } else {
        // Find parent content
        const parentPath = pathParts.slice(0, -1).join('.');
        const allContents = await this.getCourseContents(element.course.id);
        const parentContent = allContents.find(c => c.path === parentPath);
        
        if (parentContent) {
          const hasChildren = this.hasChildContents(parentContent, allContents);
          let exampleInfo = null;
          let exampleVersionInfo = null;

          const parentDeployment = (parentContent as any).deployment;
          if (hasExampleAssigned(parentContent) && parentDeployment) {
            if (parentDeployment.example_version) {
              exampleVersionInfo = parentDeployment.example_version;
            }
            if (parentDeployment.example_identifier) {
              exampleInfo = {
                identifier: parentDeployment.example_identifier,
                title: parentDeployment.example_identifier
              } as any;
            }
          }
          
          // Get content type info
          const contentTypes = await this.getCourseContentTypes(element.course.id);
          const contentType = contentTypes.find(t => t.id === parentContent.course_content_type_id);
          const isSubmittable = this.isContentSubmittable(contentType);
          
          const nodeId = `content-${parentContent.id}`;
          const expandedState = courseContentCollapsibleState({
            hasChildren,
            expanded: this.expandedStates[nodeId] === true
          });
          
          return new CourseContentTreeItem({
            courseContent: parentContent,
            course: element.course,
            courseFamily: element.courseFamily,
            organization: element.organization,
            hasChildren,
            exampleInfo,
            contentType,
            isSubmittable,
            exampleVersionInfo,
            collapsibleState: expandedState
          });
        }
      }
    }
    
    return undefined;
  }

  // Helper methods for course content management
  async createCourseContent(
    folderItem: CourseFolderTreeItem,
    title: string,
    contentTypeId: string,
    parentPath?: string,
    slug?: string,
    description?: string,
    properties?: CourseContentCreate['properties']
  ): Promise<CourseContentGet | undefined> {
    try {
      const position = await this.getNextPosition(folderItem.course.id, parentPath);
      
      // Use slug if provided, otherwise fall back to position number
      const pathSegment = slug || `item${position}`;
      const path = parentPath ? `${parentPath}.${pathSegment}` : pathSegment;
      
      // Check if path already exists
      const existingContents = await this.getCourseContents(folderItem.course.id);
      if (existingContents.some(c => c.path === path)) {
        notify.error(`A content item with path '${path}' already exists. Please use a different slug.`);
        return;
      }
      
      const contentData: CourseContentCreate = {
        title,
        description,
        path,
        position,
        course_id: folderItem.course.id,
        course_content_type_id: contentTypeId,
        properties
      };
      
      const created = await this.apiService.createCourseContent(folderItem.course.id, contentData);
      
      // Clear cache and refresh
      // Cache cleared via API
      
      // If creating under a parent, refresh the parent node
      if (parentPath) {
        const parentContent = existingContents.find(c => c.path === parentPath);
        if (parentContent) {
          // Don't need to create new item, just refresh
          this.refreshNode();
        }
      } else {
        this.refreshNode(folderItem);
      }
      return created;
    } catch (error) {
      notify.error(`Failed to create content: ${error}`);
      return undefined;
    }
  }

  async updateCourseContent(contentItem: CourseContentTreeItem, updates: CourseContentUpdate): Promise<void> {
    try {
      await this.apiService.updateCourseContent(
        contentItem.course.id,
        contentItem.courseContent.id,
        updates
      );
      
      // Clear API cache for this course
      this.apiService.clearCourseCache(contentItem.course.id);
      
      // Refresh the specific item
      this.onDidChangeTreeDataEmitter.fire(contentItem);
    } catch (error) {
      notify.error(`Failed to update course content: ${error}`);
    }
  }

  async deleteCourseContent(contentItem: CourseContentTreeItem): Promise<void> {
    try {
      // Validate input
      if (!contentItem || !contentItem.courseContent || !contentItem.courseContent.id || !contentItem.course || !contentItem.course.id) {
        console.error('Invalid content item passed to deleteCourseContent:', {
          hasContentItem: !!contentItem,
          hasCourseContent: !!contentItem?.courseContent,
          hasCourseContentId: !!contentItem?.courseContent?.id,
          hasCourse: !!contentItem?.course,
          hasCourseId: !!contentItem?.course?.id
        });
        throw new Error('Invalid content item - missing required data');
      }
      
      const title = contentItem.courseContent.title || contentItem.courseContent.path || 'Unknown';
      await this.apiService.deleteCourseContent(
        contentItem.course.id,
        contentItem.courseContent.id
      );

      // Clear API cache for this course - this ensures fresh data will be fetched
      this.apiService.clearCourseCache(contentItem.course.id);

      this.refresh();

      notify.info(`Deleted "${title}" successfully`);
    } catch (error) {
      console.error('Failed to delete course content:', error);
      notify.error(`Failed to delete course content: ${error}`);
    }
  }

  private async getNextPosition(courseId: string, parentPath?: string): Promise<number> {
    const contents = await this.getCourseContents(courseId);
    
    if (parentPath) {
      const siblings = this.getChildContents({ path: parentPath } as CourseContentLecturerList, contents);
      return siblings.length + 1;
    } else {
      const roots = this.getRootContents(contents);
      return roots.length + 1;
    }
  }
  
  private isContentSubmittable(contentType?: CourseContentTypeList): boolean {
    if (!contentType) {
      return false;
    }

    // Prefer backend flag when available
    if (contentType.course_content_kind?.submittable) {
      return true;
    }

    // Fallback to heuristics based on slug/title for older payloads
    const slug = contentType.slug?.toLowerCase() || '';
    const title = contentType.course_content_kind?.title?.toLowerCase() || '';
    const submittableTypes = ['assignment', 'exercise', 'homework', 'task', 'lab', 'quiz', 'exam'];

    return submittableTypes.some(type => slug.includes(type) || title.includes(type));
  }

  /**
   * Ensure we have GitLab tokens for all unique GitLab instances in courses
   */

  private async ensureGitLabTokensForCourses(courses: CourseList[]): Promise<void> {
    const gitlabUrls = new Set<string>();
    
    // Extract unique GitLab URLs from courses
    for (const course of courses) {
      const url = this.gitLabTokenManager.extractGitLabUrlFromCourse(course);
      if (url) {
        gitlabUrls.add(url);
      }
    }
    
    // Prompt for tokens for each unique URL
    for (const url of gitlabUrls) {
      await this.gitLabTokenManager.ensureTokenForUrl(url);
    }
  }

  /**
   * Get GitLab token for a course
   */
  async getGitLabTokenForCourse(course: CourseList): Promise<string | undefined> {
    const gitlabUrl = this.gitLabTokenManager.extractGitLabUrlFromCourse(course);
    if (!gitlabUrl) {
      return undefined;
    }
    
    return await this.gitLabTokenManager.ensureTokenForUrl(gitlabUrl);
  }

  /**
   * Load expanded states from settings
   */
  private async loadExpandedStates(): Promise<void> {
    // Reads synchronously from UiStateService. This used to await the settings
    // file, and getChildren could outrun it, so the first render after a
    // reload collapsed the tree it was meant to restore
    // (computor-org/issues#285).
    this.expandedStates = { ...(this.uiState?.expandedNodes('lecturer') ?? {}) };
  }


  /**
   * Set node expanded state
   */
  public async setNodeExpanded(nodeId: string, expanded: boolean): Promise<void> {
    if (expanded) {
      this.expandedStates[nodeId] = true;
    } else {
      delete this.expandedStates[nodeId];
    }

    this.uiState?.setExpanded('lecturer', nodeId, expanded);
  }

  // Drag and drop implementation
  public async handleDrag(source: readonly TreeItem[], treeDataTransfer: vscode.DataTransfer): Promise<void> {
    const members = source.filter(item => item instanceof CourseMemberTreeItem) as CourseMemberTreeItem[];
    if (members.length > 0) {
      const memberData = members.map(m => ({
        memberId: m.member.id,
        courseId: m.course.id,
        currentGroupId: m.member.course_group_id
      }));
      treeDataTransfer.set(
        'application/vnd.code.tree.lecturermember',
        new vscode.DataTransferItem(memberData)
      );
      return;
    }

    const contentItem = source.find(item => item instanceof CourseContentTreeItem) as CourseContentTreeItem | undefined;
    if (contentItem) {
      treeDataTransfer.set(
        'application/vnd.code.tree.lecturercontent',
        new vscode.DataTransferItem({
          contentId: contentItem.courseContent.id,
          courseId: contentItem.course.id,
          path: contentItem.courseContent.path,
          position: contentItem.courseContent.position
        })
      );
    }
  }

  private async handleMemberDrop(target: TreeItem | undefined, memberDataItem: vscode.DataTransferItem): Promise<void> {
    if (!target) {
      return;
    }

    // Determine target group
    let targetGroupId: string | null = null;
    let courseId: string;

    if (target instanceof CourseGroupTreeItem) {
      targetGroupId = target.group.id;
      courseId = target.course.id;
    } else if (target instanceof NoGroupTreeItem) {
      targetGroupId = null; // Moving to "No Group"
      courseId = target.course.id;
    } else {
      notify.error('Members can only be dropped on course groups or "No Group"');
      return;
    }

    try {
      const memberData = await memberDataItem.value;
      if (!Array.isArray(memberData)) {
        return;
      }

      // Move all members to the target group
      for (const member of memberData) {
        if (member.courseId !== courseId) {
          notify.warning(`Cannot move member to a different course`);
          continue;
        }

        if (member.currentGroupId === targetGroupId) {
          continue; // Already in target group
        }

        await this.apiService.updateCourseMember(member.memberId, {
          course_group_id: targetGroupId
        });
      }

      const groupName = target instanceof CourseGroupTreeItem
        ? target.group.title || 'the group'
        : 'No Group';

      notify.info(
        `Moved ${memberData.length} member(s) to ${groupName}`
      );

      // Refresh the tree to show changes
      await this.refresh();
    } catch (error: any) {
      notify.error(`Failed to move members: ${error?.message || error}`);
    }
  }

  private getParentPath(path: string): string {
    const lastDot = path.lastIndexOf('.');
    return lastDot === -1 ? '' : path.substring(0, lastDot);
  }

  private getSlug(path: string): string {
    const lastDot = path.lastIndexOf('.');
    return lastDot === -1 ? path : path.substring(lastDot + 1);
  }

  private calculateInsertPosition(siblings: { position: number }[], targetIndex: number): number | undefined {
    const targetSibling = siblings[targetIndex];
    if (!targetSibling) {
      return undefined;
    }
    if (targetIndex === 0) {
      return targetSibling.position - 1;
    }
    const beforeSibling = siblings[targetIndex - 1];
    if (!beforeSibling) {
      return undefined;
    }
    return (beforeSibling.position + targetSibling.position) / 2;
  }

  private async handleContentReorder(
    draggedData: { contentId: string; courseId: string; path: string; position: number },
    target: CourseContentTreeItem
  ): Promise<void> {
    if (draggedData.contentId === target.courseContent.id) {
      return;
    }

    const draggedPath = draggedData.path;
    const targetPath = target.courseContent.path;
    const draggedParent = this.getParentPath(draggedPath);
    const targetParent = this.getParentPath(targetPath);
    const isSameLevel = draggedParent === targetParent;

    // Prevent moving an item into its own descendant
    if (targetPath.startsWith(draggedPath + '.')) {
      notify.warning('Cannot move an item into its own descendant');
      return;
    }

    const allContents = await this.getCourseContents(draggedData.courseId);
    const siblings = allContents
      .filter(c => {
        const parent = this.getParentPath(c.path);
        return parent === targetParent && c.id !== draggedData.contentId;
      })
      .sort((a, b) => a.position - b.position);

    const targetIndex = siblings.findIndex(c => c.id === target.courseContent.id);
    if (targetIndex === -1) {
      return;
    }

    const newPosition = this.calculateInsertPosition(siblings, targetIndex);
    if (newPosition === undefined) {
      return;
    }

    try {
      if (isSameLevel) {
        await this.apiService.updateCourseContent(
          draggedData.courseId,
          draggedData.contentId,
          { position: newPosition }
        );
      } else {
        const slug = this.getSlug(draggedPath);
        const newPath = targetParent ? `${targetParent}.${slug}` : slug;
        await this.apiService.moveCourseContent(
          draggedData.courseId,
          draggedData.contentId,
          newPath,
          newPosition
        );
      }

      this.apiService.clearCourseCache(draggedData.courseId);
      this.clearCourseCache(draggedData.courseId);
      this.onDidChangeTreeDataEmitter.fire(undefined);
    } catch (error: any) {
      notify.error(`Failed to reorder: ${error?.message || error}`);
    }
  }

  private async handleContentMoveToParent(
    draggedData: { contentId: string; courseId: string; path: string; position: number },
    targetParentPath: string,
    courseId: string
  ): Promise<void> {
    const draggedParent = this.getParentPath(draggedData.path);
    if (draggedParent === targetParentPath) {
      return; // Already at this level
    }

    // Prevent moving into own descendant
    if (targetParentPath.startsWith(draggedData.path + '.')) {
      notify.warning('Cannot move an item into its own descendant');
      return;
    }

    const slug = this.getSlug(draggedData.path);
    const newPath = targetParentPath ? `${targetParentPath}.${slug}` : slug;

    const allContents = await this.getCourseContents(courseId);
    const siblings = allContents
      .filter(c => {
        const parent = this.getParentPath(c.path);
        return parent === targetParentPath && c.id !== draggedData.contentId;
      })
      .sort((a, b) => a.position - b.position);

    // Place at the end
    const lastSibling = siblings[siblings.length - 1];
    const newPosition = lastSibling ? lastSibling.position + 1 : 1;

    try {
      await this.apiService.moveCourseContent(courseId, draggedData.contentId, newPath, newPosition);

      this.apiService.clearCourseCache(courseId);
      this.clearCourseCache(courseId);
      this.onDidChangeTreeDataEmitter.fire(undefined);
    } catch (error: any) {
      notify.error(`Failed to move: ${error?.message || error}`);
    }
  }

  /**
   * What a unit dropped on another unit should mean.
   *
   * Only genuinely ambiguous when the two are siblings — dragging a unit in
   * from somewhere else reads as nesting, and an assignment dropped on a unit
   * always means "into it". Returns 'into' without asking in those cases.
   */
  private async resolveUnitDrop(
    draggedData: { contentId?: string; path?: string; courseId?: string },
    target: CourseContentTreeItem
  ): Promise<'into' | 'before' | 'cancelled'> {
    const draggedPath = draggedData?.path;
    if (!draggedPath || draggedData.contentId === target.courseContent.id) {
      return 'into';
    }

    if (this.getParentPath(draggedPath) !== this.getParentPath(target.courseContent.path)) {
      return 'into';
    }

    const allContents = await this.getCourseContents(target.course.id);
    const dragged = allContents.find(c => c.id === draggedData.contentId);
    if (!dragged || dragged.is_submittable) {
      // An assignment dropped on a unit is never ambiguous.
      return 'into';
    }

    const targetLabel = target.courseContent.title || target.courseContent.path;
    const choice = await vscode.window.showQuickPick(
      [
        { label: `$(arrow-up) Place before "${targetLabel}"`, value: 'before' as const },
        { label: `$(folder) Move into "${targetLabel}"`, value: 'into' as const }
      ],
      { title: 'Where should this unit go?' }
    );
    return choice ? choice.value : 'cancelled';
  }

  public async handleDrop(target: TreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    // Check if we have member data being dropped
    const memberData = dataTransfer.get('application/vnd.code.tree.lecturermember');

    if (memberData) {
      try {
        const memberDataValue = await memberData.value;
        if (memberDataValue && Array.isArray(memberDataValue) && memberDataValue.length > 0) {
          await this.handleMemberDrop(target, memberData);
          return;
        }
      } catch {
        // Invalid member data, skip
      }
    }

    // Check if we have content reorder/move data
    const contentData = dataTransfer.get('application/vnd.code.tree.lecturercontent');
    if (contentData) {
      try {
        const draggedData = await contentData.value;
        if (draggedData?.contentId) {
          if (target instanceof CourseContentTreeItem) {
            if (!target.isSubmittable) {
              // Dropping onto a unit means "put this inside it" — except when
              // both are units of the same parent, where it just as plausibly
              // means "put this before it". Units cannot be reordered by drag
              // at all if we guess, so ask (computor-org/issues#323).
              const dropped = await this.resolveUnitDrop(draggedData, target);
              if (dropped === 'cancelled') {
                return;
              }
              if (dropped === 'before') {
                await this.handleContentReorder(draggedData, target);
              } else {
                await this.handleContentMoveToParent(draggedData, target.courseContent.path, target.course.id);
              }
            } else {
              // Dropping onto a sibling: reorder alongside it
              await this.handleContentReorder(draggedData, target);
            }
            return;
          }
          if (target instanceof CourseFolderTreeItem && target.folderType === 'contents') {
            await this.handleContentMoveToParent(draggedData, '', target.course.id);
            return;
          }
        }
      } catch {
        // Invalid content data, skip
      }
    }

    // Check if we have example data being dropped
    const exampleData = dataTransfer.get('application/vnd.code.tree.computorexample');

    if (!exampleData || !target) {
      return;
    }

    // Determine where to create the new assignment based on drop target
    let courseId: string;
    let parentPath: string | undefined;
    let targetDescription = '';

    if (target instanceof CourseTreeItem) {
      // Dropped on course - create at root level
      courseId = target.course.id;
      parentPath = undefined;
      targetDescription = `in course "${target.course.title || target.course.path}"`;
    } else if (target instanceof CourseFolderTreeItem && target.folderType === 'contents') {
      // Dropped on "Contents" folder - create at root level of course contents
      courseId = target.course.id;
      parentPath = undefined;
      targetDescription = `in course "${target.course.title || target.course.path}"`;
    } else if (target instanceof CourseContentTreeItem) {
      courseId = target.course.id;
      
      // Check if target is submittable - if yes, we might want to replace
      if (target.isSubmittable && hasExampleAssigned(target.courseContent)) {
        const choice = await notify.warning(
          `Assignment "${target.courseContent.title}" already has an example. Do you want to replace it or create a new assignment?`,
          'Replace', 'Create New', 'Cancel'
        );
        
        if (choice === 'Cancel') {
          return;
        } else if (choice === 'Replace') {
          // Original behavior - assign to existing
          await this.assignExampleToExisting(target, exampleData);
          return;
        }
        // Otherwise fall through to create new
      }
      
      // For non-submittable content or when creating new, use it as parent
      if (!target.isSubmittable) {
        parentPath = target.courseContent.path;
        targetDescription = `under "${target.courseContent.title}"`;
      } else {
        // For submittable content when creating new, create as sibling
        const pathParts = target.courseContent.path.split('.');
        if (pathParts.length > 1) {
          pathParts.pop();
          parentPath = pathParts.join('.');
          targetDescription = `as sibling of "${target.courseContent.title}"`;
        } else {
          parentPath = undefined;
          targetDescription = `at root level`;
        }
      }
    } else {
      notify.error('Examples can only be dropped on courses or course contents');
      return;
    }

    try {
      // First try to get data from DragDropManager (workaround for VS Code DataTransfer limitations)
      const dragDropManager = DragDropManager.getInstance();
      let draggedExamples = dragDropManager.getDraggedData();
      
      if (!draggedExamples) {
        // Fallback: try to get from DataTransfer
        let rawValue: any = '';
        
        if (typeof exampleData.value === 'function') {
          try {
            rawValue = await exampleData.value();
          } catch (err) {
            console.error('Error calling value():', err);
          }
        } else if (typeof exampleData.value === 'string') {
          rawValue = exampleData.value;
        } else {
          rawValue = exampleData.value ? String(exampleData.value) : '';
        }
        
        if (!rawValue || rawValue === '') {
          notify.error('No data received from drag operation. Please try again or use the context menu instead.');
          return;
        }
        
        // Parse the JSON string if it's a string
        draggedExamples = typeof rawValue === 'string' 
          ? JSON.parse(rawValue)
          : rawValue;
      }
      
      if (!Array.isArray(draggedExamples) || draggedExamples.length === 0) {
        return;
      }

      const example = draggedExamples[0];

      if (!example.exampleId) {
        notify.error('Invalid example data - missing exampleId');
        return;
      }

      // Create a new assignment with the example
      await this.createAssignmentFromExample(
        courseId,
        parentPath,
        example,
        targetDescription
      );
      
      // Clear the drag data after successful operation
      dragDropManager.clearDraggedData();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      notify.error(`Failed to create assignment: ${errorMessage}`);
    }
  }

  /**
   * Helper method to assign example to existing course content
   */
  private async assignExampleToExisting(target: CourseContentTreeItem, exampleData: vscode.DataTransferItem): Promise<void> {
    try {
      // Try DragDropManager first
      const dragDropManager = DragDropManager.getInstance();
      let draggedExamples = dragDropManager.getDraggedData();
      
      if (!draggedExamples) {
        // Fallback to DataTransfer
        let rawValue: any = '';
        
        if (typeof exampleData.value === 'function') {
          rawValue = await exampleData.value();
        } else if (typeof exampleData.value === 'string') {
          rawValue = exampleData.value;
        } else {
          rawValue = exampleData.value ? String(exampleData.value) : '';
        }
        
        if (!rawValue || rawValue === '') {
          notify.error('No data received from drag operation.');
          return;
        }
        
        draggedExamples = typeof rawValue === 'string' 
          ? JSON.parse(rawValue)
          : rawValue;
      }
      
      if (!Array.isArray(draggedExamples) || draggedExamples.length === 0) {
        return;
      }

      const example = draggedExamples[0];
      if (!example.exampleId) {
        notify.error('Invalid example data');
        return;
      }

      // Get the example with versions to find the latest version ID
      const fullExample = await this.apiService.getExample(example.exampleId);
      if (!fullExample || !fullExample.versions || fullExample.versions.length === 0) {
        throw new Error('Example has no versions available');
      }

      // Use the latest version
      const latestVersion = fullExample.versions.reduce((latest, current) => 
        current.version_number > latest.version_number ? current : latest
      );

      // Assign the example version to the course content
      await this.apiService.lecturerAssignExample(
        target.courseContent.id,
        {
          example_identifier: fullExample.identifier,
          version_tag: latestVersion.version_tag
        }
      );

      // Trigger assignments sync so files are populated in assignments repo
      try {
        await this.apiService.generateAssignments(target.course.id, {
          course_content_ids: [target.courseContent.id],
          overwrite_strategy: 'skip_if_exists',
          commit_message: `Initialize assignment from example ${fullExample.identifier || fullExample.title}`
        });
      } catch (e) {
        console.warn('Failed to trigger assignments generation after assigning example:', e);
      }

      // Clear cache and force refresh to show the updated assignment
      await this.forceRefreshCourse(target.course.id);

      notify.info(
        `✅ Example "${example.title}" assigned to "${target.courseContent.title}" successfully!`
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      notify.error(`Failed to assign example: ${errorMessage}`);
    }
  }

  /**
   * Create a new assignment from an example at the specified location
   */
  private async createAssignmentFromExample(
    courseId: string,
    parentPath: string | undefined,
    example: any,
    targetDescription: string
  ): Promise<void> {
    try {
      // Get content types for the course and find a submittable one
      const contentTypes = await this.apiService.getCourseContentTypes(courseId);
      
      // Find submittable content types
      const submittableTypes = [];
      for (const type of contentTypes) {
        try {
          const fullType = await this.apiService.getCourseContentType(type.id);
          if (fullType?.course_content_kind?.submittable) {
            submittableTypes.push(type);
          }
        } catch (error) {
          console.warn(`Failed to fetch content type details: ${error}`);
        }
      }

      if (submittableTypes.length === 0) {
        notify.error(
          'No submittable content types (assignments, exercises) are configured for this course. Please create one first.'
        );
        return;
      }

      // Use the first submittable type or let user choose if multiple
      let contentType = submittableTypes[0];
      if (submittableTypes.length > 1) {
        const selected = await vscode.window.showQuickPick(
          submittableTypes.map(t => {
            const fullType = contentTypes.find(ct => ct.id === t.id);
            return {
              label: t.title || t.slug,
              description: fullType?.course_content_kind_id || '',
              id: t.id
            };
          }),
          { placeHolder: 'Select content type' }
        );

        if (!selected) {
          return;
        }

        const selectedType = submittableTypes.find(t => t.id === selected.id);
        if (selectedType) {
          contentType = selectedType;
        }
      }

      // Generate slug from example title
      const slug = example.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      
      // Build the full path
      const path = parentPath ? `${parentPath}.${slug}` : slug;
      
      // Check if path already exists
      const existingContents = await this.getCourseContents(courseId);
      if (existingContents.some(c => c.path === path)) {
        notify.error(`A content item with path '${path}' already exists.`);
        return;
      }

      // Get position for the new content
      const position = await this.getNextPosition(courseId, parentPath);

      // Ensure we have a content type (TypeScript safety)
      if (!contentType) {
        notify.error('No content type selected');
        return;
      }

      // Create the course content
      const contentData: CourseContentCreate = {
        title: example.title,
        description: example.description || `Assignment based on example: ${example.title}`,
        path: path,
        position: position,
        course_id: courseId,
        course_content_type_id: contentType.id,
        // No max_submissions / max_test_runs: an assignment is unlimited
        // unless a lecturer sets a limit. These used to be stamped with 10/100,
        // which silently capped every assignment created from an example.
      };

      const createdContent = await this.apiService.createCourseContent(courseId, contentData);
      
      // Assign the example version if content was created
      if (createdContent && createdContent.id) {
        const fullExample = await this.apiService.getExample(example.exampleId);
        
        if (fullExample && fullExample.versions && fullExample.versions.length > 0) {
          const latestVersion = fullExample.versions.reduce((latest, current) => 
            current.version_number > latest.version_number ? current : latest
          );

          try {
            await this.apiService.lecturerAssignExample(
              createdContent.id,
              {
                example_identifier: fullExample.identifier,
                version_tag: latestVersion.version_tag
              }
            );
          } catch (assignError: any) {
            const assignMessage = assignError?.response?.data?.detail || assignError.message || 'Unknown error';
            const action = await notify.warning(
              `Assignment "${example.title}" was created but the example could not be assigned: ${assignMessage}. Keep the assignment without an example?`,
              'Keep', 'Delete'
            );
            if (action === 'Delete') {
              await this.apiService.deleteCourseContent(courseId, createdContent.id);
            }
            this.apiService.clearCourseCache(courseId);
            await this.forceRefreshCourse(courseId);
            return;
          }
        }
      }

      // Refresh the tree
      await this.forceRefreshCourse(courseId);

      notify.info(
        `Created assignment "${example.title}" ${targetDescription}`
      );
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      notify.error(`Failed to create assignment: ${errorMessage}`);
    }
  }
}

class InfoItem extends vscode.TreeItem {
  constructor(message: string, severity: 'info' | 'warning' | 'error') {
    super(message, vscode.TreeItemCollapsibleState.None);
    if (severity === 'warning') this.iconPath = new vscode.ThemeIcon('warning');
    else if (severity === 'error') this.iconPath = new vscode.ThemeIcon('error');
    else this.iconPath = new vscode.ThemeIcon('info');
  }
}
