import * as vscode from 'vscode';
import {
  OrganizationList,
  CourseFamilyList,
  CourseList,
  CourseContentList,
  CourseContentLecturerList,
  CourseContentTypeList,
  ExampleList,
  ExampleGet,
  ExampleVersionGet,
  CourseGroupList,
  CourseMemberList
} from '../../../types/generated';
import { IconGenerator } from '../../../utils/IconGenerator';
import { hasExampleAssigned, getExampleVersionId, getDeploymentStatus } from '../../../utils/deploymentHelpers';

export interface CourseContentAssignmentInfo {
  directoryName?: string;
  versionIdentifier?: string | null;
  versionTag?: string | null;
  deploymentStatus?: string | null;
  hasDeployment?: boolean;
  hasLocalChanges?: boolean;
  folderExists?: boolean;
  statusMessage?: { message: string; severity: 'info' | 'warning' | 'error' };
  commitMissing?: boolean;
  diffError?: string;
}

export class OrganizationTreeItem extends vscode.TreeItem {
  constructor(
    public readonly organization: OrganizationList,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
  ) {
    super(organization.title || organization.path, collapsibleState);
    this.id = `org-${organization.id}`;
    this.contextValue = 'organization';
    this.iconPath = new vscode.ThemeIcon('organization');
    this.tooltip = organization.title || organization.path;
    this.description = 'Organization';
  }
}

export class CourseFamilyTreeItem extends vscode.TreeItem {
  constructor(
    public readonly courseFamily: CourseFamilyList,
    public readonly organization: OrganizationList,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
  ) {
    super(courseFamily.title || courseFamily.path, collapsibleState);
    this.id = `family-${courseFamily.id}`;
    this.contextValue = 'courseFamily';
    this.iconPath = new vscode.ThemeIcon('folder-library');
    this.tooltip = courseFamily.title || courseFamily.path;
    this.description = 'Course Family';
  }
}

export class CourseTreeItem extends vscode.TreeItem {
  constructor(
    public readonly course: CourseList,
    public readonly courseFamily: CourseFamilyList,
    public readonly organization: OrganizationList,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
  ) {
    super(course.title || course.path, collapsibleState);
    this.id = `course-${course.id}`;
    this.contextValue = 'course';
    this.iconPath = new vscode.ThemeIcon('book');
    this.tooltip = course.title || course.path;
    
    // Set description to indicate this is a Course
    this.description = 'Course';
  }
}

export interface CourseContentTreeItemOptions {
  courseContent: CourseContentList | CourseContentLecturerList;
  course: CourseList;
  courseFamily: CourseFamilyList;
  organization: OrganizationList;
  hasChildren: boolean;
  exampleInfo?: ExampleGet | null;
  contentType?: CourseContentTypeList;
  isSubmittable?: boolean;
  exampleVersionInfo?: ExampleVersionGet | null;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  assignmentInfo?: CourseContentAssignmentInfo;
  assignmentDirectory?: string;
}

export class CourseContentTreeItem extends vscode.TreeItem {
  public readonly courseContent: CourseContentList | CourseContentLecturerList;
  public readonly course: CourseList;
  public readonly courseFamily: CourseFamilyList;
  public readonly organization: OrganizationList;
  public readonly hasChildren: boolean;
  public readonly exampleInfo?: ExampleGet | null;
  public readonly contentType?: CourseContentTypeList;
  public readonly isSubmittable: boolean;
  public readonly exampleVersionInfo?: ExampleVersionGet | null;
  public assignmentInfo?: CourseContentAssignmentInfo;
  public assignmentDirectory?: string;

  constructor(options: CourseContentTreeItemOptions) {
    super(
      options.courseContent.title || options.courseContent.path,
      options.collapsibleState !== undefined ? options.collapsibleState :
        (options.hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None)
    );

    this.courseContent = options.courseContent;
    this.course = options.course;
    this.courseFamily = options.courseFamily;
    this.organization = options.organization;
    this.hasChildren = options.hasChildren;
    this.exampleInfo = options.exampleInfo;
    this.contentType = options.contentType;
    this.isSubmittable = options.isSubmittable ?? false;
    this.exampleVersionInfo = options.exampleVersionInfo;
    this.assignmentInfo = options.assignmentInfo;
    this.assignmentDirectory = options.assignmentDirectory;

    this.id = `content-${options.courseContent.id}`;
    if (!this.assignmentDirectory && this.assignmentInfo?.directoryName) {
      this.assignmentDirectory = this.assignmentInfo.directoryName;
    }

    this.contextValue = this.getContextValue();
    this.iconPath = this.getIcon();
    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
  }

