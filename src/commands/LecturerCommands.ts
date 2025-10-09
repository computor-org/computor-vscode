import * as vscode from 'vscode';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import * as fs from 'fs';
import * as path from 'path';
import { LecturerTreeDataProvider } from '../ui/tree/lecturer/LecturerTreeDataProvider';
import { OrganizationTreeItem, CourseFamilyTreeItem, CourseTreeItem, CourseContentTreeItem, CourseFolderTreeItem, CourseContentTypeTreeItem, CourseGroupTreeItem, CourseMemberTreeItem } from '../ui/tree/lecturer/LecturerTreeItems';
import { CourseGroupCommands } from './lecturer/courseGroupCommands';
import { ComputorApiService } from '../services/ComputorApiService';
import { CourseWebviewProvider } from '../ui/webviews/CourseWebviewProvider';
import { CourseContentWebviewProvider } from '../ui/webviews/CourseContentWebviewProvider';
import { OrganizationWebviewProvider } from '../ui/webviews/OrganizationWebviewProvider';
import { CourseFamilyWebviewProvider } from '../ui/webviews/CourseFamilyWebviewProvider';
import { CourseContentTypeWebviewProvider } from '../ui/webviews/CourseContentTypeWebviewProvider';
import { CourseGroupWebviewProvider } from '../ui/webviews/CourseGroupWebviewProvider';
import { MessagesWebviewProvider, MessageTargetContext } from '../ui/webviews/MessagesWebviewProvider';
import { CourseMemberCommentsWebviewProvider } from '../ui/webviews/CourseMemberCommentsWebviewProvider';
import { ExampleGet } from '../types/generated/examples';
import { hasExampleAssigned, getExampleVersionId, getDeploymentStatus } from '../utils/deploymentHelpers';
import type { CourseContentTypeList, CourseList, CourseFamilyList, CourseContentGet } from '../types/generated/courses';
import type { OrganizationList } from '../types/generated/organizations';
import { LecturerRepositoryManager } from '../services/LecturerRepositoryManager';
import { createSimpleGit } from '../git/simpleGitFactory';

