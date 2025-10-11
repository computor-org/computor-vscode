import * as vscode from 'vscode';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerRepositoryManager } from '../../../services/LecturerRepositoryManager';
import * as fs from 'fs';
import * as path from 'path';
import { GitLabTokenManager } from '../../../services/GitLabTokenManager';
import { ComputorSettingsManager } from '../../../settings/ComputorSettingsManager';
import { errorRecoveryService } from '../../../services/ErrorRecoveryService';
import { performanceMonitor } from '../../../services/PerformanceMonitoringService';
import { VirtualScrollingService } from '../../../services/VirtualScrollingService';
import { DragDropManager } from '../../../services/DragDropManager';
import { GitWrapper } from '../../../git/GitWrapper';
import { hasExampleAssigned, getExampleVersionId } from '../../../utils/deploymentHelpers';
import {
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
  CourseContentAssignmentInfo
} from './LecturerTreeItems';
import type {
  CourseContentList,
  CourseContentLecturerList,
  CourseContentCreate,
  CourseContentUpdate,
  CourseContentGet,
  CourseList,
  CourseContentTypeList,
  CourseGroupList,
  CourseMemberList,
  CourseContentDeploymentList,
  ExampleGet
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
  | FSFolderItem
  | FSFileItem
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

export class LecturerTreeDataProvider implements vscode.TreeDataProvider<TreeItem>, vscode.TreeDragAndDropController<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  // Drag and drop support
  public readonly dropMimeTypes = ['application/vnd.code.tree.computorexample', 'application/vnd.code.tree.lecturermember'];
  public readonly dragMimeTypes: string[] = ['application/vnd.code.tree.lecturermember']; // Support dragging members

  private apiService: ComputorApiService;
  private gitLabTokenManager: GitLabTokenManager;
  private settingsManager: ComputorSettingsManager;
  private expandedStates: Record<string, boolean> = {};
  
  // Pagination state for different node types
  private paginationState: Map<string, PaginationInfo> = new Map();
  
  // Virtual scrolling services for large datasets
  private virtualScrollServices: Map<string, VirtualScrollingService<any>> = new Map();

  private gitWrapper: GitWrapper;
  private repositoryManager: LecturerRepositoryManager;
  private assignmentIdentifierCache: Map<string, string | null> = new Map();
  private fullCourseCache: Map<string, any> = new Map();

  constructor(context: vscode.ExtensionContext, apiService?: ComputorApiService) {
    // Use provided apiService or create a new one
    this.apiService = apiService || new ComputorApiService(context);
    this.gitLabTokenManager = GitLabTokenManager.getInstance(context);
    this.settingsManager = new ComputorSettingsManager(context);
    this.gitWrapper = new GitWrapper();
    this.repositoryManager = new LecturerRepositoryManager(context, this.apiService as any);
    
    // Load expanded states on startup
    console.log('Loading expanded states on startup...');
    this.loadExpandedStates().then(() => {
      console.log('Expanded states loaded:', Object.keys(this.expandedStates));
    });
  }

  refresh(): void {
    console.log('Full tree refresh requested');
    console.log('Current expanded states before refresh:', Object.keys(this.expandedStates));
    
    // Clear ALL backend API caches - organizations, courses, course families, etc.
    this.clearAllCaches();
    this.paginationState.clear();
    this.assignmentIdentifierCache.clear();
    this.fullCourseCache.clear();
    
    // Clear all virtual scrolling services
    for (const service of this.virtualScrollServices.values()) {
      service.reset();
    }
    this.virtualScrollServices.clear();
    
    // NOTE: We do NOT clear expandedStates here - we want to preserve them across refreshes
    
    // Fire with undefined to refresh entire tree
    this._onDidChangeTreeData.fire(undefined);
  }

  refreshNode(element?: TreeItem): void {
    this._onDidChangeTreeData.fire(element);
  }
  
  /**
   * Force refresh a specific course by clearing its cache and pre-fetching data
   * This ensures the data is refreshed even if the node is collapsed
   */
  async forceRefreshCourse(courseId: string): Promise<void> {
    console.log(`Force refreshing course ${courseId}`);
    
    // Clear API cache FIRST, then tree cache
    this.apiService.clearCourseCache(courseId);
    this.clearCourseCache(courseId);
    
    // Fire tree data change event with undefined to refresh entire tree
    this._onDidChangeTreeData.fire(undefined);
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
      this._onDidChangeTreeData.fire(undefined);
    } else {
      // Fallback to pagination state
      const paginationKey = `${loadMoreItem.parentType}-${loadMoreItem.parentId}`;
      const pagination = this.paginationState.get(paginationKey);
      
      if (pagination) {
        // Update offset to load more items
        pagination.offset = loadMoreItem.currentOffset;
        
        // Find the parent element and refresh it
        // This will trigger getChildren again with the updated pagination
        this._onDidChangeTreeData.fire(undefined);
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
              vscode.window.showInformationMessage(`Retrying connection... (attempt ${attempt})`);
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
          // Ensure content types are loaded for this course
          await this.getCourseContentTypes(element.course.id);
          
          // Show course contents for course with virtual scrolling for large lists
          const allContents = await this.getCourseContents(element.course.id);
          
          // Build tree structure from ltree paths
          const rootContents = this.getRootContents(allContents);
          
          // Use virtual scrolling for large lists (> 100 items)
          if (rootContents.length > 100) {
            const virtualKey = `contents-${element.course.id}`;

            // Get or create virtual scrolling service
            let virtualService = this.virtualScrollServices.get(virtualKey);
            if (!virtualService) {
              virtualService = new VirtualScrollingService(
                async (page: number, pageSize: number) => {
                  const start = page * pageSize;
                  const items = rootContents.slice(start, start + pageSize);

                  // Transform to tree items
                  const treeItems = await Promise.all(items.map(async content => {
                    const hasChildren = this.hasChildContents(content, allContents);
                    let exampleInfo = null;
                    let exampleVersionInfo = null;

                    // Check if example is assigned using helper
                    if (hasExampleAssigned(content)) {
                      const versionId = getExampleVersionId(content);
                      if (versionId) {
                        console.log(`[Virtual scroll] Fetching example version info for content "${content.title}" with version_id: ${versionId}`);
                        try {
                          exampleVersionInfo = await this.apiService.getExampleVersion(versionId);
                          console.log(`[Virtual scroll] Version info fetched:`, exampleVersionInfo ? `${exampleVersionInfo.version_tag || 'unknown'}` : 'null');

                          // Get example info from the version
                          if (exampleVersionInfo && exampleVersionInfo.example_id) {
                            exampleInfo = await this.getExampleInfo(exampleVersionInfo.example_id);
                            console.log(`[Virtual scroll] Example info fetched:`, exampleInfo ? `${exampleInfo.title}` : 'null');
                          }
                        } catch (error) {
                          console.warn(`Failed to fetch version info for ${versionId}:`, error);
                        }
                      }
                    }
                    
                    // Get content type for this content
                    const contentTypes = await this.getCourseContentTypes(element.course.id);
                    const contentType = contentTypes.find(t => t.id === content.course_content_type_id);
                    const isSubmittable = this.isContentSubmittable(contentType);
                    const isAssignmentLeaf = isSubmittable && !hasChildren;
                    let assignmentDirectory: string | undefined;
                    let assignmentInfo: CourseContentAssignmentInfo | undefined;
                    
                    if (isSubmittable) {
                      assignmentDirectory = await this.resolveAssignmentDirectoryName(content);
                      assignmentInfo = await this.computeAssignmentInfo(element.course, content, assignmentDirectory);
                    }
                    
                    const nodeId = `content-${content.id}`;
                    const expandedState = hasChildren
                      ? (this.expandedStates[nodeId] ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
                      : (isAssignmentLeaf ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
                    
                    return new CourseContentTreeItem(
                      content,
                      element.course,
                      element.courseFamily,
                      element.organization,
                      hasChildren,
                      exampleInfo,
                      contentType,
                      isSubmittable,
                      exampleVersionInfo,
                      expandedState,
                      assignmentInfo,
                      assignmentDirectory
                    );
                  }));
                  
                  return { items: treeItems, total: rootContents.length };
                },
                { pageSize: 50, preloadPages: 2, maxCachedPages: 10 }
              );
              
              this.virtualScrollServices.set(virtualKey, virtualService);
            }
            
            // Get first page of items
            const items = await virtualService.getItems(0, 50);
            
            // Add load more if there are more items
            if (rootContents.length > items.length) {
              items.push(new LoadMoreTreeItem(
                element.course.id,
                'contents',
                items.length,
                50
              ));
            }
            
            return items;
          } else {
            // Small list - load all at once
            const contentItems = await Promise.all(rootContents.map(async content => {
              const hasChildren = this.hasChildContents(content, allContents);
              let exampleInfo = null;
              let exampleVersionInfo = null;

              // Check if example is assigned using helper
              if (hasExampleAssigned(content)) {
                const versionId = getExampleVersionId(content);
                if (versionId) {
                  console.log(`Fetching example version info for content "${content.title}" with version_id: ${versionId}`);
                  try {
                    exampleVersionInfo = await this.apiService.getExampleVersion(versionId);
                    console.log(`Version info fetched:`, exampleVersionInfo ? `${exampleVersionInfo.version_tag || 'unknown'}` : 'null');

                    // Get example info from the version
                    if (exampleVersionInfo && exampleVersionInfo.example_id) {
                      exampleInfo = await this.getExampleInfo(exampleVersionInfo.example_id);
                      console.log(`Example info fetched:`, exampleInfo ? `${exampleInfo.title}` : 'null');
                    }
                  } catch (error) {
                    console.warn(`Failed to fetch version info for ${versionId}:`, error);
                  }
                }
              }
              
              // Get content type info
              const contentTypes = await this.getCourseContentTypes(element.course.id);
              const contentType = contentTypes.find(t => t.id === content.course_content_type_id);
              const isSubmittable = this.isContentSubmittable(contentType);
              const isAssignmentLeaf = isSubmittable && !hasChildren;
              let assignmentDirectory: string | undefined;
              let assignmentInfo: CourseContentAssignmentInfo | undefined;
              
              if (isSubmittable) {
                assignmentDirectory = await this.resolveAssignmentDirectoryName(content);
                assignmentInfo = await this.computeAssignmentInfo(element.course, content, assignmentDirectory);
              }
              
              const nodeId = `content-${content.id}`;
              const expandedState = hasChildren
                ? (this.expandedStates[nodeId] ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
                : (isAssignmentLeaf ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
              
              return new CourseContentTreeItem(
                content,
                element.course,
                element.courseFamily,
                element.organization,
                hasChildren,
                exampleInfo,
                contentType,
                isSubmittable,
                exampleVersionInfo,
                expandedState,
                assignmentInfo,
                assignmentDirectory
              );
            }));
            
            return contentItems;
          }
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

          // Sort content types alphabetically by title
          const sortedContentTypes = [...contentTypes].sort((a, b) => {
            const titleA = (a.title || a.slug || '').toLowerCase();
            const titleB = (b.title || b.slug || '').toLowerCase();
            return titleA.localeCompare(titleB);
          });

          // Fetch content kind information for each type
          const contentTypesWithKinds = await Promise.all(sortedContentTypes.map(async (type) => {
            try {
              const fullType = await this.apiService.getCourseContentType(type.id);
              const kindTitle = fullType?.course_content_kind?.title || undefined;
              return new CourseContentTypeTreeItem(
                type,
                element.course,
                element.courseFamily,
                element.organization,
                kindTitle
              );
            } catch (error) {
              // If fetching full type fails, create without kind title
              console.warn(`Failed to fetch content type details for ${type.id}:`, error);
              return new CourseContentTypeTreeItem(
                type,
                element.course,
                element.courseFamily,
                element.organization
              );
            }
          }));

          return contentTypesWithKinds;
        }
      }

      if (element instanceof CourseContentTreeItem) {
        // Show child course contents or, for assignments (leaves), show local repo files
        const allContents = await this.getCourseContents(element.course.id);
        const childContents = this.getChildContents(element.courseContent as CourseContentLecturerList, allContents);
        
        // Fetch example info for child contents
        const childItems = await Promise.all(childContents.map(async content => {
          const hasChildren = this.hasChildContents(content, allContents);
          let exampleInfo = null;
          let exampleVersionInfo = null;
          
          // Check if example is assigned using helper
          if (hasExampleAssigned(content)) {
            const versionId = getExampleVersionId(content);
            if (versionId) {
              try {
                exampleVersionInfo = await this.apiService.getExampleVersion(versionId);
                // Get example info from the version
                if (exampleVersionInfo && exampleVersionInfo.example_id) {
                  exampleInfo = await this.getExampleInfo(exampleVersionInfo.example_id);
                }
              } catch (error) {
                console.warn(`Failed to fetch version info for ${versionId}:`, error);
              }
            }
          }
          
          // Get content type info
          const contentTypes = await this.getCourseContentTypes(element.course.id);
          const contentType = contentTypes.find(t => t.id === content.course_content_type_id);
          const isSubmittable = this.isContentSubmittable(contentType);
          const isAssignmentLeaf = isSubmittable && !hasChildren;
          let assignmentDirectory: string | undefined;
          let assignmentInfo: CourseContentAssignmentInfo | undefined;

          if (isSubmittable) {
            assignmentDirectory = await this.resolveAssignmentDirectoryName(content);
            assignmentInfo = await this.computeAssignmentInfo(element.course, content, assignmentDirectory);
          }
          
          const nodeId = `content-${content.id}`;
          const expandedState = hasChildren
            ? (this.expandedStates[nodeId] ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
            : (isAssignmentLeaf ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
          
          return new CourseContentTreeItem(
            content,
            element.course,
            element.courseFamily,
            element.organization,
            hasChildren,
            exampleInfo,
            contentType,
            isSubmittable,
            exampleVersionInfo,
            expandedState,
            assignmentInfo,
            assignmentDirectory
          );
        }));
        
        if (childItems.length > 0) {
          return childItems;
        }
        
        return this.getAssignmentDirectoryChildren(element);
      }

      if (element instanceof CourseGroupTreeItem) {
        // Show members in this group
        const members = await this.getCourseMembers(element.course.id, element.group.id);
        
        // Use virtual scrolling for large member lists (> 100)
        if (members.length > 100) {
          const virtualKey = `members-${element.course.id}-${element.group.id}`;
          
          let virtualService = this.virtualScrollServices.get(virtualKey);
          if (!virtualService) {
            virtualService = new VirtualScrollingService(
              async (page: number, pageSize: number) => {
                const start = page * pageSize;
                const items = members.slice(start, start + pageSize);
                
                const treeItems = items.map((member: CourseMemberList) => new CourseMemberTreeItem(
                  member,
                  element.course,
                  element.courseFamily,
                  element.organization,
                  element.group
                ));
                
                return { items: treeItems, total: members.length };
              },
              { pageSize: 50, preloadPages: 1, maxCachedPages: 5 }
            );
            
            this.virtualScrollServices.set(virtualKey, virtualService);
          }
          
          const items = await virtualService.getItems(0, 50);
          
          if (members.length > items.length) {
            items.push(new LoadMoreTreeItem(
              element.group.id,
              'members',
              items.length,
              50
            ));
          }
          
          return items;
        } else {
          return members.map((member: CourseMemberList) => new CourseMemberTreeItem(
            member,
            element.course,
            element.courseFamily,
            element.organization,
            element.group
          ));
        }
      }

      if (element instanceof NoGroupTreeItem) {
        // Show members not in any group
        const members = await this.getCourseMembers(element.course.id);
        const ungroupedMembers = members.filter((m: CourseMemberList) => !m.course_group_id);
        
        // Use virtual scrolling for large member lists (> 100)
        if (ungroupedMembers.length > 100) {
          const virtualKey = `members-${element.course.id}-ungrouped`;
          
          let virtualService = this.virtualScrollServices.get(virtualKey);
          if (!virtualService) {
            virtualService = new VirtualScrollingService(
              async (page: number, pageSize: number) => {
                const start = page * pageSize;
                const items = ungroupedMembers.slice(start, start + pageSize);
                
                const treeItems = items.map((member: CourseMemberList) => new CourseMemberTreeItem(
                  member,
                  element.course,
                  element.courseFamily,
                  element.organization
                ));
                
                return { items: treeItems, total: ungroupedMembers.length };
              },
              { pageSize: 50, preloadPages: 1, maxCachedPages: 5 }
            );
            
            this.virtualScrollServices.set(virtualKey, virtualService);
          }
          
          const items = await virtualService.getItems(0, 50);
          
          if (ungroupedMembers.length > items.length) {
            items.push(new LoadMoreTreeItem(
              element.course.id,
              'members-ungrouped',
              items.length,
              50
            ));
          }
          
          return items;
        } else {
          return ungroupedMembers.map((member: CourseMemberList) => new CourseMemberTreeItem(
            member,
            element.course,
            element.courseFamily,
            element.organization
          ));
        }
      }

      // Filesystem folder expansion for lecturer assignment folders
      if (element instanceof FSFolderItem) {
        const items = await this.readDirectoryItems(element.absPath, element.course, element.courseContent, element.repositoryRoot);
        return items;
      }

      return [];
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load tree data: ${error}`);
      return [];
    }
  }

  private async getAssignmentDirectoryChildren(element: CourseContentTreeItem): Promise<TreeItem[]> {
    if (!element.isSubmittable) {
      return [];
    }

    const rawDirectoryName = element.assignmentDirectory || await this.resolveAssignmentDirectoryName(element.courseContent as CourseContentLecturerList);
    if (!rawDirectoryName) {
      return [new InfoItem('Assignment not initialized in assignments repo', 'info')];
    }

    const directoryName = this.sanitizeAssignmentDirectoryName(rawDirectoryName);
    if (!directoryName) {
      return [new InfoItem('Assignment directory name is invalid', 'warning')];
    }

    element.assignmentDirectory = directoryName;
    this.assignmentIdentifierCache.set(element.courseContent.id, directoryName);

    try {
      const resolution = await this.resolveAssignmentDirectory(element.course, directoryName, true);

      if (element.assignmentInfo) {
        element.assignmentInfo.directoryName = directoryName;
        element.assignmentInfo.folderExists = resolution.exists;
        element.assignmentInfo.statusMessage = resolution.statusMessage;
      }

      if (!resolution.absolutePath || !resolution.exists) {
        if (resolution.statusMessage) {
          return [new InfoItem(resolution.statusMessage.message, resolution.statusMessage.severity)];
        }
        return [new InfoItem('Assignment directory not available locally', 'warning')];
      }

      const repoRoot = resolution.repositoryPath || this.repositoryManager.getAssignmentsRepoRoot(element.course);
      const children = await this.readDirectoryItems(resolution.absolutePath, element.course, element.courseContent, repoRoot || resolution.absolutePath);
      if (children.length === 0) {
        return [new InfoItem('Empty assignment directory', 'info')];
      }
      return children;
    } catch (error) {
      console.warn('Failed to prepare assignment directory:', error);
      if (element.assignmentInfo) {
        element.assignmentInfo.statusMessage = { message: 'Error loading assignment files', severity: 'error' };
      }
      return [new InfoItem('Error loading assignment files', 'error')];
    }
  }

  private async resolveAssignmentDirectoryName(content: CourseContentLecturerList): Promise<string | undefined> {
    const cached = this.assignmentIdentifierCache.get(content.id);
    if (cached !== undefined) {
      return cached || undefined;
    }

    // The new lecturer endpoint doesn't include deployment details,
    // so we need to fetch the full content to get deployment path
    try {
      const full = await this.apiService.getCourseContent(content.id, true) as CourseContentGet | undefined;
      const fullDeployment = full?.deployment as (CourseContentDeploymentList & { deployment_path?: string | null; example_identifier?: string | null; version_identifier?: string | null }) | null | undefined;
      const identifier = ((fullDeployment as any)?.deployment_path as string | undefined)
        || fullDeployment?.example_identifier;
      const sanitizedFull = this.sanitizeAssignmentDirectoryName(identifier || undefined);
      this.assignmentIdentifierCache.set(content.id, sanitizedFull ?? null);
      if (sanitizedFull) {
        return sanitizedFull;
      }
    } catch (error) {
      console.warn('Failed to resolve assignment directory name:', error);
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
    directoryName: string,
    attemptSync: boolean = true
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

    let folder = this.repositoryManager.getAssignmentFolderPath(fullCourse, sanitizedDirectoryName);
    let folderExists = folder ? fs.existsSync(folder) : false;
    let statusMessage: AssignmentDirectoryStatus | undefined;

    if (!folder && attemptSync) {
      await this.syncAssignmentsRepository(course.id, fullCourse);
      folder = this.repositoryManager.getAssignmentFolderPath(fullCourse, sanitizedDirectoryName);
      folderExists = folder ? fs.existsSync(folder) : false;
    }

    if (!folder) {
      return {
        absolutePath: null,
        repositoryPath: repoRoot,
        exists: false,
        statusMessage: { message: 'Assignment directory not configured', severity: 'warning' }
      };
    }

    if (!folderExists) {
      if (attemptSync) {
        await this.syncAssignmentsRepository(course.id, fullCourse);
        folderExists = fs.existsSync(folder);
      }
      if (!folderExists) {
        statusMessage = { message: 'Assignment folder missing locally — run "Sync Assignments"', severity: 'warning' };
      }
    }

    return {
      absolutePath: folder,
      repositoryPath: repoRoot,
      exists: folderExists,
      statusMessage
    };
  }

  private async syncAssignmentsRepository(courseId: string, course: any): Promise<void> {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Syncing assignments...' }, async (progress) => {
      progress.report({ message: `Syncing assignments for ${course.title || course.path}` });
      await this.repositoryManager.syncAssignmentsForCourse(courseId);
    });
  }

  private async computeAssignmentInfo(
    course: CourseList,
    content: CourseContentLecturerList,
    directoryName?: string
  ): Promise<CourseContentAssignmentInfo | undefined> {
    // The new lecturer endpoint has deployment_status and has_deployment directly
    const info: CourseContentAssignmentInfo = {
      directoryName,
      versionIdentifier: undefined, // Will be fetched if needed
      versionTag: undefined, // Will be fetched if needed
      deploymentStatus: content.deployment_status || null,
      hasDeployment: content.has_deployment || false
    };

    if (!directoryName) {
      return info;
    }

    const resolution = await this.resolveAssignmentDirectory(course, directoryName, false);
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

  private async getFullCourse(course: CourseList): Promise<any> {
    const cached = this.fullCourseCache.get(course.id);
    if (cached) {
      return cached;
    }

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

    this.fullCourseCache.set(course.id, fullCourse);
    return fullCourse;
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
    // Always fetch fresh data from API
    const members = await this.apiService.getCourseMembers(courseId, groupId);
    return members || [];
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
          
          // Check if example is assigned using helper
          if (hasExampleAssigned(parentContent)) {
            const versionId = getExampleVersionId(parentContent);
            if (versionId) {
              try {
                exampleVersionInfo = await this.apiService.getExampleVersion(versionId);
                // Get example info from the version
                if (exampleVersionInfo && exampleVersionInfo.example_id) {
                  exampleInfo = await this.getExampleInfo(exampleVersionInfo.example_id);
                }
              } catch (error) {
                console.warn(`Failed to fetch version info for ${versionId}:`, error);
              }
            }
          }
          
          // Get content type info
          const contentTypes = await this.getCourseContentTypes(element.course.id);
          const contentType = contentTypes.find(t => t.id === parentContent.course_content_type_id);
          const isSubmittable = this.isContentSubmittable(contentType);
          
          const nodeId = `content-${parentContent.id}`;
          const expandedState = hasChildren ? 
            (this.expandedStates[nodeId] ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) :
            vscode.TreeItemCollapsibleState.None;
          
          return new CourseContentTreeItem(
            parentContent,
            element.course,
            element.courseFamily,
            element.organization,
            hasChildren,
            exampleInfo,
            contentType,
            isSubmittable,
            exampleVersionInfo,
            expandedState
          );
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
        vscode.window.showErrorMessage(`A content item with path '${path}' already exists. Please use a different slug.`);
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
      vscode.window.showErrorMessage(`Failed to create content: ${error}`);
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
      this._onDidChangeTreeData.fire(contentItem);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update course content: ${error}`);
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
      console.log(`Deleting course content: ${title} (${contentItem.courseContent.id})`);
      
      await this.apiService.deleteCourseContent(
        contentItem.course.id,
        contentItem.courseContent.id
      );
      
      console.log('Delete API call successful, clearing cache and refreshing tree...');
      
      // Clear API cache for this course - this ensures fresh data will be fetched
      this.apiService.clearCourseCache(contentItem.course.id);
      
      this.refresh();
      
      vscode.window.showInformationMessage(`Deleted "${title}" successfully`);
    } catch (error) {
      console.error('Failed to delete course content:', error);
      vscode.window.showErrorMessage(`Failed to delete course content: ${error}`);
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
  private async getExampleInfo(exampleId: string): Promise<ExampleGet | null> {
    // Check cache first
    // Examples fetched from API on demand
    
    try {
      const example = await this.apiService.getExample(exampleId);
      if (example) {
        // Example stored in API cache
        return example;
      } else {
        console.warn(`Example ${exampleId} not found or returned undefined`);
      }
    } catch (error) {
      console.error(`Failed to fetch example ${exampleId}:`, error);
      // Show a more user-friendly error message
      vscode.window.showWarningMessage(`Failed to load example information for ID: ${exampleId}`);
    }
    
    return null;
  }

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
    try {
      this.expandedStates = await this.settingsManager.getTreeExpandedStates();
    } catch (error) {
      console.error('Failed to load expanded states:', error);
      this.expandedStates = {};
    }
  }


  /**
   * Set node expanded state
   */
  public async setNodeExpanded(nodeId: string, expanded: boolean): Promise<void> {
    console.log(`Setting node ${nodeId} expanded state to: ${expanded}`);
    
    if (expanded) {
      this.expandedStates[nodeId] = true;
    } else {
      delete this.expandedStates[nodeId];
    }
    
    try {
      await this.settingsManager.setNodeExpandedState(nodeId, expanded);
      console.log(`Saved expanded state for ${nodeId}: ${expanded}`);
      console.log('Current expanded states:', Object.keys(this.expandedStates));
    } catch (error) {
      console.error('Failed to save node expanded state:', error);
    }
  }

  // Drag and drop implementation
  public async handleDrag(source: readonly TreeItem[], treeDataTransfer: vscode.DataTransfer): Promise<void> {
    // Only support dragging course members - explicitly reject other item types
    const members = source.filter(item => item instanceof CourseMemberTreeItem) as CourseMemberTreeItem[];

    if (members.length === 0) {
      // No valid draggable items - don't set any data transfer
      return;
    }

    if (members.length > 0) {
      // Serialize member data for drag
      const memberData = members.map(m => ({
        memberId: m.member.id,
        courseId: m.course.id,
        currentGroupId: m.member.course_group_id
      }));

      treeDataTransfer.set(
        'application/vnd.code.tree.lecturermember',
        new vscode.DataTransferItem(memberData)
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
      vscode.window.showErrorMessage('Members can only be dropped on course groups or "No Group"');
      return;
    }

    try {
      const memberData = await memberDataItem.value;
      console.log('[LecturerTreeDataProvider] Dropping members:', memberData);

      if (!Array.isArray(memberData)) {
        return;
      }

      // Move all members to the target group
      for (const member of memberData) {
        if (member.courseId !== courseId) {
          vscode.window.showWarningMessage(`Cannot move member to a different course`);
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

      vscode.window.showInformationMessage(
        `Moved ${memberData.length} member(s) to ${groupName}`
      );

      // Refresh the tree to show changes
      await this.refresh();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to move members: ${error?.message || error}`);
    }
  }

  public async handleDrop(target: TreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    // Debug: Log all available mime types
    const mimeTypes: string[] = [];
    dataTransfer.forEach((_value, key) => {
      mimeTypes.push(key);
    });
    console.log('Available mime types:', mimeTypes);

    // Check if we have member data being dropped
    const memberData = dataTransfer.get('application/vnd.code.tree.lecturermember');

    if (memberData) {
      // Validate that we actually have member data before processing
      try {
        const memberDataValue = await memberData.value;
        if (memberDataValue && Array.isArray(memberDataValue) && memberDataValue.length > 0) {
          await this.handleMemberDrop(target, memberData);
          return;
        }
      } catch (error) {
        console.log('Invalid member data, skipping member drop handler');
      }
    }

    // Check if we have example data being dropped
    const exampleData = dataTransfer.get('application/vnd.code.tree.computorexample');

    console.log('Example data found:', !!exampleData);

    if (!exampleData || !target) {
      console.log('Missing data or target - exampleData:', !!exampleData, 'target:', !!target);
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
        const choice = await vscode.window.showWarningMessage(
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
      vscode.window.showErrorMessage('Examples can only be dropped on courses or course contents');
      return;
    }

    try {
      // First try to get data from DragDropManager (workaround for VS Code DataTransfer limitations)
      const dragDropManager = DragDropManager.getInstance();
      let draggedExamples = dragDropManager.getDraggedData();
      
      if (!draggedExamples) {
        // Fallback: try to get from DataTransfer (though this often fails)
        console.log('No data in DragDropManager, trying DataTransfer...');
        console.log('ExampleData item:', exampleData);
        
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
        
        console.log('Drag data from DataTransfer:', rawValue);
        
        if (!rawValue || rawValue === '') {
          vscode.window.showErrorMessage('No data received from drag operation. Please try again or use the context menu instead.');
          console.error('Empty drag data received');
          return;
        }
        
        // Parse the JSON string if it's a string
        draggedExamples = typeof rawValue === 'string' 
          ? JSON.parse(rawValue)
          : rawValue;
      } else {
        console.log('Successfully retrieved drag data from DragDropManager');
      }
      
      if (!Array.isArray(draggedExamples) || draggedExamples.length === 0) {
        console.error('Invalid dragged examples format:', draggedExamples);
        return;
      }

      // For simplicity, take the first dragged example
      const example = draggedExamples[0];
      
      if (!example.exampleId) {
        vscode.window.showErrorMessage('Invalid example data - missing exampleId');
        console.error('Invalid example data:', example);
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
      vscode.window.showErrorMessage(`Failed to create assignment: ${errorMessage}`);
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
          vscode.window.showErrorMessage('No data received from drag operation.');
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
        vscode.window.showErrorMessage('Invalid example data');
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
      await this.apiService.assignExampleVersionToCourseContent(
        target.courseContent.id,
        latestVersion.id
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

      vscode.window.showInformationMessage(
        `✅ Example "${example.title}" assigned to "${target.courseContent.title}" successfully!`
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      vscode.window.showErrorMessage(`Failed to assign example: ${errorMessage}`);
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
        vscode.window.showErrorMessage(
          'No submittable content types (assignments, exercises) are configured for this course. Please create one first.'
        );
        return;
      }

      // Use the first submittable type or let user choose if multiple
      let contentType = submittableTypes[0];
      if (submittableTypes.length > 1) {
        const selected = await vscode.window.showQuickPick(
          submittableTypes.map(t => ({
            label: t.title || t.slug,
            id: t.id
          })),
          { placeHolder: 'Select assignment type' }
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
        vscode.window.showErrorMessage(`A content item with path '${path}' already exists.`);
        return;
      }

      // Get position for the new content
      const position = await this.getNextPosition(courseId, parentPath);

      // Ensure we have a content type (TypeScript safety)
      if (!contentType) {
        vscode.window.showErrorMessage('No content type selected');
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
        max_submissions: 10,
        max_test_runs: 100
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
            await this.apiService.assignExampleVersionToCourseContent(
              createdContent.id,
              latestVersion.id
            );
            // Trigger assignments sync for the newly created content
            try {
              await this.apiService.generateAssignments(courseId, {
                course_content_ids: [createdContent.id],
                overwrite_strategy: 'skip_if_exists',
                commit_message: `Initialize assignment from example ${fullExample.identifier || fullExample.title}`
              });
            } catch (e) {
              console.warn('Failed to trigger assignments generation after creating content:', e);
            }
          } catch (assignError) {
            console.warn('Failed to assign example version:', assignError);
          }
        }
      }

      // Refresh the tree
      await this.forceRefreshCourse(courseId);
      
      vscode.window.showInformationMessage(
        `✅ Created assignment "${example.title}" ${targetDescription}`
      );
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      vscode.window.showErrorMessage(`Failed to create assignment: ${errorMessage}`);
    }
  }

  private async readDirectoryItems(dir: string, course: CourseList, courseContent: CourseContentList, repositoryRoot: string): Promise<TreeItem[]> {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      const items: TreeItem[] = [];
      for (const ent of entries) {
        if (ent.name === '.git') continue;
        const abs = path.join(dir, ent.name);
        const rel = ent.name;
        if (ent.isDirectory()) {
          items.push(new FSFolderItem(abs, rel, course, courseContent, repositoryRoot));
        } else {
          items.push(new FSFileItem(abs, rel, course, courseContent, repositoryRoot));
        }
      }
      // Sort folders first, then files alphabetically
      items.sort((a: any, b: any) => {
        const aIsFolder = a instanceof FSFolderItem;
        const bIsFolder = b instanceof FSFolderItem;
        if (aIsFolder && !bIsFolder) return -1;
        if (!aIsFolder && bIsFolder) return 1;
        return String(a.label).localeCompare(String(b.label));
      });
      return items;
    } catch (e) {
      console.warn('Failed to read directory:', dir, e);
      return [new InfoItem('Error reading directory', 'error')];
    }
  }
}

class FSFolderItem extends vscode.TreeItem {
  constructor(
    public absPath: string,
    public relPath: string,
    public course: CourseList,
    public courseContent: CourseContentList,
    public repositoryRoot: string
  ) {
    super(path.basename(absPath), vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('folder');
    this.resourceUri = vscode.Uri.file(absPath);
    this.contextValue = 'lecturerFsFolder';
    this.tooltip = absPath;
  }
}

class FSFileItem extends vscode.TreeItem {
  constructor(
    public absPath: string,
    public relPath: string,
    public course: CourseList,
    public courseContent: CourseContentList,
    public repositoryRoot: string
  ) {
    super(path.basename(absPath), vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('file');
    this.resourceUri = vscode.Uri.file(absPath);
    this.contextValue = 'lecturerFsFile';
    this.command = { command: 'vscode.open', title: 'Open File', arguments: [vscode.Uri.file(absPath)] };
    this.tooltip = absPath;
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
