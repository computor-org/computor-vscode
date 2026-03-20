import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { TutorSelectionService } from '../../../services/TutorSelectionService';
import type { WebSocketService } from '../../../services/WebSocketService';
import { IconGenerator } from '../../../utils/IconGenerator';
import { CourseContentStudentList, CourseContentKindList, SubmissionGroupStudentList } from '../../../types/generated';
import { deriveRepositoryDirectoryName, buildReviewRepoRoot } from '../../../utils/repositoryNaming';
import { extractGraderName } from '../../../utils/gradingHelpers';
import { CTGit } from '../../../git/CTGit';
import { WorkspaceStructureManager } from '../../../utils/workspaceStructure';

function getEmbeddedCourseContentType(courseContent: any): any | undefined {
  const ct = courseContent?.course_content_type ?? courseContent?.course_content_types;
  if (!ct) return undefined;
  return Array.isArray(ct) ? ct[0] : ct;
}

function normalizeStatus(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim().toLowerCase();
  return s ? s : undefined;
}

export class TutorStudentTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private contentKinds: CourseContentKindList[] = [];

  // Content ID that should be expanded on next getChildren call (one-time trigger)
  private pendingExpandContentId?: string;
  // Content ID whose virtual folders (Reference, Submissions) should be expanded (one-time trigger)
  private pendingExpandVirtualFoldersForContentId?: string;

  // Expansion state cache - persists until user collapses manually
  private expandedContentIds = new Set<string>();
  private expandedVirtualFolderIds = new Set<string>();
  private expandedSubmissionIds = new Set<string>();
  private wsService?: WebSocketService;
  private subscribedCourseChannel?: string;

  constructor(private api: ComputorApiService, private selection: TutorSelectionService) {
    selection.onDidChangeSelection(() => this.refresh());
  }

  setWebSocketService(wsService: WebSocketService): void {
    this.wsService = wsService;
  }

  private subscribeToCourseChannel(courseId: string): void {
    if (!this.wsService) return;
    const channel = `course:${courseId}`;
    if (this.subscribedCourseChannel === channel) return;

    // Unsubscribe from previous course channel
    if (this.subscribedCourseChannel) {
      this.wsService.unsubscribe([this.subscribedCourseChannel], 'tutor-tree');
    }

    this.subscribedCourseChannel = channel;
    this.wsService.subscribe([channel], 'tutor-tree', {
      onDeploymentStatusChanged: (event) => {
        console.log(`[TutorTree/WS] Deployment status changed: ${event.course_content_id} -> ${event.new_status}`);
        if (event.new_status === 'deployed' || event.new_status === 'failed') {
          this.refresh();
        }
      },
      onDeploymentAssigned: (event) => {
        console.log(`[TutorTree/WS] Deployment assigned: ${event.course_content_id}`);
        this.refresh();
      },
      onDeploymentUnassigned: (event) => {
        console.log(`[TutorTree/WS] Deployment unassigned: ${event.course_content_id}`);
        this.refresh();
      },
      onCourseContentUpdated: (event) => {
        console.log(`[TutorTree/WS] Course content updated: ${event.course_content_id} (${event.change_type})`);
        this.refresh();
      },
    });
  }

  /**
   * Handle collapse event from TreeView - remove from expansion cache
   */
  handleCollapse(element: vscode.TreeItem): void {
    const id = element.id;
    if (!id) return;
    // Extract base ID (remove :expanded:timestamp suffix if present)
    const baseId = id.replace(/:expanded:\d+$/, '');
    this.expandedContentIds.delete(baseId);
    this.expandedVirtualFolderIds.delete(baseId);
    this.expandedSubmissionIds.delete(baseId);
  }

  refresh(): void { this._onDidChangeTreeData.fire(undefined); }

  /**
   * Mark a content item to be expanded (with its virtual folders visible) after refresh.
   * The item will be created with collapsibleState.Expanded and a temporary unique ID
   * to force VS Code to treat it as a new item and respect the expansion state.
   * The Reference and Submissions virtual folders will also be expanded.
   */
  markForVirtualFolderExpansion(contentId: string): void {
    this.pendingExpandContentId = contentId;
    this.pendingExpandVirtualFoldersForContentId = contentId;
  }

  // Allow targeted refresh of a specific element
  refreshItem(element: vscode.TreeItem): void { this._onDidChangeTreeData.fire(element); }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const courseId = this.selection.getCurrentCourseId();
    const memberId = this.selection.getCurrentMemberId();

    if (!courseId) {
      return [new MessageItem('Select a course to begin', 'info')];
    }
    if (!memberId) {
      return [new MessageItem('Select a member to view content', 'info')];
    }

    // Ensure kinds
    if (this.contentKinds.length === 0) {
      this.contentKinds = await this.api.getCourseContentKinds() || [];
    }

    if (!element) {
      // Subscribe to WS channel for the selected course
      this.subscribeToCourseChannel(courseId);

      // Root: show selection context headers, then course contents
      const memberLabel = this.selection.getCurrentMemberLabel() || memberId;
      const memberGroupLabel = this.selection.getMemberCourseGroupLabel();
      const headerItems: vscode.TreeItem[] = [
        new TutorSelectionMemberItem(memberLabel, this.selection.getMemberEmail(), this.selection.getMemberUsername()),
        new TutorSelectionGroupItem(memberGroupLabel || 'No Group')
      ];

      const courseContents = await (this.api as any).getTutorCourseContents?.(courseId, memberId) || [];
      if (courseContents.length === 0) return [...headerItems, new MessageItem('No content available', 'info')];
      const tree = this.buildContentTree(courseContents, this.contentKinds);
      return [...headerItems, ...this.createTreeItems(tree, memberId)];
    }

    if (element instanceof TutorUnitItem) {
      return this.createTreeItems(element.node, memberId);
    }

    if (element instanceof TutorContentItem) {
      return this.getAssignmentDirectoryChildren(element, courseId, memberId);
    }

    if (element instanceof TutorVirtualFolderItem) {
      return this.getVirtualFolderChildren(element);
    }

    if (element instanceof TutorSubmissionItem) {
      return this.getSubmissionItemChildren(element);
    }

    if (element instanceof TutorFsFolderItem) {
      return this.readDirectoryItems(element.absPath, element.courseId, element.memberId, element.repositoryRoot, element.content, element.folderType);
    }

    return [];
  }

  // Tree building similar to student provider
  private buildContentTree(contents: CourseContentStudentList[], kinds: CourseContentKindList[]): ContentNode {
    const root: ContentNode = { children: new Map(), isUnit: false };
    const kindMap = new Map<string, CourseContentKindList>();
    kinds.forEach(k => kindMap.set(k.id, k));

    // Sort by path depth first (shorter paths = higher in tree), then by position
    const sortedContents = [...contents].sort((a, b) => {
      const aDepth = (a.path.match(/\./g) || []).length;
      const bDepth = (b.path.match(/\./g) || []).length;
      if (aDepth !== bDepth) {
        return aDepth - bDepth;
      }
      return a.position - b.position;
    });

    // Create a map to track all content items by their path for parent-child lookup
    const contentMap = new Map<string, ContentNode>();

    for (const content of sortedContents) {
      const ct: any = getEmbeddedCourseContentType(content);
      const contentKind = ct ? kindMap.get(ct.course_content_kind_id) : undefined;
      const submissionGroup = content.submission_group || undefined;
      const isUnit = contentKind ? !!contentKind.has_descendants : false;

      const node: ContentNode = {
        name: content.title || content.path.split('.').pop() || content.path,
        children: new Map(),
        courseContent: content,
        contentKind,
        isUnit,
        unreadMessageCount: (content as any).unread_message_count ?? 0,
        unreviewedCount: (content as any).unreviewed_count ?? 0,
        submissionGroup,
      };

      contentMap.set(content.path, node);

      // Find parent path and attach to parent or root
      const pathParts = content.path.split('.');
      if (pathParts.length === 1) {
        // Top-level item, add directly to root
        root.children.set(content.path, node);
      } else {
        // Find parent by removing the last part of the path
        const parentPath = pathParts.slice(0, -1).join('.');
        const parentNode = contentMap.get(parentPath);
        if (parentNode) {
          parentNode.children.set(content.path, node);
        } else {
          // Parent doesn't exist in API response, add to root
          root.children.set(content.path, node);
        }
      }
    }

    this.aggregateUnreadCounts(root);
    this.aggregateUnitDecorations(root);
    return root;
  }

  private aggregateUnreadCounts(node: ContentNode): number {
    const ownUnread = (node.courseContent as any)?.unread_message_count ?? 0;
    let total = ownUnread;

    node.children.forEach((child) => {
      total += this.aggregateUnreadCounts(child);
    });

    node.unreadMessageCount = total;
    return total;
  }

  private aggregateUnitDecorations(node: ContentNode): { color?: string } {
    const ct = getEmbeddedCourseContentType(node.courseContent);
    let bestColor: string | undefined = ct?.color || (node.courseContent as any)?.color;

    node.children.forEach(child => {
      const aggregated = this.aggregateUnitDecorations(child);

      if (!bestColor && aggregated.color) {
        bestColor = aggregated.color;
      }
    });

    (node as any).aggregatedColor = bestColor;
    return { color: bestColor };
  }

  private createTreeItems(node: ContentNode, memberId: string): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    const entries = Array.from(node.children.entries()).sort((a, b) => {
      const an = a[1];
      const bn = b[1];
      const ap = an.courseContent?.position;
      const bp = bn.courseContent?.position;
      if (typeof ap === 'number' && typeof bp === 'number') return ap - bp;
      return a[0].localeCompare(b[0]);
    });
    for (const [, child] of entries) {
      if (child.isUnit) {
        items.push(new TutorUnitItem(child));
      } else if (child.courseContent) {
        const isAssignment = this.isAssignmentContent(child.courseContent);
        const hasRepository = isAssignment ? this.hasLocalRepository(child.courseContent, memberId) : false;
        // Check if this content should be expanded (pending trigger or cached)
        const contentId = child.courseContent.id;
        const isPendingExpand = this.pendingExpandContentId === contentId;
        if (isPendingExpand) {
          this.pendingExpandContentId = undefined;
          this.expandedContentIds.add(contentId); // Add to cache
        }
        const shouldExpand = isPendingExpand || this.expandedContentIds.has(contentId);
        const contentItem = new TutorContentItem(
          child.courseContent,
          memberId,
          isAssignment,
          this.deriveAssignmentDirectory(child.courseContent),
          hasRepository,
          shouldExpand
        );
        items.push(contentItem);
      }
    }
    return items;
  }

  private isAssignmentContent(content: CourseContentStudentList): boolean {
    const ct: any = getEmbeddedCourseContentType(content);
    const kindId = ct?.course_content_kind_id;
    if (kindId && typeof kindId === 'string') {
      if (kindId.toLowerCase() === 'assignment') return true;
    }
    const slug = ct?.slug?.toLowerCase?.() || '';
    if (slug.includes('assignment') || slug.includes('exercise') || slug.includes('homework') || slug.includes('task') || slug.includes('lab') || slug.includes('quiz') || slug.includes('exam')) {
      return true;
    }
    const kindTitle = ct?.course_content_kind?.title?.toLowerCase?.() || '';
    if (kindTitle.includes('assignment') || kindTitle.includes('exercise') || kindTitle.includes('homework') || kindTitle.includes('task') || kindTitle.includes('lab') || kindTitle.includes('quiz') || kindTitle.includes('exam')) {
      return true;
    }
    return false;
  }

  private deriveAssignmentDirectory(content: CourseContentStudentList): string | undefined {
    const raw = (content as any)?.directory as string | undefined
      ?? content.submission_group?.example_identifier
      ?? (content.path?.split('.').pop());
    return this.sanitizeAssignmentDirectoryName(raw);
  }

  private sanitizeAssignmentDirectoryName(raw?: string | null): string | undefined {
    if (!raw) return undefined;
    const normalized = path.normalize(raw).replace(/^([\\/]+)/, '');
    if (!normalized || normalized === '.' || normalized === '..') {
      return undefined;
    }
    const segments = normalized.split(/[\\/]+/).filter(seg => seg && seg !== '..');
    return segments.join(path.sep);
  }

  private hasLocalRepository(content: CourseContentStudentList, memberId: string): boolean {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) return false;

      const courseId = this.selection.getCurrentCourseId();
      if (!courseId) return false;

      const repoRoot = this.getTutorRepoRoot(workspaceFolder, courseId, memberId, content);
      const gitDir = path.join(repoRoot, '.git');
      return fs.existsSync(gitDir);
    } catch {
      return false;
    }
  }

  private async getAssignmentDirectoryChildren(element: TutorContentItem, courseId: string, memberId: string): Promise<vscode.TreeItem[]> {
    if (!element.isAssignment) {
      return [];
    }

    // Check if virtual folders should be expanded (pending trigger)
    const contentId = element.content.id;
    const isPendingExpand = this.pendingExpandVirtualFoldersForContentId === contentId;
    if (isPendingExpand) {
      this.pendingExpandVirtualFoldersForContentId = undefined;
    }

    // Fetch artifacts once for both Submissions and History
    const submissionGroupId = element.content.submission_group?.id ?? undefined;
    let sortedArtifacts: any[] = [];
    if (submissionGroupId) {
      try {
        const artifacts = await this.api.listSubmissionArtifacts(submissionGroupId);
        if (artifacts && artifacts.length > 0) {
          sortedArtifacts = artifacts.sort((a, b) => {
            const dateA = new Date(a.uploaded_at || a.created_at || '').getTime();
            const dateB = new Date(b.uploaded_at || b.created_at || '').getTime();
            return dateB - dateA;
          });
        }
      } catch {
        // Ignore fetch errors — nodes will show empty state
      }
    }

    const latestArtifact = sortedArtifacts[0] || null;
    let latestDescription: string | undefined;
    if (latestArtifact) {
      const timestamp = latestArtifact.uploaded_at || latestArtifact.created_at;
      const dateStr = timestamp ? new Date(timestamp).toLocaleString() : latestArtifact.id;
      const result = latestArtifact.latest_result?.result;
      latestDescription = typeof result === 'number'
        ? `${dateStr} ${(result * 100).toFixed(1)}%`
        : dateStr;
    }

    const items: vscode.TreeItem[] = [];

    // 1. Submissions — shows latest submission files directly
    const subsFolderId = `tutorVirtualFolder:submissions:${contentId}:${courseId}:${memberId}`;
    if (isPendingExpand) {
      this.expandedVirtualFolderIds.add(subsFolderId);
    }
    const shouldExpandSubs = isPendingExpand || this.expandedVirtualFolderIds.has(subsFolderId);
    items.push(new TutorVirtualFolderItem('Submissions', 'submissions', element.content, courseId, memberId, {
      startExpanded: shouldExpandSubs,
      latestArtifactId: latestArtifact?.id,
      latestArtifactDescription: latestDescription,
      submissionGroupId,
      hasSubmissions: sortedArtifacts.length > 0,
    }));

    // 2. References (only if deployment exists)
    if (element.content.deployment && element.content.deployment.example_version_id) {
      const workspaceStructure = WorkspaceStructureManager.getInstance();
      const exampleVersionId = element.content.deployment.example_version_id;
      const referenceExists = await workspaceStructure.referenceExists(exampleVersionId);

      const versionTag = element.content.deployment.version_tag || '';
      const label = versionTag ? `References (${versionTag})` : 'References';

      const refFolderId = `tutorVirtualFolder:reference:${contentId}:${courseId}:${memberId}`;
      if (isPendingExpand) {
        this.expandedVirtualFolderIds.add(refFolderId);
      }
      const shouldExpandRef = isPendingExpand || this.expandedVirtualFolderIds.has(refFolderId);
      items.push(new TutorVirtualFolderItem(label, 'reference', element.content, courseId, memberId, {
        referenceExists,
        startExpanded: shouldExpandRef,
      }));
    }

    // 3. History — lists older submissions (only shown if there are 2+ artifacts)
    if (sortedArtifacts.length > 1) {
      const historyFolderId = `tutorVirtualFolder:history:${contentId}:${courseId}:${memberId}`;
      if (isPendingExpand) {
        this.expandedVirtualFolderIds.add(historyFolderId);
      }
      const shouldExpandHistory = this.expandedVirtualFolderIds.has(historyFolderId);
      items.push(new TutorVirtualFolderItem('History', 'history', element.content, courseId, memberId, {
        startExpanded: shouldExpandHistory,
        artifacts: sortedArtifacts,
        submissionGroupId,
      }));
    }

    return items;
  }

  private getTutorRepoRoot(workspaceRoot: string, courseId: string, memberId: string, content: CourseContentStudentList): string {
    const submissionRepo = content.submission_group?.repository as any;
    let remoteUrl: string | undefined = submissionRepo?.clone_url || submissionRepo?.url || submissionRepo?.web_url;
    if (!remoteUrl && submissionRepo) {
      const base = submissionRepo?.provider_url || submissionRepo?.provider || submissionRepo?.url || '';
      const full = submissionRepo?.full_path || '';
      if (base && full) {
        remoteUrl = `${String(base).replace(/\/$/, '')}/${String(full).replace(/^\//, '')}`;
        if (!remoteUrl.endsWith('.git')) remoteUrl += '.git';
      }
    }

    const repoName = deriveRepositoryDirectoryName({
      submissionRepo,
      remoteUrl,
      courseId,
      memberId,
      submissionGroupId: content.submission_group?.id || undefined
    });

    return buildReviewRepoRoot(workspaceRoot, repoName);
  }

  private async getVirtualFolderChildren(element: TutorVirtualFolderItem): Promise<vscode.TreeItem[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      return [new MessageItem('Open a workspace folder to view files.', 'warning')];
    }

    const workspaceStructure = WorkspaceStructureManager.getInstance();

    switch (element.folderType) {
      case 'repository':
        return this.getRepositoryChildren(element, workspaceFolder, workspaceStructure);
      case 'reference':
        return this.getReferenceChildren(element, workspaceStructure);
      case 'submissions':
        return this.getLatestSubmissionFiles(element, workspaceStructure);
      case 'history':
        return this.getHistoryChildren(element);
      default:
        return [];
    }
  }

  private async getRepositoryChildren(element: TutorVirtualFolderItem, workspaceFolder: string, workspaceStructure: WorkspaceStructureManager): Promise<vscode.TreeItem[]> {
    const repoRoot = this.getTutorRepoRoot(workspaceFolder, element.courseId, element.memberId, element.content);
    const gitDir = path.join(repoRoot, '.git');

    if (!fs.existsSync(gitDir)) {
      return [new MessageItem('Student repository not found locally. Use "Clone Student Repository" first.', 'warning')];
    }

    // Auto-update repository when expanding
    try {
      const git = new CTGit(repoRoot);
      await git.fetch();
      await git.pull();
    } catch (error) {
      console.warn('[TutorStudentTreeProvider] Failed to update repository:', error);
    }

    const directoryName = this.deriveAssignmentDirectory(element.content);
    if (!directoryName) {
      return [new MessageItem('Assignment directory is not specified for this content.', 'info')];
    }

    const assignmentPath = path.join(repoRoot, directoryName);
    if (!fs.existsSync(assignmentPath)) {
      return [new MessageItem('Assignment directory missing locally. Pull the latest student repository.', 'warning')];
    }

    const items = await this.readDirectoryItems(assignmentPath, element.courseId, element.memberId, repoRoot, element.content, 'repository');
    return items.length > 0 ? items : [new MessageItem('Assignment directory is empty.', 'info')];
  }

  private async getReferenceChildren(element: TutorVirtualFolderItem, workspaceStructure: WorkspaceStructureManager): Promise<vscode.TreeItem[]> {
    const deployment = element.content.deployment;
    if (!deployment || !deployment.example_version_id) {
      return [new MessageItem('No reference available for this assignment.', 'info')];
    }

    const referencePath = workspaceStructure.getReviewReferencePath(deployment.example_version_id);

    if (!fs.existsSync(referencePath)) {
      return [new MessageItem('Reference not downloaded. Right-click assignment → "Download Reference".', 'info')];
    }

    const items = await this.readDirectoryItems(referencePath, element.courseId, element.memberId, referencePath, element.content, 'reference');
    return items.length > 0 ? items : [new MessageItem('Reference directory is empty.', 'info')];
  }

  private async getLatestSubmissionFiles(element: TutorVirtualFolderItem, workspaceStructure: WorkspaceStructureManager): Promise<vscode.TreeItem[]> {
    const submissionGroupId = element.submissionGroupId;
    const artifactId = element.latestArtifactId;
    if (!submissionGroupId || !artifactId) {
      return [new MessageItem('No submissions available for this assignment.', 'info')];
    }

    const submissionPath = workspaceStructure.getReviewSubmissionPath(submissionGroupId, artifactId);

    // Auto-download the artifact if not present locally
    if (!fs.existsSync(submissionPath)) {
      try {
        const buffer = await this.api.downloadSubmissionArtifact(artifactId);
        if (!buffer) {
          return [new MessageItem('Failed to download submission artifact.', 'warning')];
        }
        const JSZip = require('jszip');
        const zip = await JSZip.loadAsync(buffer);
        await fs.promises.mkdir(submissionPath, { recursive: true });
        for (const [filename, file] of Object.entries(zip.files)) {
          const fileData = file as any;
          if (!fileData.dir) {
            const content = await fileData.async('nodebuffer');
            const filePath = path.join(submissionPath, filename);
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.writeFile(filePath, content);
          }
        }
      } catch (error) {
        console.warn('[TutorStudentTreeProvider] Failed to auto-download submission artifact:', error);
        return [new MessageItem('Submission artifact not found locally.', 'warning')];
      }
    }

    const items = await this.readDirectoryItems(submissionPath, element.courseId, element.memberId, submissionPath, element.content, 'submission');
    return items.length > 0 ? items : [new MessageItem('Submission directory is empty.', 'info')];
  }

  private getHistoryChildren(element: TutorVirtualFolderItem): vscode.TreeItem[] {
    const artifacts = element.artifacts;
    const submissionGroupId = element.submissionGroupId;
    if (!artifacts || artifacts.length === 0 || !submissionGroupId) {
      return [new MessageItem('No submissions available.', 'info')];
    }

    // Skip the latest (index 0) — it's already shown directly in the Submissions node
    const olderArtifacts = artifacts.slice(1);
    if (olderArtifacts.length === 0) {
      return [new MessageItem('No older submissions.', 'info')];
    }

    return olderArtifacts.map((artifact) => {
      const timestamp = artifact.uploaded_at || artifact.created_at;
      const formattedDate = timestamp ? new Date(timestamp).toLocaleString() : artifact.id;
      const result = (artifact as any).latest_result?.result;
      const submissionBaseId = `tutorSubmission:${artifact.id}:${submissionGroupId}:${element.courseId}:${element.memberId}`;
      const startExpanded = this.expandedSubmissionIds.has(submissionBaseId);
      return new TutorSubmissionItem(
        artifact.id,
        submissionGroupId,
        element.content,
        element.courseId,
        element.memberId,
        formattedDate,
        false,
        result,
        startExpanded
      );
    });
  }

  private async getSubmissionItemChildren(element: TutorSubmissionItem): Promise<vscode.TreeItem[]> {
    const workspaceStructure = WorkspaceStructureManager.getInstance();
    const submissionPath = workspaceStructure.getReviewSubmissionPath(element.submissionGroupId, element.artifactId);

    // Auto-download the artifact if not present locally
    if (!fs.existsSync(submissionPath)) {
      try {
        const buffer = await this.api.downloadSubmissionArtifact(element.artifactId);
        if (!buffer) {
          return [new MessageItem('Failed to download submission artifact.', 'warning')];
        }
        const JSZip = require('jszip');
        const zip = await JSZip.loadAsync(buffer);
        await fs.promises.mkdir(submissionPath, { recursive: true });
        for (const [filename, file] of Object.entries(zip.files)) {
          const fileData = file as any;
          if (!fileData.dir) {
            const content = await fileData.async('nodebuffer');
            const filePath = path.join(submissionPath, filename);
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.writeFile(filePath, content);
          }
        }
      } catch (error) {
        console.warn('[TutorStudentTreeProvider] Failed to auto-download submission artifact:', error);
        return [new MessageItem('Submission artifact not found locally.', 'warning')];
      }
    }

    const items = await this.readDirectoryItems(submissionPath, element.courseId, element.memberId, submissionPath, element.content, 'submission');
    return items.length > 0 ? items : [new MessageItem('Submission directory is empty.', 'info')];
  }

  private async readDirectoryItems(dir: string, courseId: string, memberId: string, repositoryRoot: string, content?: CourseContentStudentList, folderType?: 'repository' | 'reference' | 'submission'): Promise<vscode.TreeItem[]> {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      const items: vscode.TreeItem[] = [];
      const memberLabel = this.selection.getCurrentMemberLabel() || undefined;
      for (const entry of entries) {
        if (entry.name === '.git') continue;
        const absPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          items.push(new TutorFsFolderItem(absPath, courseId, memberId, repositoryRoot, content, folderType, memberLabel));
        } else if (entry.isFile()) {
          items.push(new TutorFsFileItem(absPath, courseId, memberId, repositoryRoot, content, folderType, memberLabel));
        }
      }

      items.sort((a, b) => {
        const aIsFolder = a instanceof TutorFsFolderItem;
        const bIsFolder = b instanceof TutorFsFolderItem;
        if (aIsFolder && !bIsFolder) return -1;
        if (!aIsFolder && bIsFolder) return 1;
        return String(a.label).localeCompare(String(b.label));
      });

      return items;
    } catch (error) {
      console.warn('Failed to read tutor assignment directory:', error);
      return [new MessageItem('Error reading assignment directory.', 'error')];
    }
  }
}

