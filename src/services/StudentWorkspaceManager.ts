import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ComputorApiService } from './ComputorApiService';
import { execAsync } from '../utils/exec';
import { GitLabTokenManager } from './GitLabTokenManager';

interface CourseInfo {
  id: string;
  title?: string;
  path: string;
  repository?: {
    clone_url?: string;
    full_path?: string;
    provider_url?: string;
  };
}

/**
 * Manages student workspace, repository detection, and cloning
 */
export class StudentWorkspaceManager {
  private apiService: ComputorApiService;
  private context: vscode.ExtensionContext;
  private currentCourseId?: string;
  private gitLabTokenManager: GitLabTokenManager;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService) {
    this.context = context;
    this.apiService = apiService;
    this.gitLabTokenManager = GitLabTokenManager.getInstance(context);
  }

  /**
   * Get the current course ID
   */
  getCurrentCourseId(): string | undefined {
    return this.currentCourseId;
  }

  /**
   * Set the current course ID
   */
  setCurrentCourseId(courseId: string | undefined): void {
    this.currentCourseId = courseId;
    if (courseId) {
      this.context.globalState.update('studentCurrentCourseId', courseId);
    }
  }

  /**
   * Load saved course ID from global state
   */
  async loadSavedCourseId(): Promise<string | undefined> {
    const savedId = await this.context.globalState.get<string>('studentCurrentCourseId');
    if (savedId) {
      this.currentCourseId = savedId;
    }
    return savedId;
  }

  /**
   * Check if current workspace is a git repository for a course
   */
  async detectCourseRepository(): Promise<string | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return undefined;
    }

    const workspacePath = workspaceFolder.uri.fsPath;
    const gitPath = path.join(workspacePath, '.git');
    
    // Check if it's a git repository
    if (!fs.existsSync(gitPath)) {
      return undefined;
    }

    try {
      // Get remote URL
      const { stdout } = await execAsync('git remote get-url origin', {
        cwd: workspacePath
      });
      const remoteUrl = stdout.trim();
      
      if (!remoteUrl) {
        return undefined;
      }

      // Get all student courses
      const courses = await this.apiService.getStudentCourses();
      
      // Try to match the remote URL with a course
      for (const course of courses) {
        if ((course as any).repository?.clone_url === remoteUrl) {
          console.log(`Detected course repository: ${course.title || course.path}`);
          return course.id;
        }
        
        // Also check if the remote URL contains course-related patterns
        if ((course as any).repository?.full_path) {
          const fullPath = (course as any).repository.full_path;
          if (remoteUrl.includes(fullPath)) {
            console.log(`Detected course repository by path: ${course.title || course.path}`);
            return course.id;
          }
        }
      }

      // Check for .computor metadata file
      const metadataPath = path.join(workspacePath, '.computor', 'course.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          if (metadata.courseId) {
            // Verify the course ID is valid
            const courseExists = courses.some(c => c.id === metadata.courseId);
            if (courseExists) {
              console.log(`Detected course from metadata: ${metadata.courseId}`);
              return metadata.courseId;
            }
          }
        } catch (error) {
          console.error('Failed to read course metadata:', error);
        }
      }
    } catch (error) {
      console.error('Failed to detect course repository:', error);
    }

    return undefined;
  }

  /**
   * Show course selection quick pick
   */
  async selectCourse(courses: CourseInfo[]): Promise<CourseInfo | undefined> {
    if (courses.length === 0) {
      vscode.window.showWarningMessage('No courses available');
      return undefined;
    }

    if (courses.length === 1) {
      return courses[0];
    }

    const items = courses.map(course => ({
      label: course.title || course.path,
      description: course.path,
      detail: (course as any).repository ? `Repository available` : 'No repository',
      course
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a course to work with',
      title: 'Course Selection'
    });

    return selected?.course;
  }

  /**
   * Clone course repository
   */
  async cloneCourseRepository(course: CourseInfo): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    
    // Determine where to clone
    let targetPath: string;
    
    if (workspaceFolder) {
      // Check if workspace is empty
      const files = fs.readdirSync(workspaceFolder.uri.fsPath);
      const hasFiles = files.some(f => !f.startsWith('.'));
      
      if (hasFiles) {
        const choice = await vscode.window.showWarningMessage(
          'Current workspace is not empty. How would you like to proceed?',
          'Clone to Subfolder',
          'Open in New Window',
          'Cancel'
        );
        
        if (choice === 'Cancel' || !choice) {
          return false;
        }
        
        if (choice === 'Open in New Window') {
          // Create a temp directory for cloning
          const tempDir = path.join(require('os').tmpdir(), 'computor', course.id);
          await fs.promises.mkdir(tempDir, { recursive: true });
          targetPath = tempDir;
          
          // After cloning, open in new window
          await this.doClone(course, targetPath);
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath), true);
          return true;
        } else {
          // Clone to subfolder
          const folderName = course.title?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || course.id;
          targetPath = path.join(workspaceFolder.uri.fsPath, folderName);
        }
      } else {
        // Empty workspace, clone here
        targetPath = workspaceFolder.uri.fsPath;
      }
    } else {
      // No workspace open
      const uri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Clone Location',
        title: 'Choose where to clone the repository'
      });
      
      if (!uri || uri.length === 0 || !uri[0]) {
        return false;
      }
      
      targetPath = uri[0].fsPath;
    }

    // Clone the repository
    const success = await this.doClone(course, targetPath);
    
    if (success) {
      // Save course metadata
      await this.saveCourseMetadata(targetPath, course);
      
      // If we cloned to current workspace, reload window
      if (targetPath === workspaceFolder?.uri.fsPath) {
        const reload = await vscode.window.showInformationMessage(
          'Repository cloned. Reload window to activate course workspace?',
          'Reload',
          'Later'
        );
        
        if (reload === 'Reload') {
          await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      }
    }
    
    return success;
  }

  /**
   * Perform the actual git clone
   */
  private async doClone(course: CourseInfo, targetPath: string): Promise<boolean> {
    const cloneUrl = await this.getCloneUrl(course);
    
    if (!cloneUrl) {
      vscode.window.showErrorMessage('No repository URL available for this course');
      return false;
    }

    // Get GitLab token for authentication
    const gitlabUrl = new URL(cloneUrl).origin;
    const token = await this.gitLabTokenManager.ensureTokenForUrl(gitlabUrl);
    
    if (!token) {
      vscode.window.showErrorMessage('GitLab authentication token required. Please provide a personal access token.');
      return false;
    }

    // Add token to URL for authentication
    const authenticatedUrl = this.addTokenToUrl(cloneUrl, token);

    return await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Cloning ${course.title || course.path}...`,
      cancellable: false
    }, async () => {
      try {
        // If target is not empty, clone to temp then move
        const files = fs.existsSync(targetPath) ? fs.readdirSync(targetPath) : [];
        const isEmpty = files.length === 0 || files.every(f => f.startsWith('.'));
        
        if (isEmpty && fs.existsSync(targetPath)) {
          // Clone directly
          await execAsync(`git clone "${authenticatedUrl}" .`, {
            cwd: targetPath,
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0'
            }
          });
        } else {
          // Clone normally
          await execAsync(`git clone "${authenticatedUrl}" "${targetPath}"`, {
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0'
            }
          });
        }

        vscode.window.showInformationMessage(`Successfully cloned ${course.title || course.path}`);
        return true;
      } catch (error: any) {
        console.error('Failed to clone repository:', error);
        
        // Check if authentication failed
        if (this.isAuthenticationError(error)) {
          // Clear token and prompt for new one
          await this.gitLabTokenManager.removeToken(gitlabUrl);
          vscode.window.showErrorMessage('Authentication failed. Please try again with a valid GitLab token.');
        } else {
          vscode.window.showErrorMessage(`Failed to clone: ${error.message}`);
        }
        return false;
      }
    });
  }

  /**
   * Get clone URL for a course
   */
  private async getCloneUrl(course: CourseInfo): Promise<string | undefined> {
    // First check if course has direct clone URL
    if ((course as any).repository?.clone_url) {
      return (course as any).repository.clone_url;
    }

    // Try to get course content with repositories
    try {
      const contents = await this.apiService.getStudentCourseContents(course.id);
      
      // Look for any content with a repository
      for (const content of contents) {
        if (content.submission_group?.repository?.clone_url) {
          // Extract base repository URL
          const cloneUrl = content.submission_group.repository.clone_url;
          return cloneUrl;
        }
      }
    } catch (error) {
      console.error('Failed to get course contents:', error);
    }

    return undefined;
  }

  /**
   * Save course metadata to workspace
   */
  private async saveCourseMetadata(workspacePath: string, course: CourseInfo): Promise<void> {
    const metadataDir = path.join(workspacePath, '.computor');
    const metadataPath = path.join(metadataDir, 'course.json');

    try {
      await fs.promises.mkdir(metadataDir, { recursive: true });
      
      const metadata = {
        courseId: course.id,
        courseTitle: course.title || course.path,
        timestamp: new Date().toISOString()
      };

      await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      console.log(`Saved course metadata for: ${course.title || course.path}`);
    } catch (error) {
      console.error('Failed to save course metadata:', error);
    }
  }

  /**
   * Add authentication token to Git URL
   */
  private addTokenToUrl(url: string, token: string): string {
    // Handle both http and https URLs
    if (url.startsWith('https://')) {
      return url.replace('https://', `https://oauth2:${token}@`);
    } else if (url.startsWith('http://')) {
      return url.replace('http://', `http://oauth2:${token}@`);
    }
    return url;
  }

  /**
   * Check if error is an authentication error
   */
  private isAuthenticationError(error: any): boolean {
    const message = error?.message || error?.toString() || '';
    return message.includes('Authentication failed') ||
           message.includes('Access denied') ||
           message.includes('HTTP Basic') ||
           message.includes('401') ||
           message.includes('could not read Username');
  }
}