interface ExampleQuickPickItem extends vscode.QuickPickItem {
  example: ExampleGet;
}

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
  private courseContentWebviewProvider: CourseContentWebviewProvider;
  private organizationWebviewProvider: OrganizationWebviewProvider;
  private courseFamilyWebviewProvider: CourseFamilyWebviewProvider;
  private courseContentTypeWebviewProvider: CourseContentTypeWebviewProvider;
  private courseGroupWebviewProvider: CourseGroupWebviewProvider;
  private courseGroupCommands: CourseGroupCommands;
  private messagesWebviewProvider: MessagesWebviewProvider;
  private commentsWebviewProvider: CourseMemberCommentsWebviewProvider;

  constructor(
    private context: vscode.ExtensionContext,
    private treeDataProvider: LecturerTreeDataProvider,
    apiService?: ComputorApiService
  ) {
    this.settingsManager = new ComputorSettingsManager(context);
    // Use provided apiService or create a new one
    this.apiService = apiService || new ComputorApiService(context);
    this.courseWebviewProvider = new CourseWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseContentWebviewProvider = new CourseContentWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.organizationWebviewProvider = new OrganizationWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseFamilyWebviewProvider = new CourseFamilyWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseContentTypeWebviewProvider = new CourseContentTypeWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.courseGroupWebviewProvider = new CourseGroupWebviewProvider(context, this.apiService, this.treeDataProvider);
    this.messagesWebviewProvider = new MessagesWebviewProvider(context, this.apiService);
    this.commentsWebviewProvider = new CourseMemberCommentsWebviewProvider(context, this.apiService);
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

  private async assignExample(item: CourseContentTreeItem): Promise<void> {
    try {
      const searchQuery = await this.promptForExampleSearch();
      const examples = await this.searchExamples(item.course.id, searchQuery);
      
      if (!examples || examples.length === 0) {
        vscode.window.showWarningMessage('No examples found matching your search');
        return;
      }

      const selected = await this.selectExample(examples);
      if (!selected) {
        return;
      }

      await this.performExampleAssignment(item, selected.example);
      
      vscode.window.showInformationMessage(
        `✅ Example "${selected.label}" assigned successfully!`
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to assign example: ${error}`);
    }
  }
  
  private async promptForExampleSearch(): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: 'Search for examples (optional)',
      placeHolder: 'Enter search terms or leave empty to see all'
    });
  }
  
  private async searchExamples(courseId: string, searchQuery?: string): Promise<ExampleGet[]> {
    void courseId; // courseId - parameter kept for compatibility
    void searchQuery; // searchQuery - not used in current implementation
    return this.apiService.getAvailableExamples() || [];
  }
  
  private async selectExample(examples: ExampleGet[]): Promise<ExampleQuickPickItem | undefined> {
    const quickPickItems: ExampleQuickPickItem[] = examples.map((example: ExampleGet) => ({
      label: example.title,
      description: [
        example.identifier && `🔖 ${example.identifier}`,
        example.repository && `📦 latest`
      ].filter(Boolean).join(' • '),
      detail: example.description || '',
      example: example
    }));

    return vscode.window.showQuickPick(quickPickItems, {
      placeHolder: `Select an example to assign (${examples.length} found)`,
      matchOnDescription: true,
      matchOnDetail: true
    });
  }
  
  private async performExampleAssignment(item: CourseContentTreeItem, example: ExampleGet): Promise<void> {
    // First, get the example with versions if not already loaded
    let exampleWithVersions = example;
    if (!example.versions || example.versions.length === 0) {
      const fullExample = await this.apiService.getExample(example.id);
      if (!fullExample || !fullExample.versions || fullExample.versions.length === 0) {
        throw new Error('Example has no versions available');
      }
      exampleWithVersions = fullExample;
    }

    // Select version - for now use the latest version
    // TODO: In future, allow user to select specific version
    const latestVersion = exampleWithVersions.versions!.reduce((latest, current) => 
      current.version_number > latest.version_number ? current : latest
    );

    // Get the updated content from the API response using the new method
    const updatedContent = await this.apiService.assignExampleVersionToCourseContent(
      item.courseContent.id,
      latestVersion.id
    );
    
    console.log('Assignment API returned updated content:', {
      id: updatedContent.id,
      title: updatedContent.title,
      hasExample: hasExampleAssigned(updatedContent),
      versionId: getExampleVersionId(updatedContent),
      deployment: updatedContent.deployment
    });
    
    // Check deployment status if deployment is included
    if (updatedContent.deployment) {
      const deploymentStatus = updatedContent.deployment.deployment_status;
      if (deploymentStatus !== 'pending' && deploymentStatus !== 'assigned') {
        console.warn(`Unexpected deployment_status: ${deploymentStatus}. Expected 'pending' or 'assigned'.`);
      }
    }

    // Trigger assignments sync so files are populated in assignments repo for this content
    try {
      await this.apiService.generateAssignments(item.course.id, {
        course_content_ids: [item.courseContent.id],
        overwrite_strategy: 'skip_if_exists',
        commit_message: `Initialize assignment from example ${example.identifier || example.title}`
      });
    } catch (e) {
      console.warn('Failed to trigger assignments generation after assigning example:', e);
    }

    console.log('Example assignment completed, refreshing tree...');
    
    // Clear cache and refresh the specific item
    this.apiService.clearCourseCache(item.course.id);
    
    // Refresh the parent of the content item to properly update the display
    // This ensures the item's visual state (icon, description) is updated
    const parent = await this.treeDataProvider.getParent(item);
    if (parent) {
      console.log(`Refreshing parent node: ${parent.id}`);
      (this.treeDataProvider as any).refreshNode(parent);
    } else {
      console.log('No parent found, refreshing the item itself');
      (this.treeDataProvider as any).refreshNode(item);
    }
  }

  private async unassignExample(item: CourseContentTreeItem): Promise<void> {
    const confirmation = await vscode.window.showWarningMessage(
      `Remove example assignment from "${item.courseContent.title}"?`,
      'Yes',
      'No'
    );

    if (confirmation === 'Yes') {
      try {
        // Get the updated content from the API response
        const updatedContent = await this.apiService.unassignExampleFromCourseContent(
          item.course.id,
          item.courseContent.id
        );
        
        console.log('Unassign API returned updated content:', {
          id: updatedContent.id,
          title: updatedContent.title,
          hasExample: hasExampleAssigned(updatedContent),
          deploymentStatus: getDeploymentStatus(updatedContent)
        });
        
        // Clear cache and refresh the specific item
        this.apiService.clearCourseCache(item.course.id);
        
        // Refresh the parent of the content item to properly update the display
        const parent = await this.treeDataProvider.getParent(item);
        if (parent) {
          console.log(`Refreshing parent node after unassign: ${parent.id}`);
          (this.treeDataProvider as any).refreshNode(parent);
        } else {
          console.log('No parent found, refreshing the item itself');
          (this.treeDataProvider as any).refreshNode(item);
        }
        
        vscode.window.showInformationMessage('Example unassigned successfully');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to unassign example: ${error}`);
      }
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

    const slug = await vscode.window.showInputBox({
      prompt: 'Enter a unique slug for this content type',
      placeHolder: 'e.g., lecture, assignment, exercise'
    });

    if (!slug) {
      return;
    }

    const title = await vscode.window.showInputBox({
      prompt: 'Enter content type title',
      placeHolder: 'e.g., Lecture, Assignment'
    });

    const color = await vscode.window.showInputBox({
      prompt: 'Enter color (optional)',
      placeHolder: 'e.g., #FF5733, blue, rgb(255,87,51)',
      value: 'green'
    });

    try {
      await this.apiService.createCourseContentType({
        slug,
        title: title || slug,
        color: color || 'green',
        course_id: item.course.id,
        course_content_kind_id: selectedKind.kindData.id
      });
      
      // Clear cache and refresh
      this.treeDataProvider.refreshNode(item);
      vscode.window.showInformationMessage(`Content type "${title || slug}" created successfully`);
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
    try {
      const scopeInfo = this.buildReleaseScopeFromTreeItem(item);
      if (!scopeInfo) {
        return;
      }
      await this.startReleaseWorkflow(scopeInfo.courseId, scopeInfo.scope);
    } catch (error) {
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
    
    await this.courseContentWebviewProvider.show(
      `Content: ${freshContent.title || freshContent.path}`,
      {
        courseContent: freshContent,
        course: item.course,
        contentType: item.contentType,
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
