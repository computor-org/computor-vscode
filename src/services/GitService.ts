import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitWrapper } from '../git/GitWrapper';
import { GitStashEntry } from '../types/GitTypes';

export interface AssignmentBranchInfo {
  assignmentPath: string;
  branchName: string;
  exists: boolean;
  isCurrent: boolean;
}

export class GitService {
  private static instance: GitService;
  private gitWrapper: GitWrapper;

  private constructor() {
    this.gitWrapper = new GitWrapper();
  }

  static getInstance(): GitService {
    if (!GitService.instance) {
      GitService.instance = new GitService();
    }
    return GitService.instance;
  }

  /**
   * Generate branch name for an assignment based on its path
   * Example: path "1.2.3" becomes "assignment/1-2-3"
   */
  generateBranchName(assignmentPath: string): string {
    const sanitizedPath = assignmentPath.replace(/\./g, '-');
    return `assignment/${sanitizedPath}`;
  }

  /**
   * Check if a branch exists for the given assignment
   */
  async checkAssignmentBranch(repoPath: string, assignmentPath: string): Promise<AssignmentBranchInfo> {
    const branchName = this.generateBranchName(assignmentPath);
    
    try {
      const branches = await this.gitWrapper.getBranches(repoPath);
      const exists = branches.some(b => b.name === branchName || b.name === `remotes/origin/${branchName}`);
      
      const currentBranch = await this.gitWrapper.getCurrentBranch(repoPath);
      const isCurrent = currentBranch === branchName;
      
      return {
        assignmentPath,
        branchName,
        exists,
        isCurrent
      };
    } catch (error) {
      console.error(`Failed to check branch status: ${error}`);
      throw error;
    }
  }

