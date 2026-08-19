import * as vscode from 'vscode';
import { openFile } from '../ui/editorLayout';
import * as fs from 'fs';
import * as path from 'path';
import { LecturerTreeDataProvider } from '../ui/tree/lecturer/LecturerTreeDataProvider';
import { OrganizationTreeItem, CourseFamilyTreeItem, CourseTreeItem, CourseContentTreeItem, CourseFolderTreeItem, CourseContentTypeTreeItem, CourseGroupTreeItem, CourseMemberTreeItem } from '../ui/tree/lecturer/LecturerTreeItems';
import type { GitServerGet, CourseGitBindingUpsert } from '../types/courseGit';
import { CourseGroupCommands } from './LecturerCourseGroupCommands';
import { ComputorApiService } from '../services/ComputorApiService';
import { CourseWebviewProvider } from '../ui/webviews/CourseWebviewProvider';
import { CourseContentWebviewFactory } from '../ui/webviews/content/CourseContentWebviewFactory';
import { OrganizationWebviewProvider } from '../ui/webviews/OrganizationWebviewProvider';
import { CourseFamilyWebviewProvider } from '../ui/webviews/CourseFamilyWebviewProvider';
import { CourseContentTypeWebviewProvider } from '../ui/webviews/CourseContentTypeWebviewProvider';
import { CourseGroupWebviewProvider } from '../ui/webviews/CourseGroupWebviewProvider';
import { CourseMemberWebviewProvider } from '../ui/webviews/CourseMemberWebviewProvider';
import { CourseMemberImportWebviewProvider } from '../ui/webviews/CourseMemberImportWebviewProvider';
import { ManageCourseMembersWebviewProvider } from '../ui/webviews/ManageCourseMembersWebviewProvider';
import { MessagesWebviewProvider, MessageTargetContext } from '../ui/webviews/MessagesWebviewProvider';
import { CourseMemberCommentsWebviewProvider } from '../ui/webviews/CourseMemberCommentsWebviewProvider';
import { CourseMemberCommentsInputPanelProvider } from '../ui/panels/CourseMemberCommentsInputPanel';
import { ReleaseValidationWebviewProvider } from '../ui/webviews/ReleaseValidationWebviewProvider';
import { CourseProgressOverviewWebviewProvider } from '../ui/webviews/CourseProgressOverviewWebviewProvider';
import { CourseMemberProgressWebviewProvider } from '../ui/webviews/CourseMemberProgressWebviewProvider';
import { ScopeMembershipWebviewProvider } from '../ui/webviews/ScopeMembershipWebviewProvider';
import { hasExampleAssigned, getExampleVersionId, classifyReleaseContents } from '../utils/deploymentHelpers';
import type { ReleaseCandidate } from '../utils/deploymentHelpers';
import { HttpError } from '../exceptions/errors/HttpError';
import { pollTaskUntilComplete } from '../utils/taskPoller';
import type { CourseContentTypeList, CourseList, CourseFamilyList, CourseContentGet, CourseTaskRequest } from '../types/generated/courses';
import type { OrganizationList } from '../types/generated/organizations';
import type {
  CourseContentLecturerList,
  CourseContentList,
  CourseDeploymentList
} from '../types/generated';
import { LecturerRepositoryManager } from '../services/LecturerRepositoryManager';
import {
  COURSE_ANNOUNCEMENT_DENIED_REASON,
  canPostCourseAnnouncement,
  canPostToCourseFamily,
  canPostToOrganization
} from '../services/MessagePermissions';
import { runLockedWithProgress } from '../utils/progressLock';
import { canAuthorExamples, canManageAnyCourseFamilyMembers, canManageAnyOrganizationMembers } from '../services/ScopePermissions';
import type { MessagesInputPanelProvider } from '../ui/panels/MessagesInputPanel';
import type { WebSocketService } from '../services/WebSocketService';
import { commandRegistrar } from './commandHelpers';
import { notify } from '../utils/notify';
import { revealUri } from '../utils/reveal';
import {
  computeInsertPosition,
  computeReorderPosition,
  getParentPath,
  getSlug,
  sortedSiblings,
  type Placement
} from '../utils/contentOrdering';
import { isWithinRoot, normalizeRelativePath } from '../utils/studentFsOperations';

/** A webview cannot pass a tree item, so it sends the ids the scope needs. */
interface ReleaseContentPayload {
  courseId?: string;
  contentId?: string;
  path?: string;
  title?: string;
}

type ReleaseTarget =
  | CourseTreeItem
  | CourseFolderTreeItem
  | CourseContentTreeItem
  | ReleaseContentPayload;

interface ReleaseScope {
  label?: string;
  path?: string;
  parentId?: string;
  all?: boolean;
}

export class LecturerCommands {
  private apiService: ComputorApiService;
  private courseWebviewProvider: CourseWebviewProvider;
  private organizationWebviewProvider: OrganizationWebviewProvider;
  private courseFamilyWebviewProvider: CourseFamilyWebviewProvider;
  private courseContentTypeWebviewProvider: CourseContentTypeWebviewProvider;
  private courseGroupWebviewProvider: CourseGroupWebviewProvider;
  private courseMemberWebviewProvider: CourseMemberWebviewProvider;
  private courseMemberImportWebviewProvider: CourseMemberImportWebviewProvider;
  private manageCourseMembersWebviewProvider: ManageCourseMembersWebviewProvider;
  private courseGroupCommands: CourseGroupCommands;
  private messagesWebviewProvider: MessagesWebviewProvider;
  private commentsWebviewProvider: CourseMemberCommentsWebviewProvider;
  private releaseValidationWebviewProvider: ReleaseValidationWebviewProvider;
  private courseProgressOverviewWebviewProvider: CourseProgressOverviewWebviewProvider;
  private courseMemberProgressWebviewProvider: CourseMemberProgressWebviewProvider;
  private scopeMembershipWebviewProvider: ScopeMembershipWebviewProvider;

  constructor(
    private context: vscode.ExtensionContext,
    private treeDataProvider: LecturerTreeDataProvider,
    apiService?: ComputorApiService,
    messagesInputPanel?: MessagesInputPanelProvider,
    wsService?: WebSocketService,
    commentsInputPanel?: CourseMemberCommentsInputPanelProvider
  ) {
    // Use provided apiService or create a new one
    this.apiService = apiService || new ComputorApiService(context);
    this.courseWebviewProvider = new CourseWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.organizationWebviewProvider = new OrganizationWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseFamilyWebviewProvider = new CourseFamilyWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseContentTypeWebviewProvider = new CourseContentTypeWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseGroupWebviewProvider = new CourseGroupWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseMemberWebviewProvider = new CourseMemberWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseMemberImportWebviewProvider = new CourseMemberImportWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.manageCourseMembersWebviewProvider = new ManageCourseMembersWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.messagesWebviewProvider = MessagesWebviewProvider.getShared(context, this.apiService);
    if (messagesInputPanel) {
      this.messagesWebviewProvider.setInputPanel(messagesInputPanel);
    }
    if (wsService) {
      this.messagesWebviewProvider.setWebSocketService(wsService);
    }
    this.commentsWebviewProvider = new CourseMemberCommentsWebviewProvider(context, this.apiService);
    if (commentsInputPanel) {
      this.commentsWebviewProvider.setInputPanel(commentsInputPanel);
    }
    this.releaseValidationWebviewProvider = new ReleaseValidationWebviewProvider(context, this.apiService);
    this.courseProgressOverviewWebviewProvider = new CourseProgressOverviewWebviewProvider(context, this.apiService);
    this.courseMemberProgressWebviewProvider = new CourseMemberProgressWebviewProvider(context, this.apiService);
    this.scopeMembershipWebviewProvider = new ScopeMembershipWebviewProvider(context, this.apiService);
    this.courseGroupCommands = new CourseGroupCommands(this.apiService, this.treeDataProvider);
  }