  private getContextValue(): string {
    const parts = ['courseContent'];
    
    // Add submittable/nonSubmittable to make the distinction clear
    if (this.isSubmittable) {
      parts.push('submittable');
    } else {
      parts.push('nonSubmittable');
    }
    
    // Check if it's an assignment based on course_content_kind_id
    const isAssignment = this.contentType?.course_content_kind_id === 'assignment';
    
    if (isAssignment) {
      parts.push('assignment');
      if (hasExampleAssigned(this.courseContent)) {
        parts.push('hasExample');
      } else {
        parts.push('noExample');
      }
    }
    
    if (this.hasChildren) {
      parts.push('hasChildren');
    }
    
    if (this.assignmentInfo?.hasLocalChanges) {
      parts.push('localChanges');
    }

    if (this.assignmentInfo && this.assignmentInfo.folderExists === false) {
      parts.push('missingFolder');
    }
    
    return parts.join('.');
  }

  private getIcon(): vscode.ThemeIcon | vscode.Uri {
    // Use the color from contentType, or grey as default
    const color = this.contentType?.color || 'grey';
    
    try {
      // Determine shape based on course_content_kind_id
      // 'assignment' gets square, 'unit' (or anything else) gets circle
      const shape = this.contentType?.course_content_kind_id === 'assignment' ? 'square' : 'circle';
      return IconGenerator.getColoredIcon(color, shape);
    } catch {
      // Fallback to default theme icons if icon generation fails
      if (hasExampleAssigned(this.courseContent)) {
        return new vscode.ThemeIcon('file-code');
      } else if (this.hasChildren) {
        return new vscode.ThemeIcon('folder');
      } else {
        return new vscode.ThemeIcon('file');
      }
    }
  }

  private getTooltip(): string {
    const parts: string[] = [];
    
    if (this.courseContent.title) {
      parts.push(this.courseContent.title);
    }
    
    if (hasExampleAssigned(this.courseContent)) {
      // Show example title if available
      if (this.exampleInfo?.title) {
        parts.push(`Example: ${this.exampleInfo.title}`);
      }
      const versionId = getExampleVersionId(this.courseContent);
      if (versionId) {
        if (this.exampleVersionInfo) {
          parts.push(`Version tag: ${this.exampleVersionInfo.version_tag || 'unknown'}`);
        } else {
          parts.push('Version tag: loading...');
        }
      } else {
        parts.push('Version tag: <not set>');
      }
    }

    if (this.assignmentInfo?.directoryName) {
      parts.push(`Directory: ${this.assignmentInfo.directoryName}`);
    } else if (this.assignmentDirectory) {
      parts.push(`Directory: ${this.assignmentDirectory}`);
    }

    if (this.assignmentInfo?.versionIdentifier) {
      parts.push(`Deployment commit: ${this.assignmentInfo.versionIdentifier}`);
    }

    if (this.assignmentInfo?.versionTag) {
      parts.push(`Version tag: ${this.assignmentInfo.versionTag}`);
    }

    if (this.assignmentInfo?.hasLocalChanges) {
      parts.push('Local changes detected since last deployment');
    }

    if (this.assignmentInfo && this.assignmentInfo.folderExists === false) {
      parts.push('Assignment directory missing locally');
    }

    if (this.assignmentInfo?.commitMissing) {
      parts.push('Deployment commit not found locally');
    }

    if (this.assignmentInfo?.statusMessage) {
      parts.push(`${this.assignmentInfo.statusMessage.severity.toUpperCase()}: ${this.assignmentInfo.statusMessage.message}`);
    }

    if (this.assignmentInfo?.diffError) {
      parts.push(`Diff error: ${this.assignmentInfo.diffError}`);
    }
    
    return parts.join('\n') || this.courseContent.path;
  }

