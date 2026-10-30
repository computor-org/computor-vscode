import * as vscode from 'vscode';
import * as fs from 'fs';
import { LecturerTreeDataProvider } from '../ui/tree/lecturer/LecturerTreeDataProvider';
import { OrganizationTreeItem, CourseFamilyTreeItem, CourseTreeItem, CourseContentTreeItem, CourseFolderTreeItem, CourseContentTypeTreeItem, CourseGroupTreeItem, CourseMemberTreeItem } from '../ui/tree/lecturer/LecturerTreeItems';
import type { GitServerGet, CourseGitBindingUpsert, CourseGitBindingGet } from '../types/courseGit';
import { parentRepositoryUrl } from '../utils/gitUrlHelpers';
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
import { findContentsUsingType, formatContentTypeInUseDetail } from '../utils/contentTypeUsage';
import { showErrorWithSeverity } from '../utils/errorDisplay';
import { pollTaskUntilComplete } from '../utils/taskPoller';
import type { CourseContentTypeList, CourseList, CourseFamilyList, CourseTaskRequest } from '../types/generated/courses';
import type { OrganizationList } from '../types/generated/organizations';
import type {
  CourseContentLecturerList,
  CourseContentList,
  CourseDeploymentList
} from '../types/generated';
import {
  COURSE_ANNOUNCEMENT_DENIED_REASON,
  canPostCourseAnnouncement,
  canPostToCourseFamily,
  canPostToOrganization
} from '../services/MessagePermissions';
import { runLockedWithProgress } from '../utils/progressLock';
import {
  canAuthorExamples,
  canDeleteAny,
  canDeleteCourse,
  canDeleteScope,
  canManageAnyCourseFamilyMembers,
  canManageAnyOrganizationMembers
} from '../services/ScopePermissions';
import type { ScopePermissionContext } from '../services/ScopePermissions';
import { formatCascadePreview } from '../services/CascadePreview';
import type { CascadeDeleteResult } from '../types/generated/common';
import { CourseSelectionService } from '../services/CourseSelectionService';
import type { MessagesInputPanelProvider } from '../ui/panels/MessagesInputPanel';
import type { WebSocketService } from '../services/WebSocketService';
import { commandRegistrar } from './commandHelpers';
import { notify } from '../utils/notify';
import { say, uiLanguage, uiLocale } from '../utils/uiLanguage';
import { localizedKindTitle } from '../utils/contentLanguage';
import { revealUri } from '../utils/reveal';
import {
  computeInsertPosition,
  computeReorderPosition,
  getParentPath,
  getSlug,
  sortedSiblings,
  type Placement
} from '../utils/contentOrdering';

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