  /**
   * Create or switch to assignment branch
   */
  async switchToAssignmentBranch(repoPath: string, assignmentPath: string): Promise<void> {
    const branchInfo = await this.checkAssignmentBranch(repoPath, assignmentPath);
    
    if (branchInfo.isCurrent) {
      vscode.window.showInformationMessage(`Already on branch ${branchInfo.branchName}`);
      return;
    }
    
    try {
      // Check for uncommitted changes
      const status = await this.gitWrapper.status(repoPath);
      if (!status.isClean) {
        const action = await vscode.window.showWarningMessage(
          'You have uncommitted changes. What would you like to do?',
          'Stash Changes',
          'Commit Changes',
          'Cancel'
        );
        
        if (action === 'Cancel') {
          return;
        } else if (action === 'Stash Changes') {
          await this.gitWrapper.stash(repoPath, [`-m`, `Auto-stash for branch switch to ${branchInfo.branchName}`]);
          vscode.window.showInformationMessage('Changes stashed');
        } else if (action === 'Commit Changes') {
          await this.commitChanges(repoPath, `WIP: Switching to ${branchInfo.branchName}`);
        }
      }
      
      if (branchInfo.exists) {
        // Switch to existing branch
        await this.gitWrapper.checkoutBranch(repoPath, branchInfo.branchName);
        vscode.window.showInformationMessage(`Switched to branch ${branchInfo.branchName}`);
      } else {
        // Create new branch from main/master
        const mainBranch = await this.getMainBranch(repoPath);
        
        // First checkout main branch
        try {
          await this.gitWrapper.checkoutBranch(repoPath, mainBranch);
        } catch {
          // If main branch doesn't exist locally, try to pull it
          await this.gitWrapper.pull(repoPath, 'origin', mainBranch);
          await this.gitWrapper.checkoutBranch(repoPath, mainBranch);
        }
        
        // Create and checkout new branch
        await this.gitWrapper.createBranch(repoPath, branchInfo.branchName);
        await this.gitWrapper.checkoutBranch(repoPath, branchInfo.branchName);
        vscode.window.showInformationMessage(`Created and switched to branch ${branchInfo.branchName}`);
      }
      
      // Check for stashed changes to restore
      const stashList = await this.gitWrapper.stashList(repoPath);
      const relevantStash = stashList.find((s: GitStashEntry) => s.message?.includes(`Auto-stash for branch switch to ${branchInfo.branchName}`));
      if (relevantStash) {
        try {
          await this.gitWrapper.stashPop(repoPath);
          vscode.window.showInformationMessage('Stashed changes restored');
        } catch (error) {
          console.log('Could not restore stash:', error);
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to switch branch: ${error}`);
      throw error;
    }
  }

  /**
   * Get the main branch name (main or master)
   */
  async getMainBranch(repoPath: string): Promise<string> {
    try {
      const branches = await this.gitWrapper.getBranches(repoPath);
      
      // Check for remote main/master
      if (branches.some(b => b.name === 'remotes/origin/main')) {
        return 'main';
      } else if (branches.some(b => b.name === 'remotes/origin/master')) {
        return 'master';
      }
      
      // Check for local main/master
      if (branches.some(b => b.name === 'main')) {
        return 'main';
      } else if (branches.some(b => b.name === 'master')) {
        return 'master';
      }
      
      return 'main'; // Default to main
    } catch {
      return 'main';
    }
  }

  /**
   * Commit changes with assignment context
   */
  async commitChanges(repoPath: string, message: string): Promise<void> {
    await this.gitWrapper.add(repoPath, '.');
    await this.gitWrapper.commit(repoPath, message);
  }

  /**
   * Push assignment branch to remote
   */
  async pushAssignmentBranch(repoPath: string, assignmentPath: string): Promise<void> {
    const branchName = this.generateBranchName(assignmentPath);
    
    try {
      // Push branch to remote
      // First try regular push, GitWrapper will handle upstream if needed
      await this.gitWrapper.push(repoPath, 'origin', branchName);
      vscode.window.showInformationMessage(`Pushed branch ${branchName} to remote`);
    } catch (error) {
      // If push fails due to no upstream, try with set-upstream
      try {
        const git = await this.gitWrapper.getRepository(repoPath);
        await git.push('origin', branchName, ['--set-upstream']);
        vscode.window.showInformationMessage(`Pushed branch ${branchName} to remote`);
      } catch (fallbackError) {
        vscode.window.showErrorMessage(`Failed to push branch: ${error}`);
        throw error;
      }
    }
  }

  /**
   * Get list of all assignment branches
   */
  async listAssignmentBranches(repoPath: string): Promise<string[]> {
    try {
      const branches = await this.gitWrapper.getBranches(repoPath);
      return branches
        .map(b => b.name)
        .filter(name => name.includes('assignment/'));
    } catch (error) {
      console.error(`Failed to list branches: ${error}`);
      return [];
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      return await this.gitWrapper.getCurrentBranch(repoPath);
    } catch (error) {
      console.error(`Failed to get current branch: ${error}`);
      return null;
    }
  }

  /**
   * Checkout a branch
   */
  async checkoutBranch(repoPath: string, branchName: string): Promise<void> {
    try {
      await this.gitWrapper.checkoutBranch(repoPath, branchName);
    } catch (error) {
      console.error(`Failed to checkout branch ${branchName}: ${error}`);
      throw error;
    }
  }

  /**
   * Check if repository has uncommitted changes
   */
  async hasChanges(repoPath: string): Promise<boolean> {
    try {
      const status = await this.gitWrapper.status(repoPath);
      return !status.isClean;
    } catch (error) {
      console.error(`Failed to check repository status: ${error}`);
      return false;
    }
  }

  /**
   * Stage all changes in the repository
   */
  async stageAll(repoPath: string): Promise<void> {
    try {
      await this.gitWrapper.add(repoPath, ['--all']);
    } catch (error) {
      console.error(`Failed to stage changes: ${error}`);
      throw error;
    }
  }

  /**
   * Stage a specific path (relative to repo root)
   */
  async stagePath(repoPath: string, targetPath: string): Promise<void> {
    try {
      const relPath = path.relative(repoPath, targetPath);
      await this.gitWrapper.add(repoPath, relPath);
    } catch (error) {
      console.error(`Failed to stage path ${targetPath}: ${error}`);
      throw error;
    }
  }

  /**
   * Check if there are staged files
   */
  async hasStagedFiles(repoPath: string): Promise<boolean> {
    try {
      const status = await this.gitWrapper.status(repoPath);
      return status.staged.length > 0;
    } catch (error) {
      console.error(`Failed to check staged files: ${error}`);
      return false;
    }
  }

  /**
   * Push current branch to remote
   */
  async pushCurrentBranch(repoPath: string): Promise<void> {
    try {
      const currentBranch = await this.gitWrapper.getCurrentBranch(repoPath);
      if (!currentBranch) {
        throw new Error('Could not determine current branch');
      }
      await this.gitWrapper.push(repoPath, 'origin', currentBranch);
      // Removed notification - handled by caller
    } catch (error) {
      console.error(`Failed to push current branch: ${error}`);
      throw error;
    }
  }

  /**
   * Get the latest commit hash from the repository
   */
  async getLatestCommitHash(repoPath: string): Promise<string | null> {
    try {
      const log = await this.gitWrapper.getLog(repoPath, { maxCount: 1 });
      if (log && log.length > 0 && log[0]) {
        return log[0].hash;
      }
      return null;
    } catch (error) {
      console.error(`Failed to get latest commit hash: ${error}`);
      return null;
    }
  }

  /**
   * Create merge request for assignment submission
   */
  async createMergeRequest(
    repoPath: string,
    assignmentPath: string
  ): Promise<void> {
    const branchName = this.generateBranchName(assignmentPath);
    
    try {
      const remotes = await this.gitWrapper.getRemotes(repoPath);
      const originRemote = remotes.find(r => r.name === 'origin');
      
      if (!originRemote) {
        throw new Error('No origin remote found');
      }
      
      // Convert git URL to web URL
      let webUrl = originRemote.url;
      if (webUrl.endsWith('.git')) {
        webUrl = webUrl.slice(0, -4);
      }
      if (webUrl.startsWith('git@')) {
        webUrl = webUrl.replace('git@', 'https://').replace(':', '/');
      }
      
      const mrUrl = `${webUrl}/-/merge_requests/new?merge_request[source_branch]=${branchName}`;
      vscode.env.openExternal(vscode.Uri.parse(mrUrl));
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create merge request: ${error}`);
    }
  }

  /**
   * Get assignment directory in repository
   */
  getAssignmentDirectory(repoPath: string, assignmentPath: string): string {
    // Convert path like "1.2.3" to directory like "assignment_1_2_3"
    const dirName = `assignment_${assignmentPath.replace(/\./g, '_')}`;
    return path.join(repoPath, dirName);
  }

  /**
   * Ensure assignment directory exists
   */
  async ensureAssignmentDirectory(repoPath: string, assignmentPath: string): Promise<string> {
    const assignmentDir = this.getAssignmentDirectory(repoPath, assignmentPath);
    
    try {
      // Create directory if it doesn't exist
      await fs.promises.mkdir(assignmentDir, { recursive: true });
      
      // Create a README if it doesn't exist
      const readmePath = path.join(assignmentDir, 'README.md');
      try {
        await fs.promises.access(readmePath);
      } catch {
        const content = `# Assignment ${assignmentPath}\n\nYour assignment work goes here.\n`;
        await fs.promises.writeFile(readmePath, content, 'utf-8');
      }
      
      return assignmentDir;
    } catch (error) {
      console.error(`Failed to create assignment directory: ${error}`);
      throw error;
    }
  }

  /**
   * Fork repository from template
   */
  async forkFromTemplate(
    templateUrl: string,
    targetPath: string,
    assignmentPath: string
  ): Promise<void> {
    try {
      // Clone the template repository
      await this.gitWrapper.clone(templateUrl, targetPath, {
        depth: 1
      });
      
      // Remove the original remote
      const git = await this.gitWrapper.getRepository(targetPath);
      await git.removeRemote('origin');
      
      // Create initial assignment branch
      const branchName = this.generateBranchName(assignmentPath);
      await this.gitWrapper.createBranch(targetPath, branchName);
      await this.gitWrapper.checkoutBranch(targetPath, branchName);
      
      // Create assignment directory
      await this.ensureAssignmentDirectory(targetPath, assignmentPath);
      
      vscode.window.showInformationMessage('Repository forked from template successfully');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to fork from template: ${error}`);
      throw error;
    }
  }
}