import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { LecturerRepositoryManager } from '../services/LecturerRepositoryManager';
import { ComputorApiService } from '../services/ComputorApiService';
import { commandRegistrar } from './commandHelpers';
import { notify } from '../utils/notify';

export class LecturerFsCommands {
  private repositoryManager: LecturerRepositoryManager;

  constructor(
    private context: vscode.ExtensionContext,
    apiService: ComputorApiService
  ) {
    this.repositoryManager = new LecturerRepositoryManager(context, apiService);
  }

  register(): void {

    const register = commandRegistrar(this.context);
    register('computor.lecturer.fs.rename', async (item: any) => {
      await this.renameEntry(item);
    });
    register('computor.lecturer.fs.delete', async (item: any) => {
      await this.deleteEntry(item);
    });
  }

  private async renameEntry(item: any): Promise<void> {
    const course = item?.course || item?.courseContent?.course;
    const courseContent = item?.courseContent;
    const absPath: string | undefined = item?.absPath;

    if (!course || !courseContent || !absPath) {
      notify.error('Unable to rename. Course context or path missing.');
      return;
    }

    if (!(await this.ensureWithinAssignments(course, absPath, item?.repositoryRoot))) {
      notify.error('This file is outside the assignments repository.');
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
      notify.error('Target path would move the file outside the assignments repository.');
      return;
    }

    try {
      await fs.access(target);
      notify.error('A file or folder with that name already exists.');
      return;
    } catch {}

    try {
      await fs.rename(absPath, target);
      notify.info(`Renamed to ${newName}`);
      await vscode.commands.executeCommand('computor.lecturer.refresh');
    } catch (error: any) {
      notify.error(`Failed to rename: ${error?.message || error}`);
    }
  }

  private async deleteEntry(item: any): Promise<void> {
    const course = item?.course || item?.courseContent?.course;
    const courseContent = item?.courseContent;
    const absPath: string | undefined = item?.absPath;
    const label: string = item?.label?.toString() || absPath;

    if (!course || !courseContent || !absPath) {
      notify.error('Unable to delete. Course context or path missing.');
      return;
    }

    if (!(await this.ensureWithinAssignments(course, absPath, item?.repositoryRoot))) {
      notify.error('This entry is outside the assignments repository.');
      return;
    }

    const confirmation = await notify.confirm(
      `Delete '${label}'? This cannot be undone.`,
      'Delete'
    );

    if (!confirmation) {
      return;
    }

    try {
      await fs.rm(absPath, { recursive: true, force: true });
      notify.info(`Deleted ${label}`);
      await vscode.commands.executeCommand('computor.lecturer.refresh');
    } catch (error: any) {
      notify.error(`Failed to delete: ${error?.message || error}`);
    }
  }

  private async ensureWithinAssignments(course: any, entryPath: string, explicitRoot?: string): Promise<boolean> {
    const repoRoot = explicitRoot || this.repositoryManager.getAssignmentsRepoRoot(course);
    if (!repoRoot) {
      notify.error('Assignments repository not found. Run "Sync Assignments" first.');
      return false;
    }

    const normalizedRoot = path.resolve(repoRoot);
    const normalizedEntry = path.resolve(entryPath);
    return normalizedEntry === normalizedRoot || normalizedEntry.startsWith(normalizedRoot + path.sep);
  }
}
