import * as vscode from 'vscode';
import { tooltipWithDescription, withDescription } from '../../contentDescription';
import { INVISIBLE_BADGE, hiddenBadge, isHidden, isHiddenHere } from '../visibility';
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
import { hasExampleAssigned, getExampleVersionId, getReleaseState, ReleaseState } from '../../../utils/deploymentHelpers';

const ASSIGNMENT_KIND_ID = 'assignment';

/**
 * How each release state reads in the tree.
 *
 * 🔄 is reserved for `deploying` — the only state where something is actually
 * running. The two states that need the lecturer to press "Release Content"
 * carry ⚠/⏳ instead, so a stale row never looks like a stuck spinner.
 */
const RELEASE_STATE_ICONS: Record<ReleaseState, string> = {
  'deployed': '✅',
  'deploying': '🔄',
  'failed': '❌',
  'update-not-deployed': '⚠',
  'never-deployed': '⏳'
};

const RELEASE_STATE_LABELS: Record<ReleaseState, string> = {
  'deployed': 'deployed',
  'deploying': 'deploying',
  'failed': 'failed',
  'update-not-deployed': 'update not deployed',
  'never-deployed': 'not deployed yet'
};

export interface CourseContentAssignmentInfo {
  directoryName?: string;
  versionIdentifier?: string | null;
  versionTag?: string | null;
  deploymentStatus?: string | null;
  hasDeployment?: boolean;
  hasNewerVersion?: boolean;
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
    const orgTitle = organization.title || organization.path;
    super(orgTitle, collapsibleState);
    this.id = `org-${organization.id}`;
    this.contextValue = 'organization';
    this.iconPath = new vscode.ThemeIcon('organization');
    this.tooltip = `Organization: ${orgTitle}`;
    this.description = 'Organization';
  }
}

export class CourseFamilyTreeItem extends vscode.TreeItem {
  constructor(
    public readonly courseFamily: CourseFamilyList,
    public readonly organization: OrganizationList,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
  ) {
    const familyTitle = courseFamily.title || courseFamily.path;
    const orgTitle = organization.title || organization.path;
    super(familyTitle, collapsibleState);
    this.id = `family-${courseFamily.id}`;
    this.contextValue = 'courseFamily';
    this.iconPath = new vscode.ThemeIcon('folder-library');
    this.tooltip = `Course Family: ${familyTitle}\nOrganization: ${orgTitle}`;
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
    const courseTitle = course.title || course.path;
    const familyTitle = courseFamily.title || courseFamily.path;
    const orgTitle = organization.title || organization.path;
    super(courseTitle, collapsibleState);
    this.id = `course-${course.id}`;
    this.contextValue = 'course';
    this.iconPath = new vscode.ThemeIcon('book');

    // The course-wide budget defaults, shown only once set: they are the
    // bottom tier, so an assignment naming its own limit overrides them and a
    // tutor's per-student grant overrides both.
    const tooltipParts = [`Course: ${courseTitle}`, `Course Family: ${familyTitle}`, `Organization: ${orgTitle}`];
    const maxTestRuns = (course as any).max_test_runs;
    const maxSubmissions = (course as any).max_submissions;
    if (maxTestRuns != null || maxSubmissions != null) {
      tooltipParts.push(`Default test runs: ${maxTestRuns ?? 'unlimited'}`);
      tooltipParts.push(`Default submissions: ${maxSubmissions ?? 'unlimited'}`);
    }

    this.tooltip = tooltipWithDescription(tooltipParts, (course as any).description);

    // Set description to indicate this is a Course
    this.description = 'Course';
    withDescription(this, courseTitle, (course as any).description);
  }
}

/**
 * The single place that decides whether a lecturer course-content row gets an
 * expand arrow. A row is collapsible when it has child contents — nothing else.
 *
 * Assignments are leaves. They used to expand into their local assignment
 * directory; that listing is gone, and `isSubmittable` must never re-enter this
 * decision. The rule flipped three times (c58dc3e made assignments leaves,
 * 713de01 made them expandable again) because the same expression lived in three
 * places that drifted apart. They all call this now.
 */