/** German noun forms for the `kind` the delete prompts name in English. */
function kindDe(kind: string): { noun: string; the: string; this: string; ofThis: string } {
  switch (kind) {
    case 'course': return { noun: 'Kurs', the: 'den Kurs', this: 'Dieser Kurs', ofThis: 'dieses Kurses' };
    case 'course family': return { noun: 'Kursfamilie', the: 'die Kursfamilie', this: 'Diese Kursfamilie', ofThis: 'dieser Kursfamilie' };
    case 'organization': return { noun: 'Organisation', the: 'die Organisation', this: 'Diese Organisation', ofThis: 'dieser Organisation' };
    default: return { noun: 'Element', the: 'das Element', this: 'Dieses Element', ofThis: 'dieses Elements' };
  }
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
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: say('Syncing assignments repositories...', 'Aufgaben-Repositorys werden synchronisiert …'), cancellable: false }, async (progress) => {
          await mgr.syncAllAssignments((m) => progress.report({ message: m }));
        });
        notify.info(say('Assignments repositories synced.', 'Aufgaben-Repositorys sind synchronisiert.'));
      } catch (e) {
        notify.error(say(`Failed to sync assignments: ${e}`, `Die Aufgaben konnten nicht synchronisiert werden: ${e}`));
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

    // Hierarchy lifecycle. Owners (and admins) only; the menu entries are
    // gated by the coarse `canDeleteAny` context key and each command
    // re-checks the specific node before doing anything.
    // Both need a tree node: from the Command Palette there is none, so say
    // so instead of throwing on `item.organization`.
    register('computor.lecturer.deleteOrganization', async (item?: OrganizationTreeItem) => {
      if (!item?.organization) {
        notify.info(say('Right-click an organization in the Lecturer tree to delete it.', 'Klicke in der Lehrenden-Ansicht mit der rechten Maustaste auf eine Organisation, um sie zu löschen.'));
        return;
      }
      await this.deleteOrganization(item);
    });
    register('computor.lecturer.deleteCourseFamily', async (item?: CourseFamilyTreeItem) => {
      if (!item?.courseFamily) {
        notify.info(say('Right-click a course family in the Lecturer tree to delete it.', 'Klicke in der Lehrenden-Ansicht mit der rechten Maustaste auf eine Kursfamilie, um sie zu löschen.'));
        return;
      }
      await this.deleteCourseFamily(item);
    });
    register('computor.lecturer.deleteCourse', async (item?: CourseTreeItem) => {
      if (item?.course) {
        await this.deleteCourse(item.course);
      } else {
        await this.manageCourse(undefined);
      }
    });
    register('computor.lecturer.archiveCourse', async (item?: CourseTreeItem) => {
      if (!item?.course) {
        notify.info(say('Right-click a course in the Lecturer tree to archive it.', 'Klicke in der Lehrenden-Ansicht mit der rechten Maustaste auf einen Kurs, um ihn zu archivieren.'));
        return;
      }
      await this.archiveCourse(item.course);
    });
    register('computor.lecturer.unarchiveCourse', async (item?: CourseTreeItem) => {
      if (!item?.course) {
        notify.info(say('Right-click an archived course in the Lecturer tree to unarchive it.', 'Klicke in der Lehrenden-Ansicht mit der rechten Maustaste auf einen archivierten Kurs, um ihn aus dem Archiv zu holen.'));
        return;
      }
      await this.unarchiveCourse(item.course);
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

    // Reveal what was actually deployed for this assignment: its folder in the
    // local, read-only clone of the course's assignments repository. It was
    // called "Open Assignment Folder", which read like an editing entry point
    // for a folder that is only ever pulled (computor-org/issues#356).
    register('computor.lecturer.openAssignmentFolder', async (item: CourseContentTreeItem) => {
      if (!item || !item.courseContent?.id || !item.course?.id) { notify.warning(say('Select an assignment', 'Wähle eine Aufgabe aus.')); return; }
      try {
        const course = await this.apiService.getCourse(item.course.id);
        const content = await this.apiService.getCourseContent(item.courseContent.id, true);
        const deploymentPath = (content as any)?.deployment?.deployment_path || (content as any)?.deployment?.example_identifier || '';
        if (!course || !deploymentPath) {
          notify.warning(say('Nothing is deployed for this assignment yet, so there are no files to reveal.', 'Für diese Aufgabe ist noch nichts bereitgestellt, daher gibt es keine Dateien zum Anzeigen.'));
          return;
        }
        const { LecturerRepositoryManager } = await import('../services/LecturerRepositoryManager');
        const mgr = new LecturerRepositoryManager(this.context, this.apiService);
        const folder = mgr.getAssignmentFolderPath(course, deploymentPath);
        if (!folder || !fs.existsSync(folder)) {
          const choice = await notify.warning(
            say('The local copy of the assignments repository does not have this assignment yet. Sync it now?', 'Die lokale Kopie des Aufgaben-Repositorys enthält diese Aufgabe noch nicht. Jetzt synchronisieren?'),
            say('Sync', 'Synchronisieren'), say('Cancel', 'Abbrechen')
          );
          if (choice === say('Sync', 'Synchronisieren')) { await vscode.commands.executeCommand('computor.lecturer.syncAssignments'); }
          return;
        }
        await revealUri(vscode.Uri.file(folder));
      } catch (e) {
        notify.error(say(`Failed to reveal the deployed files: ${e}`, `Die bereitgestellten Dateien konnten nicht angezeigt werden: ${e}`));
      }
    });

    register('computor.lecturer.setMaxTestRuns', async (item: CourseContentTreeItem) => {
      await this.setSubmissionLimit(item, 'max_test_runs');
    });

    register('computor.lecturer.setMaxSubmissions', async (item: CourseContentTreeItem) => {
      await this.setSubmissionLimit(item, 'max_submissions');
    });

    register('computor.lecturer.setCourseMaxTestRuns', async (item: CourseTreeItem) => {
      await this.setCourseBudget(item, 'max_test_runs');
    });

    register('computor.lecturer.setCourseMaxSubmissions', async (item: CourseTreeItem) => {
      await this.setCourseBudget(item, 'max_submissions');
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
      prompt: say('Enter organization path (lowercase identifier)', 'Pfad der Organisation eingeben (Kennung in Kleinbuchstaben)'),
      placeHolder: say('e.g., my-university, research-lab', 'z. B. my-university, research-lab'),
      validateInput: (value) => {
        if (!value) { return say('Organization path is required', 'Der Pfad der Organisation ist erforderlich.'); }
        if (!/^[a-z0-9]+([.\-][a-z0-9]+)*$/.test(value)) {
          return say('Path must be lowercase alphanumeric with hyphens and dots', 'Der Pfad darf nur Kleinbuchstaben, Ziffern, Bindestriche und Punkte enthalten.');
        }
        return null;
      }
    });
    if (!orgPath) { return; }

    const orgTitle = await vscode.window.showInputBox({
      prompt: say('Enter organization title', 'Titel der Organisation eingeben'),
      placeHolder: say('e.g., My University', 'z. B. Meine Universität'),
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
      notify.info(say(`Organization "${orgTitle}" created successfully!`, `Die Organisation „${orgTitle}“ wurde angelegt.`));
      this.treeDataProvider.refresh();
    } catch (error: any) {
      notify.error(say(`Failed to create organization: ${error.message || error}`, `Die Organisation konnte nicht angelegt werden: ${error.message || error}`));
    }
  }

  private async createCourseFamily(item: OrganizationTreeItem): Promise<void> {
    const organization = item.organization;

    const familyPath = await vscode.window.showInputBox({
      prompt: say(`Enter course family path under "${organization.title || organization.path}"`, `Pfad der Kursfamilie unter „${organization.title || organization.path}“ eingeben`),
      placeHolder: say('e.g., computer-science, mathematics', 'z. B. computer-science, mathematics'),
      validateInput: (value) => {
        if (!value) { return say('Course family path is required', 'Der Pfad der Kursfamilie ist erforderlich.'); }
        if (!/^[a-z0-9]+([.\-][a-z0-9]+)*$/.test(value)) {
          return say('Path must be lowercase alphanumeric with hyphens and dots', 'Der Pfad darf nur Kleinbuchstaben, Ziffern, Bindestriche und Punkte enthalten.');
        }
        return null;
      }
    });
    if (!familyPath) { return; }

    const familyTitle = await vscode.window.showInputBox({
      prompt: say('Enter course family title', 'Titel der Kursfamilie eingeben'),
      placeHolder: say('e.g., Computer Science', 'z. B. Informatik'),
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
      notify.info(say(`Course family "${familyTitle}" created successfully!`, `Die Kursfamilie „${familyTitle}“ wurde angelegt.`));
      this.treeDataProvider.refresh();
    } catch (error: any) {
      notify.error(say(`Failed to create course family: ${error.message || error}`, `Die Kursfamilie konnte nicht angelegt werden: ${error.message || error}`));
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
        notify.error(say('No organizations available', 'Keine Organisationen verfügbar.'));
        return;
      }

      const selectedOrg = await vscode.window.showQuickPick(
        organizations.map(org => ({
          label: org.title || org.path,
          description: org.path,
          organization: org
        })),
        { placeHolder: say('Select organization', 'Organisation auswählen') }
      );
      if (!selectedOrg) { return; }

      const families = await this.apiService.getCourseFamilies(selectedOrg.organization.id);
      if (!families || families.length === 0) {
        notify.error(say('No course families available in this organization', 'In dieser Organisation gibt es keine Kursfamilien.'));
        return;
      }

      const selectedFamily = await vscode.window.showQuickPick(
        families.map(family => ({
          label: family.title || family.path,
          description: family.path,
          family: family
        })),
        { placeHolder: say('Select course family', 'Kursfamilie auswählen') }
      );
      if (!selectedFamily) { return; }

      courseFamilyId = selectedFamily.family.id;
      familyLabel = selectedFamily.family.title || selectedFamily.family.path;
    }

    const coursePath = await vscode.window.showInputBox({
      prompt: say('Enter course path (URL-friendly identifier)', 'Pfad des Kurses eingeben (URL-taugliche Kennung)'),
      placeHolder: say('e.g., cs101-2024, intro-programming-fall', 'z. B. cs101-2024, intro-programming-fall'),
      validateInput: (value) => {
        if (!value) { return say('Course path is required', 'Der Pfad des Kurses ist erforderlich.'); }
        if (!/^[a-z0-9]+([.\-][a-z0-9]+)*$/.test(value)) {
          return say('Path must be lowercase alphanumeric with hyphens and dots', 'Der Pfad darf nur Kleinbuchstaben, Ziffern, Bindestriche und Punkte enthalten.');
        }
        return null;
      }
    });
    if (!coursePath) { return; }

    const courseTitle = await vscode.window.showInputBox({
      prompt: say('Enter course title', 'Titel des Kurses eingeben'),
      placeHolder: say('e.g., Introduction to Computer Science', 'z. B. Einführung in die Informatik'),
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
        title: say(`Creating course "${courseTitle}"...`, `Kurs „${courseTitle}“ wird angelegt …`)
      });

      if (result.status === 'SUCCESS') {
        notify.info(say(`Course "${courseTitle}" created successfully in ${familyLabel}!`, `Der Kurs „${courseTitle}“ wurde in ${familyLabel} angelegt.`));
        this.treeDataProvider.refresh();
      } else if (result.status === 'FAILED') {
        notify.error(say(`Failed to create course: ${result.error || 'Unknown error'}`, `Der Kurs konnte nicht angelegt werden: ${result.error || 'unbekannter Fehler'}`));
      } else if (result.status === 'TIMEOUT') {
        notify.warning(say(`Course creation for "${courseTitle}" is still in progress. Check back later.`, `Der Kurs „${courseTitle}“ wird noch angelegt. Sieh später noch einmal nach.`));
      }
    } catch (error: any) {
      notify.error(say(`Failed to create course: ${error.message || error}`, `Der Kurs konnte nicht angelegt werden: ${error.message || error}`));
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
        notify.error(say('No organizations available', 'Keine Organisationen verfügbar.'));
        return;
      }

      const selectedOrg = await vscode.window.showQuickPick(
        organizations.map(org => ({
          label: org.title || org.path,
          description: org.path,
          organization: org
        })),
        { placeHolder: say('Select organization', 'Organisation auswählen') }
      );
      if (!selectedOrg) { return; }

      const families = await this.apiService.getCourseFamilies(selectedOrg.organization.id);
      if (!families || families.length === 0) {
        notify.error(say('No course families available in this organization', 'In dieser Organisation gibt es keine Kursfamilien.'));
        return;
      }

      const selectedFamily = await vscode.window.showQuickPick(
        families.map(family => ({
          label: family.title || family.path,
          description: family.path,
          family: family
        })),
        { placeHolder: say('Select course family', 'Kursfamilie auswählen') }
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
      title: say('Select course_deployment.yaml to deploy', 'course_deployment.yaml zum Bereitstellen auswählen')
    });
    if (!fileUri || fileUri.length === 0) { return; }
    const firstFile = fileUri[0];
    if (!firstFile) { return; }

    let text: string;
    try {
      text = await fs.promises.readFile(firstFile.fsPath, 'utf8');
    } catch (error: any) {
      notify.error(say(`Failed to read file: ${error.message || error}`, `Die Datei konnte nicht gelesen werden: ${error.message || error}`));
      return;
    }

    try {
      // Validate first — surface fatal errors and abort before applying.
      const validation = await this.apiService.deployCourseFromFile(courseFamilyId, text, true);
      if (!validation) {
        notify.error(say('Course deployment validation returned no result.', 'Die Prüfung der Kursbereitstellung hat kein Ergebnis geliefert.'));
        return;
      }

      if (validation.errors && validation.errors.length > 0) {
        notify.error(say(`Course deployment cannot proceed: ${validation.errors.join('; ')}`, `Der Kurs kann nicht bereitgestellt werden: ${validation.errors.join('; ')}`));
        return;
      }

      const courseLabel = validation.course_title || validation.course_path;

      if (validation.warnings && validation.warnings.length > 0) {
        const warningLines = validation.warnings.map(w => {
          const loc = w.path || w.example_identifier;
          return loc ? `• ${loc}: ${w.reason}` : `• ${w.reason}`;
        }).join('\n');
        const proceed = await notify.confirm(
          say(`Deploying "${courseLabel}" produced ${validation.warnings.length} warning(s). Deploy anyway?`, `Die Bereitstellung von „${courseLabel}“ ergab ${validation.warnings.length} Warnung(en). Trotzdem bereitstellen?`),
          say('Deploy anyway', 'Trotzdem bereitstellen'),
          warningLines
        );
        if (!proceed) { return; }
      }

      // Apply.
      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: say(`Deploying course "${courseLabel}"...`, `Kurs „${courseLabel}“ wird bereitgestellt …`),
        cancellable: false
      }, async () => this.apiService.deployCourseFromFile(courseFamilyId, text, false));

      if (!result || !result.applied) {
        const errs = result?.errors?.join('; ');
        notify.error(say(`Course deployment failed${errs ? `: ${errs}` : '.'}`, `Die Bereitstellung des Kurses ist fehlgeschlagen${errs ? `: ${errs}` : '.'}`));
        return;
      }

      const s = result.summary;
      const summaryText = s
        ? say(` — ${s.content_types ?? 0} content type(s), ${s.units ?? 0} unit(s), ${s.assignments ?? 0} assignment(s), ${s.examples_assigned ?? 0} example(s) assigned`, ` – ${s.content_types ?? 0} Inhaltstyp(en), ${s.units ?? 0} Einheit(en), ${s.assignments ?? 0} Aufgabe(n), ${s.examples_assigned ?? 0} Beispiel(e) zugewiesen`)
        : '';
      notify.info(
        say(`Course "${result.course_title || result.course_path}" deployed to ${familyLabel}${summaryText}.`, `Der Kurs „${result.course_title || result.course_path}“ wurde in ${familyLabel} bereitgestellt${summaryText}.`)
      );
      this.treeDataProvider.refresh();
    } catch (error: any) {
      notify.error(say(`Failed to deploy course: ${error.message || error}`, `Der Kurs konnte nicht bereitgestellt werden: ${error.message || error}`));
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
      notify.error(say(`Could not load git servers: ${err?.message || String(err)}`, `Die Git-Server konnten nicht geladen werden: ${err?.message || String(err)}`));
      return null;
    }
    const managed = servers.filter(s => s.managed && s.has_token);
    if (managed.length === 0) {
      if (opts.allowSkip) {
        notify.warning(say('No managed git server is registered — creating the course unbound. An administrator can register one, then configure the course git later.', 'Es ist kein verwalteter Git-Server registriert, daher wird der Kurs ohne Git-Anbindung angelegt. Eine Administratorin oder ein Administrator kann einen registrieren; danach kannst du Git für den Kurs konfigurieren.'));
        return undefined;
      }
      notify.warning(say('No managed git server is registered. Ask an administrator to register one first.', 'Es ist kein verwalteter Git-Server registriert. Bitte zuerst die Administration, einen zu registrieren.'));
      return null;
    }

    type ServerPick = vscode.QuickPickItem & { server?: GitServerGet; skip?: boolean };
    const items: ServerPick[] = managed.map(s => ({
      label: s.name || s.base_url,
      description: `${s.type}${s.parent_group_id ? say(` · group ${s.parent_group_id}`, ` · Gruppe ${s.parent_group_id}`) : ''}`,
      server: s,
    }));
    if (opts.allowSkip) {
      items.push({ label: say('$(circle-slash) Skip for now', '$(circle-slash) Vorerst überspringen'), description: say('Create the course unbound; configure git later', 'Kurs ohne Git anlegen und Git später konfigurieren'), skip: true });
    }

    const serverPick = await vscode.window.showQuickPick(items, {
      title: say('Course git — choose the host server', 'Git für den Kurs: Server auswählen'),
      ignoreFocusOut: true,
    });
    if (!serverPick) { return null; }
    if (serverPick.skip || !serverPick.server) { return undefined; }
    const server = serverPick.server;

    const modeOptions = [
      { label: say(`$(server) Managed (${server.type})`, `$(server) Verwaltet (${server.type})`), description: say('We host each student repository', 'Wir hosten das Repository jeder und jedes Studierenden'), mode: 'managed', picked: true },
      { label: say('$(repo-forked) External', '$(repo-forked) Extern'), description: say('Students bring their own repository (any provider)', 'Studierende bringen ein eigenes Repository mit (beliebiger Anbieter)'), mode: 'external', picked: false },
      { label: say('$(cloud-download) Download', '$(cloud-download) Herunterladen'), description: say('Students download the template + submit without git', 'Studierende laden die Vorlage herunter und geben ohne Git ab'), mode: 'download', picked: false },
    ];
    const modePicks = await vscode.window.showQuickPick(modeOptions, {
      title: say('Which student-repo modes should this course offer?', 'Welche Repository-Varianten soll dieser Kurs den Studierenden anbieten?'),
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
      notify.warning(say('Open "Configure Course Git" from a course in the lecturer tree.', 'Öffne „Git für den Kurs konfigurieren“ über einen Kurs in der Lehrenden-Ansicht.'));
      return;
    }

    const binding = await this.promptCourseGitBinding({ allowSkip: false });
    if (!binding) { return; }  // null = cancelled / no managed server

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: say('Configuring course git…', 'Git für den Kurs wird konfiguriert …'), cancellable: false },
      async () => {
        try {
          await this.apiService.setCourseGitBinding(courseId, binding);
          notify.info(say(`Course git configured (${(binding.student_repo_modes || []).join(', ')}).`, `Git für den Kurs ist konfiguriert (${(binding.student_repo_modes || []).join(', ')}).`));
        } catch (err: any) {
          const detail = err?.response?.data?.detail || err?.message || String(err);
          notify.error(say(`Could not configure course git: ${detail}`, `Git für den Kurs konnte nicht konfiguriert werden: ${detail}`));
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
      notify.error(say('No course content selected', 'Kein Kursinhalt ausgewählt.'));
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
          ? say(`“${label}” is now hidden from students, along with anything under it.`, `„${label}“ ist jetzt samt allem darunter für Studierende verborgen.`)
          : say(`“${label}” is visible to students again.`, `„${label}“ ist für Studierende wieder sichtbar.`)
      );
      // Students are told over the course channel by the backend; this
      // refreshes the lecturer's own tree so the badge updates immediately.
      await this.treeDataProvider.forceRefreshCourse(String(content.course_id));
    } catch (error) {
      notify.error(
        say(`Could not change visibility: ${error instanceof Error ? error.message : String(error)}`, `Die Sichtbarkeit konnte nicht geändert werden: ${error instanceof Error ? error.message : String(error)}`)
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
      notify.error(say('No course selected', 'Kein Kurs ausgewählt.'));
      return;
    }

    const hidingNow = course.visible !== false;
    const label = course.title || course.path;

    if (hidingNow) {
      const choice = await vscode.window.showWarningMessage(
        say(`Hide all content of “${label}” from students?`, `Alle Inhalte von „${label}“ vor den Studierenden verbergen?`),
        {
          modal: true,
          detail: say('Every unit and assignment in the course disappears from the ', 'Alle Einheiten und Aufgaben des Kurses verschwinden aus dem ')
            + say('student tree, and students cannot test or submit. Their files, ', 'Baum der Studierenden, die dann weder testen noch abgeben können. Ihre Dateien, ')
            + say('tests and submissions are untouched and come back when you make ', 'Tests und Abgaben bleiben unangetastet und sind wieder da, sobald du ')
            + say('the course visible again.', 'den Kurs wieder sichtbar machst.'),
        },
        say('Hide from students', 'Vor Studierenden verbergen')
      );
      if (choice !== say('Hide from students', 'Vor Studierenden verbergen')) {
        return;
      }
    }

    try {
      await this.apiService.updateCourse(String(course.id), {
        visible: hidingNow ? false : null,
      } as any);
      notify.info(
        hidingNow
          ? say(`Students now see no content in “${label}”.`, `Studierende sehen jetzt keine Inhalte von „${label}“.`)
          : say(`Students can see “${label}” again.`, `Studierende sehen „${label}“ wieder.`)
      );
      await this.treeDataProvider.forceRefreshCourse(String(course.id));
    } catch (error) {
      notify.error(
        say(`Could not change course visibility: ${error instanceof Error ? error.message : String(error)}`, `Die Sichtbarkeit des Kurses konnte nicht geändert werden: ${error instanceof Error ? error.message : String(error)}`)
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
        notify.info(say('No courses available', 'Keine Kurse verfügbar.'));
        return;
      }

      const selected = await vscode.window.showQuickPick(
        courses.map(c => ({
          label: c.title || c.path,
          description: `${c.organization?.title || ''} > ${c.course_family?.title || ''}`,
          course: c
        })),
        { placeHolder: say('Select course to manage', 'Kurs zum Verwalten auswählen') }
      );

      if (!selected) {
        return;
      }
      course = selected.course;
    }

    // Show management options
    const action = await vscode.window.showQuickPick([
      { label: say('$(edit) Edit Course Details', '$(edit) Kursdetails bearbeiten'), value: 'edit' },
      { label: say('$(gear) Course Settings', '$(gear) Kurseinstellungen'), value: 'settings' },
      { label: say('$(trash) Delete Course', '$(trash) Kurs löschen'), value: 'delete' }
    ], {
      placeHolder: say(`Manage: ${course.title || course.path}`, `Verwalten: ${course.title || course.path}`)
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
      prompt: say('Enter new course title', 'Neuen Titel des Kurses eingeben'),
      value: course.title || course.path
    });

    if (!newTitle || newTitle === course.title) {
      return;
    }

    try {
      await this.apiService.updateCourse(course.id, { title: newTitle });
      notify.info(say('Course updated successfully', 'Der Kurs wurde aktualisiert.'));
      this.treeDataProvider.refresh();
    } catch (error) {
      notify.error(say(`Failed to update course: ${error}`, `Der Kurs konnte nicht aktualisiert werden: ${error}`));
    }
  }


  private async showCourseSettings(course: any): Promise<void> {
    // For now, just show the course details webview
    if (course) {
      await this.courseWebviewProvider.show(
        say(`Course Settings: ${course.title || course.path}`, `Kurseinstellungen: ${course.title || course.path}`),
        {
          course: course,
          courseFamily: course.course_family,
          organization: course.organization
        }
      );
    }
  }

  // ---------------------------------------------------------------------
  // Hierarchy lifecycle: archive / delete of course, family, organization
  // ---------------------------------------------------------------------
  //
  // One flow for all three deletes: owner pre-check → dry run (the server
  // says what goes, what stays and whether the real call would be refused)
  // → preview modal → the entity's `path` typed out → the real call. The
  // typed confirmation is the same gate a folder delete in the documents
  // tree has (`DocumentsCommands.delete`); nothing here is undoable.

  private async deleteCourse(course: CourseList): Promise<void> {
    const label = course.title || course.path;
    const ctx = await this.buildScopeContext();
    if (!canDeleteCourse(course.id, ctx)) {
      await notify.modal('info', say(`Only an owner of this course can delete it.`, `Nur wer diesen Kurs besitzt, kann ihn löschen.`), {
        detail: say(`"${label}" can be deleted by a course owner or an administrator. Ask one of them, or ask to be made an owner.`, `„${label}“ können nur Kursbesitzer:innen oder die Administration löschen. Frag eine dieser Personen oder bitte darum, selbst Besitzer:in zu werden.`)
      });
      return;
    }

    const preview = await this.previewCascadeDelete(
      say(`Checking what deleting "${label}" would remove…`, `Es wird geprüft, was das Löschen von „${label}“ entfernen würde …`),
      () => this.apiService.deleteCourse(course.id, { dryRun: true })
    );
    if (preview === undefined) {
      return;
    }

    if (preview.blocked_reason) {
      // The server already knows the real call would be refused. Two cases:
      // an admin who has not archived yet (offer to), or an owner whose
      // course holds student submissions (only an admin can delete it).
      const needsArchive = ctx.scopes?.is_admin === true
        && !course.archived_at
        && /archive/i.test(preview.blocked_reason);
      const picked = await notify.modal('warning', say(`Cannot delete "${label}" yet`, `„${label}“ kann noch nicht gelöscht werden`), {
        detail: preview.blocked_reason,
        actions: needsArchive ? [say('Archive course', 'Kurs archivieren')] : []
      });
      if (picked === say('Archive course', 'Kurs archivieren')) {
        await this.archiveCourse(course);
      }
      return;
    }

    const proceed = await notify.modal('warning', say(`Delete course "${label}"?`, `Kurs „${label}“ löschen?`), {
      detail: formatCascadePreview(preview, { kind: 'course' }),
      actions: [say('Continue', 'Weiter')]
    });
    if (proceed !== say('Continue', 'Weiter')) {
      return;
    }
    if (!(await this.confirmByTypingPath('course', label, course.path))) {
      return;
    }

    try {
      const result = await notify.progress(say(`Deleting course "${label}"…`, `Kurs „${label}“ wird gelöscht …`), () =>
        this.apiService.deleteCourse(course.id)
      );
      this.reportCascadeResult(say(`Course "${label}" deleted.`, `Der Kurs „${label}“ wurde gelöscht.`), result);
      await this.forgetDeletedCourseSelection(course.id);
      this.treeDataProvider.refresh();
    } catch (error) {
      this.showDeleteError(error, say(`Failed to delete course "${label}"`, `Der Kurs „${label}“ konnte nicht gelöscht werden`), 'course');
    }
  }

  private async deleteCourseFamily(item: CourseFamilyTreeItem): Promise<void> {
    const family = item.courseFamily;
    const label = family.title || family.path;
    const ctx = await this.buildScopeContext();
    if (!canDeleteScope('course_family', family.id, ctx)) {
      await notify.modal('info', say(`Only an owner of this course family can delete it.`, `Nur wer diese Kursfamilie besitzt, kann sie löschen.`), {
        detail: say(`"${label}" can be deleted by a course family owner or an administrator.`, `„${label}“ können nur Besitzer:innen der Kursfamilie oder die Administration löschen.`)
      });
      return;
    }

    const preview = await this.previewCascadeDelete(
      say(`Checking what deleting "${label}" would remove…`, `Es wird geprüft, was das Löschen von „${label}“ entfernen würde …`),
      () => this.apiService.deleteCourseFamily(family.id, { dryRun: true })
    );
    if (preview === undefined) {
      return;
    }
    if (preview.blocked_reason) {
      await notify.modal('warning', say(`Cannot delete "${label}" yet`, `„${label}“ kann noch nicht gelöscht werden`), { detail: preview.blocked_reason });
      return;
    }

    const proceed = await notify.modal('warning', say(`Delete course family "${label}"?`, `Kursfamilie „${label}“ löschen?`), {
      detail: formatCascadePreview(preview, { kind: 'course_family' }),
      actions: [say('Continue', 'Weiter')]
    });
    if (proceed !== say('Continue', 'Weiter')) {
      return;
    }
    if (!(await this.confirmByTypingPath('course family', label, family.path))) {
      return;
    }

    try {
      const result = await notify.progress(say(`Deleting course family "${label}"…`, `Kursfamilie „${label}“ wird gelöscht …`), () =>
        this.apiService.deleteCourseFamily(family.id)
      );
      this.reportCascadeResult(say(`Course family "${label}" deleted.`, `Die Kursfamilie „${label}“ wurde gelöscht.`), result);
      this.treeDataProvider.refresh();
    } catch (error) {
      this.showDeleteError(error, say(`Failed to delete course family "${label}"`, `Die Kursfamilie „${label}“ konnte nicht gelöscht werden`), 'course family');
    }
  }

  private async deleteOrganization(item: OrganizationTreeItem): Promise<void> {
    const org = item.organization;
    const label = org.title || org.path;
    const ctx = await this.buildScopeContext();
    if (!canDeleteScope('organization', org.id, ctx)) {
      await notify.modal('info', say(`Only an owner of this organization can delete it.`, `Nur wer diese Organisation besitzt, kann sie löschen.`), {
        detail: say(`"${label}" can be deleted by an organization owner or an administrator.`, `„${label}“ können nur Besitzer:innen der Organisation oder die Administration löschen.`)
      });
      return;
    }

    const preview = await this.previewCascadeDelete(
      say(`Checking what deleting "${label}" would remove…`, `Es wird geprüft, was das Löschen von „${label}“ entfernen würde …`),
      () => this.apiService.deleteOrganization(org.id, { dryRun: true })
    );
    if (preview === undefined) {
      return;
    }
    if (preview.blocked_reason) {
      await notify.modal('warning', say(`Cannot delete "${label}" yet`, `„${label}“ kann noch nicht gelöscht werden`), { detail: preview.blocked_reason });
      return;
    }

    const proceed = await notify.modal('warning', say(`Delete organization "${label}"?`, `Organisation „${label}“ löschen?`), {
      detail: formatCascadePreview(preview, { kind: 'organization' }),
      actions: [say('Continue', 'Weiter')]
    });
    if (proceed !== say('Continue', 'Weiter')) {
      return;
    }
    if (!(await this.confirmByTypingPath('organization', label, org.path))) {
      return;
    }

    try {
      const result = await notify.progress(say(`Deleting organization "${label}"…`, `Organisation „${label}“ wird gelöscht …`), () =>
        this.apiService.deleteOrganization(org.id)
      );
      this.reportCascadeResult(say(`Organization "${label}" deleted.`, `Die Organisation „${label}“ wurde gelöscht.`), result);
      this.treeDataProvider.refresh();
    } catch (error) {
      this.showDeleteError(error, say(`Failed to delete organization "${label}"`, `Die Organisation „${label}“ konnte nicht gelöscht werden`), 'organization');
    }
  }

  private async archiveCourse(course: CourseList): Promise<void> {
    const label = course.title || course.path;
    const ctx = await this.buildScopeContext();
    if (!canDeleteCourse(course.id, ctx)) {
      await notify.modal('info', say(`Only an owner of this course can archive it.`, `Nur wer diesen Kurs besitzt, kann ihn archivieren.`));
      return;
    }
    const confirmed = await notify.confirm(
      say(`Archive course "${label}"?`, `Kurs „${label}“ archivieren?`),
      say('Archive', 'Archivieren'),
      say('Students and tutors will no longer see the course, and submissions and test runs are closed. It stays in your tree marked "Archived"; use Unarchive to reopen it.', 'Studierende und Tutor:innen sehen den Kurs nicht mehr, Abgaben und Testläufe sind geschlossen. Er bleibt in deinem Baum, als „Archiviert“ markiert; mit „Aus dem Archiv holen“ öffnest du ihn wieder.')
    );
    if (!confirmed) {
      return;
    }
    try {
      await this.apiService.archiveCourse(course.id);
      this.treeDataProvider.refresh();
      notify.info(say(`"${label}" is archived: hidden from students, submissions closed. Use Unarchive to reopen it.`, `„${label}“ ist archiviert: für Studierende verborgen, Abgaben geschlossen. Mit „Aus dem Archiv holen“ öffnest du ihn wieder.`));
    } catch (error) {
      showErrorWithSeverity(
        error instanceof Error ? error : new Error(String(error)),
        say(`Failed to archive course "${label}"`, `Der Kurs „${label}“ konnte nicht archiviert werden`)
      );
    }
  }

  private async unarchiveCourse(course: CourseList): Promise<void> {
    const label = course.title || course.path;
    const ctx = await this.buildScopeContext();
    if (!canDeleteCourse(course.id, ctx)) {
      await notify.modal('info', say(`Only an owner of this course can unarchive it.`, `Nur wer diesen Kurs besitzt, kann ihn aus dem Archiv holen.`));
      return;
    }
    const confirmed = await notify.confirm(
      say(`Unarchive course "${label}"?`, `Kurs „${label}“ aus dem Archiv holen?`),
      say('Unarchive', 'Aus dem Archiv holen'),
      say('The course becomes visible to its students and tutors again, and submissions and test runs reopen.', 'Der Kurs wird für seine Studierenden und Tutor:innen wieder sichtbar, Abgaben und Testläufe sind wieder offen.')
    );
    if (!confirmed) {
      return;
    }
    try {
      await this.apiService.unarchiveCourse(course.id);
      this.treeDataProvider.refresh();
      notify.info(say(`"${label}" is open again for its students.`, `„${label}“ ist für die Studierenden wieder offen.`));
    } catch (error) {
      showErrorWithSeverity(
        error instanceof Error ? error : new Error(String(error)),
        say(`Failed to unarchive course "${label}"`, `Der Kurs „${label}“ konnte nicht aus dem Archiv geholt werden`)
      );
    }
  }

  /** Dry run under a progress notification; `undefined` when it failed (already reported). */
  private async previewCascadeDelete(
    title: string,
    run: () => Promise<CascadeDeleteResult>
  ): Promise<CascadeDeleteResult | undefined> {
    try {
      return await notify.progress(title, () => run());
    } catch (error) {
      this.showDeleteError(error, say('Could not check what the delete would remove', 'Es konnte nicht geprüft werden, was das Löschen entfernen würde'), 'item');
      return undefined;
    }
  }

  /** The typed gate: the entity's own `path`, exactly. Empty input cancels. */
  private async confirmByTypingPath(kind: string, label: string, path: string): Promise<boolean> {
    const typed = await vscode.window.showInputBox({
      title: say(`Delete ${kind} "${label}"`, `${kindDe(kind).noun} „${label}“ löschen`),
      prompt: say(
        `This permanently deletes the ${kind} and everything listed. There is no undo. Type "${path}" to confirm.`,
        `Das löscht ${kindDe(kind).the} und alles Aufgeführte endgültig und lässt sich nicht rückgängig machen. Gib „${path}“ ein, um zu bestätigen.`
      ),
      placeHolder: path,
      ignoreFocusOut: true,
      validateInput: (value) => value === path || value.length === 0
        ? undefined
        : say(`Type "${path}" exactly, or leave empty to cancel.`, `Gib genau „${path}“ ein oder lass das Feld leer, um abzubrechen.`)
    });
    return typed === path;
  }

  private reportCascadeResult(headline: string, result: CascadeDeleteResult): void {
    const errors = result.errors ?? [];
    if (errors.length === 0) {
      notify.info(headline);
      return;
    }
    // The database part is done; what failed is on the git server side
    // (template/reference repos) or in storage. Say so instead of hiding it.
    void notify.modal('warning', say(`${headline} Some clean-up did not complete.`, `${headline} Ein Teil der Aufräumarbeiten wurde nicht abgeschlossen.`), {
      detail: errors.join('\n')
    });
  }

  private showDeleteError(error: unknown, fallback: string, kind: string): void {
    if (error instanceof HttpError && error.status === 409) {
      // A 409 here is "not deletable in this state" (children left, student
      // submissions, not archived). It arrives as CONFLICT_001, whose catalog
      // title ("Resource Already Exists") is wrong for it — the server's own
      // sentence is the message.
      void notify.modal('warning', say(`Cannot delete this ${kind} yet`, `${kindDe(kind).this} kann noch nicht gelöscht werden`), {
        detail: error.serverDetail || fallback
      });
      return;
    }
    if (error instanceof HttpError && error.status === 403) {
      void notify.modal('info', say(
        `Only an owner of this ${kind} (or an administrator) can delete it.`,
        `Löschen können nur Besitzer:innen ${kindDe(kind).ofThis} oder die Administration.`
      ), {
        detail: error.serverDetail
      });
      return;
    }
    showErrorWithSeverity(error instanceof Error ? error : new Error(String(error)), fallback);
  }

  /** A deleted course must not stay the "current" one for the student side. */
  private async forgetDeletedCourseSelection(courseId: string): Promise<void> {
    try {
      const selection = CourseSelectionService.getInstance();
      if (selection.getCurrentCourseId() === courseId) {
        await selection.clearSelection();
      }
    } catch {
      // Selection service not initialized (no student side in this window).
    }
  }

  /** The roles the current user holds, for the in-command owner checks. */
  private async buildScopeContext(): Promise<ScopePermissionContext> {
    const [scopes, currentUser] = await Promise.all([
      this.apiService.getUserScopes(),
      this.apiService.getUserAccount().catch(() => undefined)
    ]);
    const globalRoles = new Set(
      (currentUser?.user_roles ?? [])
        .map(r => r?.role_id)
        .filter((id): id is string => typeof id === 'string')
    );
    return { scopes, globalRoles };
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
    notify.error(say('Course contents can only be created under the Contents folder or another content item.', 'Kursinhalte lassen sich nur im Ordner „Inhalte“ oder unter einem anderen Inhalt anlegen.'));
    return undefined;
  }

  private async pickContentType(
    courseId: string,
    opts: { submittable: boolean; noneMessage: string }
  ): Promise<CourseContentTypeList | undefined> {
    const types = await this.apiService.getCourseContentTypes(courseId);
    if (types.length === 0) {
      notify.warning(say('No content types available. Please create a content type first.', 'Keine Inhaltstypen verfügbar. Lege zuerst einen Inhaltstyp an.'));
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
        description: localizedKindTitle(t.course_content_kind_id, t.course_content_kind?.title, uiLanguage()) || '',
        contentType: t
      })),
      { placeHolder: say('Select content type', 'Inhaltstyp auswählen') }
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
      noneMessage: say('No non-submittable content types are configured for this course. Create one first.', 'Für diesen Kurs ist kein Inhaltstyp ohne Abgabe konfiguriert. Lege zuerst einen an.')
    });
    if (!contentType) { return; }

    const title = await vscode.window.showInputBox({
      prompt: say('Enter unit title', 'Titel der Einheit eingeben'),
      placeHolder: say('e.g., Week 1: Introduction', 'z. B. Woche 1: Einführung')
    });
    if (!title) { return; }

    // Use the result: a failed create notifies from inside the provider and
    // returns undefined, and staying silent here is what let a create look
    // like it had worked (computor-org/issues#162). The provider has already
    // refreshed the course, so there is nothing to refresh a second time.
    const created = await this.treeDataProvider.createCourseContent(
      target.folderItem,
      title,
      contentType.id,
      target.parentPath,
      this.slugify(title, 'unit'),
      undefined
    );
    if (!created) { return; }

    notify.info(say(`Created unit "${title}"`, `Die Einheit „${title}“ wurde angelegt.`));
  }

  private async createAssignment(item: CourseFolderTreeItem | CourseContentTreeItem): Promise<void> {
    const target = this.resolveCreateTarget(item);
    if (!target) { return; }

    const contentType = await this.pickContentType(target.course.id, {
      submittable: true,
      noneMessage: say('No submittable content types (assignments, exercises) are configured for this course. Create one first.', 'Für diesen Kurs ist kein Inhaltstyp mit Abgabe (Aufgaben, Übungen) konfiguriert. Lege zuerst einen an.')
    });
    if (!contentType) { return; }

    const examples = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: say('Loading examples...', 'Beispiele werden geladen …') },
      () => this.apiService.getAvailableExamples()
    );
    if (!examples || examples.length === 0) {
      notify.warning(say('No examples available. Upload examples in the Examples view first.', 'Keine Beispiele verfügbar. Lade zuerst Beispiele in der Ansicht „Beispiele“ hoch.'));
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
        placeHolder: say('Select example to assign', 'Beispiel zum Zuweisen auswählen'),
        matchOnDescription: true,
        matchOnDetail: true
      }
    );
    if (!selectedExample) { return; }

    const versions = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: say('Loading versions...', 'Versionen werden geladen …') },
      () => this.apiService.getExampleVersions(selectedExample.id)
    );
    if (!versions || versions.length === 0) {
      notify.warning(say('No versions available for this example.', 'Für dieses Beispiel gibt es keine Versionen.'));
      return;
    }

    const sortedVersions = [...versions].sort((a, b) => b.version_number - a.version_number);
    const latest = sortedVersions[0];
    const selectedVersion = sortedVersions.length === 1 && latest
      ? { versionTag: latest.version_tag }
      : await vscode.window.showQuickPick(
          sortedVersions.map(v => ({
            label: v.version_tag,
            description: say(`Created: ${new Date(v.created_at).toLocaleDateString(uiLocale())}`, `Erstellt: ${new Date(v.created_at).toLocaleDateString(uiLocale())}`),
            versionTag: v.version_tag
          })),
          { placeHolder: say('Select version (latest first)', 'Version auswählen (neueste zuerst)') }
        );
    if (!selectedVersion) { return; }

    const title = await vscode.window.showInputBox({
      prompt: say('Enter assignment title', 'Titel der Aufgabe eingeben'),
      value: selectedExample.exampleTitle,
      placeHolder: say('Assignment title', 'Titel der Aufgabe')
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
        const assignMessage = assignError?.response?.data?.detail || assignError.message || say('Unknown error', 'unbekannter Fehler');
        const action = await notify.warning(
          say(`Assignment "${title}" was created but the example could not be assigned: ${assignMessage}. Keep the assignment without an example?`, `Die Aufgabe „${title}“ wurde angelegt, aber das Beispiel konnte nicht zugewiesen werden: ${assignMessage}. Aufgabe ohne Beispiel behalten?`),
          say('Keep', 'Behalten'), say('Delete', 'Löschen')
        );
        if (action === say('Delete', 'Löschen')) {
          await this.apiService.deleteCourseContent(target.course.id, createdContent.id);
        }
        this.apiService.clearCourseCache(target.course.id);
        this.treeDataProvider.refresh();
        return;
      }

      await this.treeDataProvider.forceRefreshCourse(target.course.id);
      notify.info(
        say(`Created assignment "${title}" with example "${selectedExample.label}" ${selectedVersion.versionTag}`, `Die Aufgabe „${title}“ wurde mit dem Beispiel „${selectedExample.label}“ ${selectedVersion.versionTag} angelegt.`)
      );
    } catch (error: any) {
      const errorMessage = error?.response?.data?.detail || error.message || say('Unknown error', 'unbekannter Fehler');
      notify.error(say(`Failed to create assignment: ${errorMessage}`, `Die Aufgabe konnte nicht angelegt werden: ${errorMessage}`));
    }
  }

  private async changeCourseContentType(item: CourseContentTreeItem): Promise<void> {
    if (!item || !item.courseContent) {
      notify.error(say('Invalid course content item', 'Ungültiger Kursinhalt.'));
      return;
    }

    try {
      // Get available content types for this course
      const contentTypes = await this.apiService.getCourseContentTypes(item.course.id);
      
      if (contentTypes.length === 0) {
        notify.warning(say('No content types available in this course.', 'In diesem Kurs gibt es keine Inhaltstypen.'));
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
            ? (localizedKindTitle(ct.course_content_kind_id, undefined, uiLanguage()) || say('unknown', 'unbekannt'))
            : say(`$(warning) ${localizedKindTitle(ct.course_content_kind_id, undefined, uiLanguage()) || 'unknown'} — changes the kind; only possible while the content is empty`, `$(warning) ${localizedKindTitle(ct.course_content_kind_id, undefined, uiLanguage()) || 'unbekannt'} – ändert die Art; nur möglich, solange der Inhalt leer ist`),
          id: ct.id,
          contentType: ct
        }));

      if (availableTypes.length === 0) {
        notify.info(say('No other content types available to switch to.', 'Es gibt keinen anderen Inhaltstyp, zu dem du wechseln kannst.'));
        return;
      }

      const selectedType = await vscode.window.showQuickPick(availableTypes, {
        placeHolder: say(`Change from "${currentTypeLabel}" to...`, `Von „${currentTypeLabel}“ wechseln zu …`),
        title: say('Select New Content Type', 'Neuen Inhaltstyp auswählen')
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
        say(`Changed content type from "${currentTypeLabel}" to "${selectedType.label}"`, `Inhaltstyp von „${currentTypeLabel}“ zu „${selectedType.label}“ geändert.`)
      );

      // Clear cache and refresh the tree
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();

    } catch (error) {
      console.error('Failed to change course content type:', error);
      showErrorWithSeverity(error as Error, say('Failed to change content type', 'Der Inhaltstyp konnte nicht geändert werden'));
    }
  }

  /**
   * Set one of the two per-assignment budgets straight from the tree. Both were
   * reachable only through the details view (computor-org/issues#356).
   *
   * An empty answer clears the limit; `0` is kept as a real zero rather than
   * being folded into "unlimited", which is what the details form's
   * `parseInt(...) || null` did to it.
   */
  private async setSubmissionLimit(
    item: CourseContentTreeItem,
    field: 'max_test_runs' | 'max_submissions'
  ): Promise<void> {
    if (!item?.courseContent?.id || !item.course?.id) {
      notify.warning(say('Select an assignment first.', 'Wähle zuerst eine Aufgabe aus.'));
      return;
    }

    const label = field === 'max_test_runs' ? say('Max Test Runs', 'Höchstzahl der Testläufe') : say('Max Submissions', 'Höchstzahl der Abgaben');
    const current = (item.courseContent as any)[field] as number | null | undefined;

    const answer = await vscode.window.showInputBox({
      title: say(`Set ${label}`, `${label} festlegen`),
      prompt: say(`How many ${field === 'max_test_runs' ? 'test runs' : 'submissions'} may a student use for "${item.courseContent.title || item.courseContent.path}"? Leave empty for unlimited.`, `Wie viele ${field === 'max_test_runs' ? 'Testläufe' : 'Abgaben'} stehen Studierenden für „${item.courseContent.title || item.courseContent.path}“ zur Verfügung? Leer lassen bedeutet unbegrenzt.`),
      value: typeof current === 'number' ? String(current) : '',
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) { return undefined; }
        if (!/^\d+$/.test(trimmed)) { return say('Enter a whole number, or leave empty for unlimited.', 'Gib eine ganze Zahl ein oder lass das Feld leer für unbegrenzt.'); }
        return undefined;
      }
    });

    if (answer === undefined) { return; }

    const trimmed = answer.trim();
    const value = trimmed.length === 0 ? null : Number.parseInt(trimmed, 10);
    if (value === (current ?? null)) { return; }

    try {
      await this.treeDataProvider.updateCourseContent(item, { [field]: value } as any);
      await this.treeDataProvider.refresh();
      notify.info(value === null ? say(`${label}: unlimited`, `${label}: unbegrenzt`) : `${label}: ${value}`);
    } catch (error: any) {
      notify.error(say(`Failed to set ${label}: ${error?.message || error}`, `${label} konnte nicht festgelegt werden: ${error?.message || error}`));
    }
  }

  /**
   * Set a course-wide default for one of the two budgets.
   *
   * The bottom tier of the three: an assignment that names its own limit wins
   * over this, and a submission group's grant wins over both. It exists so a
   * lecturer can cap a whole course once instead of per assignment
   * (computor-org/issues#393), and stays lecturer-only — only the group-level
   * grant is open to tutors.
   */
  private async setCourseBudget(
    item: CourseTreeItem,
    field: 'max_test_runs' | 'max_submissions'
  ): Promise<void> {
    if (!item?.course?.id) {
      notify.warning(say('Select a course first.', 'Wähle zuerst einen Kurs aus.'));
      return;
    }

    const label = field === 'max_test_runs' ? say('Max Test Runs', 'Höchstzahl der Testläufe') : say('Max Submissions', 'Höchstzahl der Abgaben');
    const noun = field === 'max_test_runs' ? say('test runs', 'Testläufe') : say('submissions', 'Abgaben');
    const current = (item.course as any)[field] as number | null | undefined;

    const answer = await vscode.window.showInputBox({
      title: say(`Set Course Default: ${label}`, `Kursstandard festlegen: ${label}`),
      prompt: say(`How many ${noun} may a student use for an assignment in `, `Wie viele ${noun} stehen Studierenden für eine Aufgabe in `)
        + say(`"${item.course.title || item.course.path}" that does not set its own limit? `, `„${item.course.title || item.course.path}“ zur Verfügung, die kein eigenes Limit festlegt? `)
        + say(`Leave empty for unlimited.`, `Leer lassen bedeutet unbegrenzt.`),
      value: typeof current === 'number' ? String(current) : '',
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) { return undefined; }
        if (!/^\d+$/.test(trimmed)) { return say('Enter a whole number, or leave empty for unlimited.', 'Gib eine ganze Zahl ein oder lass das Feld leer für unbegrenzt.'); }
        return undefined;
      }
    });

    if (answer === undefined) { return; }

    const trimmed = answer.trim();
    const value = trimmed.length === 0 ? null : Number.parseInt(trimmed, 10);
    if (value === (current ?? null)) { return; }

    try {
      await this.apiService.updateCourse(item.course.id, { [field]: value } as any);
      await this.treeDataProvider.refresh();
      notify.info(
        value === null
          ? say(`Course default ${label}: unlimited`, `Kursstandard für ${label}: unbegrenzt`)
          : say(`Course default ${label}: ${value} (assignments that set their own limit are unaffected)`, `Kursstandard für ${label}: ${value} (Aufgaben mit eigenem Limit bleiben unverändert)`)
      );
    } catch (error: any) {
      notify.error(say(`Failed to set ${label}: ${error?.message || error}`, `${label} konnte nicht festgelegt werden: ${error?.message || error}`));
    }
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
          subtitle: say('Organization', 'Organisation'),
          query: { scope: 'organization', organization_id: item.organization.id },
          createPayload: { organization_id: item.organization.id },
          sourceRole: 'lecturer',
          wsChannel: `organization:${item.organization.id}`,
          readOnly: !canPost,
          readOnlyReason: canPost ? undefined : say('Posting to this organization requires manager or owner role.', 'Um in dieser Organisation zu schreiben, brauchst du die Rolle Manager oder Owner.')
        };
      } else if (item instanceof CourseFamilyTreeItem) {
        const scopes = await this.apiService.getUserScopes();
        const canPost = canPostToCourseFamily(scopes, item.courseFamily.id);
        target = {
          title: item.courseFamily.title || item.courseFamily.path,
          subtitle: say(`${item.organization.title || item.organization.path} › Course Family`, `${item.organization.title || item.organization.path} › Kursfamilie`),
          query: { scope: 'course_family', course_family_id: item.courseFamily.id },
          createPayload: { course_family_id: item.courseFamily.id },
          sourceRole: 'lecturer',
          wsChannel: `course_family:${item.courseFamily.id}`,
          readOnly: !canPost,
          readOnlyReason: canPost ? undefined : say('Posting to this course family requires manager or owner role.', 'Um in dieser Kursfamilie zu schreiben, brauchst du die Rolle Manager oder Owner.')
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
          title: item.group.title || say(`Group ${item.group.id.slice(0, 8)}`, `Gruppe ${item.group.id.slice(0, 8)}`),
          subtitle: say(`${this.buildCourseSubtitle(item.course, item.courseFamily, item.organization)} › Group`, `${this.buildCourseSubtitle(item.course, item.courseFamily, item.organization)} › Gruppe`),
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
        notify.warning(say('Messages are not available for this item.', 'Für dieses Element gibt es keine Nachrichten.'));
        return;
      }

      await this.messagesWebviewProvider.showMessages(target);
    } catch (error: any) {
      notify.error(say(`Failed to open messages: ${error?.message || error}`, `Die Nachrichten konnten nicht geöffnet werden: ${error?.message || error}`));
    }
  }

  private async showCourseMemberComments(item: CourseMemberTreeItem): Promise<void> {
    try {
      const given = item.member.user?.given_name;
      const family = item.member.user?.family_name;
      const fullName = [given, family].filter(Boolean).join(' ').trim();
      const displayName = fullName
        || item.member.user?.email
        || say(`Member ${item.member.id.slice(0, 8)}`, `Mitglied ${item.member.id.slice(0, 8)}`);
      const title = `${displayName} — ${item.course.title || item.course.path}`;
      await this.commentsWebviewProvider.showComments(item.member.id, title);
    } catch (error: any) {
      notify.error(say(`Failed to open comments: ${error?.message || error}`, `Die Kommentare konnten nicht geöffnet werden: ${error?.message || error}`));
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
        || say(`Member ${item.member.id.slice(0, 8)}`, `Mitglied ${item.member.id.slice(0, 8)}`);

      // Get the course's GitLab token (GLPAT)
      const gitlabToken = await this.treeDataProvider.getGitLabTokenForCourse(item.course);

      if (!gitlabToken) {
        notify.error(
          say('No GitLab token configured for this course. Please configure the GitLab token first.', 'Für diesen Kurs ist kein GitLab-Token konfiguriert. Konfiguriere zuerst das GitLab-Token.')
        );
        return;
      }

      // Show progress notification
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: say(`Syncing GitLab permissions for ${displayName}`, `GitLab-Berechtigungen für ${displayName} werden synchronisiert`),
          cancellable: false
        },
        async (progress) => {
          progress.report({ increment: 0, message: say('Contacting server...', 'Server wird kontaktiert …') });

          const result = await this.apiService.syncMemberGitlabPermissions(
            item.member.id,
            { access_token: gitlabToken }
          );

          progress.report({ increment: 100, message: say('Done', 'Fertig') });

          // Show success message with the result
          const message = result.message || say('GitLab permissions synced successfully', 'GitLab-Berechtigungen wurden synchronisiert.');
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
      notify.error(say(`Failed to sync GitLab permissions: ${errorMessage}`, `Die GitLab-Berechtigungen konnten nicht synchronisiert werden: ${errorMessage}`));
      console.error('Error syncing GitLab permissions:', error);
    }
  }

  private buildCourseSubtitle(course: CourseList, courseFamily: CourseFamilyList, organization: OrganizationList): string {
    const orgName = organization.title || organization.path;
    const familyName = courseFamily.title || courseFamily.path;
    const courseName = course.title || course.path;
    return `${orgName} / ${familyName} / ${courseName}`;
  }

  /**
   * Renames the *title* — the label shown in the tree. It deliberately does not
   * touch the content's path, its deployment directory or the example's
   * meta.yaml; the command was simply called "Rename", which left lecturers
   * guessing which of those it meant (computor-org/issues#356).
   */
  private async renameCourseContent(item: CourseContentTreeItem): Promise<void> {
    const currentTitle = item.courseContent.title || '';
    const newTitle = await vscode.window.showInputBox({
      title: say('Rename Title', 'Titel ändern'),
      prompt: say('New title shown in the tree. The path, the deployment folder and meta.yaml stay as they are.', 'Neuer Titel im Baum. Pfad, Bereitstellungsordner und meta.yaml bleiben unverändert.'),
      value: currentTitle
    });

    if (!newTitle || newTitle === currentTitle) {
      return;
    }

    try {
      await this.treeDataProvider.updateCourseContent(item, { title: newTitle });
      notify.info(say(`Content renamed to "${newTitle}"`, `Inhalt umbenannt in „${newTitle}“.`));
      
      // Force a full refresh to ensure the tree updates
      await this.treeDataProvider.refresh();
    } catch (error) {
      notify.error(say(`Failed to rename content: ${error}`, `Der Inhalt konnte nicht umbenannt werden: ${error}`));
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
      notify.error(say(`Failed to move "${content.title || content.path}": ${detail}`, `„${content.title || content.path}“ konnte nicht verschoben werden: ${detail}`));
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
        { label: say('$(root-folder) Course root', '$(root-folder) Oberste Ebene des Kurses'), description: say('not inside any unit', 'in keiner Einheit'), unitPath: '' },
        ...units.map((unit) => ({
          label: unit.title || unit.path,
          description: unit.path,
          unitPath: unit.path
        }))
      ];

      const chosen = await vscode.window.showQuickPick(picks, {
        title: mode === 'prepend'
          ? say(`Move "${content.title || content.path}" to the start of…`, `„${content.title || content.path}“ an den Anfang verschieben von …`)
          : say(`Move "${content.title || content.path}" to the end of…`, `„${content.title || content.path}“ an das Ende verschieben von …`)
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
          say(`"${chosen.label}" already contains something at "${slug}" (${clash.title || clash.path}). `, `„${chosen.label}“ enthält unter „${slug}“ bereits etwas (${clash.title || clash.path}). `) +
          say('Rename one of them first.', 'Benenne zuerst eines davon um.')
        );
        return;
      }

      await this.apiService.moveCourseContent(courseId, content.id, targetPath, position);
      await this.treeDataProvider.forceRefreshCourse(courseId);
      notify.info(
        say(`Moved "${content.title || content.path}" to the ${mode === 'prepend' ? 'start' : 'end'} of ${chosen.label}`, `„${content.title || content.path}“ wurde an ${mode === 'prepend' ? 'den Anfang' : 'das Ende'} von ${chosen.label} verschoben.`)
      );
    } catch (error: any) {
      const detail = error?.response?.detail || error?.message || error;
      notify.error(say(`Failed to move "${content.title || content.path}": ${detail}`, `„${content.title || content.path}“ konnte nicht verschoben werden: ${detail}`));
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
      prompt: say('Enter new title for content type', 'Neuen Titel für den Inhaltstyp eingeben'),
      value: currentTitle
    });

    if (!newTitle || newTitle === currentTitle) {
      return;
    }

    try {
      await this.apiService.updateCourseContentType(item.contentType.id, { title: newTitle });
      notify.info(say(`Content type renamed to "${newTitle}"`, `Inhaltstyp umbenannt in „${newTitle}“.`));
      await this.treeDataProvider.refresh();
    } catch (error) {
      showErrorWithSeverity(error as Error, say('Failed to rename content type', 'Der Inhaltstyp konnte nicht umbenannt werden'));
    }
  }

  private async deleteCourseContent(item: CourseContentTreeItem): Promise<void> {
    if (!item.courseContent || !item.courseContent.id) {
      notify.error(say('Invalid course content item - missing required data', 'Ungültiger Kursinhalt: erforderliche Daten fehlen.'));
      return;
    }

    const title = item.courseContent.title || item.courseContent.path;
    const confirmation = await notify.warning(
      say(`Are you sure you want to delete "${title}"?`, `Möchtest du „${title}“ wirklich löschen?`),
      say('Yes', 'Ja'),
      say('No', 'Nein')
    );

    if (confirmation !== say('Yes', 'Ja')) { return; }

    try {
      await this.apiService.deleteCourseContent(item.course.id, item.courseContent.id);
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();
      notify.info(say(`Deleted "${title}" successfully`, `„${title}“ wurde gelöscht.`));
    } catch (error: any) {
      if (error instanceof HttpError && (error.errorCode === 'CONTENT_006' || error.errorCode === 'CONTENT_007')) {
        const archiveChoice = await notify.warning(
          say(`Cannot delete "${title}" because it has student submissions. Would you like to archive it instead?`, `„${title}“ kann nicht gelöscht werden, weil es Abgaben von Studierenden gibt. Möchtest du es stattdessen archivieren?`),
          say('Archive', 'Archivieren'),
          say('Cancel', 'Abbrechen')
        );
        if (archiveChoice === say('Archive', 'Archivieren')) {
          await this.archiveCourseContent(item);
        }
      } else {
        notify.error(say(`Failed to delete "${title}": ${error.message || error}`, `„${title}“ konnte nicht gelöscht werden: ${error.message || error}`));
      }
    }
  }

  private async archiveCourseContent(item: CourseContentTreeItem): Promise<void> {
    if (!item.courseContent?.id || !item.course?.id) {
      notify.error(say('Invalid course content item', 'Ungültiger Kursinhalt.'));
      return;
    }

    const title = item.courseContent.title || item.courseContent.path;

    try {
      await this.apiService.archiveCourseContent(item.course.id, item.courseContent.id);
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();
      // "Archived successfully" said nothing about where the content went, and
      // it goes nowhere: it stays right here, marked, and vanishes for students
      // (computor-org/issues#356).
      notify.info(
        say(`"${title}" is no longer visible to students. It stays in your tree marked "Archived" — use Unarchive to bring it back.`, `„${title}“ ist für Studierende nicht mehr sichtbar. Es bleibt in deinem Baum, als „Archiviert“ markiert; mit „Aus dem Archiv holen“ holst du es zurück.`)
      );
    } catch (error: any) {
      notify.error(say(`Failed to archive "${title}": ${error.message || error}`, `„${title}“ konnte nicht archiviert werden: ${error.message || error}`));
    }
  }

  private async unarchiveCourseContent(item: CourseContentTreeItem): Promise<void> {
    if (!item.courseContent?.id || !item.course?.id) {
      notify.error(say('Invalid course content item', 'Ungültiger Kursinhalt.'));
      return;
    }

    const title = item.courseContent.title || item.courseContent.path;

    try {
      await this.apiService.unarchiveCourseContent(item.course.id, item.courseContent.id);
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();
      notify.info(say(`Unarchived "${title}" successfully`, `„${title}“ wurde aus dem Archiv geholt.`));
    } catch (error: any) {
      notify.error(say(`Failed to unarchive "${title}": ${error.message || error}`, `„${title}“ konnte nicht aus dem Archiv geholt werden: ${error.message || error}`));
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
          notify.warning(say('No example assigned to this assignment', 'Dieser Aufgabe ist kein Beispiel zugewiesen.'));
          return;
        }
        const example = await this.apiService.getExample(deployment.example_id);
        if (!example) {
          notify.warning(say('Could not load example information', 'Die Beispielinformationen konnten nicht geladen werden.'));
          return;
        }
        exampleInfo = { id: example.id, title: example.title, identifier: example.identifier };
        currentVersionTag = currentVersionTag || deployment.version_tag;
      }

      const versions = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: say('Loading available versions...', 'Verfügbare Versionen werden geladen …'),
        cancellable: false
      }, async () => {
        return await this.apiService.getExampleVersions(exampleInfo!.id);
      });

      if (!versions || versions.length === 0) {
        notify.warning(say('No versions available for this example', 'Für dieses Beispiel gibt es keine Versionen.'));
        return;
      }

      const selectedVersion = await vscode.window.showQuickPick(
        versions.map(v => ({
          label: v.version_tag,
          description: v.version_tag === currentVersionTag ? say('(current)', '(aktuell)') : say(`Created: ${new Date(v.created_at).toLocaleDateString(uiLocale())}`, `Erstellt: ${new Date(v.created_at).toLocaleDateString(uiLocale())}`),
          versionTag: v.version_tag
        })),
        {
          placeHolder: say(`Select version (current: ${currentVersionTag || 'unknown'})`, `Version auswählen (aktuell: ${currentVersionTag || 'unbekannt'})`)
        }
      );

      if (!selectedVersion) {
        return;
      }

      if (selectedVersion.versionTag === currentVersionTag) {
        notify.info(say('Already on this version', 'Diese Version ist bereits eingestellt.'));
        return;
      }

      const confirm = await notify.info(
        say(`Update "${exampleInfo.title}" from v${currentVersionTag} to v${selectedVersion.versionTag}?`, `„${exampleInfo.title}“ von v${currentVersionTag} auf v${selectedVersion.versionTag} aktualisieren?`),
        say('Update', 'Aktualisieren'),
        say('Cancel', 'Abbrechen')
      );

      if (confirm !== say('Update', 'Aktualisieren')) {
        return;
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: say('Updating example version...', 'Beispielversion wird aktualisiert …'),
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
        say(`Example version updated to v${selectedVersion.versionTag}`, `Beispielversion auf v${selectedVersion.versionTag} aktualisiert.`)
      );

      this.apiService.clearCourseCache(courseId);
      this.treeDataProvider.refresh();

    } catch (error: any) {
      console.error('Failed to update example version:', error);
      const errorMessage = error?.response?.data?.detail || error.message || say('Unknown error', 'unbekannter Fehler');
      notify.error(say(`Failed to update example version: ${errorMessage}`, `Die Beispielversion konnte nicht aktualisiert werden: ${errorMessage}`));
    }
  }

  private async batchUpdateExampleVersions(item: CourseTreeItem | CourseFolderTreeItem | CourseContentTreeItem): Promise<void> {
    const scopeInfo = this.buildReleaseScopeFromTreeItem(item);
    if (!scopeInfo) { return; }
    const { courseId, scope } = scopeInfo;

    try {
      const updatableItems = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: say('Scanning for updatable assignments...', 'Aufgaben mit neueren Beispielversionen werden gesucht …'),
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
        const scopeText = scope?.label ? say(` under "${scope.label}"`, ` unter „${scope.label}“`) : '';
        notify.info(say(`All assignments${scopeText} are already on their latest example versions.`, `Alle Aufgaben${scopeText} verwenden bereits die neueste Beispielversion.`));
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
        title: say(`Update example versions${scope?.label ? ` — ${scope.label}` : ''}`, `Beispielversionen aktualisieren${scope?.label ? ` – ${scope.label}` : ''}`),
        placeHolder: say(`${updatableItems.length} assignment(s) have newer versions available`, `Für ${updatableItems.length} Aufgabe(n) gibt es neuere Versionen`)
      });

      if (!selected || selected.length === 0) { return; }

      const selectedIds = new Set(selected.map(s => s.contentId));

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: say('Updating example versions...', 'Beispielversionen werden aktualisiert …'),
        cancellable: false
      }, async () => {
        const contentIds = [...selectedIds];
        const result = await this.apiService.lecturerBatchUpgradeVersions(courseId, contentIds);

        if (result.total_failed === 0) {
          notify.info(say(`Updated ${result.total_upgraded} assignment(s) to latest example versions.`, `${result.total_upgraded} Aufgabe(n) auf die neueste Beispielversion aktualisiert.`));
        } else {
          notify.warning(say(`Updated ${result.total_upgraded} assignment(s), ${result.total_failed} failed.`, `${result.total_upgraded} Aufgabe(n) aktualisiert, ${result.total_failed} fehlgeschlagen.`));
        }
      });

      this.apiService.clearCourseCache(courseId);
      await this.treeDataProvider.forceRefreshCourse(courseId);

    } catch (error: any) {
      console.error('Failed to batch update example versions:', error);
      const errorMessage = error?.response?.data?.detail || error.message || say('Unknown error', 'unbekannter Fehler');
      notify.error(say(`Failed to update example versions: ${errorMessage}`, `Die Beispielversionen konnten nicht aktualisiert werden: ${errorMessage}`));
    }
  }


  private async openRemoteRepository(item: CourseTreeItem | CourseMemberTreeItem): Promise<void> {
    try {
      let webUrl: string | undefined;
      let itemType: string;

      if (item instanceof CourseMemberTreeItem) {
        // For course members, we need to fetch the full member data to get the GitLab project URL
        itemType = say('member project', 'Projekt des Mitglieds');
        const memberData = await this.apiService.getCourseMember(item.member.id);

        if (memberData?.properties?.gitlab?.url && memberData.properties.gitlab.full_path) {
          // Build the full GitLab project URL
          const gitlabHost = memberData.properties.gitlab.url;
          const projectPath = memberData.properties.gitlab.full_path;
          webUrl = `${gitlabHost}/${projectPath}`;
        } else {
          notify.warning(
            say('No repository is recorded for this course member yet — it is created when they first open the course.', 'Für dieses Kursmitglied ist noch kein Repository hinterlegt. Es entsteht, wenn die Person den Kurs zum ersten Mal öffnet.')
          );
          return;
        }
      } else {
        itemType = say('course repositories', 'Kurs-Repositorys');
        webUrl = await this.courseGitNamespaceUrl(item.course);
        if (!webUrl) {
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
        notify.info(say(`Opening ${itemType} in browser`, `Im Browser wird geöffnet: ${itemType}`));
      }
    } catch (error) {
      notify.error(say(`Failed to open repository: ${error}`, `Das Repository konnte nicht geöffnet werden: ${error}`));
    }
  }

  /**
   * Web URL of the git namespace holding a course's repositories — the place
   * where assignments, student-template and reference live.
   *
   * A course on the current git server keeps its location on the git *binding*;
   * `properties.gitlab` is a leftover of the era when every course was
   * provisioned into a GitLab group, and modern courses simply never have it.
   * Reading only that property made this command claim "No repository found for
   * this course" for courses whose repositories exist and are in daily use
   * (computor-org/issues#356). The binding comes first now, the old property
   * stays as the fallback for courses that predate it.
   *
   * Returns undefined after telling the lecturer what is missing.
   */
  private async courseGitNamespaceUrl(course: CourseList): Promise<string | undefined> {
    let binding: CourseGitBindingGet | null = null;
    try {
      binding = await this.apiService.getCourseGitBinding(String(course.id));
    } catch (error) {
      // A lecturer without git-manage rights cannot read the binding; fall
      // through to the legacy property rather than failing the command.
      console.warn('Could not read course git binding:', error);
    }

    // web_url is the browser-audience address; template_url is the CLONE URL
    // for whoever asked, and inside a workspace that is the workspace-internal
    // git host — dead in a browser tab (issue #356). Prefer web_url and keep
    // template_url only for bindings from a backend that predates the field.
    const browserUrl = binding?.web_url || binding?.template_url;
    const namespace = browserUrl ? parentRepositoryUrl(browserUrl) : undefined;
    if (namespace) {
      return namespace;
    }

    const legacy = course.properties?.gitlab;
    if (legacy?.url && legacy.full_path) {
      return `${legacy.url}/${legacy.full_path}`;
    }

    if (binding && binding.delivery === 'download') {
      notify.warning(
        say('This course hands out assignments as downloads, so it has no git repositories to open.', 'Dieser Kurs gibt Aufgaben als Download aus und hat daher keine Git-Repositorys zum Öffnen.')
      );
    } else if (binding) {
      notify.warning(
        say('This course has a git binding, but no student-template location is recorded for it yet.', 'Dieser Kurs ist an Git angebunden, aber für ihn ist noch kein Ort der Studierendenvorlage hinterlegt.')
      );
    } else {
      notify.warning(
        say('This course is not connected to a git server yet. Use "Configure Course Git" on the course to set it up.', 'Dieser Kurs ist noch mit keinem Git-Server verbunden. Richte das über „Git für den Kurs konfigurieren“ am Kurs ein.')
      );
    }
    return undefined;
  }

  private async createCourseContentType(item: CourseFolderTreeItem): Promise<void> {
    if (item.folderType !== 'contentTypes') {
      return;
    }

    // Get available content kinds
    const contentKinds = await this.apiService.getCourseContentKinds();
    if (contentKinds.length === 0) {
      notify.error(say('No content kinds available in the system', 'Im System sind keine Inhaltsarten verfügbar.'));
      return;
    }

    // Select content kind. The kind titles read "Unit" and "Assignment", the
    // same words as the contents themselves, so spell out that this step picks
    // the category a *type* belongs to — a lecturer in issues#387 created a
    // type called "Unit 1" believing it had created a unit.
    const kindItems = contentKinds.map(k => ({
      label: localizedKindTitle(k.id, k.title, uiLanguage()) || k.id,
      description: k.submittable ? say('submittable', 'mit Abgabe') : say('not submittable', 'ohne Abgabe'),
      detail: k.has_descendants
        ? say('Groups other content; students do not submit to it (e.g. a week or a chapter)', 'Fasst andere Inhalte zusammen; Studierende geben dazu nichts ab (z. B. eine Woche oder ein Kapitel)')
        : say('Students submit work to content of this kind', 'Zu Inhalten dieser Art geben Studierende Arbeiten ab'),
      kindData: k
    }));

    const selectedKind = await vscode.window.showQuickPick(
      kindItems,
      { placeHolder: say('Which kind of content will this type describe?', 'Welche Art von Inhalt soll dieser Typ beschreiben?') }
    );

    if (!selectedKind) {
      return;
    }

    const kindLabel = selectedKind.label;

    // Auto-generate slug from title: lowercase, replace spaces with underscores, remove non-alphanumeric
    const deriveSlug = (value: string): string => value.toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/^_|_$/g, '');

    const title = await vscode.window.showInputBox({
      prompt: say(`Name this ${kindLabel.toLowerCase()} type. This creates a label you can put on content — it does not create a ${kindLabel.toLowerCase()}.`, `Benenne diesen Typ der Art „${kindLabel}“. Damit legst du eine Kennzeichnung für Inhalte an, aber keinen Inhalt der Art „${kindLabel}“.`),
      placeHolder: say('e.g., Lecture Notes, Homework, Bonus Task', 'z. B. Vorlesungsnotizen, Hausübung, Bonusaufgabe'),
      validateInput: value => deriveSlug(value || '')
        ? undefined
        : say('Use at least one letter or digit — the slug is derived from this name.', 'Verwende mindestens einen Buchstaben oder eine Ziffer; daraus wird der Slug abgeleitet.')
    });

    if (!title) {
      return;
    }

    const slug = deriveSlug(title);

    const color = await vscode.window.showInputBox({
      prompt: say('Enter color (optional)', 'Farbe eingeben (optional)'),
      placeHolder: say('e.g., #FF5733, blue, rgb(255,87,51)', 'z. B. #FF5733, blue, rgb(255,87,51)'),
      value: 'green'
    });

    // Spell out what is about to be created. A lecturer in issues#387 named a
    // type "Unit 1" believing they had created a unit, and only found out when
    // deleting it failed.
    const proceed = await notify.confirm(
      say(`Create content type "${title}"?`, `Inhaltstyp „${title}“ anlegen?`),
      say('Create', 'Anlegen'),
      say(`Kind: ${kindLabel}\nSlug: ${slug}\nColor: ${color || 'green'}\n\n`, `Art: ${kindLabel}\nSlug: ${slug}\nFarbe: ${color || 'green'}\n\n`)
      + say(`This adds a type you can assign to course content. It does not create any content.`, `Damit entsteht ein Typ, den du Kursinhalten zuweisen kannst. Es wird kein Inhalt angelegt.`)
    );

    if (!proceed) {
      return;
    }

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
      notify.info(say(`Content type "${title}" created successfully (slug: ${slug})`, `Der Inhaltstyp „${title}“ wurde angelegt (Slug: ${slug}).`));
    } catch (error) {
      showErrorWithSeverity(error as Error, say(`Failed to create content type "${title}"`, `Der Inhaltstyp „${title}“ konnte nicht angelegt werden`));
    }
  }

  private async editCourseContentType(item: CourseContentTypeTreeItem): Promise<void> {
    const title = await vscode.window.showInputBox({
      prompt: say('Enter new title', 'Neuen Titel eingeben'),
      value: item.contentType.title || item.contentType.slug
    });

    if (!title) {
      return;
    }

    const color = await vscode.window.showInputBox({
      prompt: say('Enter new color', 'Neue Farbe eingeben'),
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
      notify.info(say('Content type updated successfully', 'Der Inhaltstyp wurde aktualisiert.'));
    } catch (error) {
      showErrorWithSeverity(error as Error, say('Failed to update content type', 'Der Inhaltstyp konnte nicht aktualisiert werden'));
    }
  }

  private async deleteCourseContentType(item: CourseContentTypeTreeItem): Promise<void> {
    const label = item.contentType.title || item.contentType.slug;

    // A type that course content still points at cannot be deleted: the FK is
    // NOT NULL with ondelete=RESTRICT. The backend refuses with CONTENT_010,
    // but it can only say how many — the tree already knows *which*, so name
    // them here instead of sending a request that is bound to fail
    // (computor-org/issues#387).
    try {
      // Skip the cache: a stale entry would block a delete the server would allow.
      const contents = await this.apiService.getCourseContents(item.course.id, true);
      const blocking = findContentsUsingType(contents, item.contentType.id);
      if (blocking.length > 0) {
        await notify.modal('warning', say(`Cannot delete content type "${label}"`, `Der Inhaltstyp „${label}“ kann nicht gelöscht werden`), {
          detail: formatContentTypeInUseDetail(label, blocking)
        });
        return;
      }
    } catch {
      // Usage unknown (offline, stale cache): fall through and let the server
      // be the authority.
    }

    const confirmed = await notify.confirm(
      say(`Are you sure you want to delete content type "${label}"?`, `Möchtest du den Inhaltstyp „${label}“ wirklich löschen?`),
      say('Delete', 'Löschen')
    );

    if (!confirmed) {
      return;
    }

    try {
      await this.apiService.deleteCourseContentType(item.contentType.id);
      notify.info(say('Content type deleted successfully', 'Der Inhaltstyp wurde gelöscht.'));

      // Refresh the tree to show the changes
      await this.treeDataProvider.refresh();
    } catch (error) {
      if (error instanceof HttpError && error.errorCode === 'CONTENT_010') {
        await notify.modal('warning', say(`Cannot delete content type "${label}"`, `Der Inhaltstyp „${label}“ kann nicht gelöscht werden`), {
          detail: error.serverDetail
            || say('Course content still uses this type. Change those contents to another content type of the same kind, or delete them first.', 'Kursinhalte verwenden diesen Typ noch. Stelle diese Inhalte auf einen anderen Inhaltstyp derselben Art um oder lösche sie zuerst.')
        });
        return;
      }
      showErrorWithSeverity(
        error instanceof Error ? error : new Error(String(error)),
        say(`Failed to delete content type "${label}"`, `Der Inhaltstyp „${label}“ konnte nicht gelöscht werden`)
      );
    }
  }

  private async releaseCourseContent(item: ReleaseTarget): Promise<void> {
    try {
      const scopeInfo = this.buildReleaseScopeFromTreeItem(item);
      if (!scopeInfo) { return; }
      await this.startReleaseWorkflow(scopeInfo.courseId, scopeInfo.scope);
    } catch (error) {
      notify.error(say(`Failed to release course content: ${error}`, `Der Kursinhalt konnte nicht freigegeben werden: ${error}`));
    }
  }

  private async releaseCourseContentFromWebview(courseData: any): Promise<void> {
    try {
      const courseId = courseData?.id || courseData;
      if (!courseId) {
        notify.error(say('Invalid course data: missing course ID', 'Ungültige Kursdaten: Die Kurs-ID fehlt.'));
        return;
      }

      const label = typeof courseData === 'object' && courseData
        ? (courseData.title || courseData.path || 'course')
        : 'course';

      await this.startReleaseWorkflow(courseId, { all: true, label });
    } catch (error) {
      notify.error(say(`Failed to release course content: ${error}`, `Der Kursinhalt konnte nicht freigegeben werden: ${error}`));
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
        notify.warning(say('Release is only available from the course contents folder.', 'Freigeben ist nur im Ordner der Kursinhalte möglich.'));
        return undefined;
      }

      return {
        courseId: item.course.id,
        scope: {
          all: true,
          label: say(`${item.course.title || item.course.path} contents`, `Inhalte von ${item.course.title || item.course.path}`)
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

    notify.warning(say('Select a course or an assignment in the Lecturer view to release.', 'Wähle in der Lehrenden-Ansicht einen Kurs oder eine Aufgabe zum Freigeben aus.'));
    return undefined;
  }

  private async startReleaseWorkflow(courseId: string, scope: ReleaseScope): Promise<void> {
    // Step 1: Pre-flight validation
    const validationResult = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: say('Validating course for release...', 'Kurs wird für die Freigabe geprüft …'),
      cancellable: false
    }, async () => {
      try {
        return await this.apiService.validateCourseForRelease(courseId);
      } catch (error: any) {
        return {
          valid: false,
          error: say('Validation failed', 'Prüfung fehlgeschlagen'),
          validation_errors: [],
          total_issues: 0
        };
      }
    });

    // Step 2: If validation fails, show errors
    if (!validationResult.valid) {
      const course = await this.apiService.getCourse(courseId);
      const courseTitle = course?.title || course?.path || say('Unknown Course', 'Unbekannter Kurs');

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
      title: say('Checking for releasable content...', 'Freigebbare Inhalte werden gesucht …'),
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

    const scopeText = scope?.label ? say(` under "${scope.label}"`, ` unter „${scope.label}“`) : '';

    if (withExamples.length > 0) {
      notify.info(say(`No pending content to release${scopeText}. All ${withExamples.length} assigned item(s) are up to date.`, `Keine Inhalte zum Freigeben${scopeText}. Alle ${withExamples.length} zugewiesenen Elemente sind aktuell.`));
    } else {
      notify.info(say(`No pending content to release${scopeText}. Assign examples to course contents first.`, `Keine Inhalte zum Freigeben${scopeText}. Weise den Kursinhalten zuerst Beispiele zu.`));
    }
  }
  
  private async confirmRelease(candidates: ReleaseCandidate[], scope?: ReleaseScope): Promise<ReleaseCandidate[] | undefined> {
    interface ReleaseQuickPickItem extends vscode.QuickPickItem {
      candidate: ReleaseCandidate;
    }

    const iconMap = { new: '$(cloud-upload)', update: '$(sync)', failed: '$(error)' };
    const descriptionMap = { new: say('new', 'neu'), update: say('update available', 'Aktualisierung verfügbar'), failed: say('failed — retry', 'fehlgeschlagen, erneut versuchen') };

    const items: ReleaseQuickPickItem[] = candidates.map(candidate => ({
      label: `${iconMap[candidate.reason]} ${candidate.content.title || candidate.content.path}`,
      description: descriptionMap[candidate.reason],
      picked: candidate.reason !== 'failed',
      candidate
    }));

    const title = scope?.label
      ? say(`Release content under "${scope.label}"`, `Inhalte unter „${scope.label}“ freigeben`)
      : say('Release content to students', 'Inhalte für Studierende freigeben');

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title,
      placeHolder: say('Select items to release (new and updated are pre-selected)', 'Elemente zum Freigeben auswählen (neue und aktualisierte sind vorausgewählt)')
    });

    if (!selected || selected.length === 0) { return undefined; }
    return selected.map(item => item.candidate);
  }
  
  private async executeRelease(courseId: string, scope: ReleaseScope | undefined, selectedCandidates: ReleaseCandidate[]): Promise<void> {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: say('Releasing course content', 'Kursinhalte werden freigegeben'),
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 0, message: say('Preparing release...', 'Freigabe wird vorbereitet …') });

      const updateCandidates = selectedCandidates.filter(c => c.reason === 'update');
      if (updateCandidates.length > 0) {
        progress.report({ message: say(`Updating ${updateCandidates.length} example version(s) to latest...`, `${updateCandidates.length} Beispielversion(en) werden auf den neuesten Stand gebracht …`) });
        const updateIds = updateCandidates.map(c => c.content.id);
        const upgradeResult = await this.apiService.lecturerBatchUpgradeVersions(courseId, updateIds);
        if (upgradeResult.total_failed > 0) {
          notify.warning(
            say(`${upgradeResult.total_failed} of ${updateIds.length} version upgrade(s) failed. The release will continue with the items that did upgrade.`, `${upgradeResult.total_failed} von ${updateIds.length} Versionsaktualisierung(en) sind fehlgeschlagen. Die Freigabe läuft mit den aktualisierten Elementen weiter.`)
          );
        }
      }

      const selectedContentIds = selectedCandidates.map(c => c.content.id);

      try {
        progress.report({ message: say(`Syncing assignments for ${selectedContentIds.length} item(s)...`, `Aufgaben für ${selectedContentIds.length} Element(e) werden synchronisiert …`) });
        await this.apiService.generateAssignments(courseId, {
          course_content_ids: selectedContentIds,
          overwrite_strategy: 'skip_if_exists',
          commit_message: 'Sync assignments prior to student-template release'
        });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const choice = await notify.confirm(
          say(`Failed to sync assignments before release: ${detail}. Continue with student-template release anyway?`, `Die Aufgaben konnten vor der Freigabe nicht synchronisiert werden: ${detail}. Die Studierendenvorlage trotzdem freigeben?`),
          say('Continue', 'Weiter')
        );
        if (!choice) {
          throw new Error(say('Release cancelled after assignments sync failure', 'Freigabe abgebrochen, weil die Aufgaben nicht synchronisiert werden konnten'));
        }
      }

      progress.report({ message: say('Starting student-template release...', 'Freigabe der Studierendenvorlage wird gestartet …') });
      const result = await this.apiService.generateStudentTemplate(courseId, {
        release: { course_content_ids: selectedContentIds }
      });

      const items = typeof result?.contents_to_process === 'number' ? result.contents_to_process : undefined;
      const scopeSuffix = scope?.label ? say(` for ${scope.label}`, ` für ${scope.label}`) : '';
      const msg = items && items > 0
        ? say(`Release started for ${items} item(s)${scopeSuffix}. This runs in background.`, `Freigabe für ${items} Element(e)${scopeSuffix} gestartet. Sie läuft im Hintergrund.`)
        : say(`Release started${scopeSuffix}. This runs in background.`, `Freigabe${scopeSuffix} gestartet. Sie läuft im Hintergrund.`);
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
      say(`Course: ${freshCourse.title || freshCourse.path}`, `Kurs: ${freshCourse.title || freshCourse.path}`),
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
      notify.error(say('Unable to determine content kind for this item', 'Die Inhaltsart dieses Elements lässt sich nicht bestimmen.'));
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
      say(`Organization: ${freshOrganization.title || freshOrganization.path}`, `Organisation: ${freshOrganization.title || freshOrganization.path}`),
      {
        organization: freshOrganization
      }
    );
  }

  private async showCourseFamilyDetails(item: CourseFamilyTreeItem): Promise<void> {
    // Fetch fresh data from API
    const freshCourseFamily = await this.apiService.getCourseFamily(item.courseFamily.id) || item.courseFamily;
    
    await this.courseFamilyWebviewProvider.show(
      say(`Course Family: ${freshCourseFamily.title || freshCourseFamily.path}`, `Kursfamilie: ${freshCourseFamily.title || freshCourseFamily.path}`),
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
      say(`Content Type: ${freshContentType.title || freshContentType.slug}`, `Inhaltstyp: ${freshContentType.title || freshContentType.slug}`),
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
        notify.error(say('Failed to load group details', 'Die Gruppendetails konnten nicht geladen werden.'));
        return;
      }

      // Get group members
      const members = await this.apiService.getCourseMembers(item.course.id, item.group.id);

      await this.courseGroupWebviewProvider.show(
        say(`Group: ${item.group.title || item.group.id}`, `Gruppe: ${item.group.title || item.group.id}`),
        {
          group: detailedGroup,
          members: members,
          courseTitle: item.course.title || item.course.path,
          organizationTitle: item.organization.title || item.organization.path
        }
      );
    } catch (error) {
      notify.error(say(`Failed to show group details: ${error}`, `Die Gruppendetails konnten nicht angezeigt werden: ${error}`));
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
      say(`Member: ${freshMember.user?.email || 'Unknown'}`, `Mitglied: ${freshMember.user?.email || 'unbekannt'}`),
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
      prompt: say('Enter new title for the group', 'Neuen Titel für die Gruppe eingeben'),
      value: currentTitle
    });

    if (!newTitle || newTitle === currentTitle) {
      return;
    }

    try {
      await this.apiService.updateCourseGroup(item.group.id, { title: newTitle });
      notify.info(say(`Group renamed to "${newTitle}"`, `Gruppe umbenannt in „${newTitle}“.`));

      // Refresh the tree to show the changes
      await this.treeDataProvider.refresh();
    } catch (error) {
      notify.error(say(`Failed to rename group: ${error}`, `Die Gruppe konnte nicht umbenannt werden: ${error}`));
    }
  }

  private async deleteCourseGroup(item: CourseGroupTreeItem): Promise<void> {
    const groupTitle = item.group.title || item.group.id;

    // Confirm deletion
    const confirmation = await notify.confirm(
      say(`Are you sure you want to delete the group "${groupTitle}"?\n\nMembers will be moved to "No Group".`, `Möchtest du die Gruppe „${groupTitle}“ wirklich löschen?\n\nIhre Mitglieder kommen unter „Keine Gruppe“.`),
      say('Delete', 'Löschen')
    );

    if (!confirmation) {
      return;
    }

    try {
      await this.apiService.deleteCourseGroup(item.group.id);
      notify.info(say(`Group "${groupTitle}" deleted`, `Die Gruppe „${groupTitle}“ wurde gelöscht.`));

      // Refresh the tree to show the changes
      await this.treeDataProvider.refresh();
    } catch (error: any) {
      notify.error(say(`Failed to delete group: ${error?.message || error}`, `Die Gruppe konnte nicht gelöscht werden: ${error?.message || error}`));
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
        notify.error(say('Please select a course or groups folder to show members.', 'Wähle einen Kurs oder einen Gruppenordner aus, um die Mitglieder zu sehen.'));
        return;
      }

      // Show webview with existing members first
      await this.courseMemberImportWebviewProvider.showMembers(courseId);
    } catch (error: any) {
      console.error('Failed to show course members:', error);
      notify.error(
        say(`Failed to show course members: ${error?.message || error}`, `Die Kursmitglieder konnten nicht angezeigt werden: ${error?.message || error}`)
      );
    }
  }

  async manageCourseMembers(item: CourseTreeItem): Promise<void> {
    try {
      if (!(item instanceof CourseTreeItem) || !item.course?.id) {
        notify.error(say('Please select a course to manage its members.', 'Wähle einen Kurs aus, um seine Mitglieder zu verwalten.'));
        return;
      }
      await this.manageCourseMembersWebviewProvider.open(
        item.course.id,
        item.course.title || item.course.path
      );
    } catch (error: any) {
      console.error('Failed to open course member management:', error);
      notify.error(
        say(`Failed to open course member management: ${error?.message || error}`, `Die Mitgliederverwaltung des Kurses konnte nicht geöffnet werden: ${error?.message || error}`)
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
        title: say(`Loading course progress: ${courseLabel}`, `Kursfortschritt wird geladen: ${courseLabel}`),
        duplicateMessage: say('Course progress is already loading…', 'Der Kursfortschritt wird bereits geladen …')
      },
      async () => {
        try {
          const course = await this.apiService.getCourse(item.course.id);
          if (!course) {
            notify.error(say('Failed to load course details', 'Die Kursdetails konnten nicht geladen werden.'));
            return;
          }
          await this.courseProgressOverviewWebviewProvider.showCourseProgress(course);
        } catch (error) {
          notify.error(say(`Failed to show course progress: ${error}`, `Der Kursfortschritt konnte nicht angezeigt werden: ${error}`));
        }
      }
    );
  }

  private async showCourseProgressOverviewById(courseId: string): Promise<void> {
    await runLockedWithProgress(
      {
        key: `course-progress:${courseId}`,
        title: say('Loading course progress…', 'Kursfortschritt wird geladen …'),
        duplicateMessage: say('Course progress is already loading…', 'Der Kursfortschritt wird bereits geladen …')
      },
      async () => {
        try {
          const course = await this.apiService.getCourse(courseId);
          if (!course) {
            notify.error(say('Failed to load course details', 'Die Kursdetails konnten nicht geladen werden.'));
            return;
          }
          await this.courseProgressOverviewWebviewProvider.showCourseProgress(course);
        } catch (error) {
          notify.error(say(`Failed to show course progress: ${error}`, `Der Kursfortschritt konnte nicht angezeigt werden: ${error}`));
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
        title: say(`Loading progress: ${memberName || 'student'}`, `Fortschritt wird geladen: ${memberName || 'Studierende:r'}`),
        duplicateMessage: say('Student progress is already loading…', 'Der Fortschritt wird bereits geladen …')
      },
      async () => {
        try {
          await this.courseMemberProgressWebviewProvider.showMemberProgress(memberId, memberName);
        } catch (error) {
          notify.error(say(`Failed to show member progress: ${error}`, `Der Fortschritt des Mitglieds konnte nicht angezeigt werden: ${error}`));
        }
      }
    );
  }

  /**
   * Re-derive the scope context keys after a server-pushed permissions change
   * (computor-org/issues#384). Evict the scope caches first — this re-reads
   * /user/scopes through the API service.
   */
  async refreshScopeContextKeys(): Promise<void> {
    await this.applyScopeMembershipContextKey();
  }

  // Sets the role-derived context keys: per-scope-kind "Manage Members",
  // example-authoring and hierarchy delete/archive. See
  // `services/ScopePermissions.ts` for the rules.
  private async applyScopeMembershipContextKey(): Promise<void> {
    try {
      const ctx = await this.buildScopeContext();
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.canManageOrgMembers', canManageAnyOrganizationMembers(ctx));
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.canManageFamilyMembers', canManageAnyCourseFamilyMembers(ctx));
      // Gates the example upload / create-repository buttons — backend reserves
      // those writes to `_example_manager` (admins bypass).
      await vscode.commands.executeCommand('setContext', 'computor.examples.canAuthor', canAuthorExamples(ctx));
      // Coarse gate for the delete/archive menu entries ("owns at least one
      // scope"); every command re-checks its own node.
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.canDeleteAny', canDeleteAny(ctx));
    } catch (err) {
      console.warn('[LecturerCommands] Failed to compute scope-membership context keys:', err);
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.canManageOrgMembers', false);
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.canManageFamilyMembers', false);
      await vscode.commands.executeCommand('setContext', 'computor.examples.canAuthor', false);
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.canDeleteAny', false);
    }
  }
}
