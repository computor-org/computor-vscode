import * as vscode from 'vscode';
import type {
  DocumentEntry,
  DocumentScope,
  DocumentSyncState
} from '../../../services/DocumentsCacheService';
import type {
  OrganizationList,
  CourseFamilyList,
  CourseList
} from '../../../types/generated';

export type DocumentsTreeItem =
  | DocumentsOrgItem
  | DocumentsCourseFamilyItem
  | DocumentsCourseItem
  | DocumentsDirectoryItem
  | DocumentsFileItem
  | DocumentsLoadingItem
  | DocumentsEmptyItem
  | DocumentsErrorItem;

// ----- Status / utility rows -----

export class DocumentsLoadingItem extends vscode.TreeItem {
  constructor(message: string = 'Loading…') {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.contextValue = 'documents.loading';
  }
}

export class DocumentsEmptyItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('inbox');
    this.contextValue = 'documents.empty';
  }
}

export class DocumentsErrorItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    this.contextValue = 'documents.error';
  }
}

// ----- Entity rows (org / family / course) -----
//
// These mirror the lecturer course tree. Expanding an entity row yields its
// child entities followed by the documents at that scope's root. The
// `scope` field on each entity drives all subsequent document listings under
// it.
//
// System-scope files/directories live directly at the tree root (no
// dedicated System node) — the provider mixes them into getRootChildren()
// so they appear next to the org rows.

export class DocumentsOrgItem extends vscode.TreeItem {
  public readonly scope: DocumentScope = { scope: 'organization', scopeId: '' };

  constructor(public readonly organization: OrganizationList) {
    super(organization.title || organization.path, vscode.TreeItemCollapsibleState.Collapsed);
    this.scope = { scope: 'organization', scopeId: organization.id };
    this.id = `documents-org-${organization.id}`;
    this.iconPath = new vscode.ThemeIcon('organization');
    this.tooltip = `Organization · ${organization.path}`;
    this.contextValue = 'documents.scope.organization';
  }
}

export class DocumentsCourseFamilyItem extends vscode.TreeItem {
  public readonly scope: DocumentScope;

  constructor(
    public readonly courseFamily: CourseFamilyList,
    public readonly organization: OrganizationList
  ) {
    super(courseFamily.title || courseFamily.path, vscode.TreeItemCollapsibleState.Collapsed);
    this.scope = { scope: 'course_family', scopeId: courseFamily.id };
    this.id = `documents-family-${courseFamily.id}`;
    this.iconPath = new vscode.ThemeIcon('folder-library');
    this.tooltip = `Course family · ${courseFamily.path}`;
    this.contextValue = 'documents.scope.course_family';
  }
}

export class DocumentsCourseItem extends vscode.TreeItem {
  public readonly scope: DocumentScope;

  constructor(
    public readonly course: CourseList,
    public readonly courseFamily: CourseFamilyList,
    public readonly organization: OrganizationList
  ) {
    super(course.title || course.path, vscode.TreeItemCollapsibleState.Collapsed);
    this.scope = { scope: 'course', scopeId: course.id };
    this.id = `documents-course-${course.id}`;
    this.iconPath = new vscode.ThemeIcon('mortar-board');
    this.tooltip = `Course · ${course.path}`;
    this.contextValue = 'documents.scope.course';
  }
}

// ----- Document rows -----

export class DocumentsDirectoryItem extends vscode.TreeItem {
  constructor(
    public readonly scope: DocumentScope,
    public readonly entry: DocumentEntry
  ) {
    super(entry.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `documents-dir-${scope.scope}-${scope.scopeId ?? 'system'}-${entry.relativePath}`;
    this.resourceUri = entry.local
      ? vscode.Uri.file(entry.local.absPath)
      : undefined;
    this.iconPath = vscode.ThemeIcon.Folder;
    this.contextValue = entry.state === 'local-only'
      ? 'documents.dir.localOnly'
      : 'documents.dir';
    this.tooltip = describeTooltip(entry);
  }
}

export class DocumentsFileItem extends vscode.TreeItem {
  constructor(
    public readonly scope: DocumentScope,
    public readonly entry: DocumentEntry
  ) {
    super(entry.name, vscode.TreeItemCollapsibleState.None);
    this.id = `documents-file-${scope.scope}-${scope.scopeId ?? 'system'}-${entry.relativePath}`;
    this.resourceUri = entry.local
      ? vscode.Uri.file(entry.local.absPath)
      : undefined;
    this.iconPath = vscode.ThemeIcon.File;
    this.description = describeStateBadge(entry.state);
    this.tooltip = describeTooltip(entry);
    this.contextValue = `documents.file.${stateContextSuffix(entry.state)}`;
    this.command = {
      command: 'computor.lecturer.documents.openFile',
      title: 'Open Document',
      arguments: [this]
    };
  }
}

function stateContextSuffix(state: DocumentSyncState): string {
  switch (state) {
    case 'synced': return 'synced';
    case 'modified': return 'modified';
    case 'local-only': return 'localOnly';
    case 'remote-only': return 'remoteOnly';
    case 'remote-changed': return 'remoteChanged';
  }
}

/**
 * Every badge here compares one place against another, so it only means
 * something once you know which two: the published documents store on the
 * server, and this workspace's copy of it. "· remote" said neither
 * (computor-org/issues#361) — and on a fresh workspace it is what every row
 * says, because nothing has been copied down yet.
 */
function describeStateBadge(state: DocumentSyncState): string | undefined {
  switch (state) {
    case 'synced': return undefined;
    case 'modified': return '● changed here';
    case 'local-only': return '● not published';
    case 'remote-only': return '· on server';
    case 'remote-changed': return '⟳ newer on server';
  }
}

function describeTooltip(entry: DocumentEntry): string {
  const lines: string[] = [entry.relativePath];
  switch (entry.state) {
    case 'synced':
      lines.push('Published, and this workspace has the same version.');
      break;
    case 'modified':
      lines.push('Changed in this workspace. Upload to publish your version.');
      break;
    case 'local-only':
      lines.push('Only in this workspace. Upload to publish it.');
      break;
    case 'remote-only':
      lines.push('Published on the server; this workspace has no copy yet. Click to fetch one.');
      break;
    case 'remote-changed':
      lines.push('The published version moved past your copy. Fetch it again to catch up.');
      break;
  }
  lines.push('Published documents are served under /docs — use "Copy Public URL" for the address.');
  if (entry.remote?.lastModified) {
    try {
      lines.push(`Last modified: ${new Date(entry.remote.lastModified).toLocaleString()}`);
    } catch {
      lines.push(`Last modified: ${entry.remote.lastModified}`);
    }
  }
  if (entry.remote?.size != null) {
    lines.push(`Size: ${entry.remote.size} bytes`);
  }
  return lines.join('\n');
}
