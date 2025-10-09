import * as vscode from 'vscode';
import { ComputorApiService } from './ComputorApiService';
import { StatusBarService } from '../ui/StatusBarService';

export interface CourseInfo {
    id: string;
    title: string;
    path: string;
    organizationId: string;
    courseFamilyId: string;
}

export class CourseSelectionService {
    private static instance: CourseSelectionService;
    private currentCourseId: string | undefined;
    private currentCourseInfo: CourseInfo | undefined;
    private workspaceRoot: string;
    private context: vscode.ExtensionContext;
    private apiService: ComputorApiService;
    private statusBarService: StatusBarService;

    private constructor(
        context: vscode.ExtensionContext,
        apiService: ComputorApiService,
        statusBarService: StatusBarService
    ) {
        this.context = context;
        this.apiService = apiService;
        this.statusBarService = statusBarService;
        const firstWorkspace = vscode.workspace.workspaceFolders?.[0];
        if (!firstWorkspace) {
            throw new Error('CourseSelectionService requires an open workspace folder.');
        }
        this.workspaceRoot = firstWorkspace.uri.fsPath;
        
        // Don't auto-load last selected course - let the student extension handle it
        // This prevents loading stale/invalid course IDs from previous sessions
        // this.loadLastSelectedCourse();
    }

    static initialize(
        context: vscode.ExtensionContext,
        apiService: ComputorApiService,
        statusBarService: StatusBarService
    ): CourseSelectionService {
        if (!CourseSelectionService.instance) {
            CourseSelectionService.instance = new CourseSelectionService(
                context,
                apiService,
                statusBarService
            );
        }
        return CourseSelectionService.instance;
    }

    static getInstance(): CourseSelectionService {
        if (!CourseSelectionService.instance) {
            throw new Error('CourseSelectionService not initialized');
        }
        return CourseSelectionService.instance;
    }

    // Removed loadLastSelectedCourse - we don't want to load stale course IDs
    // Course selection should come from the .computor_student marker file only

    async selectCourse(courseId?: string): Promise<CourseInfo | undefined> {
        try {
            // If courseId is provided, select that course directly
            if (courseId) {
                const courses = await this.apiService.getStudentCourses();
                const course = courses.find(c => c.id === courseId);
                
                if (course) {
                    const courseInfo: CourseInfo = {
                        id: course.id,
                        title: course.title || course.path,
                        path: course.path,
                        organizationId: course.organization_id || '',
                        courseFamilyId: course.course_family_id || ''
                    };
                    await this.switchToCourse(courseInfo);
                    return courseInfo;
                }
                return undefined;
            }
            
            // Otherwise, show course selection dialog
            // Fetch available courses for student
            const courses = await this.apiService.getStudentCourses();
            
            if (!courses || courses.length === 0) {
                vscode.window.showInformationMessage('No courses available');
                return undefined;
            }

            // Prepare quick pick items
            const quickPickItems = courses.map(course => ({
                label: course.title,
                description: course.path,
                detail: `Organization: ${course.organization_id}`,
                courseInfo: {
                    id: course.id,
                    title: course.title,
                    path: course.path,
                    organizationId: course.organization_id,
                    courseFamilyId: course.course_family_id
                } as CourseInfo
            }));

            // Show quick pick
            const selected = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Select a course to work on',
                title: 'Course Selection',
                ignoreFocusOut: true
            });

            if (selected) {
                await this.switchToCourse(selected.courseInfo);
                return selected.courseInfo;
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fetch courses: ${error}`);
        }

        return undefined;
    }

    async switchToCourse(course: CourseInfo): Promise<void> {
        this.currentCourseId = course.id;
        this.currentCourseInfo = course;

        // Workspace folder already exists; nothing else to do here.

        // Save selection to global state
        await this.context.globalState.update('selectedCourseId', course.id);
        await this.context.globalState.update('selectedCourseInfo', course);

        // Update status bar
        this.statusBarService.updateCourse(course.title);

        // Set context to make course content view visible
        vscode.commands.executeCommand('setContext', 'computor.courseSelected', true);

        // Fire event for other components (if handler exists)
        try {
            await vscode.commands.executeCommand('computor.courseChanged', course);
        } catch {
            // Command might not be registered, that's OK
        }

    }

    getCurrentCourseId(): string | undefined {
        return this.currentCourseId;
    }

    getCurrentCourseInfo(): CourseInfo | undefined {
        return this.currentCourseInfo;
    }

    /**
     * Clear any stored course IDs from global state
     * Used to prevent stale course IDs from being loaded
     */
    async clearStoredCourseIds(): Promise<void> {
        await this.context.globalState.update('selectedCourseId', undefined);
        await this.context.globalState.update('selectedCourseInfo', undefined);
        console.log('Cleared stored course IDs from global state');
    }

    getCourseWorkspacePath(): string | undefined {
        return this.workspaceRoot;
    }

    async ensureCourseSelected(): Promise<CourseInfo | undefined> {
        if (this.currentCourseInfo) {
            return this.currentCourseInfo;
        }

        const result = await vscode.window.showInformationMessage(
            'No course selected. Would you like to select one now?',
            'Select Course',
            'Cancel'
        );

        if (result === 'Select Course') {
            return await this.selectCourse();
        }

        return undefined;
    }

    async clearSelection(): Promise<void> {
        this.currentCourseId = undefined;
        this.currentCourseInfo = undefined;
        
        await this.context.globalState.update('selectedCourseId', undefined);
        await this.context.globalState.update('selectedCourseInfo', undefined);
        
        this.statusBarService.clearCourse();
        vscode.commands.executeCommand('setContext', 'computor.courseSelected', false);
    }
}
