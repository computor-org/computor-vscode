import * as vscode from 'vscode';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
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
import { MessagesWebviewProvider, MessageTargetContext } from '../ui/webviews/MessagesWebviewProvider';
import { CourseMemberCommentsWebviewProvider } from '../ui/webviews/CourseMemberCommentsWebviewProvider';
import { DeploymentInfoWebviewProvider } from '../ui/webviews/DeploymentInfoWebviewProvider';
import { ReleaseValidationWebviewProvider } from '../ui/webviews/ReleaseValidationWebviewProvider';
import { ExampleGet } from '../types/generated/examples';
import { hasExampleAssigned, getExampleVersionId, getDeploymentStatus } from '../utils/deploymentHelpers';
import type { CourseContentTypeList, CourseList, CourseFamilyList, CourseContentGet } from '../types/generated/courses';
import type { OrganizationList } from '../types/generated/organizations';
import { LecturerRepositoryManager } from '../services/LecturerRepositoryManager';
import { createSimpleGit } from '../git/simpleGitFactory';
import JSZip from 'jszip';
import * as yaml from 'js-yaml';

interface ReleaseScope {
  label?: string;
  path?: string;
  parentId?: string;
  all?: boolean;
}

export class LecturerCommands {
  private settingsManager: ComputorSettingsManager;
  private apiService: ComputorApiService;
  private courseWebviewProvider: CourseWebviewProvider;
  private organizationWebviewProvider: OrganizationWebviewProvider;
  private courseFamilyWebviewProvider: CourseFamilyWebviewProvider;
  private courseContentTypeWebviewProvider: CourseContentTypeWebviewProvider;
  private courseGroupWebviewProvider: CourseGroupWebviewProvider;
  private courseMemberWebviewProvider: CourseMemberWebviewProvider;
  private courseGroupCommands: CourseGroupCommands;
  private messagesWebviewProvider: MessagesWebviewProvider;
  private commentsWebviewProvider: CourseMemberCommentsWebviewProvider;
  private deploymentInfoWebviewProvider: DeploymentInfoWebviewProvider;
  private releaseValidationWebviewProvider: ReleaseValidationWebviewProvider;

  constructor(
    private context: vscode.ExtensionContext,
    private treeDataProvider: LecturerTreeDataProvider,
    apiService?: ComputorApiService
  ) {
    this.settingsManager = new ComputorSettingsManager(context);
    // Use provided apiService or create a new one
    this.apiService = apiService || new ComputorApiService(context);
    this.courseWebviewProvider = new CourseWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.organizationWebviewProvider = new OrganizationWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseFamilyWebviewProvider = new CourseFamilyWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseContentTypeWebviewProvider = new CourseContentTypeWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseGroupWebviewProvider = new CourseGroupWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseMemberWebviewProvider = new CourseMemberWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.messagesWebviewProvider = new MessagesWebviewProvider(context, this.apiService);
    this.commentsWebviewProvider = new CourseMemberCommentsWebviewProvider(context, this.apiService);
    this.deploymentInfoWebviewProvider = new DeploymentInfoWebviewProvider(context, this.apiService);
    this.releaseValidationWebviewProvider = new ReleaseValidationWebviewProvider(context, this.apiService);
    this.courseGroupCommands = new CourseGroupCommands(this.apiService, this.treeDataProvider);
  }