  private getDescription(): string | undefined {
    const parts: string[] = [];
    const isAssignment = this.contentType?.course_content_kind_id === 'assignment';
    const assignment = this.assignmentInfo;

    if (isAssignment) {
      const statusIcons: Record<string, string> = {
        pending: '⏳',
        in_progress: '🔄',
        deployed: '✅',
        failed: '❌',
        pending_release: '📤',
        assigned: '📎',
        deploying: '🔄',
        released: '🚀'
      };
      const statusLabels: Record<string, string> = {
        pending: 'pending',
        in_progress: 'in progress',
        deployed: 'deployed',
        failed: 'failed',
        pending_release: 'pending release',
        assigned: 'assigned',
        deploying: 'deploying',
        released: 'released'
      };

      const deploymentStatus = assignment?.deploymentStatus || getDeploymentStatus(this.courseContent);
      if (deploymentStatus) {
        const icon = statusIcons[deploymentStatus] || '❓';
        const label = statusLabels[deploymentStatus] || deploymentStatus.replace(/_/g, ' ');
        parts.push(`${icon} ${label}`);
      } else if (assignment?.hasDeployment) {
        parts.push('✅ deployed');
      }

      if (assignment && assignment.folderExists === false) {
        parts.push('⚠ not synced');
      }

      if (assignment?.hasDeployment && assignment.hasLocalChanges) {
        parts.push('✏️ changes');
      }

      if (assignment?.commitMissing) {
        parts.push('⚠ commit missing');
      }

      if (assignment?.statusMessage && assignment.statusMessage.severity !== 'info') {
        const icon = assignment.statusMessage.severity === 'error' ? '❌' : '⚠';
        parts.push(`${icon} ${assignment.statusMessage.message}`);
      }
    }

    return parts.length > 0 ? parts.join(' • ') : undefined;
  }
}

export class ExampleTreeItem extends vscode.TreeItem {
  constructor(
    public readonly example: ExampleList,
    public readonly courseContent: CourseContentTreeItem
  ) {
    super(example.title, vscode.TreeItemCollapsibleState.None);
    this.id = `example-${example.id}`;
    this.contextValue = 'example';
    this.iconPath = new vscode.ThemeIcon('package');
    this.tooltip = example.title;
    this.description = 'latest';
  }
}

// Folder nodes for organizing course sub-items
export class CourseFolderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly folderType: 'contents' | 'contentTypes' | 'groups',
    public readonly course: CourseList,
    public readonly courseFamily: CourseFamilyList,
    public readonly organization: OrganizationList,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
  ) {
    const labels = {
      'contents': 'Contents',
      'contentTypes': 'Content Types',
      'groups': 'Groups'
    };
    
    const icons = {
      'contents': 'folder',
      'contentTypes': 'symbol-class',
      'groups': 'organization'
    };
    
    const tooltips = {
      'contents': 'Course contents organized in a tree structure',
      'contentTypes': 'Content types define the kinds of content in this course',
      'groups': 'Course groups and their members'
    };
    
    super(
      labels[folderType],
      collapsibleState
    );
    this.id = `${folderType}-${course.id}`;
    this.contextValue = `course.${folderType}`;
    this.iconPath = new vscode.ThemeIcon(icons[folderType]);
    this.tooltip = tooltips[folderType];
  }
}

// Course Content Type item
export class CourseContentTypeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly contentType: CourseContentTypeList,
    public readonly course: CourseList,
    public readonly courseFamily: CourseFamilyList,
    public readonly organization: OrganizationList,
    public readonly contentKindTitle?: string
  ) {
    super(contentType.title || contentType.slug, vscode.TreeItemCollapsibleState.None);
    this.id = `contentType-${contentType.id}`;
    this.contextValue = 'courseContentType';
    
    // Use colored icon if color is available
    if (contentType.color) {
      try {
        this.iconPath = IconGenerator.getColoredIcon(contentType.color, 'square');
      } catch {
        // Fallback to default icon if color generation fails
        this.iconPath = new vscode.ThemeIcon('symbol-enum');
      }
    } else {
      this.iconPath = new vscode.ThemeIcon('symbol-enum');
    }
    
    this.tooltip = `${contentType.title || contentType.slug}\nSlug: ${contentType.slug}`;
    
    // Show content kind title as description if available
    if (contentKindTitle) {
      this.description = contentKindTitle;
    }
  }
}