interface ContentNode {
  name?: string;
  children: Map<string, ContentNode>;
  courseContent?: CourseContentStudentList;
  contentKind?: CourseContentKindList;
  isUnit: boolean;
  unreadMessageCount?: number;
  unreviewedCount?: number;
  submissionGroup?: SubmissionGroupStudentList;
  aggregatedColor?: string;
}

class TutorSelectionMemberItem extends vscode.TreeItem {
  constructor(memberLabel: string, email?: string | null, username?: string | null) {
    super(memberLabel, vscode.TreeItemCollapsibleState.None);
    this.id = 'tutor-content-member';
    this.contextValue = 'tutorMember.selected';
    this.iconPath = new vscode.ThemeIcon('person-filled');
    const tooltipParts: string[] = [memberLabel];
    if (email) { tooltipParts.push(`Email: ${email}`); }
    if (username) { tooltipParts.push(`Username: ${username}`); }
    if (tooltipParts.length > 1) {
      this.tooltip = tooltipParts.join('\n');
    }
  }
}

class TutorSelectionGroupItem extends vscode.TreeItem {
  constructor(groupLabel: string) {
    super(groupLabel, vscode.TreeItemCollapsibleState.None);
    this.id = 'tutor-content-group';
    this.contextValue = 'tutorGroupOption.selected';
    this.iconPath = new vscode.ThemeIcon('organization');
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(message: string, severity: 'info' | 'warning' | 'error') {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(
      severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'info'
    );
  }
}

class TutorUnitItem extends vscode.TreeItem {
  constructor(public node: ContentNode) {
    super(node.name || 'Unit', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'tutorUnit';
    // Try to use a colored circle icon like in the student view
    try {
      const color = this.deriveColor(node) || 'grey';
      const status = ((node.courseContent as any)?.status || node.submissionGroup?.status)?.toLowerCase?.();
      const corner: 'corrected' | 'correction_necessary' | 'correction_possible' | 'none' =
        status === 'corrected' ? 'corrected'
          : status === 'correction_necessary' ? 'correction_necessary'
            : (status === 'correction_possible' || status === 'improvement_possible') ? 'correction_possible'
              : 'none';
      const hasUnreviewed = (node.unreviewedCount ?? 0) > 0;
      this.iconPath = (corner === 'none' && !hasUnreviewed)
        ? IconGenerator.getColoredIcon(color, 'circle')
        : IconGenerator.getColoredIconWithBadge(color, 'circle', 'none', corner, hasUnreviewed);
    } catch {
      this.iconPath = new vscode.ThemeIcon('folder');
    }
    this.id = node.courseContent ? node.courseContent.id : undefined;
    this.applyCounts();
  }

  private deriveColor(node: ContentNode): string | undefined {
    // Prefer the unit node's own content type color if available.
    if (node.courseContent) {
      const cc: any = node.courseContent as any;
      const ct = getEmbeddedCourseContentType(cc);
      if (ct?.color) return ct.color as string;
      if (cc.color) return cc.color as string;
    }
    if (node.aggregatedColor) return node.aggregatedColor;
    // Otherwise, no reliable unit color from the tutor endpoints; fall back to undefined (grey default)
    return undefined;
  }

  private applyCounts(): void {
    const count = this.countItems(this.node);
    const unread = this.node.unreadMessageCount ?? 0;
    const unreviewed = this.node.unreviewedCount ?? 0;

    // Build label prefix with indicators
    const labelParts: string[] = [];
    if (unreviewed > 0) {
      labelParts.push(`[📝${unreviewed}]`);
    }
    if (unread > 0) {
      labelParts.push(`[🔔${unread}]`);
    }
    const baseName = this.node.name || 'Unit';
    this.label = labelParts.length > 0 ? `${labelParts.join('')} ${baseName}` : baseName;

    // Description shows item count
    this.description = `${count} item${count !== 1 ? 's' : ''}`;

    const tooltipLines = [
      `Unit: ${baseName}`,
      `${count} item${count !== 1 ? 's' : ''}`
    ];
    const ct = getEmbeddedCourseContentType(this.node.courseContent);
    if (ct?.title) {
      tooltipLines.push(`Type: ${ct.title}`);
    }
    const status = (this.node.courseContent as any)?.status || this.node.submissionGroup?.status;
    if (status) {
      tooltipLines.push(`Status: ${this.formatStatus(String(status))}`);
    }
    if (unreviewed > 0) {
      tooltipLines.push(`${unreviewed} unreviewed assignment${unreviewed === 1 ? '' : 's'}`);
    }
    if (unread > 0) {
      tooltipLines.push(`${unread} unread message${unread === 1 ? '' : 's'}`);
    }
    this.tooltip = tooltipLines.join('\n');
  }

  private countItems(node: ContentNode): number {
    let count = 0;
    Array.from(node.children.values()).forEach(child => {
      if (child.courseContent && !child.isUnit) {
        count++;
      } else if (child.isUnit || child.children.size > 0) {
        count += this.countItems(child);
      }
    });
    return count;
  }

  private formatStatus(status: string): string {
    return status
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
}

class TutorContentItem extends vscode.TreeItem {
  public readonly memberId: string;
  public readonly isAssignment: boolean;
  public readonly assignmentDirectory?: string;
  public readonly hasRepository: boolean;

  constructor(
    public content: CourseContentStudentList,
    memberId: string,
    isAssignment: boolean,
    assignmentDirectory?: string,
    hasRepository: boolean = false,
    startExpanded: boolean = false
  ) {
    const collapsibleState = isAssignment
      ? (startExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
      : vscode.TreeItemCollapsibleState.None;
    super(content.title || content.path, collapsibleState);
    this.memberId = memberId;
    this.isAssignment = isAssignment;
    this.assignmentDirectory = assignmentDirectory;
    this.hasRepository = hasRepository;
    if (this.isAssignment) {
      this.contextValue = hasRepository ? 'tutorStudentContent.assignment.hasRepo' : 'tutorStudentContent.assignment.noRepo';
    } else {
      this.contextValue = 'tutorStudentContent.reading';
    }
    // Use a temporary unique ID when startExpanded is true to force VS Code to treat this as a new item
    // and respect the collapsibleState.Expanded. The ID will revert to normal on next refresh.
    this.id = startExpanded ? `${content.id}:expanded:${Date.now()}` : content.id;
    this.updateVisuals();
    this.setupCommand();
  }

  private setupCommand(): void {
    // Command removed - selection handler in extension.ts now triggers showTestResults
    // This avoids duplicate API calls (command + selection both firing)
  }

  updateVisuals(): void {
    const ct: any = getEmbeddedCourseContentType(this.content);
    const color = ct?.color || 'grey';
    const kindId = ct?.course_content_kind_id;
    const shape = kindId === 'assignment' ? 'square' : 'circle';
    const unread = (this.content as any).unread_message_count ?? 0;
    const unreviewedCount = (this.content as any).unreviewed_count ?? 0;
    const hasUnreviewed = unreviewedCount > 0;
    let badge: 'success' | 'success-submitted' | 'failure' | 'failure-submitted' | 'submitted' | 'none' = 'none';
    let corner: 'corrected' | 'correction_necessary' | 'correction_possible' | 'none' = 'none';
    const submission: SubmissionGroupStudentList = this.content.submission_group!;
    const status = normalizeStatus((this.content as any)?.status) ?? normalizeStatus(submission?.status);
    const grading = submission?.grading;
    if (status === 'corrected') corner = 'corrected';
    else if (status === 'correction_necessary') corner = 'correction_necessary';
    else if (status === 'correction_possible' || status === 'improvement_possible') corner = 'correction_possible';
    const result = this.content.result?.result as number | undefined;
    const submitted = this.content.submitted;

    if (typeof result === 'number') {
        // Has test result
        if (result === 1) {
            // Test passed
            badge = submitted === true ? 'success-submitted' : 'success';
        } else {
            // Test failed
            badge = submitted === true ? 'failure-submitted' : 'failure';
        }
    } else if (submitted === true) {
        // Submitted but not tested yet
        badge = 'submitted';
    }
    this.iconPath = (badge === 'none' && corner === 'none' && !hasUnreviewed)
      ? IconGenerator.getColoredIcon(color, shape)
      : IconGenerator.getColoredIconWithBadge(color, shape, badge, corner, hasUnreviewed);

    // Build label prefix with indicators
    const labelParts: string[] = [];
    if (hasUnreviewed) {
      labelParts.push('[📝]');
    }
    if (unread > 0) {
      labelParts.push('[🔔]');
    }
    const baseName = this.content.title || this.content.path;
    this.label = labelParts.length > 0 ? `${labelParts.join('')} ${baseName}` : baseName;

    // Build description with test/submission counts like student view
    const descriptionParts: string[] = [];

    const testCount = (this.content as any)?.result_count as number | undefined;
    const maxTests = (this.content as any)?.max_test_runs as number | undefined;
    if (typeof testCount === 'number') {
      descriptionParts.push(typeof maxTests === 'number' ? `(${testCount}/${maxTests})` : `(${testCount})`);
    }

    const submitCount = submission?.count as number | undefined;
    const maxSubmits = submission?.max_submissions as number | undefined;
    if (typeof submitCount === 'number') {
      descriptionParts.push(typeof maxSubmits === 'number' ? `(${submitCount}/${maxSubmits})` : `(${submitCount})`);
    }

    this.description = descriptionParts.length > 0 ? descriptionParts.join('') : undefined;

    // Append result percentage if available
    if (typeof result === 'number') {
      const pts = Math.round(result * 100);
      this.description = this.description ? `${this.description} ${pts}%` : `${pts}%`;
    }

    // Append grading percentage if available
    if (typeof grading === 'number') {
      const pts = Math.round(grading * 100);
      this.description = this.description ? `${this.description} ${pts}%` : `${pts}%`;
    }

    const friendlyStatus = (() => {
      if (!status) return undefined;
      if (status === 'corrected') return 'Corrected';
      if (status === 'correction_necessary') return 'Correction Necessary';
      if (status === 'improvement_possible') return 'Improvement Possible';
      if (status === 'correction_possible') return 'Correction Possible';
      const t = status.replace(/_/g, ' ');
      return t.charAt(0).toUpperCase() + t.slice(1);
    })();

    // Build tooltip with detailed information
    const tooltipLines: string[] = [];
    if (friendlyStatus) {
      tooltipLines.push(`Status: ${friendlyStatus}`);
    }
    if (typeof testCount === 'number') {
      tooltipLines.push(`Tests: ${typeof maxTests === 'number' ? `${testCount} of ${maxTests}` : `${testCount}`}`);
    }
    if (typeof submitCount === 'number') {
      tooltipLines.push(`Submissions: ${typeof maxSubmits === 'number' ? `${submitCount} of ${maxSubmits}` : `${submitCount}`}`);
    }
    if (typeof result === 'number') {
      tooltipLines.push(`Result: ${(result * 100).toFixed(2)}%`);
    }
    if (typeof grading === 'number') {
      tooltipLines.push(`Grading: ${(grading * 100).toFixed(2)}%`);
    }
    const graderName = extractGraderName(submission);
    if (graderName) {
      tooltipLines.push(`Graded by: ${graderName}`);
    }
    if (hasUnreviewed) {
      tooltipLines.push('Unreviewed assignment');
    }
    if (unread > 0) {
      tooltipLines.push(`${unread} unread message${unread === 1 ? '' : 's'}`);
    }
    this.tooltip = tooltipLines.join('\n');
  }
}

class TutorFsFolderItem extends vscode.TreeItem {
  constructor(
    public absPath: string,
    public courseId: string,
    public memberId: string,
    public repositoryRoot: string,
    public content?: CourseContentStudentList,
    public folderType?: 'repository' | 'reference' | 'submission',
    public memberLabel?: string
  ) {
    super(path.basename(absPath), vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = folderType ? `tutorFsFolder.${folderType}` : 'tutorFsFolder';
    this.tooltip = absPath;
    this.resourceUri = vscode.Uri.file(absPath);
    this.id = `tutorFsFolder:${courseId}:${memberId}:${absPath}`;
  }
}

class TutorFsFileItem extends vscode.TreeItem {
  constructor(
    public absPath: string,
    public courseId: string,
    public memberId: string,
    public repositoryRoot: string,
    public content?: CourseContentStudentList,
    public folderType?: 'repository' | 'reference' | 'submission',
    public memberLabel?: string
  ) {
    const filename = path.basename(absPath);
    const suffix = folderType === 'reference' ? ' (Reference)' : memberLabel ? ` (${memberLabel})` : '';
    super(filename + suffix, vscode.TreeItemCollapsibleState.None);
    this.contextValue = folderType ? `tutorFsFile.${folderType}` : 'tutorFsFile';
    this.tooltip = absPath;
    this.resourceUri = vscode.Uri.file(absPath);
    this.command = { command: 'vscode.open', title: 'Open File', arguments: [vscode.Uri.file(absPath)] };
    this.id = `tutorFsFile:${courseId}:${memberId}:${absPath}`;
  }
}

export class TutorVirtualFolderItem extends vscode.TreeItem {
  public readonly expandLatestSubmission: boolean;
  public readonly latestArtifactId?: string;
  public readonly artifactId?: string;
  public readonly submissionGroupId?: string;
  public readonly artifacts?: any[];

  constructor(
    label: string,
    public folderType: 'repository' | 'reference' | 'submissions' | 'history',
    public content: CourseContentStudentList,
    public courseId: string,
    public memberId: string,
    options: {
      hasRepository?: boolean;
      referenceExists?: boolean;
      startExpanded?: boolean;
      expandLatestSubmission?: boolean;
      latestArtifactId?: string;
      latestArtifactDescription?: string;
      submissionGroupId?: string;
      artifacts?: any[];
      hasSubmissions?: boolean;
    } = {}
  ) {
    const hasSubmissions = options.hasSubmissions !== false;
    const startExpanded = options.startExpanded ?? false;
    const collapsible = (folderType === 'submissions' && !hasSubmissions)
      ? vscode.TreeItemCollapsibleState.None
      : (startExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    super(label, collapsible);
    this.expandLatestSubmission = options.expandLatestSubmission ?? false;
    this.latestArtifactId = options.latestArtifactId;
    this.artifactId = options.latestArtifactId;
    this.submissionGroupId = options.submissionGroupId;
    this.artifacts = options.artifacts;

    // Set context value based on folder type and repository status
    if (folderType === 'repository') {
      this.contextValue = options.hasRepository ? 'tutorVirtualFolder.repository.hasRepo' : 'tutorVirtualFolder.repository.noRepo';
    } else {
      this.contextValue = `tutorVirtualFolder.${folderType}`;
    }

    // Use temporary unique ID when startExpanded to force VS Code to treat as new item
    const baseId = `tutorVirtualFolder:${folderType}:${content.id}:${courseId}:${memberId}`;
    this.id = startExpanded ? `${baseId}:expanded:${Date.now()}` : baseId;

    // Set description for submissions (latest artifact info)
    if (folderType === 'submissions' && options.latestArtifactDescription) {
      this.description = options.latestArtifactDescription;
    }

    // Set appropriate icons
    if (folderType === 'repository') {
      this.iconPath = new vscode.ThemeIcon('folder-library');
    } else if (folderType === 'reference') {
      if (options.referenceExists === true) {
        this.iconPath = new vscode.ThemeIcon('check-all', new vscode.ThemeColor('testing.iconPassed'));
      } else if (options.referenceExists === false) {
        this.iconPath = new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('editorWarning.foreground'));
      } else {
        this.iconPath = new vscode.ThemeIcon('book');
      }
    } else if (folderType === 'submissions') {
      this.iconPath = new vscode.ThemeIcon('archive');
    } else if (folderType === 'history') {
      this.iconPath = new vscode.ThemeIcon('history');
    }
  }
}

class TutorSubmissionItem extends vscode.TreeItem {
  public result?: number;

  constructor(
    public artifactId: string,
    public submissionGroupId: string,
    public content: CourseContentStudentList,
    public courseId: string,
    public memberId: string,
    createdAt?: string,
    isLatest?: boolean,
    result?: number,
    startExpanded: boolean = false
  ) {
    // Use created_at as label if available, otherwise use artifact ID
    let label = createdAt || artifactId;

    // Add result percentage if available
    if (typeof result === 'number') {
      const percentage = (result * 100).toFixed(1);
      label = `${label} ${percentage}%`;
    }

    // Add (latest) suffix after result
    if (isLatest) {
      label = `${label} (latest)`;
    }

    super(label, startExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'tutorSubmissionArtifact';
    // Use temporary unique ID when startExpanded to force VS Code to treat as new item
    const baseId = `tutorSubmission:${artifactId}:${submissionGroupId}:${courseId}:${memberId}`;
    this.id = startExpanded ? `${baseId}:expanded:${Date.now()}` : baseId;
    this.result = result;

    // Use different icon for latest submission
    if (isLatest) {
      this.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.green'));
    } else {
      this.iconPath = new vscode.ThemeIcon('file-zip');
    }

    let tooltip = isLatest ? `Latest Artifact: ${artifactId}` : `Artifact: ${artifactId}`;
    if (typeof result === 'number') {
      tooltip += `\nResult: ${(result * 100).toFixed(1)}%`;
    }
    this.tooltip = tooltip;
  }
}
