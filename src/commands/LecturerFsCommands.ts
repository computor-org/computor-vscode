import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { LecturerRepositoryManager } from '../services/LecturerRepositoryManager';
import { ComputorApiService } from '../services/ComputorApiService';

export class LecturerFsCommands {
  private repositoryManager: LecturerRepositoryManager;

  constructor(
    private context: vscode.ExtensionContext,
    apiService: ComputorApiService
  ) {
    this.repositoryManager = new LecturerRepositoryManager(context, apiService);
  }

  register(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.fs.rename', async (item: any) => {
        await this.renameEntry(item);
      }),
      vscode.commands.registerCommand('computor.lecturer.fs.delete', async (item: any) => {
        await this.deleteEntry(item);
      })
    );
  }

  private async renameEntry(item: any): Promise<void> {
    const course = item?.course || item?.courseContent?.course;
    const courseContent = item?.courseContent;
    const absPath: string | undefined = item?.absPath;

    if (!course || !courseContent || !absPath) {
      vscode.window.showErrorMessage('Unable to rename. Course context or path missing.');
      return;
    }

    if (!(await this.ensureWithinAssignments(course, absPath, item?.repositoryRoot))) {
      vscode.window.showErrorMessage('This file is outside the assignments repository.');
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: 'Enter new name',
      value: path.basename(absPath),
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Name cannot be empty';
        }
        if (value.includes('/') || value.includes('\\')) {
          return 'Name cannot contain path separators';
        }
        return null;
      }
    });

    if (!newName) {
      return;
    }

    if (newName === path.basename(absPath)) {
      return;
    }

    const target = path.join(path.dirname(absPath), newName);

    const pathAllowed = await this.ensureWithinAssignments(course, target, item?.repositoryRoot);
    if (!pathAllowed) {
      vscode.window.showErrorMessage('Target path would move the file outside the assignments repository.');
      return;
    }

    try {
      await fs.access(target);
      vscode.window.showErrorMessage('A file or folder with that name already exists.');
      return;
    } catch {}

    try {
      await fs.rename(absPath, target);
      vscode.window.showInformationMessage(`Renamed to ${newName}`);
      await vscode.commands.executeCommand('computor.lecturer.refreshCourses');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to rename: ${error?.message || error}`);
    }
  }

  private async deleteEntry(item: any): Promise<void> {
    const course = item?.course || item?.courseContent?.course;
    const courseContent = item?.courseContent;
    const absPath: string | undefined = item?.absPath;
    const label: string = item?.label?.toString() || absPath;

    if (!course || !courseContent || !absPath) {
      vscode.window.showErrorMessage('Unable to delete. Course context or path missing.');
      return;
    }

    if (!(await this.ensureWithinAssignments(course, absPath, item?.repositoryRoot))) {
      vscode.window.showErrorMessage('This entry is outside the assignments repository.');
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Delete '${label}'? This cannot be undone.`,
      { modal: true },
      'Delete',
      'Cancel'
    );

    if (confirmation !== 'Delete') {
      return;
    }

    try {
      await fs.rm(absPath, { recursive: true, force: true });
      vscode.window.showInformationMessage(`Deleted ${label}`);
      await vscode.commands.executeCommand('computor.lecturer.refreshCourses');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to delete: ${error?.message || error}`);
    }
  }

  private async ensureWithinAssignments(course: any, entryPath: string, explicitRoot?: string): Promise<boolean> {
    const repoRoot = explicitRoot || this.repositoryManager.getAssignmentsRepoRoot(course);
    if (!repoRoot) {
      vscode.window.showErrorMessage('Assignments repository not found. Run "Sync Assignments" first.');
      return false;
    }

    const normalizedRoot = path.resolve(repoRoot);
    const normalizedEntry = path.resolve(entryPath);
    return normalizedEntry === normalizedRoot || normalizedEntry.startsWith(normalizedRoot + path.sep);
  }
}
