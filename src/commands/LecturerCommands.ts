import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LecturerTreeDataProvider } from '../ui/tree/lecturer/LecturerTreeDataProvider';
import { OrganizationTreeItem, CourseFamilyTreeItem, CourseTreeItem, CourseContentTreeItem, CourseFolderTreeItem, CourseContentTypeTreeItem, CourseGroupTreeItem, CourseMemberTreeItem } from '../ui/tree/lecturer/LecturerTreeItems';
import { CourseGroupCommands } from './lecturer/courseGroupCommands';
import { ComputorApiService } from '../services/ComputorApiService';
import { CourseWebviewProvider } from '../ui/webviews/CourseWebviewProvider';
import { CourseContentWebviewFactory } from '../ui/webviews/content/CourseContentWebviewFactory';
import { OrganizationWebviewProvider } from '../ui/webviews/OrganizationWebviewProvider';
import { CourseFamilyWebviewProvider } from '../ui/webviews/CourseFamilyWebviewProvider';
import { CourseContentTypeWebviewProvider } from '../ui/webviews/CourseContentTypeWebviewProvider';
import { CourseGroupWebviewProvider } from '../ui/webviews/CourseGroupWebviewProvider';
import { CourseMemberWebviewProvider } from '../ui/webviews/CourseMemberWebviewProvider';
import { CourseMemberImportWebviewProvider } from '../ui/webviews/CourseMemberImportWebviewProvider';
import { MessagesWebviewProvider, MessageTargetContext } from '../ui/webviews/MessagesWebviewProvider';
import { CourseMemberCommentsWebviewProvider } from '../ui/webviews/CourseMemberCommentsWebviewProvider';
import { DeploymentInfoWebviewProvider } from '../ui/webviews/DeploymentInfoWebviewProvider';
import { ReleaseValidationWebviewProvider } from '../ui/webviews/ReleaseValidationWebviewProvider';
import { CourseProgressOverviewWebviewProvider } from '../ui/webviews/CourseProgressOverviewWebviewProvider';
import { CourseMemberProgressWebviewProvider } from '../ui/webviews/CourseMemberProgressWebviewProvider';
import { hasExampleAssigned, getExampleVersionId, classifyReleaseContents } from '../utils/deploymentHelpers';
import type { ReleaseCandidate } from '../utils/deploymentHelpers';
import { HttpError } from '../http/errors/HttpError';
import type { CourseContentTypeList, CourseList, CourseFamilyList, CourseContentGet } from '../types/generated/courses';
import type { OrganizationList } from '../types/generated/organizations';
import type { CourseDeploymentList } from '../types/generated';
import { LecturerRepositoryManager } from '../services/LecturerRepositoryManager';
import type { MessagesInputPanelProvider } from '../ui/panels/MessagesInputPanel';
import type { WebSocketService } from '../services/WebSocketService';

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
  private courseGroupCommands: CourseGroupCommands;
  private messagesWebviewProvider: MessagesWebviewProvider;
  private commentsWebviewProvider: CourseMemberCommentsWebviewProvider;
  private deploymentInfoWebviewProvider: DeploymentInfoWebviewProvider;
  private releaseValidationWebviewProvider: ReleaseValidationWebviewProvider;
  private courseProgressOverviewWebviewProvider: CourseProgressOverviewWebviewProvider;
  private courseMemberProgressWebviewProvider: CourseMemberProgressWebviewProvider;

  constructor(
    private context: vscode.ExtensionContext,
    private treeDataProvider: LecturerTreeDataProvider,
    apiService?: ComputorApiService,
    messagesInputPanel?: MessagesInputPanelProvider,
    wsService?: WebSocketService
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
    this.messagesWebviewProvider = new MessagesWebviewProvider(context, this.apiService);
    if (messagesInputPanel) {
      this.messagesWebviewProvider.setInputPanel(messagesInputPanel);
    }
    if (wsService) {
      this.messagesWebviewProvider.setWebSocketService(wsService);
    }
    this.commentsWebviewProvider = new CourseMemberCommentsWebviewProvider(context, this.apiService);
    this.deploymentInfoWebviewProvider = new DeploymentInfoWebviewProvider(context, this.apiService);
    this.releaseValidationWebviewProvider = new ReleaseValidationWebviewProvider(context, this.apiService);
    this.courseProgressOverviewWebviewProvider = new CourseProgressOverviewWebviewProvider(context, this.apiService);
    this.courseMemberProgressWebviewProvider = new CourseMemberProgressWebviewProvider(context, this.apiService);
    this.courseGroupCommands = new CourseGroupCommands(this.apiService, this.treeDataProvider);
  }

  registerCommands(): void {
    // Tree refresh - register both command names for compatibility
    const refreshHandler = async () => {
      console.log('=== LECTURER TREE REFRESH COMMAND TRIGGERED ===');
      
      // Clear ALL API caches first - this is crucial
      console.log('Clearing all API caches...');
      this.apiService.clearCourseCache(''); // Clear all course caches
      
      // Use the standard refresh mechanism
      console.log('Refreshing lecturer tree...');
      this.treeDataProvider.refresh();
      
      console.log('Tree refresh completed');
      vscode.window.showInformationMessage('✅ Lecturer tree refreshed successfully!');
    };
    
    // Register refresh commands with proper naming convention
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.refresh', refreshHandler)
    );
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.refreshCourses', refreshHandler)
    );

    // Sync assignments repositories (manual trigger)
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.syncAssignments', async () => {
        try {
          const { LecturerRepositoryManager } = await import('../services/LecturerRepositoryManager');
          const mgr = new LecturerRepositoryManager(this.context, this.apiService);
          await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Syncing assignments repositories...', cancellable: false }, async (progress) => {
            await mgr.syncAllAssignments((m) => progress.report({ message: m }));
          });
          vscode.window.showInformationMessage('Assignments repositories synced.');
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to sync assignments: ${e}`);
        }
      })
    );

    // Course management commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.createCourse', async () => {
        await this.createCourse();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.manageCourse', async (item: CourseTreeItem) => {
        await this.manageCourse(item);
      })
    );

    // Course content management
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.createCourseContent', async (item: CourseFolderTreeItem | CourseContentTreeItem) => {
        await this.createCourseContent(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showMessages', async (item: CourseTreeItem | CourseGroupTreeItem | CourseContentTreeItem) => {
        await this.showMessages(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showCourseMemberComments', async (item: CourseMemberTreeItem) => {
        await this.showCourseMemberComments(item);
      })
    );

    // Deactivated: Sync GitLab Permissions command
    // this.context.subscriptions.push(
    //   vscode.commands.registerCommand('computor.lecturer.syncMemberGitlabPermissions', async (item: CourseMemberTreeItem) => {
    //     await this.syncMemberGitlabPermissions(item);
    //   })
    // );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.changeCourseContentType', async (item: CourseContentTreeItem) => {
        await this.changeCourseContentType(item);
      })
    );

    // Course content type management
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.createCourseContentType', async (item: CourseFolderTreeItem) => {
        await this.createCourseContentType(item);
      })
    );

    // Course group management
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.createCourseGroup', async (item: CourseFolderTreeItem) => {
        await this.courseGroupCommands.createCourseGroup(item);
      })
    );

    // Course member import with preview
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.importCourseMembersPreview', async (item: CourseTreeItem | CourseFolderTreeItem) => {
        await this.importCourseMembersWithPreview(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.editCourseContentType', async (item: CourseContentTypeTreeItem) => {
        await this.editCourseContentType(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.deleteCourseContentType', async (item: CourseContentTypeTreeItem) => {
        await this.deleteCourseContentType(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.renameCourseContent', async (item: CourseContentTreeItem) => {
        await this.renameCourseContent(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.renameCourseContentType', async (item: CourseContentTypeTreeItem) => {
        await this.renameCourseContentType(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.deleteCourseContent', async (item: CourseContentTreeItem) => {
        await this.deleteCourseContent(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.archiveCourseContent', async (item: CourseContentTreeItem) => {
        await this.archiveCourseContent(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.unarchiveCourseContent', async (item: CourseContentTreeItem) => {
        await this.unarchiveCourseContent(item);
      })
    );

    // Example management
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.updateExampleVersion', async (item: CourseContentTreeItem) => {
        await this.updateExampleVersion(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.updateExampleVersions', async (item: CourseTreeItem | CourseFolderTreeItem | CourseContentTreeItem) => {
        await this.batchUpdateExampleVersions(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.viewDeploymentInfo', async (item: CourseContentTreeItem) => {
        await this.viewDeploymentInfo(item);
      })
    );

    // GitLab repository opening
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.openGitLabRepo', async (item: CourseTreeItem | CourseMemberTreeItem) => {
        await this.openGitLabRepository(item);
      })
    );

    // Release/deployment commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.releaseCourseContent', async (item: CourseTreeItem | CourseFolderTreeItem | CourseContentTreeItem) => {
        await this.releaseCourseContent(item);
      })
    );

    // Release from webview (accepts course data directly)
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.releaseCourseContentFromWebview', async (courseData: any) => {
        await this.releaseCourseContentFromWebview(courseData);
      })
    );

    // Webview commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showCourseDetails', async (item: CourseTreeItem) => {
        await this.showCourseDetails(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showCourseContentDetails', async (item: CourseContentTreeItem) => {
        await this.showCourseContentDetails(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showOrganizationDetails', async (item: OrganizationTreeItem) => {
        await this.showOrganizationDetails(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showCourseFamilyDetails', async (item: CourseFamilyTreeItem) => {
        await this.showCourseFamilyDetails(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showCourseContentTypeDetails', async (item: CourseContentTypeTreeItem) => {
        await this.showCourseContentTypeDetails(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showCourseGroupDetails', async (item: CourseGroupTreeItem) => {
        await this.showCourseGroupDetails(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showCourseMemberDetails', async (item: CourseMemberTreeItem) => {
        await this.showCourseMemberDetails(item);
      })
    );

    // Course progress overview - shows all students' progress for a course
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showCourseProgressOverview', async (itemOrId: CourseTreeItem | string) => {
        if (typeof itemOrId === 'string') {
          // Called with course ID directly (from tutor view)
          await this.showCourseProgressOverviewById(itemOrId);
        } else {
          // Called with tree item
          await this.showCourseProgressOverview(itemOrId);
        }
      })
    );

    // Course member progress - shows detailed progress for a single student
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showCourseMemberProgress', async (itemOrId: CourseMemberTreeItem | string, memberName?: string) => {
        if (typeof itemOrId === 'string') {
          // Called with course member ID directly (from overview webview)
          await this.courseMemberProgressWebviewProvider.showMemberProgress(itemOrId, memberName);
        } else {
          // Called with tree item
          await this.showCourseMemberProgress(itemOrId);
        }
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.createAssignmentFolder', async (item: CourseContentTreeItem) => {
        await this.createAssignmentFolder(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.createAssignmentFile', async (item: CourseContentTreeItem) => {
        await this.createAssignmentFile(item);
      })
    );

    // Open local assignment folder for a content
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.openAssignmentFolder', async (item: CourseContentTreeItem) => {
        if (!item || !item.courseContent?.id || !item.course?.id) { vscode.window.showWarningMessage('Select an assignment'); return; }
        try {
          const course = await this.apiService.getCourse(item.course.id);
          const content = await this.apiService.getCourseContent(item.courseContent.id, true);
          const deploymentPath = (content as any)?.deployment?.deployment_path || (content as any)?.deployment?.example_identifier || '';
          if (!course || !deploymentPath) { vscode.window.showWarningMessage('Assignment not initialized in assignments repo yet.'); return; }
          const { LecturerRepositoryManager } = await import('../services/LecturerRepositoryManager');
          const mgr = new LecturerRepositoryManager(this.context, this.apiService);
          const folder = mgr.getAssignmentFolderPath(course, deploymentPath);
          if (!folder || !fs.existsSync(folder)) {
            const choice = await vscode.window.showWarningMessage('Assignment folder missing locally. Sync assignments now?', 'Sync', 'Cancel');
            if (choice === 'Sync') { await vscode.commands.executeCommand('computor.lecturer.syncAssignments'); }
            return;
          }
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folder));
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to open assignment folder: ${e}`);
        }
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.renameCourseGroup', async (item: CourseGroupTreeItem) => {
        await this.renameCourseGroup(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.deleteCourseGroup', async (item: CourseGroupTreeItem) => {
        await this.deleteCourseGroup(item);
      })
    );
  }

  /**
   * Create a new course
   */
  private async createCourse(): Promise<void> {
    // Get organization
    const organizations = await this.apiService.getOrganizations();
    if (!organizations || organizations.length === 0) {
      vscode.window.showErrorMessage('No organizations available');
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

    if (!selectedOrg) {
      return;
    }

    // Get course family  
    const families = await this.apiService.getCourseFamilies(selectedOrg.organization.id);
    if (!families || families.length === 0) {
      vscode.window.showErrorMessage('No course families available in this organization');
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

    if (!selectedFamily) {
      return;
    }

    // Get course details
    const coursePath = await vscode.window.showInputBox({
      prompt: 'Enter course path (URL-friendly identifier)',
      placeHolder: 'e.g., cs101-2024, intro-programming-fall',
      validateInput: (value) => {
        if (!value) {
          return 'Course path is required';
        }
        if (!/^[a-z0-9-]+$/.test(value)) {
          return 'Path must contain only lowercase letters, numbers, and hyphens';
        }
        return null;
      }
    });

    if (!coursePath) {
      return;
    }

    const courseTitle = await vscode.window.showInputBox({
      prompt: 'Enter course title',
      placeHolder: 'e.g., Introduction to Computer Science',
      value: coursePath.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    });

    if (!courseTitle) {
      return;
    }

    try {
      // TODO: Implement createCourse in ComputorApiService
      // For now, show a message that this feature is coming soon
      vscode.window.showInformationMessage(
        `Course creation feature is coming soon! Would create: "${courseTitle}" in ${selectedFamily.family.title}`
      );
      
      // When API is ready, uncomment:
      // await this.apiService.createCourse({
      //   path: coursePath,
      //   title: courseTitle,
      //   course_family_id: selectedFamily.family.id
      // });
      // vscode.window.showInformationMessage(`Course "${courseTitle}" created successfully!`);
      // this.treeDataProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create course: ${error}`);
    }
  }

  /**
   * Manage course settings and properties
   */
  private async manageCourse(item?: CourseTreeItem): Promise<void> {
    let course;
    
    if (item) {
      course = item.course;
    } else {
      // If no item provided, ask user to select a course
      const courses = await this.getAllCourses();
      if (!courses || courses.length === 0) {
        vscode.window.showInformationMessage('No courses available');
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
      vscode.window.showInformationMessage('Course updated successfully');
      this.treeDataProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update course: ${error}`);
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
    const confirmation = await vscode.window.showWarningMessage(
      `Are you sure you want to delete the course "${course.title || course.path}"? This action cannot be undone.`,
      { modal: true },
      'Delete',
      'Cancel'
    );

    if (confirmation === 'Delete') {
      try {
        // TODO: Implement deleteCourse in ComputorApiService
        // For now, show a message that this feature is coming soon
        vscode.window.showInformationMessage(
          `Course deletion feature is coming soon! Would delete: "${course.title || course.path}"`
        );
        
        // When API is ready, uncomment:
        // await this.apiService.deleteCourse(course.id);
        // vscode.window.showInformationMessage('Course deleted successfully');
        // this.treeDataProvider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to delete course: ${error}`);
      }
    }
  }

  private async createCourseContent(item: CourseFolderTreeItem | CourseContentTreeItem): Promise<void> {
    let parentPath: string | undefined;
    let folderItem: CourseFolderTreeItem;
    let course: CourseList;

    if (item instanceof CourseFolderTreeItem && item.folderType === 'contents') {
      folderItem = item;
      course = item.course;
    } else if (item instanceof CourseContentTreeItem) {
      parentPath = item.courseContent.path;
      folderItem = new CourseFolderTreeItem('contents', item.course, item.courseFamily, item.organization);
      course = item.course;
    } else {
      vscode.window.showErrorMessage('Course contents can only be created under the Contents folder or another content item');
      return;
    }

    const contentTypes = await this.apiService.getCourseContentTypes(course.id);
    if (contentTypes.length === 0) {
      vscode.window.showWarningMessage('No content types available. Please create a content type first.');
      return;
    }

    // Sort content types alphabetically by title
    const sortedContentTypes = [...contentTypes].sort((a, b) => {
      const titleA = (a.title || a.slug || '').toLowerCase();
      const titleB = (b.title || b.slug || '').toLowerCase();
      return titleA.localeCompare(titleB);
    });

    // Fetch full content type info to get course_content_kind
    const contentTypesWithKind = await Promise.all(sortedContentTypes.map(async (t) => {
      try {
        const fullType = await this.apiService.getCourseContentType(t.id);
        return {
          label: t.title || t.slug,
          description: fullType?.course_content_kind?.title || fullType?.course_content_kind_id || '',
          id: t.id,
          contentType: fullType || t
        };
      } catch (error) {
        console.warn(`Failed to fetch content type details for ${t.id}:`, error);
        return {
          label: t.title || t.slug,
          description: t.course_content_kind_id || '',
          id: t.id,
          contentType: t
        };
      }
    }));

    const selectedType = await vscode.window.showQuickPick(
      contentTypesWithKind,
      { placeHolder: 'Select content type' }
    );

    if (!selectedType) {
      return;
    }

    const isAssignment = this.isContentTypeSubmittable(selectedType.contentType);

    if (!isAssignment) {
      const title = await vscode.window.showInputBox({
        prompt: 'Enter course content title',
        placeHolder: 'e.g., Week 1: Introduction'
      });

      if (!title) {
        return;
      }

      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      await this.treeDataProvider.createCourseContent(
        folderItem,
        title,
        selectedType.id,
        parentPath,
        slug,
        undefined
      );
      return;
    }

    // For assignments: pick an existing example and version
    const examples = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Loading examples...',
      cancellable: false
    }, async () => {
      return await this.apiService.getAvailableExamples();
    });

    if (!examples || examples.length === 0) {
      vscode.window.showWarningMessage(
        'No examples available. Upload examples in the Examples view first.'
      );
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

    if (!selectedExample) {
      return;
    }

    const versions = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Loading versions...',
      cancellable: false
    }, async () => {
      return await this.apiService.getExampleVersions(selectedExample.id);
    });

    if (!versions || versions.length === 0) {
      vscode.window.showWarningMessage('No versions available for this example');
      return;
    }

    const selectedVersion = await vscode.window.showQuickPick(
      versions.map(v => ({
        label: v.version_tag,
        description: `Created: ${new Date(v.created_at).toLocaleDateString()}`,
        versionTag: v.version_tag
      })),
      {
        placeHolder: 'Select version'
      }
    );

    if (!selectedVersion) {
      return;
    }

    const title = await vscode.window.showInputBox({
      prompt: 'Enter assignment title',
      value: selectedExample.exampleTitle,
      placeHolder: 'Assignment title'
    });

    if (!title) {
      return;
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    try {
      const createdContent = await this.treeDataProvider.createCourseContent(
        folderItem,
        title,
        selectedType.id,
        parentPath,
        slug || 'assignment',
        undefined
      );

      if (!createdContent) {
        return;
      }

      try {
        await this.apiService.lecturerAssignExample(
          createdContent.id,
          {
            example_identifier: selectedExample.identifier,
            version_tag: selectedVersion.versionTag
          }
        );
      } catch (assignError: any) {
        const assignMessage = assignError?.response?.data?.detail || assignError.message || 'Unknown error';
        const action = await vscode.window.showWarningMessage(
          `Assignment "${title}" was created but the example could not be assigned: ${assignMessage}. Keep the assignment without an example?`,
          'Keep', 'Delete'
        );
        if (action === 'Delete') {
          await this.apiService.deleteCourseContent(course.id, createdContent.id);
        }
        this.apiService.clearCourseCache(course.id);
        this.treeDataProvider.refresh();
        return;
      }

      await this.treeDataProvider.forceRefreshCourse(course.id);
      vscode.window.showInformationMessage(`Created assignment "${title}" with example "${selectedExample.label}" v${selectedVersion.versionTag}`);
    } catch (error: any) {
      console.error('Failed to create assignment:', error);
      const errorMessage = error?.response?.data?.detail || error.message || 'Unknown error';
      vscode.window.showErrorMessage(`Failed to create assignment: ${errorMessage}`);
    }
  }

  private async changeCourseContentType(item: CourseContentTreeItem): Promise<void> {
    if (!item || !item.courseContent) {
      vscode.window.showErrorMessage('Invalid course content item');
      return;
    }

    try {
      // Get available content types for this course
      const contentTypes = await this.apiService.getCourseContentTypes(item.course.id);
      
      if (contentTypes.length === 0) {
        vscode.window.showWarningMessage('No content types available in this course.');
        return;
      }

      // Filter out the current type and prepare selection items
      const availableTypes = contentTypes
        .filter(ct => ct.id !== item.courseContent.course_content_type_id)
        .map(ct => ({
          label: ct.title || ct.slug,
          description: ct.course_content_kind_id || 'unknown',
          id: ct.id,
          contentType: ct
        }));

      if (availableTypes.length === 0) {
        vscode.window.showInformationMessage('No other content types available to switch to.');
        return;
      }

      // Get full content type info for current type to show what we're changing from
      const currentType = contentTypes.find(ct => ct.id === item.courseContent.course_content_type_id);
      const currentTypeLabel = currentType ? (currentType.title || currentType.slug) : 'Unknown';

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

      vscode.window.showInformationMessage(
        `Changed content type from "${currentTypeLabel}" to "${selectedType.label}"`
      );

      // Clear cache and refresh the tree
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();

    } catch (error) {
      console.error('Failed to change course content type:', error);
      vscode.window.showErrorMessage(`Failed to change content type: ${error}`);
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
        vscode.window.showErrorMessage('Invalid folder name. Use relative paths without . or .. segments.');
        return;
      }

      const targetPath = path.join(context.assignmentRoot, relativePath);
      if (!this.isWithinAssignmentRoot(context.assignmentRoot, targetPath)) {
        vscode.window.showErrorMessage('Target folder must remain inside the assignment directory.');
        return;
      }

      if (fs.existsSync(targetPath)) {
        vscode.window.showInformationMessage(`Folder already exists: ${relativePath}`);
        return;
      }

      await fs.promises.mkdir(targetPath, { recursive: true });
      this.treeDataProvider.refreshNode(item);
      vscode.window.showInformationMessage(`Created folder: ${relativePath}`);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to create folder: ${error?.message || error}`);
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
        vscode.window.showErrorMessage('Invalid file name. Use relative paths without . or .. segments.');
        return;
      }

      const targetPath = path.join(context.assignmentRoot, relativePath);
      if (!this.isWithinAssignmentRoot(context.assignmentRoot, targetPath)) {
        vscode.window.showErrorMessage('Target file must remain inside the assignment directory.');
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
      const document = await vscode.workspace.openTextDocument(targetPath);
      await vscode.window.showTextDocument(document, { preview: false });
      vscode.window.showInformationMessage(`Created file: ${relativePath}`);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to create file: ${error?.message || error}`);
    }
  }

  private async resolveAssignmentEditingContext(item: CourseContentTreeItem): Promise<{ course: CourseList; content: CourseContentGet; directoryName: string; assignmentRoot: string } | undefined> {
    if (!item?.course?.id || !item.courseContent?.id) {
      vscode.window.showWarningMessage('Select an assignment first.');
      return undefined;
    }

    const kindId = item.courseContent.course_content_kind_id || item.contentType?.course_content_kind_id;
    if (kindId !== 'assignment') {
      vscode.window.showWarningMessage('This action is only available for assignments.');
      return undefined;
    }

    const course = await this.apiService.getCourse(item.course.id);
    const content = await this.apiService.getCourseContent(item.courseContent.id, true) as CourseContentGet | undefined;
    if (!course || !content) {
      vscode.window.showErrorMessage('Failed to load assignment details.');
      return undefined;
    }

    const directoryName = this.getAssignmentDirectoryName(content);
    if (!directoryName) {
      vscode.window.showWarningMessage('Assignment deployment path is not configured yet.');
      return undefined;
    }

    const repoManager = new LecturerRepositoryManager(this.context, this.apiService);
    await this.ensureAssignmentsRepo(course, repoManager);

    const assignmentRoot = repoManager.getAssignmentFolderPath(course, directoryName);
    if (!assignmentRoot) {
      vscode.window.showWarningMessage('Assignments repository is not configured for this course.');
      return undefined;
    }

    try {
      await fs.promises.mkdir(assignmentRoot, { recursive: true });
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to prepare assignment directory: ${error?.message || error}`);
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
    const trimmed = input.trim();
    if (!trimmed) {
      return undefined;
    }

    const segments = trimmed.split(/[/\\]+/).filter(segment => segment.length > 0);
    if (segments.length === 0) {
      return undefined;
    }

    if (segments.some(segment => segment === '.' || segment === '..' || segment.includes(':'))) {
      return undefined;
    }

    return path.join(...segments);
  }

  private isWithinAssignmentRoot(base: string, candidate: string): boolean {
    const relative = path.relative(base, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  private isContentTypeSubmittable(type: CourseContentTypeList): boolean {
    return type.course_content_kind?.submittable || false;
  }

  private async showMessages(item: CourseTreeItem | CourseGroupTreeItem | CourseContentTreeItem): Promise<void> {
    try {
      let target: MessageTargetContext | undefined;

      if (item instanceof CourseTreeItem) {
        target = {
          title: item.course.title || item.course.path,
          subtitle: this.buildCourseSubtitle(item.course, item.courseFamily, item.organization),
          query: { course_id: item.course.id },
          createPayload: { course_id: item.course.id },
          sourceRole: 'lecturer',
          // Lecturers subscribe to course channel to receive ALL messages including submission groups
          wsChannel: `course:${item.course.id}`
        };
      } else if (item instanceof CourseGroupTreeItem) {
        target = {
          title: item.group.title || `Group ${item.group.id.slice(0, 8)}`,
          subtitle: `${this.buildCourseSubtitle(item.course, item.courseFamily, item.organization)} › Group`,
          query: { course_group_id: item.group.id },
          createPayload: { course_group_id: item.group.id },
          sourceRole: 'lecturer',
          // Course groups use course_group channel
          wsChannel: `course_group:${item.group.id}`
        };
      } else if (item instanceof CourseContentTreeItem) {
        target = {
          title: item.courseContent.title || item.courseContent.path,
          subtitle: `${this.buildCourseSubtitle(item.course, item.courseFamily, item.organization)} › ${item.courseContent.path}`,
          query: { course_content_id: item.courseContent.id },
          createPayload: { course_content_id: item.courseContent.id, course_id: item.course.id },
          sourceRole: 'lecturer',
          wsChannel: `course_content:${item.courseContent.id}`
        };
      }

      if (!target) {
        vscode.window.showWarningMessage('Messages are not available for this item.');
        return;
      }

      await this.messagesWebviewProvider.showMessages(target);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open messages: ${error?.message || error}`);
    }
  }

  private async showCourseMemberComments(item: CourseMemberTreeItem): Promise<void> {
    try {
      const given = item.member.user?.given_name;
      const family = item.member.user?.family_name;
      const fullName = [given, family].filter(Boolean).join(' ').trim();
      const displayName = fullName
        || item.member.user?.username
        || item.member.user?.email
        || `Member ${item.member.id.slice(0, 8)}`;
      const title = `${displayName} — ${item.course.title || item.course.path}`;
      await this.commentsWebviewProvider.showComments(item.member.id, title);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open comments: ${error?.message || error}`);
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
        || item.member.user?.username
        || item.member.user?.email
        || `Member ${item.member.id.slice(0, 8)}`;

      // Get the course's GitLab token (GLPAT)
      const gitlabToken = await this.treeDataProvider.getGitLabTokenForCourse(item.course);

      if (!gitlabToken) {
        vscode.window.showErrorMessage(
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
            vscode.window.showInformationMessage(`✅ ${displayName}: ${message}`);
          } else if (status === 'warning') {
            vscode.window.showWarningMessage(`⚠️ ${displayName}: ${message}`);
          } else {
            vscode.window.showErrorMessage(`❌ ${displayName}: ${message}`);
          }
        }
      );
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      vscode.window.showErrorMessage(`Failed to sync GitLab permissions: ${errorMessage}`);
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
      vscode.window.showInformationMessage(`Content renamed to "${newTitle}"`);
      
      // Force a full refresh to ensure the tree updates
      await this.treeDataProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to rename content: ${error}`);
    }
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
      vscode.window.showInformationMessage(`Content type renamed to "${newTitle}"`);
      await this.treeDataProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to rename content type: ${error}`);
    }
  }

  private async deleteCourseContent(item: CourseContentTreeItem): Promise<void> {
    if (!item.courseContent || !item.courseContent.id) {
      vscode.window.showErrorMessage('Invalid course content item - missing required data');
      return;
    }

    const title = item.courseContent.title || item.courseContent.path;
    const confirmation = await vscode.window.showWarningMessage(
      `Are you sure you want to delete "${title}"?`,
      'Yes',
      'No'
    );

    if (confirmation !== 'Yes') { return; }

    try {
      await this.apiService.deleteCourseContent(item.course.id, item.courseContent.id);
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();
      vscode.window.showInformationMessage(`Deleted "${title}" successfully`);
    } catch (error: any) {
      if (error instanceof HttpError && (error.errorCode === 'CONTENT_006' || error.errorCode === 'CONTENT_007')) {
        const archiveChoice = await vscode.window.showWarningMessage(
          `Cannot delete "${title}" because it has student submissions. Would you like to archive it instead?`,
          'Archive',
          'Cancel'
        );
        if (archiveChoice === 'Archive') {
          await this.archiveCourseContent(item);
        }
      } else {
        vscode.window.showErrorMessage(`Failed to delete "${title}": ${error.message || error}`);
      }
    }
  }

  private async archiveCourseContent(item: CourseContentTreeItem): Promise<void> {
    if (!item.courseContent?.id || !item.course?.id) {
      vscode.window.showErrorMessage('Invalid course content item');
      return;
    }

    const title = item.courseContent.title || item.courseContent.path;

    try {
      await this.apiService.archiveCourseContent(item.course.id, item.courseContent.id);
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();
      vscode.window.showInformationMessage(`Archived "${title}" successfully`);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to archive "${title}": ${error.message || error}`);
    }
  }

  private async unarchiveCourseContent(item: CourseContentTreeItem): Promise<void> {
    if (!item.courseContent?.id || !item.course?.id) {
      vscode.window.showErrorMessage('Invalid course content item');
      return;
    }

    const title = item.courseContent.title || item.courseContent.path;

    try {
      await this.apiService.unarchiveCourseContent(item.course.id, item.courseContent.id);
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();
      vscode.window.showInformationMessage(`Unarchived "${title}" successfully`);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to unarchive "${title}": ${error.message || error}`);
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

      if (!exampleInfo) {
        const deployment = await this.apiService.lecturerGetDeployment(contentId);
        if (!deployment?.example_id) {
          vscode.window.showWarningMessage('No example assigned to this assignment');
          return;
        }
        const example = await this.apiService.getExample(deployment.example_id);
        if (!example) {
          vscode.window.showWarningMessage('Could not load example information');
          return;
        }
        exampleInfo = { id: example.id, title: example.title, identifier: example.identifier };
        currentVersionTag = deployment.version_tag;
      }

      const versions = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Loading available versions...',
        cancellable: false
      }, async () => {
        return await this.apiService.getExampleVersions(exampleInfo!.id);
      });

      if (!versions || versions.length === 0) {
        vscode.window.showWarningMessage('No versions available for this example');
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
        vscode.window.showInformationMessage('Already on this version');
        return;
      }

      const confirm = await vscode.window.showInformationMessage(
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

      vscode.window.showInformationMessage(
        `Example version updated to v${selectedVersion.versionTag}`
      );

      this.apiService.clearCourseCache(courseId);
      this.treeDataProvider.refresh();

    } catch (error: any) {
      console.error('Failed to update example version:', error);
      const errorMessage = error?.response?.data?.detail || error.message || 'Unknown error';
      vscode.window.showErrorMessage(`Failed to update example version: ${errorMessage}`);
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
        vscode.window.showInformationMessage(`All assignments${scopeText} are already on their latest example versions.`);
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
          vscode.window.showInformationMessage(`Updated ${result.total_upgraded} assignment(s) to latest example versions.`);
        } else {
          vscode.window.showWarningMessage(`Updated ${result.total_upgraded} assignment(s), ${result.total_failed} failed.`);
        }
      });

      this.apiService.clearCourseCache(courseId);
      await this.treeDataProvider.forceRefreshCourse(courseId);

    } catch (error: any) {
      console.error('Failed to batch update example versions:', error);
      const errorMessage = error?.response?.data?.detail || error.message || 'Unknown error';
      vscode.window.showErrorMessage(`Failed to update example versions: ${errorMessage}`);
    }
  }

  private async viewDeploymentInfo(item: CourseContentTreeItem): Promise<void> {
    try {
      await this.deploymentInfoWebviewProvider.showDeploymentInfo(
        item.courseContent.id,
        item.courseContent.title || item.courseContent.path
      );
    } catch (error: any) {
      console.error('Failed to view deployment info:', error);
      vscode.window.showErrorMessage(`Failed to view deployment info: ${error.message}`);
    }
  }

  private async openGitLabRepository(item: CourseTreeItem | CourseMemberTreeItem): Promise<void> {
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
          vscode.window.showWarningMessage('No GitLab project found for this course member');
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
          vscode.window.showWarningMessage('No GitLab group found for this course');
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
        vscode.window.showInformationMessage(`Opening GitLab ${itemType} in browser`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open GitLab repository: ${error}`);
    }
  }

  private async createCourseContentType(item: CourseFolderTreeItem): Promise<void> {
    if (item.folderType !== 'contentTypes') {
      return;
    }

    // Get available content kinds
    const contentKinds = await this.apiService.getCourseContentKinds();
    if (contentKinds.length === 0) {
      vscode.window.showErrorMessage('No content kinds available in the system');
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
      vscode.window.showErrorMessage('Invalid title: cannot generate slug');
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
      vscode.window.showInformationMessage(`Content type "${title}" created successfully (slug: ${slug})`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create content type: ${error}`);
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
      vscode.window.showInformationMessage('Content type updated successfully');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update content type: ${error}`);
    }
  }

  private async deleteCourseContentType(item: CourseContentTypeTreeItem): Promise<void> {
    const confirmation = await vscode.window.showWarningMessage(
      `Are you sure you want to delete content type "${item.contentType.title || item.contentType.slug}"?`,
      'Yes',
      'No'
    );

    if (confirmation === 'Yes') {
      try {
        await this.apiService.deleteCourseContentType(item.contentType.id);
        vscode.window.showInformationMessage('Content type deleted successfully');
        
        // Refresh the tree to show the changes
        await this.treeDataProvider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to delete content type: ${error}`);
      }
    }
  }

  private async releaseCourseContent(item: CourseTreeItem | CourseFolderTreeItem | CourseContentTreeItem): Promise<void> {
    console.log('============================================');
    console.log('releaseCourseContent CALLED');
    console.log('Item type:', item.constructor.name);
    console.log('============================================');
    try {
      const scopeInfo = this.buildReleaseScopeFromTreeItem(item);
      console.log('Scope info:', scopeInfo);
      if (!scopeInfo) {
        console.log('❌ No scope info, returning');
        return;
      }
      console.log('Calling startReleaseWorkflow with courseId:', scopeInfo.courseId);
      await this.startReleaseWorkflow(scopeInfo.courseId, scopeInfo.scope);
    } catch (error) {
      console.error('❌ Error in releaseCourseContent:', error);
      vscode.window.showErrorMessage(`Failed to release course content: ${error}`);
    }
  }

  private async releaseCourseContentFromWebview(courseData: any): Promise<void> {
    try {
      const courseId = courseData?.id || courseData;
      if (!courseId) {
        vscode.window.showErrorMessage('Invalid course data: missing course ID');
        return;
      }

      const label = typeof courseData === 'object' && courseData
        ? (courseData.title || courseData.path || 'course')
        : 'course';

      await this.startReleaseWorkflow(courseId, { all: true, label });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to release course content: ${error}`);
    }
  }

  private buildReleaseScopeFromTreeItem(item: CourseTreeItem | CourseFolderTreeItem | CourseContentTreeItem): { courseId: string; scope: ReleaseScope } | undefined {
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
        vscode.window.showWarningMessage('Release is only available from the course contents folder.');
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
      vscode.window.showInformationMessage(`No pending content to release${scopeText}. All ${withExamples.length} assigned item(s) are up to date.`);
    } else {
      vscode.window.showInformationMessage(`No pending content to release${scopeText}. Assign examples to course contents first.`);
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
          console.warn(`${upgradeResult.total_failed} version upgrade(s) failed during release`);
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
        console.warn('Assignments generation failed or not available; continuing to student-template.', e);
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
      vscode.window.showInformationMessage(msg);

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
      vscode.window.showErrorMessage('Unable to determine content kind for this item');
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
        vscode.window.showErrorMessage('Failed to load group details');
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
      vscode.window.showErrorMessage(`Failed to show group details: ${error}`);
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
      `Member: ${freshMember.user?.username || freshMember.user?.email || 'Unknown'}`,
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
      vscode.window.showInformationMessage(`Group renamed to "${newTitle}"`);

      // Refresh the tree to show the changes
      await this.treeDataProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to rename group: ${error}`);
    }
  }

  private async deleteCourseGroup(item: CourseGroupTreeItem): Promise<void> {
    const groupTitle = item.group.title || item.group.id;

    // Confirm deletion
    const confirmation = await vscode.window.showWarningMessage(
      `Are you sure you want to delete the group "${groupTitle}"?\n\nMembers will be moved to "No Group".`,
      { modal: true },
      'Delete'
    );

    if (confirmation !== 'Delete') {
      return;
    }

    try {
      await this.apiService.deleteCourseGroup(item.group.id);
      vscode.window.showInformationMessage(`Group "${groupTitle}" deleted`);

      // Refresh the tree to show the changes
      await this.treeDataProvider.refresh();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to delete group: ${error?.message || error}`);
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
        vscode.window.showErrorMessage('Please select a course or groups folder to show members.');
        return;
      }

      // Show webview with existing members first
      await this.courseMemberImportWebviewProvider.showMembers(courseId);
    } catch (error: any) {
      console.error('Failed to show course members:', error);
      vscode.window.showErrorMessage(
        `Failed to show course members: ${error?.message || error}`
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
    try {
      const course = await this.apiService.getCourse(item.course.id);
      if (!course) {
        vscode.window.showErrorMessage('Failed to load course details');
        return;
      }
      await this.courseProgressOverviewWebviewProvider.showCourseProgress(course);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to show course progress: ${error}`);
    }
  }

  private async showCourseProgressOverviewById(courseId: string): Promise<void> {
    try {
      const course = await this.apiService.getCourse(courseId);
      if (!course) {
        vscode.window.showErrorMessage('Failed to load course details');
        return;
      }
      await this.courseProgressOverviewWebviewProvider.showCourseProgress(course);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to show course progress: ${error}`);
    }
  }

  private async showCourseMemberProgress(item: CourseMemberTreeItem): Promise<void> {
    try {
      const memberName = item.member.user
        ? [item.member.user.given_name, item.member.user.family_name].filter(Boolean).join(' ') || item.member.user.username || undefined
        : undefined;
      await this.courseMemberProgressWebviewProvider.showMemberProgress(item.member.id, memberName);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to show member progress: ${error}`);
    }
  }
}