  registerCommands(): void {

    const register = commandRegistrar(this.context);
    void this.applyScopeMembershipContextKey();
    register('computor.lecturer.refresh', async () => {
      this.apiService.clearCourseCache('');
      this.treeDataProvider.refresh();
    });

    // Sync assignments repositories (manual trigger)
    register('computor.lecturer.syncAssignments', async () => {
      try {
        const { LecturerRepositoryManager } = await import('../services/LecturerRepositoryManager');
        const mgr = new LecturerRepositoryManager(this.context, this.apiService);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Syncing assignments repositories...', cancellable: false }, async (progress) => {
          await mgr.syncAllAssignments((m) => progress.report({ message: m }));
        });
        notify.info('Assignments repositories synced.');
      } catch (e) {
        notify.error(`Failed to sync assignments: ${e}`);
      }
    });

    // Organization, course family, and course creation
    register('computor.lecturer.createOrganization', async () => {
      await this.createOrganization();
    });

    register('computor.lecturer.createCourseFamily', async (item: OrganizationTreeItem) => {
      await this.createCourseFamily(item);
    });

    register('computor.lecturer.createCourse', async (item?: CourseFamilyTreeItem) => {
      await this.createCourse(item);
    });

    register('computor.lecturer.deployCourseFromFile', async (item?: CourseFamilyTreeItem) => {
      await this.deployCourseFromFile(item);
    });

    register('computor.lecturer.manageCourse', async (item: CourseTreeItem) => {
      await this.manageCourse(item);
    });

    register('computor.lecturer.configureCourseGit', async (item: CourseTreeItem) => {
      await this.configureCourseGit(item);
    });

    register('computor.lecturer.toggleVisibility', async (item: CourseContentTreeItem) => {
      await this.toggleVisibility(item);
    });

    register('computor.lecturer.toggleCourseVisibility', async (item: CourseFolderTreeItem) => {
      await this.toggleCourseVisibility(item);
    });

    // Course content management
    register('computor.lecturer.createUnit', async (item: CourseFolderTreeItem | CourseContentTreeItem) => {
      await this.createUnit(item);
    });

    register('computor.lecturer.createAssignment', async (item: CourseFolderTreeItem | CourseContentTreeItem) => {
      await this.createAssignment(item);
    });

    register('computor.lecturer.showMessages', async (item: OrganizationTreeItem | CourseFamilyTreeItem | CourseTreeItem | CourseGroupTreeItem | CourseContentTreeItem) => {
      await this.showMessages(item);
    });

    register('computor.lecturer.manageOrganizationMembers', async (item: OrganizationTreeItem) => {
      await this.scopeMembershipWebviewProvider.open({
        kind: 'organization',
        scopeId: item.organization.id,
        scopeTitle: item.organization.title || item.organization.path
      });
    });

    register('computor.lecturer.manageCourseFamilyMembers', async (item: CourseFamilyTreeItem) => {
      await this.scopeMembershipWebviewProvider.open({
        kind: 'course_family',
        scopeId: item.courseFamily.id,
        scopeTitle: item.courseFamily.title || item.courseFamily.path,
        scopeSubtitle: item.organization.title || item.organization.path
      });
    });

    register('computor.lecturer.showCourseMemberComments', async (item: CourseMemberTreeItem) => {
      await this.showCourseMemberComments(item);
    });

    register('computor.lecturer.changeCourseContentType', async (item: CourseContentTreeItem) => {
      await this.changeCourseContentType(item);
    });

    // Course content type management
    register('computor.lecturer.createCourseContentType', async (item: CourseFolderTreeItem) => {
      await this.createCourseContentType(item);
    });

    // Course group management
    register('computor.lecturer.createCourseGroup', async (item: CourseFolderTreeItem) => {
      await this.courseGroupCommands.createCourseGroup(item);
    });

    // Course member import with preview
    register('computor.lecturer.importCourseMembersPreview', async (item: CourseTreeItem | CourseFolderTreeItem) => {
      await this.importCourseMembersWithPreview(item);
    });

    // Manage members (roster + add) — on the course node
    register('computor.lecturer.manageCourseMembers', async (item: CourseTreeItem) => {
      await this.manageCourseMembers(item);
    });

    register('computor.lecturer.editCourseContentType', async (item: CourseContentTypeTreeItem) => {
      await this.editCourseContentType(item);
    });

    register('computor.lecturer.deleteCourseContentType', async (item: CourseContentTypeTreeItem) => {
      await this.deleteCourseContentType(item);
    });

    register('computor.lecturer.renameCourseContent', async (item: CourseContentTreeItem) => {
      await this.renameCourseContent(item);
    });

    register('computor.lecturer.renameCourseContentType', async (item: CourseContentTypeTreeItem) => {
      await this.renameCourseContentType(item);
    });

    register('computor.lecturer.deleteCourseContent', async (item: CourseContentTreeItem) => {
      await this.deleteCourseContent(item);
    });

    register('computor.lecturer.archiveCourseContent', async (item: CourseContentTreeItem) => {
      await this.archiveCourseContent(item);
    });

    register('computor.lecturer.unarchiveCourseContent', async (item: CourseContentTreeItem) => {
      await this.unarchiveCourseContent(item);
    });

    // Rearranging the course. Dragging already worked; these are the same moves
    // without the mouse gymnastics, and the only way to reorder units at all
    // (computor-org/issues#323).
    register('computor.lecturer.moveContentToTop', async (item: CourseContentTreeItem) => {
      await this.reorderCourseContent(item, 'top');
    });

    register('computor.lecturer.moveContentUp', async (item: CourseContentTreeItem) => {
      await this.reorderCourseContent(item, 'up');
    });

    register('computor.lecturer.moveContentDown', async (item: CourseContentTreeItem) => {
      await this.reorderCourseContent(item, 'down');
    });

    register('computor.lecturer.moveContentToBottom', async (item: CourseContentTreeItem) => {
      await this.reorderCourseContent(item, 'bottom');
    });

    register('computor.lecturer.prependContentToUnit', async (item: CourseContentTreeItem) => {
      await this.moveContentToUnit(item, 'prepend');
    });

    register('computor.lecturer.appendContentToUnit', async (item: CourseContentTreeItem) => {
      await this.moveContentToUnit(item, 'append');
    });

    // Example management
    register('computor.lecturer.updateExampleVersion', async (item: CourseContentTreeItem) => {
      await this.updateExampleVersion(item);
    });

    register('computor.lecturer.updateExampleVersions', async (item: CourseTreeItem | CourseFolderTreeItem | CourseContentTreeItem) => {
      await this.batchUpdateExampleVersions(item);
    });


    // GitLab repository opening
    register('computor.lecturer.openRemoteRepository', async (item: CourseTreeItem | CourseMemberTreeItem) => {
      await this.openRemoteRepository(item);
    });

    // Release/deployment commands
    register('computor.lecturer.releaseCourseContent', async (item: CourseTreeItem | CourseFolderTreeItem | CourseContentTreeItem) => {
      await this.releaseCourseContent(item);
    });

    // Release from webview (accepts course data directly)
    register('computor.lecturer.releaseCourseContentFromWebview', async (courseData: any) => {
      await this.releaseCourseContentFromWebview(courseData);
    });

    // Webview commands
    register('computor.lecturer.showCourseDetails', async (item: CourseTreeItem) => {
      await this.showCourseDetails(item);
    });

    register('computor.lecturer.showCourseContentDetails', async (item: CourseContentTreeItem) => {
      await this.showCourseContentDetails(item);
    });

    register('computor.lecturer.showOrganizationDetails', async (item: OrganizationTreeItem) => {
      await this.showOrganizationDetails(item);
    });

    register('computor.lecturer.showCourseFamilyDetails', async (item: CourseFamilyTreeItem) => {
      await this.showCourseFamilyDetails(item);
    });

    register('computor.lecturer.showCourseContentTypeDetails', async (item: CourseContentTypeTreeItem) => {
      await this.showCourseContentTypeDetails(item);
    });

    register('computor.lecturer.showCourseGroupDetails', async (item: CourseGroupTreeItem) => {
      await this.showCourseGroupDetails(item);
    });

    register('computor.lecturer.showCourseMemberDetails', async (item: CourseMemberTreeItem) => {
      await this.showCourseMemberDetails(item);
    });

    // Course progress overview - shows all students' progress for a course
    register('computor.lecturer.showCourseProgressOverview', async (itemOrId: CourseTreeItem | string) => {
      if (typeof itemOrId === 'string') {
        // Called with course ID directly (from tutor view)
        await this.showCourseProgressOverviewById(itemOrId);
      } else {
        // Called with tree item
        await this.showCourseProgressOverview(itemOrId);
      }
    });

    // Course member progress - shows detailed progress for a single student
    register('computor.lecturer.showCourseMemberProgress', async (itemOrId: CourseMemberTreeItem | string, memberName?: string) => {
      if (typeof itemOrId === 'string') {
        // Called with course member ID directly (from overview webview)
        await this.showCourseMemberProgressById(itemOrId, memberName);
      } else {
        // Called with tree item
        await this.showCourseMemberProgress(itemOrId);
      }
    });

    register('computor.lecturer.createAssignmentFolder', async (item: CourseContentTreeItem) => {
      await this.createAssignmentFolder(item);
    });

    register('computor.lecturer.createAssignmentFile', async (item: CourseContentTreeItem) => {
      await this.createAssignmentFile(item);
    });

    // Open local assignment folder for a content
    register('computor.lecturer.openAssignmentFolder', async (item: CourseContentTreeItem) => {
      if (!item || !item.courseContent?.id || !item.course?.id) { notify.warning('Select an assignment'); return; }
      try {
        const course = await this.apiService.getCourse(item.course.id);
        const content = await this.apiService.getCourseContent(item.courseContent.id, true);
        const deploymentPath = (content as any)?.deployment?.deployment_path || (content as any)?.deployment?.example_identifier || '';
        if (!course || !deploymentPath) { notify.warning('Assignment not initialized in assignments repo yet.'); return; }
        const { LecturerRepositoryManager } = await import('../services/LecturerRepositoryManager');
        const mgr = new LecturerRepositoryManager(this.context, this.apiService);
        const folder = mgr.getAssignmentFolderPath(course, deploymentPath);
        if (!folder || !fs.existsSync(folder)) {
          const choice = await notify.warning('Assignment folder missing locally. Sync assignments now?', 'Sync', 'Cancel');
          if (choice === 'Sync') { await vscode.commands.executeCommand('computor.lecturer.syncAssignments'); }
          return;
        }
        await revealUri(vscode.Uri.file(folder));
      } catch (e) {
        notify.error(`Failed to open assignment folder: ${e}`);
      }
    });

    register('computor.lecturer.renameCourseGroup', async (item: CourseGroupTreeItem) => {
      await this.renameCourseGroup(item);
    });

    register('computor.lecturer.deleteCourseGroup', async (item: CourseGroupTreeItem) => {
      await this.deleteCourseGroup(item);
    });
  }

  private async createOrganization(): Promise<void> {
    const orgPath = await vscode.window.showInputBox({
      prompt: 'Enter organization path (lowercase identifier)',
      placeHolder: 'e.g., my-university, research-lab',
      validateInput: (value) => {
        if (!value) { return 'Organization path is required'; }
        if (!/^[a-z0-9]+([.\-][a-z0-9]+)*$/.test(value)) {
          return 'Path must be lowercase alphanumeric with hyphens and dots';
        }
        return null;
      }
    });
    if (!orgPath) { return; }

    const orgTitle = await vscode.window.showInputBox({
      prompt: 'Enter organization title',
      placeHolder: 'e.g., My University',
      value: orgPath.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    });
    if (!orgTitle) { return; }

    // Organizations no longer carry a git connection (git is per-course), so
    // creation is a plain CRUD insert — no workflow, no task polling.
    try {
      await this.apiService.createOrganization({
        path: orgPath,
        title: orgTitle,
        organization_type: 'organization'
      });
      notify.info(`Organization "${orgTitle}" created successfully!`);
      this.treeDataProvider.refresh();
    } catch (error: any) {
      notify.error(`Failed to create organization: ${error.message || error}`);
    }
  }

  private async createCourseFamily(item: OrganizationTreeItem): Promise<void> {
    const organization = item.organization;

    const familyPath = await vscode.window.showInputBox({
      prompt: `Enter course family path under "${organization.title || organization.path}"`,
      placeHolder: 'e.g., computer-science, mathematics',
      validateInput: (value) => {
        if (!value) { return 'Course family path is required'; }
        if (!/^[a-z0-9]+([.\-][a-z0-9]+)*$/.test(value)) {
          return 'Path must be lowercase alphanumeric with hyphens and dots';
        }
        return null;
      }
    });
    if (!familyPath) { return; }

    const familyTitle = await vscode.window.showInputBox({
      prompt: 'Enter course family title',
      placeHolder: 'e.g., Computer Science',
      value: familyPath.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    });
    if (!familyTitle) { return; }

    // Course families carry no git config in the course-level model (git is
    // per-course), so creation is a plain CRUD insert — no workflow.
    try {
      await this.apiService.createCourseFamily({
        path: familyPath,
        title: familyTitle,
        organization_id: organization.id
      });
      notify.info(`Course family "${familyTitle}" created successfully!`);
      this.treeDataProvider.refresh();
    } catch (error: any) {
      notify.error(`Failed to create course family: ${error.message || error}`);
    }
  }

  private async createCourse(item?: CourseFamilyTreeItem): Promise<void> {
    let courseFamilyId: string;
    let familyLabel: string;

    if (item) {
      courseFamilyId = item.courseFamily.id;
      familyLabel = item.courseFamily.title || item.courseFamily.path;
    } else {
      const organizations = await this.apiService.getOrganizations();
      if (!organizations || organizations.length === 0) {
        notify.error('No organizations available');
        return;
      }

      const selectedOrg = await vscode.window.showQuickPick(
        organizations.map(org => ({
          label: org.title || org.path,
          description: org.path,
          organization: org
        })),
        { placeHolder: 'Select organization' }
      );
      if (!selectedOrg) { return; }

      const families = await this.apiService.getCourseFamilies(selectedOrg.organization.id);
      if (!families || families.length === 0) {
        notify.error('No course families available in this organization');
        return;
      }

      const selectedFamily = await vscode.window.showQuickPick(
        families.map(family => ({
          label: family.title || family.path,
          description: family.path,
          family: family
        })),
        { placeHolder: 'Select course family' }
      );
      if (!selectedFamily) { return; }

      courseFamilyId = selectedFamily.family.id;
      familyLabel = selectedFamily.family.title || selectedFamily.family.path;
    }

    const coursePath = await vscode.window.showInputBox({
      prompt: 'Enter course path (URL-friendly identifier)',
      placeHolder: 'e.g., cs101-2024, intro-programming-fall',
      validateInput: (value) => {
        if (!value) { return 'Course path is required'; }
        if (!/^[a-z0-9]+([.\-][a-z0-9]+)*$/.test(value)) {
          return 'Path must be lowercase alphanumeric with hyphens and dots';
        }
        return null;
      }
    });
    if (!coursePath) { return; }

    const courseTitle = await vscode.window.showInputBox({
      prompt: 'Enter course title',
      placeHolder: 'e.g., Introduction to Computer Science',
      value: coursePath.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    });
    if (!courseTitle) { return; }

    // Git is per-course in the course-level model — pick a registry git server
    // (or skip and bind later), not "inherit from the course family".
    const git = await this.promptCourseGitBinding({ allowSkip: true });
    if (git === null) { return; }  // cancelled

    const request: CourseTaskRequest = {
      course: { path: coursePath, title: courseTitle },
      course_family_id: courseFamilyId,
      ...(git ? { git } : {})
    };

    try {
      const taskResponse = await this.apiService.deployCourse(request);

      const result = await pollTaskUntilComplete(this.apiService, taskResponse.task_id, {
        title: `Creating course "${courseTitle}"...`
      });

      if (result.status === 'SUCCESS') {
        notify.info(`Course "${courseTitle}" created successfully in ${familyLabel}!`);
        this.treeDataProvider.refresh();
      } else if (result.status === 'FAILED') {
        notify.error(`Failed to create course: ${result.error || 'Unknown error'}`);
      } else if (result.status === 'TIMEOUT') {
        notify.warning(`Course creation for "${courseTitle}" is still in progress. Check back later.`);
      }
    } catch (error: any) {
      notify.error(`Failed to create course: ${error.message || error}`);
    }
  }

  /**
   * Deploy a course into a course family from a `course_deployment.yaml` file.
   * Validates first (surfacing errors/warnings), then applies on confirmation.
   */
  private async deployCourseFromFile(item?: CourseFamilyTreeItem): Promise<void> {
    let courseFamilyId: string;
    let familyLabel: string;

    if (item) {
      courseFamilyId = item.courseFamily.id;
      familyLabel = item.courseFamily.title || item.courseFamily.path;
    } else {
      const organizations = await this.apiService.getOrganizations();
      if (!organizations || organizations.length === 0) {
        notify.error('No organizations available');
        return;
      }

      const selectedOrg = await vscode.window.showQuickPick(
        organizations.map(org => ({
          label: org.title || org.path,
          description: org.path,
          organization: org
        })),
        { placeHolder: 'Select organization' }
      );
      if (!selectedOrg) { return; }

      const families = await this.apiService.getCourseFamilies(selectedOrg.organization.id);
      if (!families || families.length === 0) {
        notify.error('No course families available in this organization');
        return;
      }

      const selectedFamily = await vscode.window.showQuickPick(
        families.map(family => ({
          label: family.title || family.path,
          description: family.path,
          family: family
        })),
        { placeHolder: 'Select course family' }
      );
      if (!selectedFamily) { return; }

      courseFamilyId = selectedFamily.family.id;
      familyLabel = selectedFamily.family.title || selectedFamily.family.path;
    }

    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'YAML': ['yaml', 'yml']
      },
      title: 'Select course_deployment.yaml to deploy'
    });
    if (!fileUri || fileUri.length === 0) { return; }
    const firstFile = fileUri[0];
    if (!firstFile) { return; }

    let text: string;
    try {
      text = await fs.promises.readFile(firstFile.fsPath, 'utf8');
    } catch (error: any) {
      notify.error(`Failed to read file: ${error.message || error}`);
      return;
    }

    try {
      // Validate first — surface fatal errors and abort before applying.
      const validation = await this.apiService.deployCourseFromFile(courseFamilyId, text, true);
      if (!validation) {
        notify.error('Course deployment validation returned no result.');
        return;
      }

      if (validation.errors && validation.errors.length > 0) {
        notify.error(`Course deployment cannot proceed: ${validation.errors.join('; ')}`);
        return;
      }

      const courseLabel = validation.course_title || validation.course_path;

      if (validation.warnings && validation.warnings.length > 0) {
        const warningLines = validation.warnings.map(w => {
          const loc = w.path || w.example_identifier;
          return loc ? `• ${loc}: ${w.reason}` : `• ${w.reason}`;
        }).join('\n');
        const proceed = await notify.confirm(
          `Deploying "${courseLabel}" produced ${validation.warnings.length} warning(s). Deploy anyway?`,
          'Deploy anyway',
          warningLines
        );
        if (!proceed) { return; }
      }

      // Apply.
      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Deploying course "${courseLabel}"...`,
        cancellable: false
      }, async () => this.apiService.deployCourseFromFile(courseFamilyId, text, false));

      if (!result || !result.applied) {
        const errs = result?.errors?.join('; ');
        notify.error(`Course deployment failed${errs ? `: ${errs}` : '.'}`);
        return;
      }

      const s = result.summary;
      const summaryText = s
        ? ` — ${s.content_types ?? 0} content type(s), ${s.units ?? 0} unit(s), ${s.assignments ?? 0} assignment(s), ${s.examples_assigned ?? 0} example(s) assigned`
        : '';
      notify.info(
        `Course "${result.course_title || result.course_path}" deployed to ${familyLabel}${summaryText}.`
      );
      this.treeDataProvider.refresh();
    } catch (error: any) {
      notify.error(`Failed to deploy course: ${error.message || error}`);
    }
  }

  /**
   * Prompt for a course git binding from the registry (`GET /git-servers`): pick
   * a managed git server and the student-repo modes to offer. Git is per-course
   * in the course-level model — there is no "inherit from organization/family".
   * Returns the binding upsert, `undefined` if the user skipped (course left
   * unbound — only offered when `allowSkip`), or `null` if cancelled / no
   * managed server is available.
   */
  private async promptCourseGitBinding(opts: { allowSkip: boolean }): Promise<CourseGitBindingUpsert | undefined | null> {
    let servers: GitServerGet[];
    try {
      servers = await this.apiService.getGitServers();
    } catch (err: any) {
      notify.error(`Could not load git servers: ${err?.message || String(err)}`);
      return null;
    }
    const managed = servers.filter(s => s.managed && s.has_token);
    if (managed.length === 0) {
      if (opts.allowSkip) {
        notify.warning('No managed git server is registered — creating the course unbound. An administrator can register one, then configure the course git later.');
        return undefined;
      }
      notify.warning('No managed git server is registered. Ask an administrator to register one first.');
      return null;
    }

    type ServerPick = vscode.QuickPickItem & { server?: GitServerGet; skip?: boolean };
    const items: ServerPick[] = managed.map(s => ({
      label: s.name || s.base_url,
      description: `${s.type}${s.parent_group_id ? ` · group ${s.parent_group_id}` : ''}`,
      server: s,
    }));
    if (opts.allowSkip) {
      items.push({ label: '$(circle-slash) Skip for now', description: 'Create the course unbound; configure git later', skip: true });
    }

    const serverPick = await vscode.window.showQuickPick(items, {
      title: 'Course git — choose the host server',
      ignoreFocusOut: true,
    });
    if (!serverPick) { return null; }
    if (serverPick.skip || !serverPick.server) { return undefined; }
    const server = serverPick.server;

    const modeOptions = [
      { label: `$(server) Managed (${server.type})`, description: 'We host each student repository', mode: 'managed', picked: true },
      { label: '$(repo-forked) External', description: 'Students bring their own repository (any provider)', mode: 'external', picked: false },
      { label: '$(cloud-download) Download', description: 'Students download the template + submit without git', mode: 'download', picked: false },
    ];
    const modePicks = await vscode.window.showQuickPick(modeOptions, {
      title: 'Which student-repo modes should this course offer?',
      canPickMany: true,
      ignoreFocusOut: true,
    });
    if (!modePicks || modePicks.length === 0) { return null; }

    return {
      delivery: 'git',
      git_server_id: server.id,
      student_repo_modes: modePicks.map(p => p.mode),
    };
  }

  /**
   * Manage course settings and properties
   */
  /**
   * Configure an existing course's git binding: pick a managed git server and the
   * student-repo modes to offer, then `PUT /courses/{id}/git`. For a managed
   * GitLab server the backend also provisions the course group/template/
   * reference/students structure. The binding locks once materialized.
   */
  private async configureCourseGit(item?: CourseTreeItem): Promise<void> {
    const course = item?.course;
    const courseId = course?.id;
    if (!courseId) {
      notify.warning('Open "Configure Course Git" from a course in the lecturer tree.');
      return;
    }

    const binding = await this.promptCourseGitBinding({ allowSkip: false });
    if (!binding) { return; }  // null = cancelled / no managed server

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Configuring course git…', cancellable: false },
      async () => {
        try {
          await this.apiService.setCourseGitBinding(courseId, binding);
          notify.info(`Course git configured (${(binding.student_repo_modes || []).join(', ')}).`);
        } catch (err: any) {
          const detail = err?.response?.data?.detail || err?.message || String(err);
          notify.error(`Could not configure course git: ${detail}`);
        }
      }
    );
  }

  /**
   * Flip one unit or assignment between hidden and inherit (issue #338).
   *
   * The workflow this serves is a fast flip at the start and end of an exam,
   * which is why it lives on the tree rather than only in a form.
   *
   * Showing again writes `null` (inherit) rather than `true`: `true` would pin
   * the content visible against a later decision to hide the unit above it,
   * which is almost never what "show this again" means.
   *
   * Only offered on rows that are hidden *here* or not hidden at all — a row
   * hidden by an ancestor cannot be revealed from below, so the menu gates on
   * the `hiddenHere` context value.
   */
  private async toggleVisibility(item?: CourseContentTreeItem): Promise<void> {
    const content = item?.courseContent as any;
    if (!content?.id) {
      notify.error('No course content selected');
      return;
    }

    const hidingNow = content.visible !== false;
    const label = content.title || content.path;

    try {
      await this.apiService.updateCourseContent(
        String(content.course_id),
        String(content.id),
        { visible: hidingNow ? false : null } as any
      );
      notify.info(
        hidingNow
          ? `“${label}” is now hidden from students, along with anything under it.`
          : `“${label}” is visible to students again.`
      );
      // Students are told over the course channel by the backend; this
      // refreshes the lecturer's own tree so the badge updates immediately.
      await this.treeDataProvider.forceRefreshCourse(String(content.course_id));
    } catch (error) {
      notify.error(
        `Could not change visibility: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Hide or show a whole course's content tree (issue #338).
   *
   * Lives on the "Contents" folder rather than the course row: it hides the
   * course's content, not the course itself, and offering "hide everything" on
   * the course node reads too much like archiving or removing the course.
   *
   * Confirmed before hiding, because this empties the tree for every enrolled
   * student at once — a much larger blast radius than hiding one unit.
   */
  private async toggleCourseVisibility(item?: CourseFolderTreeItem): Promise<void> {
    const course = item?.course;
    if (!course?.id) {
      notify.error('No course selected');
      return;
    }

    const hidingNow = course.visible !== false;
    const label = course.title || course.path;

    if (hidingNow) {
      const choice = await vscode.window.showWarningMessage(
        `Hide all content of “${label}” from students?`,
        {
          modal: true,
          detail: 'Every unit and assignment in the course disappears from the '
            + 'student tree, and students cannot test or submit. Their files, '
            + 'tests and submissions are untouched and come back when you make '
            + 'the course visible again.',
        },
        'Hide from students'
      );
      if (choice !== 'Hide from students') {
        return;
      }
    }

    try {
      await this.apiService.updateCourse(String(course.id), {
        visible: hidingNow ? false : null,
      } as any);
      notify.info(
        hidingNow
          ? `Students now see no content in “${label}”.`
          : `Students can see “${label}” again.`
      );
      await this.treeDataProvider.forceRefreshCourse(String(course.id));
    } catch (error) {
      notify.error(
        `Could not change course visibility: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async manageCourse(item?: CourseTreeItem): Promise<void> {
    let course;
    
    if (item) {
      course = item.course;
    } else {
      // If no item provided, ask user to select a course
      const courses = await this.getAllCourses();
      if (!courses || courses.length === 0) {
        notify.info('No courses available');
        return;
      }

      const selected = await vscode.window.showQuickPick(
        courses.map(c => ({
          label: c.title || c.path,
          description: `${c.organization?.title || ''} > ${c.course_family?.title || ''}`,
          course: c
        })),
        { placeHolder: 'Select course to manage' }
      );

      if (!selected) {
        return;
      }
      course = selected.course;
    }

    // Show management options
    const action = await vscode.window.showQuickPick([
      { label: '$(edit) Edit Course Details', value: 'edit' },
      { label: '$(gear) Course Settings', value: 'settings' },
      { label: '$(trash) Delete Course', value: 'delete' }
    ], {
      placeHolder: `Manage: ${course.title || course.path}`
    });

    if (!action) {
      return;
    }

    switch (action.value) {
      case 'edit':
        await this.editCourseDetails(course);
        break;
      case 'settings':
        await this.showCourseSettings(course);
        break;
      case 'delete':
        await this.deleteCourse(course);
        break;
    }
  }

  private async getAllCourses(): Promise<any[]> {
    const courses: any[] = [];
    const organizations = await this.apiService.getOrganizations();
    
    for (const org of organizations || []) {
      const families = await this.apiService.getCourseFamilies(org.id);
      for (const family of families || []) {
        const familyCourses = await this.apiService.getCourses(family.id);
        courses.push(...(familyCourses || []).map(c => ({
          ...c,
          organization: org,
          course_family: family
        })));
      }
    }
    
    return courses;
  }

  private async editCourseDetails(course: any): Promise<void> {
    const newTitle = await vscode.window.showInputBox({
      prompt: 'Enter new course title',
      value: course.title || course.path
    });

    if (!newTitle || newTitle === course.title) {
      return;
    }

    try {
      await this.apiService.updateCourse(course.id, { title: newTitle });
      notify.info('Course updated successfully');
      this.treeDataProvider.refresh();
    } catch (error) {
      notify.error(`Failed to update course: ${error}`);
    }
  }


  private async showCourseSettings(course: any): Promise<void> {
    // For now, just show the course details webview
    if (course) {
      await this.courseWebviewProvider.show(
        `Course Settings: ${course.title || course.path}`,
        {
          course: course,
          courseFamily: course.course_family,
          organization: course.organization
        }
      );
    }
  }

  private async deleteCourse(course: any): Promise<void> {
    const confirmation = await notify.confirm(
      `Are you sure you want to delete the course "${course.title || course.path}"? This action cannot be undone.`,
      'Delete'
    );

    if (confirmation) {
      try {
        // TODO: Implement deleteCourse in ComputorApiService
        // For now, show a message that this feature is coming soon
        notify.info(
          `Course deletion feature is coming soon! Would delete: "${course.title || course.path}"`
        );
        
        // When API is ready, uncomment:
        // await this.apiService.deleteCourse(course.id);
        // notify.info('Course deleted successfully');
        // this.treeDataProvider.refresh();
      } catch (error) {
        notify.error(`Failed to delete course: ${error}`);
      }
    }
  }

  private resolveCreateTarget(item: CourseFolderTreeItem | CourseContentTreeItem): {
    folderItem: CourseFolderTreeItem;
    course: CourseList;
    parentPath?: string;
  } | undefined {
    if (item instanceof CourseFolderTreeItem && item.folderType === 'contents') {
      return { folderItem: item, course: item.course };
    }
    if (item instanceof CourseContentTreeItem) {
      return {
        folderItem: new CourseFolderTreeItem('contents', item.course, item.courseFamily, item.organization),
        course: item.course,
        parentPath: item.courseContent.path
      };
    }
    notify.error('Course contents can only be created under the Contents folder or another content item.');
    return undefined;
  }

  private async pickContentType(
    courseId: string,
    opts: { submittable: boolean; noneMessage: string }
  ): Promise<CourseContentTypeList | undefined> {
    const types = await this.apiService.getCourseContentTypes(courseId);
    if (types.length === 0) {
      notify.warning('No content types available. Please create a content type first.');
      return undefined;
    }

    const detailed = await Promise.all(types.map(async (t) => {
      try {
        const full = await this.apiService.getCourseContentType(t.id);
        return full || t;
      } catch {
        return t;
      }
    }));

    const matching = detailed
      .filter(t => this.isContentTypeSubmittable(t) === opts.submittable)
      .sort((a, b) => (a.title || a.slug || '').localeCompare(b.title || b.slug || ''));

    if (matching.length === 0) {
      notify.warning(opts.noneMessage);
      return undefined;
    }

    if (matching.length === 1) {
      return matching[0];
    }

    const picked = await vscode.window.showQuickPick(
      matching.map(t => ({
        label: t.title || t.slug,
        description: t.course_content_kind?.title || t.course_content_kind_id || '',
        contentType: t
      })),
      { placeHolder: 'Select content type' }
    );
    return picked?.contentType;
  }

  private slugify(input: string, fallback: string): string {
    const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return slug || fallback;
  }

  private async createUnit(item: CourseFolderTreeItem | CourseContentTreeItem): Promise<void> {
    const target = this.resolveCreateTarget(item);
    if (!target) { return; }

    const contentType = await this.pickContentType(target.course.id, {
      submittable: false,
      noneMessage: 'No non-submittable content types are configured for this course. Create one first.'
    });
    if (!contentType) { return; }

    const title = await vscode.window.showInputBox({
      prompt: 'Enter unit title',
      placeHolder: 'e.g., Week 1: Introduction'
    });
    if (!title) { return; }

    await this.treeDataProvider.createCourseContent(
      target.folderItem,
      title,
      contentType.id,
      target.parentPath,
      this.slugify(title, 'unit'),
      undefined
    );
  }

  private async createAssignment(item: CourseFolderTreeItem | CourseContentTreeItem): Promise<void> {
    const target = this.resolveCreateTarget(item);
    if (!target) { return; }

    const contentType = await this.pickContentType(target.course.id, {
      submittable: true,
      noneMessage: 'No submittable content types (assignments, exercises) are configured for this course. Create one first.'
    });
    if (!contentType) { return; }

    const examples = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Loading examples...' },
      () => this.apiService.getAvailableExamples()
    );
    if (!examples || examples.length === 0) {
      notify.warning('No examples available. Upload examples in the Examples view first.');
      return;
    }

    const selectedExample = await vscode.window.showQuickPick(
      examples.map(ex => ({
        label: ex.title,
        description: ex.identifier || '',
        detail: ex.description || '',
        id: ex.id,
        identifier: ex.identifier,
        exampleTitle: ex.title
      })),
      {
        placeHolder: 'Select example to assign',
        matchOnDescription: true,
        matchOnDetail: true
      }
    );
    if (!selectedExample) { return; }

    const versions = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Loading versions...' },
      () => this.apiService.getExampleVersions(selectedExample.id)
    );
    if (!versions || versions.length === 0) {
      notify.warning('No versions available for this example.');
      return;
    }

    const sortedVersions = [...versions].sort((a, b) => b.version_number - a.version_number);
    const latest = sortedVersions[0];
    const selectedVersion = sortedVersions.length === 1 && latest
      ? { versionTag: latest.version_tag }
      : await vscode.window.showQuickPick(
          sortedVersions.map(v => ({
            label: v.version_tag,
            description: `Created: ${new Date(v.created_at).toLocaleDateString()}`,
            versionTag: v.version_tag
          })),
          { placeHolder: 'Select version (latest first)' }
        );
    if (!selectedVersion) { return; }

    const title = await vscode.window.showInputBox({
      prompt: 'Enter assignment title',
      value: selectedExample.exampleTitle,
      placeHolder: 'Assignment title'
    });
    if (!title) { return; }

    try {
      const createdContent = await this.treeDataProvider.createCourseContent(
        target.folderItem,
        title,
        contentType.id,
        target.parentPath,
        this.slugify(title, 'assignment'),
        undefined
      );
      if (!createdContent) { return; }

      try {
        await this.apiService.lecturerAssignExample(createdContent.id, {
          example_identifier: selectedExample.identifier,
          version_tag: selectedVersion.versionTag
        });
      } catch (assignError: any) {
        const assignMessage = assignError?.response?.data?.detail || assignError.message || 'Unknown error';
        const action = await notify.warning(
          `Assignment "${title}" was created but the example could not be assigned: ${assignMessage}. Keep the assignment without an example?`,
          'Keep', 'Delete'
        );
        if (action === 'Delete') {
          await this.apiService.deleteCourseContent(target.course.id, createdContent.id);
        }
        this.apiService.clearCourseCache(target.course.id);
        this.treeDataProvider.refresh();
        return;
      }

      await this.treeDataProvider.forceRefreshCourse(target.course.id);
      notify.info(
        `Created assignment "${title}" with example "${selectedExample.label}" ${selectedVersion.versionTag}`
      );
    } catch (error: any) {
      const errorMessage = error?.response?.data?.detail || error.message || 'Unknown error';
      notify.error(`Failed to create assignment: ${errorMessage}`);
    }
  }

  private async changeCourseContentType(item: CourseContentTreeItem): Promise<void> {
    if (!item || !item.courseContent) {
      notify.error('Invalid course content item');
      return;
    }

    try {
      // Get available content types for this course
      const contentTypes = await this.apiService.getCourseContentTypes(item.course.id);
      
      if (contentTypes.length === 0) {
        notify.warning('No content types available in this course.');
        return;
      }

      // Get full content type info for current type to show what we're changing from
      const currentType = contentTypes.find(ct => ct.id === item.courseContent.course_content_type_id);
      const currentTypeLabel = currentType ? (currentType.title || currentType.slug) : 'Unknown';
      const currentKind = item.courseContent.course_content_kind_id
        || currentType?.course_content_kind_id;

      // Same-kind switches are free; a cross-kind switch (assignment ↔ unit)
      // is only accepted by the backend while the content is empty — no
      // children, no assigned example, no submissions (computor-org/issues#320).
      // Same-kind types come first; cross-kind ones carry a warning so the
      // repair case stays reachable without inviting the accident back.
      const availableTypes = contentTypes
        .filter(ct => ct.id !== item.courseContent.course_content_type_id)
        .sort((a, b) =>
          Number(b.course_content_kind_id === currentKind) - Number(a.course_content_kind_id === currentKind)
        )
        .map(ct => ({
          label: ct.title || ct.slug,
          description: ct.course_content_kind_id === currentKind
            ? (ct.course_content_kind_id || 'unknown')
            : `$(warning) ${ct.course_content_kind_id || 'unknown'} — changes the kind; only possible while the content is empty`,
          id: ct.id,
          contentType: ct
        }));

      if (availableTypes.length === 0) {
        notify.info('No other content types available to switch to.');
        return;
      }

      const selectedType = await vscode.window.showQuickPick(availableTypes, {
        placeHolder: `Change from "${currentTypeLabel}" to...`,
        title: 'Select New Content Type'
      });

      if (!selectedType) {
        return;
      }

      // Update the course content with the new type
      const updateData = {
        course_content_type_id: selectedType.id
      };

      await this.apiService.updateCourseContent(
        item.course.id,
        item.courseContent.id,
        updateData
      );

      notify.info(
        `Changed content type from "${currentTypeLabel}" to "${selectedType.label}"`
      );

      // Clear cache and refresh the tree
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();

    } catch (error) {
      console.error('Failed to change course content type:', error);
      notify.error(`Failed to change content type: ${error}`);
    }
  }

  private async createAssignmentFolder(item: CourseContentTreeItem): Promise<void> {
    try {
      const context = await this.resolveAssignmentEditingContext(item);
      if (!context) {
        return;
      }

      const folderInput = await vscode.window.showInputBox({
        title: 'New folder inside assignment',
        prompt: 'Enter folder name (relative to assignment root)',
        placeHolder: 'e.g. src/utils',
        ignoreFocusOut: true
      });
      if (!folderInput) {
        return;
      }

      const relativePath = this.normalizeRelativePath(folderInput);
      if (!relativePath) {
        notify.error('Invalid folder name. Use relative paths without . or .. segments.');
        return;
      }

      const targetPath = path.join(context.assignmentRoot, relativePath);
      if (!this.isWithinAssignmentRoot(context.assignmentRoot, targetPath)) {
        notify.error('Target folder must remain inside the assignment directory.');
        return;
      }

      if (fs.existsSync(targetPath)) {
        notify.info(`Folder already exists: ${relativePath}`);
        return;
      }

      await fs.promises.mkdir(targetPath, { recursive: true });
      this.treeDataProvider.refreshNode(item);
      notify.info(`Created folder: ${relativePath}`);
    } catch (error: any) {
      notify.error(`Failed to create folder: ${error?.message || error}`);
    }
  }

  private async createAssignmentFile(item: CourseContentTreeItem): Promise<void> {
    try {
      const context = await this.resolveAssignmentEditingContext(item);
      if (!context) {
        return;
      }

      const fileInput = await vscode.window.showInputBox({
        title: 'New file inside assignment',
        prompt: 'Enter file name (relative to assignment root)',
        placeHolder: 'e.g. src/index.ts',
        ignoreFocusOut: true
      });
      if (!fileInput) {
        return;
      }

      const relativePath = this.normalizeRelativePath(fileInput);
      if (!relativePath) {
        notify.error('Invalid file name. Use relative paths without . or .. segments.');
        return;
      }

      const targetPath = path.join(context.assignmentRoot, relativePath);
      if (!this.isWithinAssignmentRoot(context.assignmentRoot, targetPath)) {
        notify.error('Target file must remain inside the assignment directory.');
        return;
      }

      const targetDirectory = path.dirname(targetPath);
      await fs.promises.mkdir(targetDirectory, { recursive: true });

      if (fs.existsSync(targetPath)) {
        const overwrite = await vscode.window.showQuickPick(['Overwrite', 'Cancel'], {
          title: 'File already exists',
          placeHolder: `${relativePath} already exists.`,
          ignoreFocusOut: true
        });
        if (overwrite !== 'Overwrite') {
          return;
        }
      }

      await fs.promises.writeFile(targetPath, '');
      this.treeDataProvider.refreshNode(item);
      await openFile(targetPath, { preview: false });
      notify.info(`Created file: ${relativePath}`);
    } catch (error: any) {
      notify.error(`Failed to create file: ${error?.message || error}`);
    }
  }

  private async resolveAssignmentEditingContext(item: CourseContentTreeItem): Promise<{ course: CourseList; content: CourseContentGet; directoryName: string; assignmentRoot: string } | undefined> {
    if (!item?.course?.id || !item.courseContent?.id) {
      notify.warning('Select an assignment first.');
      return undefined;
    }

    const kindId = item.courseContent.course_content_kind_id || item.contentType?.course_content_kind_id;
    if (kindId !== 'assignment') {
      notify.warning('This action is only available for assignments.');
      return undefined;
    }

    const course = await this.apiService.getCourse(item.course.id);
    const content = await this.apiService.getCourseContent(item.courseContent.id, true) as CourseContentGet | undefined;
    if (!course || !content) {
      notify.error('Failed to load assignment details.');
      return undefined;
    }

    const directoryName = this.getAssignmentDirectoryName(content);
    if (!directoryName) {
      notify.warning('Assignment deployment path is not configured yet.');
      return undefined;
    }

    const repoManager = new LecturerRepositoryManager(this.context, this.apiService);
    await this.ensureAssignmentsRepo(course, repoManager);

    const assignmentRoot = repoManager.getAssignmentFolderPath(course, directoryName);
    if (!assignmentRoot) {
      notify.warning('Assignments repository is not configured for this course.');
      return undefined;
    }

    try {
      await fs.promises.mkdir(assignmentRoot, { recursive: true });
    } catch (error: any) {
      notify.error(`Failed to prepare assignment directory: ${error?.message || error}`);
      return undefined;
    }

    return { course, content, directoryName, assignmentRoot };
  }

  private async ensureAssignmentsRepo(course: CourseList, repoManager: LecturerRepositoryManager): Promise<void> {
    const repoRoot = repoManager.getAssignmentsRepoRoot(course);
    if (repoRoot && fs.existsSync(repoRoot)) {
      return;
    }

    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Syncing assignments repository...' }, async (progress) => {
      progress.report({ message: `Syncing assignments for ${course.title || course.path}` });
      await repoManager.syncAssignmentsForCourse(course.id);
    });
  }

  private getAssignmentDirectoryName(content: CourseContentGet): string | undefined {
    const deployment = (content as any)?.deployment;
    const deploymentPath = typeof deployment?.deployment_path === 'string' && deployment.deployment_path.trim().length > 0
      ? deployment.deployment_path.trim()
      : undefined;
    const exampleIdentifier = typeof deployment?.example_identifier === 'string' && deployment.example_identifier.trim().length > 0
      ? deployment.example_identifier.trim()
      : undefined;
    return deploymentPath || exampleIdentifier || this.extractSlugFromPath(content.path);
  }

  private extractSlugFromPath(pathValue: string | undefined): string | undefined {
    if (!pathValue) {
      return undefined;
    }
    const segments = pathValue.split('.').filter(Boolean);
    if (segments.length === 0) {
      return undefined;
    }
    return segments[segments.length - 1];
  }

  private normalizeRelativePath(input: string): string | undefined {
    return normalizeRelativePath(input);
  }

  private isWithinAssignmentRoot(base: string, candidate: string): boolean {
    return isWithinRoot(base, candidate);
  }

  private isContentTypeSubmittable(type: CourseContentTypeList): boolean {
    return type.course_content_kind?.submittable || false;
  }

  private async showMessages(item: OrganizationTreeItem | CourseFamilyTreeItem | CourseTreeItem | CourseGroupTreeItem | CourseContentTreeItem): Promise<void> {
    try {
      let target: MessageTargetContext | undefined;

      // Every query below pins `scope`. Target-id filters walk *down* the
      // hierarchy by default, so `course_id=X` alone returns everything
      // reachable through the course — including every student's private
      // submission-group conversation, flattened into the announcement list
      // and then swept as read on open. `course_content_id` is the same:
      // it walks into that assignment's submission groups.
      if (item instanceof OrganizationTreeItem) {
        const scopes = await this.apiService.getUserScopes();
        const canPost = canPostToOrganization(scopes, item.organization.id);
        target = {
          title: item.organization.title || item.organization.path,
          subtitle: 'Organization',
          query: { scope: 'organization', organization_id: item.organization.id },
          createPayload: { organization_id: item.organization.id },
          sourceRole: 'lecturer',
          wsChannel: `organization:${item.organization.id}`,
          readOnly: !canPost,
          readOnlyReason: canPost ? undefined : 'Posting to this organization requires manager or owner role.'
        };
      } else if (item instanceof CourseFamilyTreeItem) {
        const scopes = await this.apiService.getUserScopes();
        const canPost = canPostToCourseFamily(scopes, item.courseFamily.id);
        target = {
          title: item.courseFamily.title || item.courseFamily.path,
          subtitle: `${item.organization.title || item.organization.path} › Course Family`,
          query: { scope: 'course_family', course_family_id: item.courseFamily.id },
          createPayload: { course_family_id: item.courseFamily.id },
          sourceRole: 'lecturer',
          wsChannel: `course_family:${item.courseFamily.id}`,
          readOnly: !canPost,
          readOnlyReason: canPost ? undefined : 'Posting to this course family requires manager or owner role.'
        };
      } else if (item instanceof CourseTreeItem) {
        const scopes = await this.apiService.getUserScopes();
        const canPost = canPostCourseAnnouncement(scopes, item.course.id);
        target = {
          title: item.course.title || item.course.path,
          subtitle: this.buildCourseSubtitle(item.course, item.courseFamily, item.organization),
          query: { scope: 'course', course_id: item.course.id },
          createPayload: { course_id: item.course.id },
          sourceRole: 'lecturer',
          // Course channel only carries course-scoped messages now — the
          // hierarchical cascade (submission_group → course) was dropped
          // along with the single-target invariant. The chat inbox covers
          // cross-scope live updates via the per-user channel.
          wsChannel: `course:${item.course.id}`,
          readOnly: !canPost,
          readOnlyReason: canPost ? undefined : COURSE_ANNOUNCEMENT_DENIED_REASON
        };
      } else if (item instanceof CourseGroupTreeItem) {
        const scopes = await this.apiService.getUserScopes();
        const canPost = canPostCourseAnnouncement(scopes, item.course.id);
        target = {
          title: item.group.title || `Group ${item.group.id.slice(0, 8)}`,
          subtitle: `${this.buildCourseSubtitle(item.course, item.courseFamily, item.organization)} › Group`,
          query: { scope: 'course_group', course_group_id: item.group.id },
          createPayload: { course_group_id: item.group.id },
          sourceRole: 'lecturer',
          // Course groups use course_group channel
          wsChannel: `course_group:${item.group.id}`,
          readOnly: !canPost,
          readOnlyReason: canPost ? undefined : COURSE_ANNOUNCEMENT_DENIED_REASON
        };
      } else if (item instanceof CourseContentTreeItem) {
        const scopes = await this.apiService.getUserScopes();
        const canPost = canPostCourseAnnouncement(scopes, item.course.id);
        target = {
          title: item.courseContent.title || item.courseContent.path,
          subtitle: `${this.buildCourseSubtitle(item.course, item.courseFamily, item.organization)} › ${item.courseContent.path}`,
          query: { scope: 'course_content', course_content_id: item.courseContent.id },
          // Only the most-specific target is persisted anyway; sending
          // course_id alongside it just invited the two to disagree.
          createPayload: { course_content_id: item.courseContent.id },
          sourceRole: 'lecturer',
          wsChannel: `course_content:${item.courseContent.id}`,
          readOnly: !canPost,
          readOnlyReason: canPost ? undefined : COURSE_ANNOUNCEMENT_DENIED_REASON
        };
      }

      if (!target) {
        notify.warning('Messages are not available for this item.');
        return;
      }

      await this.messagesWebviewProvider.showMessages(target);
    } catch (error: any) {
      notify.error(`Failed to open messages: ${error?.message || error}`);
    }
  }

  private async showCourseMemberComments(item: CourseMemberTreeItem): Promise<void> {
    try {
      const given = item.member.user?.given_name;
      const family = item.member.user?.family_name;
      const fullName = [given, family].filter(Boolean).join(' ').trim();
      const displayName = fullName
        || item.member.user?.email
        || `Member ${item.member.id.slice(0, 8)}`;
      const title = `${displayName} — ${item.course.title || item.course.path}`;
      await this.commentsWebviewProvider.showComments(item.member.id, title);
    } catch (error: any) {
      notify.error(`Failed to open comments: ${error?.message || error}`);
    }
  }

  // Deactivated - kept for future use
  // @ts-ignore - TS6133: Method intentionally unused
  private async syncMemberGitlabPermissions(item: CourseMemberTreeItem): Promise<void> {
    try {
      const given = item.member.user?.given_name;
      const family = item.member.user?.family_name;
      const fullName = [given, family].filter(Boolean).join(' ').trim();
      const displayName = fullName
        || item.member.user?.email
        || `Member ${item.member.id.slice(0, 8)}`;

      // Get the course's GitLab token (GLPAT)
      const gitlabToken = await this.treeDataProvider.getGitLabTokenForCourse(item.course);

      if (!gitlabToken) {
        notify.error(
          'No GitLab token configured for this course. Please configure the GitLab token first.'
        );
        return;
      }

      // Show progress notification
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Syncing GitLab permissions for ${displayName}`,
          cancellable: false
        },
        async (progress) => {
          progress.report({ increment: 0, message: 'Contacting server...' });

          const result = await this.apiService.syncMemberGitlabPermissions(
            item.member.id,
            { access_token: gitlabToken }
          );

          progress.report({ increment: 100, message: 'Done' });

          // Show success message with the result
          const message = result.message || 'GitLab permissions synced successfully';
          const status = result.sync_status || 'completed';

          if (status === 'success' || status === 'completed') {
            notify.info(`✅ ${displayName}: ${message}`);
          } else if (status === 'warning') {
            notify.warning(`⚠️ ${displayName}: ${message}`);
          } else {
            notify.error(`❌ ${displayName}: ${message}`);
          }
        }
      );
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      notify.error(`Failed to sync GitLab permissions: ${errorMessage}`);
      console.error('Error syncing GitLab permissions:', error);
    }
  }

  private buildCourseSubtitle(course: CourseList, courseFamily: CourseFamilyList, organization: OrganizationList): string {
    const orgName = organization.title || organization.path;
    const familyName = courseFamily.title || courseFamily.path;
    const courseName = course.title || course.path;
    return `${orgName} / ${familyName} / ${courseName}`;
  }

  private async renameCourseContent(item: CourseContentTreeItem): Promise<void> {
    const currentTitle = item.courseContent.title || '';
    const newTitle = await vscode.window.showInputBox({
      prompt: 'Enter new title',
      value: currentTitle
    });

    if (!newTitle || newTitle === currentTitle) {
      return;
    }

    try {
      await this.treeDataProvider.updateCourseContent(item, { title: newTitle });
      notify.info(`Content renamed to "${newTitle}"`);
      
      // Force a full refresh to ensure the tree updates
      await this.treeDataProvider.refresh();
    } catch (error) {
      notify.error(`Failed to rename content: ${error}`);
    }
  }

  /**
   * Move a content among its siblings.
   *
   * Same-parent moves are a position change and nothing else, so they go
   * through the plain PATCH; the path stays put and the descendants have
   * nothing to follow. Reaching an end of the list is a no-op, deliberately
   * quiet — "Move Up" on the first assignment is a misclick, not an error.
   */
  private async reorderCourseContent(
    item: CourseContentTreeItem,
    placement: Placement
  ): Promise<void> {
    if (!item?.courseContent || !item.course) {
      return;
    }
    const courseId = item.course.id;
    const content = item.courseContent;

    try {
      const contents = await this.apiService.getLecturerCourseContents(courseId);
      const siblings = sortedSiblings(contents, getParentPath(content.path));
      const index = siblings.findIndex((sibling) => sibling.id === content.id);
      const position = computeReorderPosition(siblings, index, placement);
      if (position === undefined) {
        return;
      }

      await this.apiService.updateCourseContent(courseId, content.id, { position });
      await this.treeDataProvider.forceRefreshCourse(courseId);
    } catch (error: any) {
      const detail = error?.response?.detail || error?.message || error;
      notify.error(`Failed to move "${content.title || content.path}": ${detail}`);
    }
  }

  /**
   * Move an assignment into another unit, at its start or its end.
   *
   * This one changes the path, so it goes through the move endpoint, which
   * carries any descendants along and refuses placements the course structure
   * does not allow.
   */
  private async moveContentToUnit(
    item: CourseContentTreeItem,
    mode: 'prepend' | 'append'
  ): Promise<void> {
    if (!item?.courseContent || !item.course) {
      return;
    }
    const courseId = item.course.id;
    const content = item.courseContent;

    try {
      const contents = await this.apiService.getLecturerCourseContents(courseId);
      const currentParent = getParentPath(content.path);

      const units = contents
        .filter((candidate) => candidate.id !== content.id && this.canHoldContent(candidate))
        .sort((a, b) => a.path.localeCompare(b.path));

      const picks: Array<vscode.QuickPickItem & { unitPath: string }> = [
        { label: '$(root-folder) Course root', description: 'not inside any unit', unitPath: '' },
        ...units.map((unit) => ({
          label: unit.title || unit.path,
          description: unit.path,
          unitPath: unit.path
        }))
      ];

      const chosen = await vscode.window.showQuickPick(picks, {
        title: mode === 'prepend'
          ? `Move "${content.title || content.path}" to the start of…`
          : `Move "${content.title || content.path}" to the end of…`
      });
      if (!chosen) {
        return;
      }

      const slug = getSlug(content.path);
      const targetPath = chosen.unitPath ? `${chosen.unitPath}.${slug}` : slug;
      const children = sortedSiblings(contents, chosen.unitPath).filter((c) => c.id !== content.id);
      const position = computeInsertPosition(children, mode);

      // Staying put: a path change the server would reject as a collision with
      // the content itself, when all that is wanted is a new position.
      if (chosen.unitPath === currentParent) {
        await this.apiService.updateCourseContent(courseId, content.id, { position });
        await this.treeDataProvider.forceRefreshCourse(courseId);
        return;
      }

      // Say which content is in the way before the server does — its message
      // cannot name the unit the lecturer just picked.
      const clash = contents.find((c) => c.path === targetPath && c.id !== content.id);
      if (clash) {
        notify.error(
          `"${chosen.label}" already contains something at "${slug}" (${clash.title || clash.path}). ` +
          'Rename one of them first.'
        );
        return;
      }

      await this.apiService.moveCourseContent(courseId, content.id, targetPath, position);
      await this.treeDataProvider.forceRefreshCourse(courseId);
      notify.info(
        `Moved "${content.title || content.path}" to the ${mode === 'prepend' ? 'start' : 'end'} of ${chosen.label}`
      );
    } catch (error: any) {
      const detail = error?.response?.detail || error?.message || error;
      notify.error(`Failed to move "${content.title || content.path}": ${detail}`);
    }
  }

  /** Whether a content is a kind that other content can live inside. */
  private canHoldContent(content: CourseContentList | CourseContentLecturerList): boolean {
    const kind = (content as any).course_content_type?.course_content_kind;
    if (kind && typeof kind.has_descendants === 'boolean') {
      return kind.has_descendants;
    }
    // Older payloads carry only the denormalised kind id and the submittable
    // flag; an assignment is the one kind that cannot hold anything.
    return !content.is_submittable && content.course_content_kind_id !== 'assignment';
  }

  private async renameCourseContentType(item: CourseContentTypeTreeItem): Promise<void> {
    const currentTitle = item.contentType.title || '';
    const newTitle = await vscode.window.showInputBox({
      prompt: 'Enter new title for content type',
      value: currentTitle
    });

    if (!newTitle || newTitle === currentTitle) {
      return;
    }

    try {
      await this.apiService.updateCourseContentType(item.contentType.id, { title: newTitle });
      notify.info(`Content type renamed to "${newTitle}"`);
      await this.treeDataProvider.refresh();
    } catch (error) {
      notify.error(`Failed to rename content type: ${error}`);
    }
  }

  private async deleteCourseContent(item: CourseContentTreeItem): Promise<void> {
    if (!item.courseContent || !item.courseContent.id) {
      notify.error('Invalid course content item - missing required data');
      return;
    }

    const title = item.courseContent.title || item.courseContent.path;
    const confirmation = await notify.warning(
      `Are you sure you want to delete "${title}"?`,
      'Yes',
      'No'
    );

    if (confirmation !== 'Yes') { return; }

    try {
      await this.apiService.deleteCourseContent(item.course.id, item.courseContent.id);
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();
      notify.info(`Deleted "${title}" successfully`);
    } catch (error: any) {
      if (error instanceof HttpError && (error.errorCode === 'CONTENT_006' || error.errorCode === 'CONTENT_007')) {
        const archiveChoice = await notify.warning(
          `Cannot delete "${title}" because it has student submissions. Would you like to archive it instead?`,
          'Archive',
          'Cancel'
        );
        if (archiveChoice === 'Archive') {
          await this.archiveCourseContent(item);
        }
      } else {
        notify.error(`Failed to delete "${title}": ${error.message || error}`);
      }
    }
  }

  private async archiveCourseContent(item: CourseContentTreeItem): Promise<void> {
    if (!item.courseContent?.id || !item.course?.id) {
      notify.error('Invalid course content item');
      return;
    }

    const title = item.courseContent.title || item.courseContent.path;

    try {
      await this.apiService.archiveCourseContent(item.course.id, item.courseContent.id);
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();
      notify.info(`Archived "${title}" successfully`);
    } catch (error: any) {
      notify.error(`Failed to archive "${title}": ${error.message || error}`);
    }
  }

  private async unarchiveCourseContent(item: CourseContentTreeItem): Promise<void> {
    if (!item.courseContent?.id || !item.course?.id) {
      notify.error('Invalid course content item');
      return;
    }

    const title = item.courseContent.title || item.courseContent.path;

    try {
      await this.apiService.unarchiveCourseContent(item.course.id, item.courseContent.id);
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();
      notify.info(`Unarchived "${title}" successfully`);
    } catch (error: any) {
      notify.error(`Failed to unarchive "${title}": ${error.message || error}`);
    }
  }

  private async updateExampleVersion(itemOrData: CourseContentTreeItem | Record<string, unknown>): Promise<void> {
    try {
      let contentId: string;
      let courseId: string;
      let exampleInfo: { id: string; title: string; identifier: string } | undefined;
      let currentVersionTag: string | undefined;

      if (itemOrData instanceof CourseContentTreeItem) {
        contentId = itemOrData.courseContent.id;
        courseId = itemOrData.course.id;
        exampleInfo = itemOrData.exampleInfo || undefined;
        currentVersionTag = itemOrData.exampleVersionInfo?.version_tag;
      } else {
        contentId = itemOrData.contentId as string;
        courseId = itemOrData.courseId as string;
      }

      if (!exampleInfo?.id) {
        const deployment = await this.apiService.lecturerGetDeployment(contentId);
        if (!deployment?.example_id) {
          notify.warning('No example assigned to this assignment');
          return;
        }
        const example = await this.apiService.getExample(deployment.example_id);
        if (!example) {
          notify.warning('Could not load example information');
          return;
        }
        exampleInfo = { id: example.id, title: example.title, identifier: example.identifier };
        currentVersionTag = currentVersionTag || deployment.version_tag;
      }

      const versions = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Loading available versions...',
        cancellable: false
      }, async () => {
        return await this.apiService.getExampleVersions(exampleInfo!.id);
      });

      if (!versions || versions.length === 0) {
        notify.warning('No versions available for this example');
        return;
      }

      const selectedVersion = await vscode.window.showQuickPick(
        versions.map(v => ({
          label: v.version_tag,
          description: v.version_tag === currentVersionTag ? '(current)' : `Created: ${new Date(v.created_at).toLocaleDateString()}`,
          versionTag: v.version_tag
        })),
        {
          placeHolder: `Select version (current: ${currentVersionTag || 'unknown'})`
        }
      );

      if (!selectedVersion) {
        return;
      }

      if (selectedVersion.versionTag === currentVersionTag) {
        notify.info('Already on this version');
        return;
      }

      const confirm = await notify.info(
        `Update "${exampleInfo.title}" from v${currentVersionTag} to v${selectedVersion.versionTag}?`,
        'Update',
        'Cancel'
      );

      if (confirm !== 'Update') {
        return;
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Updating example version...',
        cancellable: false
      }, async () => {
        await this.apiService.lecturerAssignExample(
          contentId,
          {
            example_identifier: exampleInfo!.identifier,
            version_tag: selectedVersion.versionTag
          }
        );
      });

      notify.info(
        `Example version updated to v${selectedVersion.versionTag}`
      );

      this.apiService.clearCourseCache(courseId);
      this.treeDataProvider.refresh();

    } catch (error: any) {
      console.error('Failed to update example version:', error);
      const errorMessage = error?.response?.data?.detail || error.message || 'Unknown error';
      notify.error(`Failed to update example version: ${errorMessage}`);
    }
  }

  private async batchUpdateExampleVersions(item: CourseTreeItem | CourseFolderTreeItem | CourseContentTreeItem): Promise<void> {
    const scopeInfo = this.buildReleaseScopeFromTreeItem(item);
    if (!scopeInfo) { return; }
    const { courseId, scope } = scopeInfo;

    try {
      const updatableItems = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Scanning for updatable assignments...',
        cancellable: false
      }, async () => {
        const [contents, batch] = await Promise.all([
          this.apiService.getCourseContents(courseId, false, true),
          this.apiService.lecturerGetCourseDeployments(courseId)
        ]);
        if (!contents || contents.length === 0) { return []; }

        const deploymentMap = new Map<string, CourseDeploymentList>();
        for (const dep of batch.deployments || []) {
          deploymentMap.set(dep.course_content_id, dep);
        }

        const matchesScope = (c: { id: string; path?: string | null }): boolean => {
          if (!scope || scope.all) { return true; }
          const pathValue = c.path || '';
          if (scope.parentId && scope.path) {
            return c.id === scope.parentId || pathValue.startsWith(`${scope.path}.`);
          }
          if (scope.path) {
            return pathValue === scope.path || pathValue.startsWith(`${scope.path}.`);
          }
          return true;
        };

        return contents
          .filter(c => c.is_submittable && hasExampleAssigned(c) && matchesScope(c))
          .reduce<{ content: typeof contents[number]; deployment: CourseDeploymentList }[]>((acc, content) => {
            const deployment = deploymentMap.get(content.id);
            if (deployment?.has_newer_version) {
              acc.push({ content, deployment });
            }
            return acc;
          }, []);
      });

      if (updatableItems.length === 0) {
        const scopeText = scope?.label ? ` under "${scope.label}"` : '';
        notify.info(`All assignments${scopeText} are already on their latest example versions.`);
        return;
      }

      interface UpdateQuickPickItem extends vscode.QuickPickItem {
        contentId: string;
      }

      const items: UpdateQuickPickItem[] = updatableItems.map(({ content, deployment }) => ({
        label: `$(sync) ${content.title || content.path}`,
        description: `v${deployment.version_tag || '?'} → v${deployment.latest_version_tag || 'latest'}`,
        picked: true,
        contentId: content.id
      }));

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: `Update example versions${scope?.label ? ` — ${scope.label}` : ''}`,
        placeHolder: `${updatableItems.length} assignment(s) have newer versions available`
      });

      if (!selected || selected.length === 0) { return; }

      const selectedIds = new Set(selected.map(s => s.contentId));

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Updating example versions...',
        cancellable: false
      }, async () => {
        const contentIds = [...selectedIds];
        const result = await this.apiService.lecturerBatchUpgradeVersions(courseId, contentIds);

        if (result.total_failed === 0) {
          notify.info(`Updated ${result.total_upgraded} assignment(s) to latest example versions.`);
        } else {
          notify.warning(`Updated ${result.total_upgraded} assignment(s), ${result.total_failed} failed.`);
        }
      });

      this.apiService.clearCourseCache(courseId);
      await this.treeDataProvider.forceRefreshCourse(courseId);

    } catch (error: any) {
      console.error('Failed to batch update example versions:', error);
      const errorMessage = error?.response?.data?.detail || error.message || 'Unknown error';
      notify.error(`Failed to update example versions: ${errorMessage}`);
    }
  }


  private async openRemoteRepository(item: CourseTreeItem | CourseMemberTreeItem): Promise<void> {
    try {
      let webUrl: string | undefined;
      let itemType: string;
      
      if (item instanceof CourseMemberTreeItem) {
        // For course members, we need to fetch the full member data to get the GitLab project URL
        itemType = 'member project';
        const memberData = await this.apiService.getCourseMember(item.member.id);
        
        if (memberData?.properties?.gitlab?.url && memberData.properties.gitlab.full_path) {
          // Build the full GitLab project URL
          const gitlabHost = memberData.properties.gitlab.url;
          const projectPath = memberData.properties.gitlab.full_path;
          webUrl = `${gitlabHost}/${projectPath}`;
        } else {
          notify.warning('No repository found for this course member');
          return;
        }
      } else {
        // For courses, use the course group URL
        itemType = 'course group';
        const courseGitlab = item.course.properties?.gitlab;
        
        if (courseGitlab?.url && courseGitlab.full_path) {
          // Build the full GitLab group URL
          const gitlabHost = courseGitlab.url;
          const groupPath = courseGitlab.full_path;
          webUrl = `${gitlabHost}/${groupPath}`;
        } else {
          notify.warning('No repository found for this course');
          return;
        }
      }
      
      if (webUrl) {
        // Ensure the URL has proper protocol
        if (!webUrl.startsWith('http://') && !webUrl.startsWith('https://')) {
          webUrl = `https://${webUrl}`;
        }
        
        // Open the URL in the default browser
        await vscode.env.openExternal(vscode.Uri.parse(webUrl));
        notify.info(`Opening ${itemType} in browser`);
      }
    } catch (error) {
      notify.error(`Failed to open repository: ${error}`);
    }
  }

  private async createCourseContentType(item: CourseFolderTreeItem): Promise<void> {
    if (item.folderType !== 'contentTypes') {
      return;
    }

    // Get available content kinds
    const contentKinds = await this.apiService.getCourseContentKinds();
    if (contentKinds.length === 0) {
      notify.error('No content kinds available in the system');
      return;
    }

    // Select content kind
    const kindItems = contentKinds.map(k => ({
      label: k.title || k.id,
      description: `ID: ${k.id}`,
      kindData: k
    }));
    
    const selectedKind = await vscode.window.showQuickPick(
      kindItems,
      { placeHolder: 'Select content kind' }
    );

    if (!selectedKind) {
      return;
    }

    const title = await vscode.window.showInputBox({
      prompt: 'Enter content type title',
      placeHolder: 'e.g., Lecture, Assignment, Special Topics'
    });

    if (!title) {
      return;
    }

    // Auto-generate slug from title: lowercase, replace spaces with underscores, remove non-alphanumeric
    const slug = title.toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/^_|_$/g, '');

    if (!slug) {
      notify.error('Invalid title: cannot generate slug');
      return;
    }

    const color = await vscode.window.showInputBox({
      prompt: 'Enter color (optional)',
      placeHolder: 'e.g., #FF5733, blue, rgb(255,87,51)',
      value: 'green'
    });

    try {
      await this.apiService.createCourseContentType({
        slug,
        title,
        color: color || 'green',
        course_id: item.course.id,
        course_content_kind_id: selectedKind.kindData.id
      });

      // Clear cache and refresh
      this.treeDataProvider.refreshNode(item);
      notify.info(`Content type "${title}" created successfully (slug: ${slug})`);
    } catch (error) {
      notify.error(`Failed to create content type: ${error}`);
    }
  }

  private async editCourseContentType(item: CourseContentTypeTreeItem): Promise<void> {
    const title = await vscode.window.showInputBox({
      prompt: 'Enter new title',
      value: item.contentType.title || item.contentType.slug
    });

    if (!title) {
      return;
    }

    const color = await vscode.window.showInputBox({
      prompt: 'Enter new color',
      value: item.contentType.color
    });

    try {
      await this.apiService.updateCourseContentType(item.contentType.id, {
        title,
        color: color || item.contentType.color
      });
      
      // Refresh parent folder
      const parent = new CourseFolderTreeItem('contentTypes', item.course, item.courseFamily, item.organization);
      this.treeDataProvider.refreshNode(parent);
      notify.info('Content type updated successfully');
    } catch (error) {
      notify.error(`Failed to update content type: ${error}`);
    }
  }

  private async deleteCourseContentType(item: CourseContentTypeTreeItem): Promise<void> {
    const confirmation = await notify.warning(
      `Are you sure you want to delete content type "${item.contentType.title || item.contentType.slug}"?`,
      'Yes',
      'No'
    );

    if (confirmation === 'Yes') {
      try {
        await this.apiService.deleteCourseContentType(item.contentType.id);
        notify.info('Content type deleted successfully');
        
        // Refresh the tree to show the changes
        await this.treeDataProvider.refresh();
      } catch (error) {
        notify.error(`Failed to delete content type: ${error}`);
      }
    }
  }

  private async releaseCourseContent(item: ReleaseTarget): Promise<void> {
    try {
      const scopeInfo = this.buildReleaseScopeFromTreeItem(item);
      if (!scopeInfo) { return; }
      await this.startReleaseWorkflow(scopeInfo.courseId, scopeInfo.scope);
    } catch (error) {
      notify.error(`Failed to release course content: ${error}`);
    }
  }

  private async releaseCourseContentFromWebview(courseData: any): Promise<void> {
    try {
      const courseId = courseData?.id || courseData;
      if (!courseId) {
        notify.error('Invalid course data: missing course ID');
        return;
      }

      const label = typeof courseData === 'object' && courseData
        ? (courseData.title || courseData.path || 'course')
        : 'course';

      await this.startReleaseWorkflow(courseId, { all: true, label });
    } catch (error) {
      notify.error(`Failed to release course content: ${error}`);
    }
  }

  private buildReleaseScopeFromTreeItem(item: ReleaseTarget): { courseId: string; scope: ReleaseScope } | undefined {
    if (item instanceof CourseTreeItem) {
      return {
        courseId: item.course.id,
        scope: {
          all: true,
          label: item.course.title || item.course.path
        }
      };
    }

    if (item instanceof CourseFolderTreeItem) {
      if (item.folderType !== 'contents') {
        notify.warning('Release is only available from the course contents folder.');
        return undefined;
      }

      return {
        courseId: item.course.id,
        scope: {
          all: true,
          label: `${item.course.title || item.course.path} contents`
        }
      };
    }

    if (item instanceof CourseContentTreeItem) {
      return {
        courseId: item.course.id,
        scope: {
          parentId: item.courseContent.id,
          path: item.courseContent.path,
          label: item.courseContent.title || item.courseContent.path
        }
      };
    }

    // Webviews cannot hand us a tree item, so they send the ids directly.
    if (item && !(item instanceof vscode.TreeItem) && item.courseId && item.contentId && item.path) {
      return {
        courseId: item.courseId,
        scope: {
          parentId: item.contentId,
          path: item.path,
          label: item.title || item.path
        }
      };
    }

    notify.warning('Select a course or an assignment in the Lecturer view to release.');
    return undefined;
  }

  private async startReleaseWorkflow(courseId: string, scope: ReleaseScope): Promise<void> {
    // Step 1: Pre-flight validation
    const validationResult = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Validating course for release...',
      cancellable: false
    }, async () => {
      try {
        return await this.apiService.validateCourseForRelease(courseId);
      } catch (error: any) {
        return {
          valid: false,
          error: 'Validation failed',
          validation_errors: [],
          total_issues: 0
        };
      }
    });

    // Step 2: If validation fails, show errors
    if (!validationResult.valid) {
      const course = await this.apiService.getCourse(courseId);
      const courseTitle = course?.title || course?.path || 'Unknown Course';

      await this.releaseValidationWebviewProvider.showValidationErrors(
        validationResult,
        courseTitle
      );
      return;
    }

    // Step 3: Get pending release candidates
    this.apiService.clearCourseCache(courseId);
    this.treeDataProvider.invalidateCache('course', courseId);

    const candidates = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Checking for releasable content...',
      cancellable: false
    }, () => this.getPendingReleaseContents(courseId, scope));

    if (candidates.length === 0) {
      await this.handleNoPendingContent(courseId, scope);
      return;
    }

    // Step 4: Let user select items to release
    const selectedCandidates = await this.confirmRelease(candidates, scope);
    if (!selectedCandidates || selectedCandidates.length === 0) {
      return;
    }

    await this.executeRelease(courseId, scope, selectedCandidates);
  }
  
  private async getPendingReleaseContents(courseId: string, scope?: ReleaseScope): Promise<ReleaseCandidate[]> {
    const contents = await this.apiService.getCourseContents(courseId, false, true);
    if (!contents || contents.length === 0) { return []; }

    const matchesScope = (c: { id: string; path?: string | null }): boolean => {
      if (!scope || scope.all) { return true; }
      const pathValue = c.path || '';
      if (scope.parentId && scope.path) {
        return c.id === scope.parentId || pathValue.startsWith(`${scope.path}.`);
      }
      if (scope.path) {
        return pathValue === scope.path || pathValue.startsWith(`${scope.path}.`);
      }
      return true;
    };

    const eligible = contents.filter(c => c.is_submittable && hasExampleAssigned(c) && matchesScope(c));
    return classifyReleaseContents(eligible, this.apiService, courseId);
  }
  
  private async handleNoPendingContent(courseId: string, scope?: ReleaseScope): Promise<void> {
    const contents = await this.apiService.getCourseContents(courseId, false, true);
    let filtered: typeof contents;
    if (scope && !scope.all && scope.parentId && scope.path) {
      // Try descendants first; fall back to the item itself if it's a leaf
      const descendants = contents?.filter(c => {
        const pathValue = c.path || '';
        return pathValue.startsWith(`${scope.path}.`);
      });
      filtered = (descendants && descendants.length > 0)
        ? descendants
        : contents?.filter(c => c.id === scope.parentId);
    } else if (scope && !scope.all && scope.path) {
      filtered = contents?.filter(c => {
        const pathValue = c.path || '';
        return pathValue === scope.path || pathValue.startsWith(`${scope.path}.`);
      });
    } else {
      filtered = contents;
    }

    const withExamples = filtered?.filter(c => hasExampleAssigned(c)) || [];

    const scopeText = scope?.label ? ` under "${scope.label}"` : '';

    if (withExamples.length > 0) {
      notify.info(`No pending content to release${scopeText}. All ${withExamples.length} assigned item(s) are up to date.`);
    } else {
      notify.info(`No pending content to release${scopeText}. Assign examples to course contents first.`);
    }
  }
  
  private async confirmRelease(candidates: ReleaseCandidate[], scope?: ReleaseScope): Promise<ReleaseCandidate[] | undefined> {
    interface ReleaseQuickPickItem extends vscode.QuickPickItem {
      candidate: ReleaseCandidate;
    }

    const iconMap = { new: '$(cloud-upload)', update: '$(sync)', failed: '$(error)' };
    const descriptionMap = { new: 'new', update: 'update available', failed: 'failed — retry' };

    const items: ReleaseQuickPickItem[] = candidates.map(candidate => ({
      label: `${iconMap[candidate.reason]} ${candidate.content.title || candidate.content.path}`,
      description: descriptionMap[candidate.reason],
      picked: candidate.reason !== 'failed',
      candidate
    }));

    const title = scope?.label
      ? `Release content under "${scope.label}"`
      : 'Release content to students';

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title,
      placeHolder: 'Select items to release (new and updated are pre-selected)'
    });

    if (!selected || selected.length === 0) { return undefined; }
    return selected.map(item => item.candidate);
  }
  
  private async executeRelease(courseId: string, scope: ReleaseScope | undefined, selectedCandidates: ReleaseCandidate[]): Promise<void> {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Releasing course content',
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 0, message: 'Preparing release...' });

      const updateCandidates = selectedCandidates.filter(c => c.reason === 'update');
      if (updateCandidates.length > 0) {
        progress.report({ message: `Updating ${updateCandidates.length} example version(s) to latest...` });
        const updateIds = updateCandidates.map(c => c.content.id);
        const upgradeResult = await this.apiService.lecturerBatchUpgradeVersions(courseId, updateIds);
        if (upgradeResult.total_failed > 0) {
          notify.warning(
            `${upgradeResult.total_failed} of ${updateIds.length} version upgrade(s) failed. The release will continue with the items that did upgrade.`
          );
        }
      }

      const selectedContentIds = selectedCandidates.map(c => c.content.id);

      try {
        progress.report({ message: `Syncing assignments for ${selectedContentIds.length} item(s)...` });
        await this.apiService.generateAssignments(courseId, {
          course_content_ids: selectedContentIds,
          overwrite_strategy: 'skip_if_exists',
          commit_message: 'Sync assignments prior to student-template release'
        });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const choice = await notify.confirm(
          `Failed to sync assignments before release: ${detail}. Continue with student-template release anyway?`,
          'Continue'
        );
        if (!choice) {
          throw new Error('Release cancelled after assignments sync failure');
        }
      }

      progress.report({ message: 'Starting student-template release...' });
      const result = await this.apiService.generateStudentTemplate(courseId, {
        release: { course_content_ids: selectedContentIds }
      });

      const items = typeof result?.contents_to_process === 'number' ? result.contents_to_process : undefined;
      const scopeSuffix = scope?.label ? ` for ${scope.label}` : '';
      const msg = items && items > 0
        ? `Release started for ${items} item(s)${scopeSuffix}. This runs in background.`
        : `Release started${scopeSuffix}. This runs in background.`;
      notify.info(msg);

      this.apiService.clearCourseCache(courseId);
      await this.treeDataProvider.forceRefreshCourse(courseId);
    });
  }
  
  // Removed task polling; backend now returns workflow-based responses for release operations

  private async showCourseDetails(item: CourseTreeItem): Promise<void> {
    // Fetch fresh data from API
    const freshCourse = await this.apiService.getCourse(item.course.id) || item.course;
    
    await this.courseWebviewProvider.show(
      `Course: ${freshCourse.title || freshCourse.path}`,
      {
        course: freshCourse,
        courseFamily: item.courseFamily,
        organization: item.organization
      }
    );
  }

  private async showCourseContentDetails(item: CourseContentTreeItem): Promise<void> {
    // Fetch full course content data from API (individual GET has all fields)
    const freshContent = await this.apiService.getCourseContent(item.courseContent.id, true) || item.courseContent;

    // Fetch example info if the content has an example assigned
    let exampleInfo = item.exampleInfo;
    if (hasExampleAssigned(freshContent) && !exampleInfo) {
      try {
        // Get version ID and fetch the version, then get the example
        const versionId = getExampleVersionId(freshContent);
        if (versionId) {
          const versionInfo = await this.apiService.getExampleVersion(versionId);
          if (versionInfo && versionInfo.example_id) {
            exampleInfo = await this.apiService.getExample(versionInfo.example_id);
          }
        }
      } catch (error) {
        console.error(`Failed to fetch example info:`, error);
      }
    }

    // Fetch content kind to determine appropriate webview provider
    let contentKind;
    try {
      const kinds = await this.apiService.getCourseContentKinds();
      contentKind = kinds.find(k => k.id === freshContent.course_content_kind_id);
    } catch (error) {
      console.error('Failed to get content kind:', error);
    }

    if (!contentKind) {
      notify.error('Unable to determine content kind for this item');
      return;
    }

    // Create appropriate webview provider using factory
    const webviewProvider = CourseContentWebviewFactory.create(
      this.context,
      this.apiService,
      contentKind,
      this.treeDataProvider
    );

    const providerType = CourseContentWebviewFactory.getProviderType(contentKind);

    await webviewProvider.show(
      `${providerType}: ${freshContent.title || freshContent.path}`,
      {
        courseContent: freshContent,
        course: item.course,
        contentType: item.contentType,
        contentKind: contentKind,
        exampleInfo: exampleInfo,
        isSubmittable: item.isSubmittable
      }
    );
  }

  private async showOrganizationDetails(item: OrganizationTreeItem): Promise<void> {
    // Fetch fresh data from API
    const freshOrganization = await this.apiService.getOrganization(item.organization.id) || item.organization;
    
    await this.organizationWebviewProvider.show(
      `Organization: ${freshOrganization.title || freshOrganization.path}`,
      {
        organization: freshOrganization
      }
    );
  }

  private async showCourseFamilyDetails(item: CourseFamilyTreeItem): Promise<void> {
    // Fetch fresh data from API
    const freshCourseFamily = await this.apiService.getCourseFamily(item.courseFamily.id) || item.courseFamily;
    
    await this.courseFamilyWebviewProvider.show(
      `Course Family: ${freshCourseFamily.title || freshCourseFamily.path}`,
      {
        courseFamily: freshCourseFamily,
        organization: item.organization
      }
    );
  }

  private async showCourseContentTypeDetails(item: CourseContentTypeTreeItem): Promise<void> {
    // Fetch full content type data from API (individual GET has all fields)
    const freshContentType = await this.apiService.getCourseContentType(item.contentType.id) || item.contentType;
    
    // Get content kind info
    let contentKind;
    try {
      const kinds = await this.apiService.getCourseContentKinds();
      contentKind = kinds.find(k => k.id === freshContentType.course_content_kind_id);
    } catch (error) {
      console.error('Failed to get content kind:', error);
    }

    await this.courseContentTypeWebviewProvider.show(
      `Content Type: ${freshContentType.title || freshContentType.slug}`,
      {
        contentType: freshContentType,
        course: item.course,
        contentKind
      }
    );
  }

  private async showCourseGroupDetails(item: CourseGroupTreeItem): Promise<void> {
    try {
      // Get detailed group information
      const detailedGroup = await this.apiService.getCourseGroup(item.group.id);
      if (!detailedGroup) {
        notify.error('Failed to load group details');
        return;
      }

      // Get group members
      const members = await this.apiService.getCourseMembers(item.course.id, item.group.id);

      await this.courseGroupWebviewProvider.show(
        `Group: ${item.group.title || item.group.id}`,
        {
          group: detailedGroup,
          members: members,
          courseTitle: item.course.title || item.course.path,
          organizationTitle: item.organization.title || item.organization.path
        }
      );
    } catch (error) {
      notify.error(`Failed to show group details: ${error}`);
    }
  }

  private async showCourseMemberDetails(item: CourseMemberTreeItem): Promise<void> {
    // Fetch full course member data from API
    const freshMember = await this.apiService.getCourseMember(item.member.id) || item.member;

    // Fetch group info if member is in a group
    let group = item.group;
    if (freshMember.course_group_id && !group) {
      try {
        group = await this.apiService.getCourseGroup(freshMember.course_group_id);
      } catch (error) {
        console.error('Failed to fetch group:', error);
      }
    }

    // Fetch available groups and roles for the course
    let availableGroups: any[] = [];
    let availableRoles: any[] = [];
    try {
      [availableGroups, availableRoles] = await Promise.all([
        this.apiService.getCourseGroups(item.course.id),
        this.apiService.getCourseRoles()
      ]);
    } catch (error) {
      console.error('Failed to fetch available groups/roles:', error);
    }

    // Find the current role
    const role = availableRoles.find(r => r.id === freshMember.course_role_id);

    await this.courseMemberWebviewProvider.show(
      `Member: ${freshMember.user?.email || 'Unknown'}`,
      {
        member: freshMember,
        course: item.course,
        group,
        role,
        availableGroups,
        availableRoles
      }
    );
  }

  private async renameCourseGroup(item: CourseGroupTreeItem): Promise<void> {
    const currentTitle = item.group.title || '';
    const newTitle = await vscode.window.showInputBox({
      prompt: 'Enter new title for the group',
      value: currentTitle
    });

    if (!newTitle || newTitle === currentTitle) {
      return;
    }

    try {
      await this.apiService.updateCourseGroup(item.group.id, { title: newTitle });
      notify.info(`Group renamed to "${newTitle}"`);

      // Refresh the tree to show the changes
      await this.treeDataProvider.refresh();
    } catch (error) {
      notify.error(`Failed to rename group: ${error}`);
    }
  }

  private async deleteCourseGroup(item: CourseGroupTreeItem): Promise<void> {
    const groupTitle = item.group.title || item.group.id;

    // Confirm deletion
    const confirmation = await notify.confirm(
      `Are you sure you want to delete the group "${groupTitle}"?\n\nMembers will be moved to "No Group".`,
      'Delete'
    );

    if (!confirmation) {
      return;
    }

    try {
      await this.apiService.deleteCourseGroup(item.group.id);
      notify.info(`Group "${groupTitle}" deleted`);

      // Refresh the tree to show the changes
      await this.treeDataProvider.refresh();
    } catch (error: any) {
      notify.error(`Failed to delete group: ${error?.message || error}`);
    }
  }

  async importCourseMembersWithPreview(item?: CourseTreeItem | CourseFolderTreeItem): Promise<void> {
    try {
      let courseId: string | undefined;

      if (item instanceof CourseTreeItem) {
        courseId = item.course.id;
      } else if (item instanceof CourseFolderTreeItem && item.folderType === 'groups') {
        courseId = item.course.id;
      }

      if (!courseId) {
        notify.error('Please select a course or groups folder to show members.');
        return;
      }

      // Show webview with existing members first
      await this.courseMemberImportWebviewProvider.showMembers(courseId);
    } catch (error: any) {
      console.error('Failed to show course members:', error);
      notify.error(
        `Failed to show course members: ${error?.message || error}`
      );
    }
  }

  async manageCourseMembers(item: CourseTreeItem): Promise<void> {
    try {
      if (!(item instanceof CourseTreeItem) || !item.course?.id) {
        notify.error('Please select a course to manage its members.');
        return;
      }
      await this.manageCourseMembersWebviewProvider.open(
        item.course.id,
        item.course.title || item.course.path
      );
    } catch (error: any) {
      console.error('Failed to open course member management:', error);
      notify.error(
        `Failed to open course member management: ${error?.message || error}`
      );
    }
  }

  async loadImportFile(courseId: string, filePath: string): Promise<void> {
    try {
      const fileBuffer = await fs.promises.readFile(filePath);
      const fileContent = fileBuffer.toString('utf-8');

      // TODO: Implement proper XML parsing
      // For now, create mock data for demonstration
      const mockMembers = this.parseMockXMLData(fileContent);

      await this.courseMemberImportWebviewProvider.loadImportData(mockMembers);
    } catch (error: any) {
      console.error('Failed to load import file:', error);
      throw error;
    }
  }

  private parseMockXMLData(xmlContent: string): any[] {
    // TODO: Implement proper XML parsing
    // This is a placeholder that creates mock data for demonstration
    // In production, this should parse the actual XML file

    // For now, return some mock data to demonstrate the webview
    return [
      {
        email: 'john.doe@example.com',
        given_name: 'John',
        family_name: 'Doe',
        student_id: '12345',
        course_group_title: 'Group A',
        course_role_id: '_student'
      },
      {
        email: 'jane.smith@example.com',
        given_name: 'Jane',
        family_name: 'Smith',
        student_id: '12346',
        course_group_title: 'Group B',
        course_role_id: '_student'
      },
      {
        email: 'bob.johnson@example.com',
        given_name: 'Bob',
        family_name: 'Johnson',
        student_id: '12347',
        course_group_title: 'Group A',
        course_role_id: '_student'
      }
    ];
  }

  private async showCourseProgressOverview(item: CourseTreeItem): Promise<void> {
    const courseLabel = item.course.title || item.course.path;
    await runLockedWithProgress(
      {
        key: `course-progress:${item.course.id}`,
        title: `Loading course progress: ${courseLabel}`,
        duplicateMessage: 'Course progress is already loading…'
      },
      async () => {
        try {
          const course = await this.apiService.getCourse(item.course.id);
          if (!course) {
            notify.error('Failed to load course details');
            return;
          }
          await this.courseProgressOverviewWebviewProvider.showCourseProgress(course);
        } catch (error) {
          notify.error(`Failed to show course progress: ${error}`);
        }
      }
    );
  }

  private async showCourseProgressOverviewById(courseId: string): Promise<void> {
    await runLockedWithProgress(
      {
        key: `course-progress:${courseId}`,
        title: 'Loading course progress…',
        duplicateMessage: 'Course progress is already loading…'
      },
      async () => {
        try {
          const course = await this.apiService.getCourse(courseId);
          if (!course) {
            notify.error('Failed to load course details');
            return;
          }
          await this.courseProgressOverviewWebviewProvider.showCourseProgress(course);
        } catch (error) {
          notify.error(`Failed to show course progress: ${error}`);
        }
      }
    );
  }

  private async showCourseMemberProgress(item: CourseMemberTreeItem): Promise<void> {
    const memberName = item.member.user
      ? [item.member.user.given_name, item.member.user.family_name].filter(Boolean).join(' ') || undefined
      : undefined;
    await this.showCourseMemberProgressById(item.member.id, memberName);
  }

  private async showCourseMemberProgressById(memberId: string, memberName?: string): Promise<void> {
    await runLockedWithProgress(
      {
        key: `member-progress:${memberId}`,
        title: `Loading progress: ${memberName || 'student'}`,
        duplicateMessage: 'Student progress is already loading…'
      },
      async () => {
        try {
          await this.courseMemberProgressWebviewProvider.showMemberProgress(memberId, memberName);
        } catch (error) {
          notify.error(`Failed to show member progress: ${error}`);
        }
      }
    );
  }

  // Sets the role-derived context keys: per-scope-kind "Manage Members" and
  // example-authoring. See `services/ScopePermissions.ts` for the rules.
  private async applyScopeMembershipContextKey(): Promise<void> {
    try {
      const [scopes, currentUser] = await Promise.all([
        this.apiService.getUserScopes(),
        this.apiService.getUserAccount().catch(() => undefined)
      ]);
      const globalRoles = new Set(
        (currentUser?.user_roles ?? [])
          .map(r => r?.role_id)
          .filter((id): id is string => typeof id === 'string')
      );
      const ctx = { scopes, globalRoles };
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.canManageOrgMembers', canManageAnyOrganizationMembers(ctx));
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.canManageFamilyMembers', canManageAnyCourseFamilyMembers(ctx));
      // Gates the example upload / create-repository buttons — backend reserves
      // those writes to `_example_manager` (admins bypass).
      await vscode.commands.executeCommand('setContext', 'computor.examples.canAuthor', canAuthorExamples(ctx));
    } catch (err) {
      console.warn('[LecturerCommands] Failed to compute scope-membership context keys:', err);
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.canManageOrgMembers', false);
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.canManageFamilyMembers', false);
      await vscode.commands.executeCommand('setContext', 'computor.examples.canAuthor', false);
    }
  }
}