// Course Group item
export class CourseGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly group: CourseGroupList,
    public readonly course: CourseList,
    public readonly courseFamily: CourseFamilyList,
    public readonly organization: OrganizationList,
    public readonly memberCount: number = 0,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
  ) {
    super(
      group.title || `Group ${group.id.slice(0, 8)}`,
      collapsibleState
    );
    this.id = `group-${group.id}`;
    this.contextValue = 'course.group';
    this.iconPath = new vscode.ThemeIcon('symbol-array');
    this.tooltip = `Group: ${group.title || group.id}\nMembers: ${memberCount}`;
    this.description = memberCount > 0 ? `${memberCount} members` : 'No members';
  }
}

// Virtual "No Group" item for ungrouped members
export class NoGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly course: CourseList,
    public readonly courseFamily: CourseFamilyList,
    public readonly organization: OrganizationList,
    public readonly memberCount: number = 0,
    public readonly providedCollapsibleState?: vscode.TreeItemCollapsibleState
  ) {
    super(
      'No Group',
      providedCollapsibleState !== undefined ? providedCollapsibleState :
        (memberCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None)
    );
    this.id = `no-group-${course.id}`;
    this.contextValue = 'course.noGroup';
    this.iconPath = new vscode.ThemeIcon('person');
    this.tooltip = `Members not assigned to any group: ${memberCount}`;
    this.description = memberCount > 0 ? `${memberCount} members` : 'No members';
  }
}

// Course Member item
export class CourseMemberTreeItem extends vscode.TreeItem {
  constructor(
    public readonly member: CourseMemberList,
    public readonly course: CourseList,
    public readonly courseFamily: CourseFamilyList,
    public readonly organization: OrganizationList,
    public readonly group?: CourseGroupList,
    public readonly roleTitle?: string
  ) {
    const displayName = formatMemberDisplayName(member);
    super(
      displayName,
      vscode.TreeItemCollapsibleState.None
    );
    this.id = `member-${member.id}`;
    this.contextValue = 'course.member';
    this.iconPath = new vscode.ThemeIcon('account');

    const tooltipParts = [`${displayName}`];

    if (member.user?.email) {
      tooltipParts.push(`Email: ${member.user.email}`);
    }
    if (member.user?.username) {
      tooltipParts.push(`Username: ${member.user.username}`);
    }
    if (roleTitle) {
      tooltipParts.push(`Role: ${roleTitle}`);
    }
    if (group) {
      tooltipParts.push(`Group: ${group.title || group.id}`);
    }

    this.tooltip = tooltipParts.join('\n');
    this.description = roleTitle || undefined;
  }
}

export function formatMemberDisplayName(member: CourseMemberList): string {
  const user = member.user;
  if (user?.family_name && user?.given_name) {
    return `${user.family_name} ${user.given_name}`;
  }
  if (user?.family_name) {
    return user.family_name;
  }
  if (user?.given_name) {
    return user.given_name;
  }
  return user?.username || user?.email || `User ${member.user_id.slice(0, 8)}`;
}

export function compareMembersByName(a: CourseMemberList, b: CourseMemberList): number {
  const nameA = formatMemberDisplayName(a).toLowerCase();
  const nameB = formatMemberDisplayName(b).toLowerCase();
  return nameA.localeCompare(nameB);
}

export class LoadMoreTreeItem extends vscode.TreeItem {
  constructor(
    public readonly parentId: string,
    public readonly parentType: string,
    public readonly currentOffset: number,
    public readonly pageSize: number = 20
  ) {
    super('Load more...', vscode.TreeItemCollapsibleState.None);
    this.id = `loadmore-${parentId}-${currentOffset}`;
    this.contextValue = 'loadMore';
    this.iconPath = new vscode.ThemeIcon('ellipsis');
    this.tooltip = `Load ${pageSize} more items`;
    this.command = {
      command: 'computor.loadMoreItems',
      title: 'Load More',
      arguments: [this]
    };
  }
}