export function courseContentCollapsibleState(options: {
  hasChildren: boolean;
  expanded?: boolean;
}): vscode.TreeItemCollapsibleState {
  if (!options.hasChildren) {
    return vscode.TreeItemCollapsibleState.None;
  }
  return options.expanded
    ? vscode.TreeItemCollapsibleState.Expanded
    : vscode.TreeItemCollapsibleState.Collapsed;
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
      options.collapsibleState ?? courseContentCollapsibleState({ hasChildren: options.hasChildren })
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
    withDescription(
      this,
      this.courseContent.title || this.courseContent.path,
      (this.courseContent as any).description
    );
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
    const isAssignment = this.contentType?.course_content_kind_id === ASSIGNMENT_KIND_ID;
    
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

    if (this.assignmentInfo?.hasNewerVersion) {
      parts.push('newerVersionAvailable');
    }

    if ('archived_at' in this.courseContent && this.courseContent.archived_at) {
      parts.push('archived');
    }

    // 'hidden' marks any hidden row; 'hiddenHere' only the one that can be
    // shown again, since flipping a row under a hidden parent changes nothing.
    if (isHidden(this.courseContent as any)) {
      parts.push('hidden');
      if (isHiddenHere(this.courseContent as any)) {
        parts.push('hiddenHere');
      }
    }

    return parts.join('.');
  }

  private getIcon(): vscode.ThemeIcon | vscode.Uri {
    // Use the color from contentType, or grey as default
    const color = this.contentType?.color || 'grey';
    
    try {
      // Determine shape based on course_content_kind_id
      // 'assignment' gets square, 'unit' (or anything else) gets circle
      const shape = this.contentType?.course_content_kind_id === ASSIGNMENT_KIND_ID ? 'square' : 'circle';
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

  private getReleaseState(): ReleaseState | undefined {
    return getReleaseState(this.courseContent, this.assignmentInfo?.deploymentStatus);
  }

  private getTooltip(): string | vscode.MarkdownString {
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

    const releaseState = this.getReleaseState();
    if (releaseState) {
      parts.push(`Status: ${RELEASE_STATE_LABELS[releaseState]}`);
      // Naming the command matters: the state is cleared by a button the
      // lecturer has to find, not by waiting for something to finish.
      if (releaseState === 'update-not-deployed' || releaseState === 'never-deployed') {
        parts.push('Run "Release Content" to deploy it to students');
      }
    } else if (hasExampleAssigned(this.courseContent)) {
      parts.push('Status: not deployed yet');
    }

    // Budgets a student works against. Spelled out here because the
    // description only has room for the compact pair.
    const maxTestRuns = (this.courseContent as any).max_test_runs;
    const maxSubmissions = (this.courseContent as any).max_submissions;
    if (maxTestRuns != null || maxSubmissions != null) {
      parts.push(`Test runs: ${maxTestRuns ?? 'unlimited'}`);
      parts.push(`Submissions: ${maxSubmissions ?? 'unlimited'}`);
    }

    const tooltip = tooltipWithDescription(
      parts.length > 0 ? parts : [this.courseContent.path],
      (this.courseContent as any).description
    );
    return tooltip;
  }

  private getDescription(): string | undefined {
    const parts: string[] = [];
    const isAssignment = this.contentType?.course_content_kind_id === ASSIGNMENT_KIND_ID;
    const assignment = this.assignmentInfo;

    if (isAssignment) {
      // Fall back to the never-released wording when the status is missing, so a
      // content row never loses its badge entirely.
      const releaseState = this.getReleaseState() ?? 'never-deployed';
      parts.push(`${RELEASE_STATE_ICONS[releaseState]} ${RELEASE_STATE_LABELS[releaseState]}`);

      if (assignment?.hasNewerVersion) {
        parts.push('⬆ update available');
      }

      // Make configured limits visible in the tree — a lecturer could
      // previously only discover them by opening the assignment.
      const maxTestRuns = (this.courseContent as any).max_test_runs;
      const maxSubmissions = (this.courseContent as any).max_submissions;
      if (maxTestRuns != null || maxSubmissions != null) {
        parts.push(`⛔ ${maxTestRuns ?? '∞'}T/${maxSubmissions ?? '∞'}S`);
      }
    }

    if ('archived_at' in this.courseContent && this.courseContent.archived_at) {
      parts.push('📦 Archived');
    }

    // Students cannot see this (issue #338). Lecturers keep the row -- this is
    // what tells them their students do not have it. The "above" variant means
    // a unit further up, or the course itself, is what hid it.
    const hidden = hiddenBadge(this.courseContent as any);
    if (hidden) {
      parts.push(hidden);
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
      'contentTypes': 'Reusable labels (title, color, kind) that course content is tagged with. Creating one does not create any content.',
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

    // Course-level visibility lives on the Contents folder rather than on the
    // course row: it hides the course's content tree, not the course itself,
    // and putting "hide everything" on the course node reads too much like
    // archiving or removing the course (issue #338).
    if (folderType === 'contents') {
      // Only a suffix is added, never a replacement: existing menus match
      // `course.contents` and must keep working.
      if (course.visible === false) {
        this.contextValue = 'course.contents.hidden';
        this.description = INVISIBLE_BADGE;
        this.tooltip = 'Students see no content in this course. '
          + 'Individual units and assignments can also be hidden on their own.';
      }
    }
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
  return user?.email || `User ${member.user_id.slice(0, 8)}`;
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