  registerCommands(): void {
    // Workspace directory selection
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.selectWorkspaceDirectory', async () => {
        await this.selectWorkspaceDirectory();
      })
    );

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

    // Example management
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.assignExample', async (item: CourseContentTreeItem) => {
        await this.assignExample(item);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.unassignExample', async (item: CourseContentTreeItem) => {
        await this.unassignExample(item);
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

  private async selectWorkspaceDirectory(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Select Workspace Directory',
      title: 'Select Workspace Directory'
    });

    if (result && result.length > 0 && result[0]) {
      const directory = result[0].fsPath;
      await this.settingsManager.setWorkspaceDirectory(directory);
      vscode.window.showInformationMessage(`Workspace directory set to: ${directory}`);
      
      // Update file explorers to show new workspace
      await vscode.commands.executeCommand('computor.fileExplorer.goToWorkspace');
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

    const title = await vscode.window.showInputBox({
      prompt: 'Enter course content title',
      placeHolder: 'e.g., Week 1: Introduction'
    });

    if (!title) {
      return;
    }

    const initialSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const isAssignment = this.isContentTypeSubmittable(selectedType.contentType);

    if (!isAssignment) {
      await this.treeDataProvider.createCourseContent(
        folderItem,
        title,
        selectedType.id,
        parentPath,
        initialSlug,
        undefined
      );
      return;
    }

    // For assignments, auto-generate the identifier from title
    const autoSlug = title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    // Build full identifier: <organization_path>.<course_family_path>.<course_path>.<slug>
    const orgPath = folderItem.organization.path.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const familyPath = folderItem.courseFamily.path.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const coursePath = folderItem.course.path.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const fullIdentifier = `${orgPath}.${familyPath}.${coursePath}.${autoSlug}`;

    const ltreeIdentifier = fullIdentifier;

    const versionTagInput = await vscode.window.showInputBox({
      prompt: 'Version tag for this assignment',
      value: '0.0.1',
      ignoreFocusOut: true
    });

    if (!versionTagInput) {
      return;
    }

    const versionTag = versionTagInput.trim();
    if (!versionTag) {
      vscode.window.showErrorMessage('Version tag cannot be empty.');
      return;
    }

    // Use the autoSlug for the course content path (not the full identifier)
    const slug = autoSlug || initialSlug || 'assignment';

    try {
      const createdContent = await this.treeDataProvider.createCourseContent(
        folderItem,
        title,
        selectedType.id,
        parentPath,
        slug,
        undefined
      );

      if (!createdContent) {
        return;
      }

      try {
        await this.apiService.assignExampleSourceToCourseContent(
          createdContent.id,
          ltreeIdentifier,
          versionTag,
          undefined
        );
      } catch (error) {
        console.warn('Failed to assign example source to new assignment:', error);
      }

      this.treeDataProvider.rememberAssignmentIdentifier(createdContent.id, ltreeIdentifier);

      await this.prepareAssignmentDirectory(course.id, ltreeIdentifier, ltreeIdentifier, versionTag, title, '', course);

      await this.treeDataProvider.forceRefreshCourse(course.id);
      vscode.window.showInformationMessage(`✅ Created assignment "${title}"`);
    } catch (error) {
      console.error('Failed to create assignment:', error);
      vscode.window.showErrorMessage(`Failed to create assignment: ${error}`);
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

  private async commitAssignmentsBeforeRelease(
    courseId: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<{ repoRoot: string; head: string } | undefined> {
    const course = await this.apiService.getCourse(courseId);
    if (!course) {
      throw new Error('Course not found while preparing assignments repository.');
    }

    const repoManager = new LecturerRepositoryManager(this.context, this.apiService);
    await this.ensureAssignmentsRepo(course, repoManager);

    const repoRoot = repoManager.getAssignmentsRepoRoot(course);
    if (!repoRoot || !fs.existsSync(repoRoot)) {
      throw new Error('Assignments repository is not available locally. Run "Sync assignments" first.');
    }

    const git = createSimpleGit({ baseDir: repoRoot });
    const initialStatus = await git.status();
    if (initialStatus.isClean()) {
      const head = (await git.revparse(['HEAD'])).trim();
      return { repoRoot, head };
    }

    progress?.report({ message: 'Staging assignment changes...' });
    await git.add('.');
    const stagedStatus = await git.status();
    if (stagedStatus.isClean()) {
      const head = (await git.revparse(['HEAD'])).trim();
      return { repoRoot, head };
    }

    const commitMessage = `Update assignments before release (${new Date().toISOString()})`;
    progress?.report({ message: 'Committing assignment changes...' });
    try {
      await git.commit(commitMessage);
    } catch (error: any) {
      const message = error && error.message ? error.message : String(error);
      if (/nothing to commit/i.test(message)) {
        return;
      }
      throw new Error(`Git commit failed: ${message}`);
    }

    progress?.report({ message: 'Pushing assignment changes...' });
    try {
      await git.push();
    } catch (error: any) {
      const message = error && error.message ? error.message : String(error);
      throw new Error(`Git push failed: ${message}`);
    }

    const head = (await git.revparse(['HEAD'])).trim();
    return { repoRoot, head };
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

  private async prepareAssignmentDirectory(
    courseId: string,
    normalizedIdentifier: string,
    ltreeIdentifier: string,
    versionTag: string,
    title: string,
    description: string,
    course: CourseList
  ): Promise<void> {
    const repoManager = new LecturerRepositoryManager(this.context, this.apiService);
    const fullCourse = await this.apiService.getCourse(courseId) || course;

    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Preparing assignments repository...', cancellable: false }, async (progress) => {
      progress.report({ message: `Syncing assignments for ${fullCourse.title || fullCourse.path}` });
      await repoManager.syncAssignmentsForCourse(courseId, (message) => progress.report({ message }));
    });

    const repoRoot = repoManager.getAssignmentsRepoRoot(fullCourse);
    if (!repoRoot) {
      vscode.window.showWarningMessage('Assignments repository is not configured for this course. Directory was not created.');
      return;
    }

    const parts = normalizedIdentifier.split('/').filter(Boolean);
    const assignmentPath = path.join(repoRoot, ...parts);

    if (fs.existsSync(assignmentPath)) {
      vscode.window.showWarningMessage(`Assignment directory already exists: ${assignmentPath}`);
      return;
    }

    await fs.promises.mkdir(assignmentPath, { recursive: true });

    const metaContent = this.buildAssignmentMetaContent(ltreeIdentifier, versionTag, title, description);
    const metaPath = path.join(assignmentPath, 'meta.yaml');
    await fs.promises.writeFile(metaPath, metaContent, 'utf8');

    try {
      const doc = await vscode.workspace.openTextDocument(metaPath);
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (error) {
      console.warn('Failed to open meta.yaml:', error);
    }
  }

  private buildAssignmentMetaContent(identifier: string, versionTag: string, title: string, description: string): string {
    const sanitizedDescription = description.trim();
    const descriptionBlock = sanitizedDescription
      ? `description: |\n  ${sanitizedDescription.replace(/\r?\n/g, '\n  ')}`
      : 'description: ""';

    return [
      `version: '${versionTag}'`,
      `slug: ${identifier}`,
      `title: ${title}`,
      descriptionBlock,
      'language: en',
      'license: MIT',
      'keywords: []',
      'authors: []',
      'maintainers: []',
      'links: []',
      'supportingMaterial: []',
      'properties:',
      '  studentSubmissionFiles: []',
      '  additionalFiles: []',
      '  testFiles: []',
      '  studentTemplates: []',
      '  testDependencies: []'
    ].join('\n');
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
          sourceRole: 'lecturer'
        };
      } else if (item instanceof CourseGroupTreeItem) {
        target = {
          title: item.group.title || `Group ${item.group.id.slice(0, 8)}`,
          subtitle: `${this.buildCourseSubtitle(item.course, item.courseFamily, item.organization)} › Group`,
          query: { course_group_id: item.group.id },
          createPayload: { course_group_id: item.group.id },
          sourceRole: 'lecturer'
        };
      } else if (item instanceof CourseContentTreeItem) {
        target = {
          title: item.courseContent.title || item.courseContent.path,
          subtitle: `${this.buildCourseSubtitle(item.course, item.courseFamily, item.organization)} › ${item.courseContent.path}`,
          query: { course_content_id: item.courseContent.id },
          createPayload: { course_content_id: item.courseContent.id, course_id: item.course.id },
          sourceRole: 'lecturer'
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
    console.log('Delete command called with item:', item);
    console.log('Item type:', item.constructor.name);
    console.log('Item courseContent:', item.courseContent);
    
    // Validate that we have the required data
    if (!item.courseContent || !item.courseContent.id) {
      vscode.window.showErrorMessage('Invalid course content item - missing required data');
      console.error('Invalid item passed to deleteCourseContent:', item);
      return;
    }
    
    const confirmation = await vscode.window.showWarningMessage(
      `Are you sure you want to delete "${item.courseContent.title || item.courseContent.path}"?`,
      'Yes',
      'No'
    );

    if (confirmation === 'Yes') {
      await this.treeDataProvider.deleteCourseContent(item);
    }
  }

  /**
   * Check local assignments repository for examples and upload them if they don't exist in the backend
   * Uses course contents from API and checks corresponding directories for meta.yaml files
   * @param course The course to check
   * @param contentIds Optional list of content IDs to check (if not provided, checks all assignments)
   */
  private async checkAndUploadLocalExamples(course: CourseList, contentIds?: string[]): Promise<void> {
    console.log('[AUTO-UPLOAD] ========================================');
    console.log('[AUTO-UPLOAD] Checking for local examples to upload');
    console.log('[AUTO-UPLOAD] Course:', course.title, '(', course.id, ')');
    try {
      const repoManager = new LecturerRepositoryManager(this.context, this.apiService);
      const assignmentsRoot = repoManager.getAssignmentsRepoRoot(course);
      console.log('[AUTO-UPLOAD] Assignments root:', assignmentsRoot);

      if (!assignmentsRoot || !fs.existsSync(assignmentsRoot)) {
        console.log('[AUTO-UPLOAD] ❌ No assignments root found, skipping');
        console.warn('[AUTO-UPLOAD] Expected assignments repository at:', assignmentsRoot || '(path not determined)');
        console.warn('[AUTO-UPLOAD] Please clone the assignments repository first before releasing');
        console.log('[AUTO-UPLOAD] ========================================');
        return;
      }

      console.log('[AUTO-UPLOAD] ✓ Assignments repository found!');

      // Step 1: Get course contents with deployment info
      console.log('[AUTO-UPLOAD] Getting course contents with deployment info from API...');
      const allContents = await this.apiService.getCourseContents(course.id, false, true);

      if (!allContents || allContents.length === 0) {
        console.log('[AUTO-UPLOAD] No course contents found in API');
        return;
      }

      // Step 2: Filter to submittable contents and optionally by content IDs
      let contentsToCheck = allContents.filter(content => content.is_submittable);

      if (contentIds && contentIds.length > 0) {
        console.log('[AUTO-UPLOAD] Filtering to specific content IDs:', contentIds);
        contentsToCheck = contentsToCheck.filter(content =>
          contentIds.includes(content.id)
        );
      }

      console.log(`[AUTO-UPLOAD] Found ${contentsToCheck.length} submittable content(s) to check`);

      // Step 3: For each content, use deployment.example_identifier as directory name
      const metaDataList: Array<{
        contentId: string;
        exampleIdentifier: string;
        dir: string;
        metaPath: string;
        meta: any
      }> = [];

      for (const content of contentsToCheck) {
        const exampleIdentifier = content.deployment?.example_identifier;
        if (!exampleIdentifier) {
          console.warn(`[AUTO-UPLOAD] Content ${content.id} (${content.path}) has no example_identifier in deployment, skipping`);
          continue;
        }

        const contentPath = path.join(assignmentsRoot, exampleIdentifier);
        const metaPath = path.join(contentPath, 'meta.yaml');

        console.log(`[AUTO-UPLOAD] Checking ${exampleIdentifier} for meta.yaml...`);

        if (!fs.existsSync(metaPath)) {
          console.log(`[AUTO-UPLOAD] No meta.yaml in ${exampleIdentifier}, skipping`);
          continue;
        }

        try {
          const metaContent = fs.readFileSync(metaPath, 'utf-8');
          const meta = yaml.load(metaContent) as any;

          if (!meta || !meta.slug || !meta.version) {
            console.warn(`[AUTO-UPLOAD] Invalid meta.yaml in ${exampleIdentifier} (missing slug or version)`);
            continue;
          }

          console.log(`[AUTO-UPLOAD] ✓ Found meta.yaml in ${exampleIdentifier}: slug="${meta.slug}", version="${meta.version}"`);
          metaDataList.push({
            contentId: content.id,
            exampleIdentifier,
            dir: contentPath,
            metaPath,
            meta
          });
        } catch (error) {
          console.error(`[AUTO-UPLOAD] ❌ Failed to read meta.yaml in ${exampleIdentifier}:`, error);
          continue;
        }
      }

      if (metaDataList.length === 0) {
        console.log('[AUTO-UPLOAD] No valid meta.yaml files found');
        return;
      }

      // Step 3: Prepare batch validation request
      const validationItems = metaDataList.map(item => ({
        content_id: item.contentId,
        example_identifier: item.meta.slug,
        version_tag: item.meta.version
      }));

      console.log(`[AUTO-UPLOAD] Validating ${validationItems.length} items in batch...`);

      // Step 4: Batch validate
      const validationResult = await this.apiService.validateCourseContent(course.id, validationItems);

      console.log('[AUTO-UPLOAD] Batch validation result:', {
        valid: validationResult.valid,
        total_validated: validationResult.total_validated,
        total_issues: validationResult.total_issues
      });

      // Step 5: Determine what needs uploading based on validation results
      const examplestoUpload: Array<{ dir: string; metaPath: string; meta: any }> = [];

      validationResult.validation_results.forEach((result: any) => {
        const metaItem = metaDataList.find(m => m.contentId === result.content_id);
        if (!metaItem) {return;}

        if (!result.valid) {
          console.log(`[AUTO-UPLOAD] ⚠️  Will upload: ${metaItem.meta.slug} v${metaItem.meta.version} (${metaItem.exampleIdentifier})`);
          console.log(`[AUTO-UPLOAD]     Reason: ${result.validation_message || 'Invalid'}`);
          examplestoUpload.push({ dir: metaItem.dir, metaPath: metaItem.metaPath, meta: metaItem.meta });
        } else {
          console.log(`[AUTO-UPLOAD] ✓ Already exists: ${metaItem.meta.slug} v${metaItem.meta.version}`);
        }
      });

      console.log('[AUTO-UPLOAD] ========================================');
      console.log('[AUTO-UPLOAD] Summary: Found', examplestoUpload.length, 'example(s) to upload');
      if (examplestoUpload.length > 0) {
        console.log('[AUTO-UPLOAD] Examples to upload:');
        examplestoUpload.forEach(ex => {
          console.log(`[AUTO-UPLOAD]   - ${ex.meta.slug} v${ex.meta.version} from ${ex.dir}`);
        });
      }
      console.log('[AUTO-UPLOAD] ========================================');

      // Upload examples that don't exist in backend
      if (examplestoUpload.length > 0) {
        console.log('[AUTO-UPLOAD] Showing selection dialog for examples to upload...');

        // Create QuickPick items for each example
        const items = examplestoUpload.map(ex => ({
          label: ex.meta.slug,
          description: `v${ex.meta.version}`,
          detail: ex.dir,
          picked: true, // Pre-selected
          example: ex
        }));

        const selected = await vscode.window.showQuickPick(items, {
          canPickMany: true,
          placeHolder: 'Select examples to upload (pre-selected)',
          title: `Found ${examplestoUpload.length} example(s) to upload`
        });

        if (!selected) {
          console.log('[AUTO-UPLOAD] User cancelled upload selection');
          throw new Error('Upload cancelled by user');
        }

        if (selected.length === 0) {
          console.log('[AUTO-UPLOAD] User deselected all examples - skipping upload');
          vscode.window.showInformationMessage('No examples selected for upload');
        } else {
          console.log(`[AUTO-UPLOAD] User selected ${selected.length} example(s) to upload`);

          // Get example repositories
          console.log('[AUTO-UPLOAD] Fetching example repositories...');
          const repositories = await this.apiService.getExampleRepositories();

          if (!repositories || repositories.length === 0) {
            vscode.window.showErrorMessage('No example repositories available. Cannot upload examples.');
            throw new Error('No example repositories available');
          }

          // Show repository selection
          const repositoryItems = repositories.map(repo => ({
            label: repo.name,
            description: repo.source_type,
            detail: repo.description || repo.source_url,
            repository: repo
          }));

          const selectedRepo = await vscode.window.showQuickPick(repositoryItems, {
            placeHolder: 'Select target example repository',
            title: 'Upload Examples To'
          });

          if (!selectedRepo) {
            console.log('[AUTO-UPLOAD] User cancelled repository selection');
            throw new Error('Repository selection cancelled by user');
          }

          console.log(`[AUTO-UPLOAD] User selected repository: ${selectedRepo.repository.name} (${selectedRepo.repository.id})`);
          const selectedExamples = selected.map(item => item.example);
          await this.uploadLocalExamples(selectedExamples, selectedRepo.repository.id);
          console.log('[AUTO-UPLOAD] ✓ Upload process complete');
        }
      } else {
        console.log('[AUTO-UPLOAD] No examples need uploading');
      }
    } catch (error) {
      console.error('[AUTO-UPLOAD] ❌ ERROR in checkAndUploadLocalExamples:', error);
      vscode.window.showErrorMessage(`Auto-upload failed: ${error}`);
      throw error;
    }
  }

  /**
   * Auto-assign examples to assignments based on local meta.yaml data
   */
  private async autoAssignExamplesFromLocal(courseId: string): Promise<void> {
    console.log('[AUTO-ASSIGN] ========================================');
    console.log('[AUTO-ASSIGN] Starting auto-assignment for course:', courseId);
    try {
      const course = await this.apiService.getCourse(courseId);
      if (!course) {
        console.log('[AUTO-ASSIGN] ❌ Course not found');
        return;
      }

      const repoManager = new LecturerRepositoryManager(this.context, this.apiService);
      const assignmentsRoot = repoManager.getAssignmentsRepoRoot(course);
      console.log('[AUTO-ASSIGN] Assignments root:', assignmentsRoot);

      if (!assignmentsRoot || !fs.existsSync(assignmentsRoot)) {
        console.log('[AUTO-ASSIGN] ❌ No assignments repository found, skipping');
        return;
      }

      console.log('[AUTO-ASSIGN] ✓ Assignments repository found');

      // Get all course contents
      const contents = await this.apiService.getCourseContents(courseId, false, true);
      if (!contents) {
        return;
      }

      // Get content types to identify submittable content (assignments)
      const contentTypes = await this.apiService.getCourseContentTypes(courseId);
      const submittableTypeIds = new Set<string>();

      for (const type of contentTypes) {
        const fullType = await this.apiService.getCourseContentType(type.id);
        if (fullType?.course_content_kind?.submittable) {
          submittableTypeIds.add(type.id);
        }
      }

      // Find assignments without examples and try to match them
      const assignmentsToAssign: Array<{ contentId: string; exampleIdentifier: string; versionTag: string; title: string }> = [];

      for (const content of contents) {
        const isSubmittable = submittableTypeIds.has(content.course_content_type_id);
        if (!isSubmittable) {
          continue;
        }

        // Check if deployment has an actual example version assigned
        const hasExampleVersion = content.deployment?.example_version_id;
        if (hasExampleVersion) {
          continue; // Already has example version assigned
        }

        // Try to find matching example in local repository
        // Use deployment.example_identifier as directory name if available
        const directoryName = content.deployment?.example_identifier || content.path;
        const assignmentPath = path.join(assignmentsRoot, directoryName);

        if (!fs.existsSync(assignmentPath)) {
          continue;
        }

        // Look for meta.yaml in assignment directory
        const metaPath = path.join(assignmentPath, 'meta.yaml');
        if (!fs.existsSync(metaPath)) {
          continue;
        }

        try {
          const metaContent = fs.readFileSync(metaPath, 'utf-8');
          const meta = yaml.load(metaContent) as any;

          if (!meta || !meta.slug || !meta.version) {
            continue;
          }

          // Query example by identifier (slug) using the new method
          const example = await this.apiService.getExampleByIdentifier(meta.slug);
          if (!example) {
            console.warn(`Example ${meta.slug} not found in backend for assignment ${content.title}`);
            continue;
          }

          // Check if version exists by querying with version_tag parameter
          const versions = await this.apiService.getExampleVersions(example.id, meta.version);
          const matchingVersion = versions && versions.length > 0 ? versions[0] : null;

          if (!matchingVersion) {
            console.warn(`Version ${meta.version} not found for example ${meta.slug}`);
            continue;
          }

          assignmentsToAssign.push({
            contentId: content.id,
            exampleIdentifier: meta.slug,
            versionTag: meta.version,
            title: content.title || content.path
          });
        } catch (error) {
          console.warn(`Failed to read meta.yaml for ${content.path}:`, error);
          continue;
        }
      }

      // Auto-assign if we found matches
      if (assignmentsToAssign.length > 0) {
        console.log(`[AUTO-ASSIGN] Auto-assigning ${assignmentsToAssign.length} assignment(s)...`);
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Auto-assigning ${assignmentsToAssign.length} assignment(s)...`,
          cancellable: false
        }, async (progress) => {
            let successCount = 0;
            const errors: string[] = [];

            for (let i = 0; i < assignmentsToAssign.length; i++) {
              const assignment = assignmentsToAssign[i];
              if (!assignment) {
                continue;
              }

              try {
                progress.report({
                  increment: (100 / assignmentsToAssign.length),
                  message: `Assigning: ${assignment.title} (${i + 1}/${assignmentsToAssign.length})`
                });

                await this.apiService.lecturerAssignExample(
                  assignment.contentId,
                  {
                    example_identifier: assignment.exampleIdentifier,
                    version_tag: assignment.versionTag
                  }
                );

                successCount++;
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                errors.push(`${assignment.title}: ${errorMsg}`);
                console.error(`Failed to assign ${assignment.title}:`, error);
              }
            }

            if (successCount > 0) {
              vscode.window.showInformationMessage(
                `✅ Auto-assigned ${successCount} assignment(s) successfully`
              );
            }

            if (errors.length > 0) {
              vscode.window.showWarningMessage(
                `Failed to assign ${errors.length} assignment(s). Check console for details.`
              );
            }
          });
      }
    } catch (error) {
      console.error('[AUTO-ASSIGN] ERROR in autoAssignExamplesFromLocal:', error);
      vscode.window.showErrorMessage(`Auto-assign failed: ${error}`);
      throw error;
    }
  }

  /**
   * Upload local examples to the backend
   */
  private async uploadLocalExamples(
    examples: Array<{ dir: string; metaPath: string; meta: any }>,
    repositoryId: string
  ): Promise<void> {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Uploading ${examples.length} example(s)...`,
      cancellable: false
    }, async (progress) => {
      let successCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < examples.length; i++) {
        const item = examples[i];
        if (!item) {
          continue;
        }
        const { dir, meta } = item;
        const exampleName = meta.title || meta.slug;

        let uploadRequest: any = null;
        try {
          progress.report({
            increment: (100 / examples.length),
            message: `Uploading: ${exampleName} (${i + 1}/${examples.length})`
          });

          // Package as zip
          const zipper = new JSZip();
          const addToZip = (dirPath: string, basePath: string) => {
            const entries = fs.readdirSync(dirPath);
            for (const entry of entries) {
              if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) {
                continue;
              }
              const fullPath = path.join(dirPath, entry);
              const stat = fs.statSync(fullPath);
              const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
              if (stat.isFile()) {
                const data = fs.readFileSync(fullPath);
                zipper.file(relativePath, data);
              } else if (stat.isDirectory()) {
                addToZip(fullPath, basePath);
              }
            }
          };

          addToZip(dir, dir);
          const base64Zip = await zipper.generateAsync({ type: 'base64', compression: 'DEFLATE' });

          // Upload via API
          uploadRequest = {
            repository_id: repositoryId,
            directory: path.basename(dir),
            files: { [`${path.basename(dir)}.zip`]: base64Zip }
          };

          console.log(`[AUTO-UPLOAD] Uploading ${exampleName} with request:`, {
            repository_id: uploadRequest.repository_id,
            directory: uploadRequest.directory,
            files_keys: Object.keys(uploadRequest.files)
          });
          await this.apiService.uploadExample(uploadRequest);
          successCount++;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push(`${exampleName}: ${errorMsg}`);
          console.error(`Failed to upload ${exampleName}:`, error);
          if (uploadRequest) {
            console.error(`Upload request was:`, {
              repository_id: uploadRequest.repository_id,
              directory: uploadRequest.directory,
              files_count: Object.keys(uploadRequest.files).length
            });
          }
        }
      }

      if (errors.length > 0) {
        const errorDetails = errors.join('\n');
        console.error('[AUTO-UPLOAD] Upload errors:', errorDetails);
        vscode.window.showErrorMessage(
          `Failed to upload ${errors.length} example(s). Release cancelled.`
        );
        throw new Error(`Failed to upload ${errors.length} example(s): ${errorDetails}`);
      }

      if (successCount > 0) {
        vscode.window.showInformationMessage(
          `✅ Uploaded ${successCount} example(s) successfully`
        );
      }
    });
  }

  private async assignExample(item: CourseContentTreeItem): Promise<void> {
    try {
      // Step 1: Check local assignments repository for examples and auto-upload if needed
      await this.checkAndUploadLocalExamples(item.course);

      // Step 2: Get available examples
      const examples = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Loading examples...',
        cancellable: false
      }, async () => {
        return await this.apiService.getAvailableExamples();
      });

      if (!examples || examples.length === 0) {
        const action = await vscode.window.showWarningMessage(
          'No examples available. You need to upload examples before assigning them.',
          'Upload Example',
          'Cancel'
        );

        if (action === 'Upload Example') {
          vscode.commands.executeCommand('computor.lecturer.examples.focus');
          vscode.window.showInformationMessage(
            'Navigate to the Examples view, right-click an example, and select "Upload Example"'
          );
        }
        return;
      }

      // Step 2: Show example picker
      const selectedExample = await vscode.window.showQuickPick(
        examples.map((ex: ExampleGet) => ({
          label: ex.title,
          description: ex.identifier || 'No identifier',
          detail: ex.description || '',
          id: ex.id,
          identifier: ex.identifier
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

      // Step 3: Load versions for selected example
      const versions = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Loading example versions...',
        cancellable: false
      }, async () => {
        return await this.apiService.getExampleVersions(selectedExample.id);
      });

      if (!versions || versions.length === 0) {
        vscode.window.showWarningMessage('No versions available for this example');
        return;
      }

      // Step 4: Show version picker
      const selectedVersion = await vscode.window.showQuickPick(
        versions.map((v: any) => ({
          label: v.version_tag,
          description: `Created: ${new Date(v.created_at).toLocaleDateString()}`,
          detail: v.description || '',
          versionTag: v.version_tag
        })),
        {
          placeHolder: 'Select version to assign'
        }
      );

      if (!selectedVersion) {
        return;
      }

      // Step 5: Confirm assignment
      const confirm = await vscode.window.showInformationMessage(
        `Assign "${selectedExample.label}" (v${selectedVersion.versionTag}) to this assignment?`,
        'Assign',
        'Cancel'
      );

      if (confirm !== 'Assign') {
        return;
      }

      // Step 6: Perform assignment using new lecturer endpoint
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Assigning example...',
        cancellable: false
      }, async () => {
        await this.apiService.lecturerAssignExample(
          item.courseContent.id,
          {
            example_identifier: selectedExample.identifier,
            version_tag: selectedVersion.versionTag
          }
        );
      });

      // Step 7: Success
      vscode.window.showInformationMessage(
        `✅ Example assigned successfully!`
      );

      // Step 8: Refresh tree
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();

    } catch (error: any) {
      console.error('Failed to assign example:', error);
      const errorMessage = error?.response?.data?.detail || error.message || 'Unknown error';
      vscode.window.showErrorMessage(`Failed to assign example: ${errorMessage}`);
    }
  }

  private async unassignExample(item: CourseContentTreeItem): Promise<void> {
    try {
      // Step 1: Get current deployment info to check status
      const deployment = await this.apiService.lecturerGetDeployment(item.courseContent.id);

      // Step 2: Check if unassignable
      const deploymentStatus = deployment?.deployment_status || 'unassigned';
      if (deploymentStatus === 'deployed' || deploymentStatus === 'deploying') {
        vscode.window.showErrorMessage(
          `Cannot unassign: Example is ${deploymentStatus}.\n\nUnassignment is only allowed for pending or failed deployments.`
        );
        return;
      }

      // Step 3: Confirm unassignment
      const confirmation = await vscode.window.showWarningMessage(
        `Unassign example from "${item.courseContent.title}"?`,
        { modal: true },
        'Unassign',
        'Cancel'
      );

      if (confirmation !== 'Unassign') {
        return;
      }

      // Step 4: Perform unassignment using new lecturer endpoint
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Unassigning example...',
        cancellable: false
      }, async () => {
        await this.apiService.lecturerUnassignExample(item.courseContent.id);
      });

      // Step 5: Success
      vscode.window.showInformationMessage('✅ Example unassigned successfully');

      // Step 6: Refresh tree
      this.apiService.clearCourseCache(item.course.id);
      this.treeDataProvider.refresh();

    } catch (error: any) {
      console.error('Failed to unassign example:', error);

      // Handle specific error cases
      if (error?.response?.status === 400) {
        const errorDetail = error.response.data?.detail || 'Cannot unassign example';
        vscode.window.showErrorMessage(`❌ Cannot unassign: ${errorDetail}`);
      } else {
        const errorMessage = error?.response?.data?.detail || error.message || 'Unknown error';
        vscode.window.showErrorMessage(`❌ Unassignment failed: ${errorMessage}`);
      }
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
    console.log('[RELEASE] ========================================');
    console.log('[RELEASE] Starting release workflow for course:', courseId);
    console.log('[RELEASE] Scope:', JSON.stringify(scope));
    console.log('[RELEASE] ========================================');

    // Step 0: Get course and check for local examples that need uploading
    const course = await this.apiService.getCourse(courseId);
    console.log('[RELEASE] Course fetched:', course ? `${course.title} (${course.id})` : 'NOT FOUND');

    if (course) {
      console.log('[RELEASE] Found course, checking for pending content to determine which examples to check...');

      // First, get the pending release contents to know which assignments we're actually releasing
      const pendingContents = await this.getPendingReleaseContents(courseId, scope);
      const pendingIds = pendingContents.map(c => c.id);

      console.log('[RELEASE] Pending content IDs:', pendingIds.length > 0 ? pendingIds : 'None - will check all');

      try {
        // Check and upload local examples - only for the pending content IDs
        console.log('[RELEASE] Calling checkAndUploadLocalExamples...');
        await this.checkAndUploadLocalExamples(course, pendingIds.length > 0 ? pendingIds : undefined);
        console.log('[RELEASE] ✓ Example check/upload complete');

        // Auto-assign examples to assignments based on identifiers
        console.log('[RELEASE] Calling autoAssignExamplesFromLocal...');
        await this.autoAssignExamplesFromLocal(courseId);
        console.log('[RELEASE] ✓ Auto-assignment complete');
      } catch (error: any) {
        console.error('[RELEASE] ❌ Error during auto-upload/assign:', error);
        if (error.message === 'Upload cancelled by user' || error.message === 'Repository selection cancelled by user') {
          vscode.window.showInformationMessage('Release cancelled');
          return;
        }
        // If upload failed, stop the release process
        if (error.message && error.message.includes('Failed to upload')) {
          vscode.window.showErrorMessage(`Release cancelled: ${error.message}`);
          return;
        }
        console.warn('[RELEASE] ⚠️  Failed to auto-upload/assign examples, continuing anyway...', error);
        // Continue anyway - validation will catch missing examples
      }
    } else {
      console.warn('[RELEASE] ⚠️  Course not found');
    }

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

    // Step 3: Continue with normal release flow
    let repoInfo: { repoRoot: string; head: string } | undefined;
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Preparing assignments repository...' }, async (progress) => {
        repoInfo = await this.commitAssignmentsBeforeRelease(courseId, progress);
      });
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to prepare assignments repository: ${error?.message || error}`);
      return;
    }

    if (!repoInfo) {
      vscode.window.showErrorMessage('Assignments repository could not be prepared.');
      return;
    }

    // Clear both API and tree caches to get fresh data
    this.apiService.clearCourseCache(courseId);
    this.treeDataProvider.invalidateCache('course', courseId);

    const pendingContents = await this.getPendingReleaseContents(courseId, scope, repoInfo?.head);

    if (pendingContents.length === 0) {
      await this.handleNoPendingContent(courseId, scope);
      return;
    }

    const confirmed = await this.confirmRelease(pendingContents, scope);
    if (!confirmed) {
      return;
    }

    await this.executeRelease(courseId, scope, repoInfo);
  }
  
  private async getPendingReleaseContents(courseId: string, scope?: ReleaseScope, initialRepoHead?: string) {
    // Fetch with deployment info included
    const contents = await this.apiService.getCourseContents(courseId, false, true);
    
    console.log('Debug: Fetched contents for release check:', contents?.length);
    
    // Get content types to check if they are submittable
    const contentTypes = await this.apiService.getCourseContentTypes(courseId);
    const submittableTypeIds = new Set<string>();
    
    // Check each content type for submittability
    for (const type of contentTypes) {
      const fullType = await this.apiService.getCourseContentType(type.id);
      if (fullType?.course_content_kind?.submittable) {
        submittableTypeIds.add(type.id);
      }
    }
    
    console.log('Debug: Submittable type IDs:', Array.from(submittableTypeIds));
    
    let repoHead: string | undefined = initialRepoHead;
    if (!repoHead) {
      try {
        const course = await this.apiService.getCourse(courseId);
        if (course) {
          const repoManager = new LecturerRepositoryManager(this.context, this.apiService);
          const repoRoot = repoManager.getAssignmentsRepoRoot(course);
          if (repoRoot && fs.existsSync(repoRoot)) {
            const git = createSimpleGit({ baseDir: repoRoot });
            repoHead = (await git.revparse(['HEAD'])).trim();
            console.log(`[Release] Assignments HEAD commit: ${repoHead}`);
          }
        }
      } catch (error) {
        console.warn('[Release] Failed to resolve assignments repo HEAD:', error);
      }
    }

    // Debug: log all contents with their deployment info
    contents?.forEach(c => {
      const isSubmittable = submittableTypeIds.has(c.course_content_type_id);
      const hasExample = hasExampleAssigned(c);
      const status = getDeploymentStatus(c);
      console.log(`Debug: Content "${c.title}": submittable=${isSubmittable}, hasExample=${hasExample}, status=${status}, has_deployment=${c.has_deployment}, deployment_status=${c.deployment_status}`);
    });
    
    return contents?.filter(c => {
      if (scope?.path) {
        const pathValue = c.path || '';
        if (!(pathValue === scope.path || pathValue.startsWith(`${scope.path}.`))) {
          return false;
        }
      }
      // Check if this content's type is submittable
      const isSubmittable = submittableTypeIds.has(c.course_content_type_id);
      // According to the new model, content with status 'pending' means assigned but not deployed
      const status = getDeploymentStatus(c);
      const deployedCommit = typeof (c as any)?.deployment?.version_identifier === 'string'
        ? (c as any).deployment.version_identifier as string
        : undefined;
      const commitChanged = Boolean(repoHead && deployedCommit && repoHead !== deployedCommit);

      // Only include submittable content with pending deployment
      return isSubmittable && hasExampleAssigned(c) && (
        status === 'pending' ||
        status === 'failed' ||
        (status === 'deployed' && commitChanged)
      );
    }) || [];
  }
  
  private async handleNoPendingContent(courseId: string, scope?: ReleaseScope): Promise<void> {
    const contents = await this.apiService.getCourseContents(courseId, false, true);
    const filtered = scope?.path
      ? contents?.filter(c => {
          const pathValue = c.path || '';
          return pathValue === scope.path || pathValue.startsWith(`${scope.path}.`);
        })
      : contents;

    const withExamples = filtered?.filter(c => hasExampleAssigned(c)) || [];

    const scopeText = scope?.label ? ` under "${scope.label}"` : '';

    if (withExamples.length > 0) {
      vscode.window.showInformationMessage(
        `No pending content to release${scopeText}. ${withExamples.length} item(s) have examples with deployment status: ${
          withExamples.map(c => getDeploymentStatus(c) || 'not set').join(', ')
        }`
      );
    } else {
      vscode.window.showInformationMessage(`No pending content to release${scopeText}. Assign examples to course contents first.`);
    }
  }
  
  private async confirmRelease(pendingContents: any[], scope?: ReleaseScope): Promise<boolean> {
    const pendingList = pendingContents.map(c => `• ${c.title || c.path}`).join('\n');
    const header = scope?.label
      ? `Release ${pendingContents.length} content item(s) under "${scope.label}" to students?`
      : `Release ${pendingContents.length} content item(s) to students?`;
    const confirmation = await vscode.window.showWarningMessage(
      `${header}\n\n${pendingList}`,
      { modal: true },
      'Release',
      'Cancel'
    );
    return confirmation === 'Release';
  }
  
  private async executeRelease(courseId: string, scope?: ReleaseScope, repoInfo?: { repoRoot: string; head: string }): Promise<void> {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Releasing course content',
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 0, message: 'Preparing release...' });

      let effectiveRepoInfo = repoInfo;
      if (!effectiveRepoInfo) {
        try {
          effectiveRepoInfo = await this.commitAssignmentsBeforeRelease(courseId, progress);
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to prepare assignments repository: ${error?.message || error}`);
          throw error;
        }
      }

      // Determine selection
      const pendingContents = await this.getPendingReleaseContents(courseId, scope, effectiveRepoInfo?.head);
      const contentIds = pendingContents.map((c: any) => c.id);

      if (contentIds.length === 0) {
        vscode.window.showInformationMessage('No pending content remains after preparing assignments. Release cancelled.');
        return;
      }

      try {
        if (scope?.parentId) {
          progress.report({ message: `Syncing assignments for ${contentIds.length} item(s) under ${scope.label || 'selection'}...` });
          await this.apiService.generateAssignments(courseId, {
            parent_id: scope.parentId,
            include_descendants: true,
            overwrite_strategy: 'skip_if_exists',
            commit_message: 'Sync assignments prior to student-template release'
          });
        } else {
          progress.report({ message: `Syncing assignments for ${contentIds.length} item(s)...` });
          await this.apiService.generateAssignments(courseId, {
            all: scope?.all || false,
            course_content_ids: scope?.all ? undefined : contentIds,
            include_descendants: true,
            overwrite_strategy: 'skip_if_exists',
            commit_message: 'Sync assignments prior to student-template release'
          });
        }
      } catch (e) {
        console.warn('Assignments generation failed or not available; continuing to student-template.', e);
      }

      // Step 2: Trigger student-template generation (Temporal workflow)
      progress.report({ message: 'Starting student-template release...' });
      const releaseSelection = scope?.parentId
        ? { parent_id: scope.parentId, include_descendants: true }
        : scope?.all
          ? { all: true }
          : { course_content_ids: contentIds, include_descendants: true };

      const result = await this.apiService.generateStudentTemplate(courseId, {
        release: releaseSelection
      });
      console.log('Student-template workflow started:', result);

      const items = typeof result?.contents_to_process === 'number' ? result.contents_to_process : undefined;
      const scopeSuffix = scope?.label ? ` for ${scope.label}` : '';
      const msg = items && items > 0
        ? `✅ Release started for ${items} item(s)${scopeSuffix}. This runs in background.`
        : `✅ Release started${scopeSuffix}. This runs in background.`;
      vscode.window.showInformationMessage(msg);

      // Clear API cache and force refresh the course data
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

    // Fetch available groups for the course
    let availableGroups: any[] = [];
    try {
      availableGroups = await this.apiService.getCourseGroups(item.course.id);
    } catch (error) {
      console.error('Failed to fetch available groups:', error);
    }

    await this.courseMemberWebviewProvider.show(
      `Member: ${freshMember.user?.username || freshMember.user?.email || 'Unknown'}`,
      {
        member: freshMember,
        course: item.course,
        group,
        role: undefined,
        availableGroups,
        availableRoles: undefined
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
}
