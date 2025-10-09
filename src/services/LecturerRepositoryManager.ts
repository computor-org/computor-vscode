import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execAsync } from '../utils/exec';
import { GitLabTokenManager } from './GitLabTokenManager';
import { ComputorApiService } from './ComputorApiService';
import { createRepositoryBackup, isHistoryRewriteError } from '../utils/repositoryBackup';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';

export class LecturerRepositoryManager {
  private workspaceStructure: WorkspaceStructureManager;
  private gitLabTokenManager: GitLabTokenManager;
  private api: ComputorApiService;

  constructor(context: vscode.ExtensionContext, api: ComputorApiService) {
    this.api = api;
    this.gitLabTokenManager = GitLabTokenManager.getInstance(context);
    this.workspaceStructure = WorkspaceStructureManager.getInstance();
  }

  async syncAllAssignments(onProgress?: (message: string) => void): Promise<void> {
    const report = onProgress || (() => {});
    await this.workspaceStructure.ensureDirectories();
    try {
      const client = await (this.api as any).getHttpClient?.();
      const resp: any = client ? await client.get('/lecturers/courses') : { data: [] };
      const courses: any[] = (resp && resp.data) || [];
      if (courses.length === 0) { report('No lecturer courses to sync'); return; }

      for (const c of courses) {
        const courseId = c.id || c.course_id || c.courseId;
        if (!courseId) continue;
        try {
          await this.syncAssignmentsForCourse(courseId, report);
        } catch (e) {
          console.warn(`[LecturerRepo] Failed to sync assignments for course ${courseId}:`, e);
        }
      }
    } catch (e) {
      console.warn('[LecturerRepo] Could not fetch lecturer courses:', e);
    }
  }

  async syncAssignmentsForCourse(courseId: string, onProgress?: (message: string) => void): Promise<void> {
    const report = onProgress || (() => {});
    const course: any = await this.api.getCourse(courseId);
    if (!course) { report(`Course ${courseId} not found`); return; }
    // Ensure we have organization to derive provider URL when assignments_url is absent
    if (!course.organization) {
      try {
        if (course.organization_id) {
          const org = await (this.api as any).getOrganization(course.organization_id);
          if (org) course.organization = org;
        }
      } catch {}
    }
    const info = this.getAssignmentsRepoInfo(course);
    if (!info) { report(`No GitLab info for ${course.title || course.path}`); return; }

    const { repoUrl } = info;
    await this.workspaceStructure.ensureDirectories();
    // Use course UUID as the directory name in reference folder
    const target = this.workspaceStructure.getReferenceRepositoryPath(courseId);

    const exists = await this.directoryExists(target);

    const token = await this.gitLabTokenManager.ensureTokenForUrl(new URL(repoUrl).origin);
    const authUrl = this.addTokenToUrl(repoUrl, token);

    if (!exists) {
      report(`Cloning course ${courseId} assignments...`);
      await execAsync(`git clone "${authUrl}" "${target}"`, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    } else {
      report(`Pulling course ${courseId} assignments...`);
      try {
        await execAsync('git pull --ff-only', { cwd: target, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      } catch (error: any) {
        if (!isHistoryRewriteError(error)) {
          console.warn(`[LecturerRepo] Failed to pull course ${courseId}:`, error);
          throw error;
        }

        report(`Remote history changed for course ${courseId}. Backing up...`);
        let backupPath: string | undefined;
        try {
          const workspaceRoot = this.workspaceStructure.getDirectories().root;
          backupPath = await createRepositoryBackup(target, workspaceRoot, { repoName: courseId });
          if (backupPath) {
            console.log(`[LecturerRepo] Backup created at ${backupPath}`);
          }
        } catch (backupError) {
          console.error(`[LecturerRepo] Failed to create backup for course ${courseId}:`, backupError);
        }

        try {
          await fs.promises.rm(target, { recursive: true, force: true });
        } catch (removeError) {
          console.error(`[LecturerRepo] Failed to remove course ${courseId} before re-clone:`, removeError);
          vscode.window.showErrorMessage(`Computor could not reset the assignments repository. Please remove it manually and retry.`);
          throw removeError;
        }

        report(`Recreating course ${courseId} from origin...`);
        try {
          await execAsync(`git clone "${authUrl}" "${target}"`, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        } catch (cloneError) {
          console.error(`[LecturerRepo] Re-clone failed for course ${courseId}:`, cloneError);
          vscode.window.showErrorMessage(`Computor could not recreate the assignments repository. Your files${backupPath ? ` were backed up at ${backupPath}` : ''}.`);
          throw cloneError;
        }

        const actions: string[] = [];
        if (backupPath) {
          actions.push('Open Backup Folder');
        }
        actions.push('Dismiss');

        const message = backupPath
          ? `The assignments repository was reset because the remote history changed. A backup without Git metadata is available at ${backupPath}. This event is unusual—if it happens repeatedly, please inform the course coordination team.`
          : `The assignments repository was reset because the remote history changed. This event is unusual—if it happens repeatedly, please inform the course coordination team.`;

        const choice = await vscode.window.showWarningMessage(message, ...actions);
        if (choice === 'Open Backup Folder' && backupPath) {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(backupPath));
        }
      }
    }
  }

  private getAssignmentsRepoInfo(course: any): { repoUrl: string } | null {
    const props = (course.properties || {}) as any;
    const gitlab = props.gitlab || {};
    let repoUrl: string | undefined = gitlab.assignments_url as string | undefined;
    if (!repoUrl) {
      const orgUrl = (((course.organization || {}).properties || {}).gitlab || {}).url as string | undefined;
      const fullPath = gitlab.full_path as string | undefined;
      if (orgUrl && fullPath) repoUrl = `${orgUrl}/${fullPath}/assignments.git`;
    }
    if (!repoUrl) return null;
    return { repoUrl };
  }

  public getAssignmentFolderPath(course: any, deploymentPath: string): string | null {
    const root = this.getAssignmentsRepoRoot(course);
    if (!root) return null;
    return path.join(root, deploymentPath || '');
  }

  public getAssignmentsRepoRoot(course: any): string | null {
    const courseId = course.id || course.course_id || course.courseId;
    if (!courseId) return null;
    const repoPath = this.workspaceStructure.getReferenceRepositoryPath(courseId);
    if (fs.existsSync(repoPath)) {
      return repoPath;
    }
    return repoPath;
  }

  private async directoryExists(dir: string): Promise<boolean> {
    try { return (await fs.promises.stat(dir)).isDirectory(); } catch { return false; }
  }

  private addTokenToUrl(url: string, token?: string): string {
    try {
      const u = new URL(url);
      if (!token) return url;
      u.username = 'oauth2';
      u.password = token;
      return u.toString();
    } catch {
      return url;
    }
  }
}
