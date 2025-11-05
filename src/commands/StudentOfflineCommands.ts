import * as vscode from 'vscode';
import * as path from 'path';
import { StudentOfflineTreeProvider } from '../ui/tree/student/StudentOfflineTreeProvider';
import { GitService } from '../services/GitService';
import { GitLabTokenManager } from '../services/GitLabTokenManager';

/**
 * Commands for the student offline mode
 * Provides git operations without API dependencies
 */
export class StudentOfflineCommands {
    private context: vscode.ExtensionContext;
    private treeProvider: StudentOfflineTreeProvider;
    private gitService: GitService;
    private gitLabTokenManager: GitLabTokenManager;

    constructor(
        context: vscode.ExtensionContext,
        treeProvider: StudentOfflineTreeProvider
    ) {
        this.context = context;
        this.treeProvider = treeProvider;
        this.gitService = GitService.getInstance();
        this.gitLabTokenManager = GitLabTokenManager.getInstance(context);
    }

    registerCommands(): void {
        // Refresh offline view
        this.context.subscriptions.push(
            vscode.commands.registerCommand('computor.student.offline.refresh', () => {
                this.treeProvider.refresh();
            })
        );

        // Save (add + commit + push) assignment
        this.context.subscriptions.push(
            vscode.commands.registerCommand('computor.student.offline.saveAssignment', async (item: any) => {
                await this.saveAssignment(item);
            })
        );

        // Open assignment in terminal
        this.context.subscriptions.push(
            vscode.commands.registerCommand('computor.student.offline.openInTerminal', async (item: any) => {
                await this.openInTerminal(item);
            })
        );

        // Open repository in terminal (course level)
        this.context.subscriptions.push(
            vscode.commands.registerCommand('computor.student.offline.openRepoInTerminal', async (item: any) => {
                await this.openRepoInTerminal(item);
            })
        );

        // Pull latest changes from remote
        this.context.subscriptions.push(
            vscode.commands.registerCommand('computor.student.offline.pullChanges', async (item: any) => {
                await this.pullChanges(item);
            })
        );

        // Show preview for README
        this.context.subscriptions.push(
            vscode.commands.registerCommand('computor.student.offline.showPreview', async (item: any) => {
                await this.showReadmePreview(item);
            })
        );
    }

    /**
     * Save assignment: add all changes, commit, and push
     * This is the main "Save" button for offline mode
     */
    private async saveAssignment(item: any): Promise<void> {
        console.log('[StudentOfflineCommands] Save assignment:', item);

        if (!item || !item.assignmentPath || !item.repoPath) {
            vscode.window.showErrorMessage('No assignment selected');
            return;
        }

        const assignmentPath = item.assignmentPath;
        const assignmentName = item.assignmentName || path.basename(assignmentPath);
        const repoPath = item.repoPath;

        try {
            // Save all open files in the assignment directory
            await this.saveAllFilesInDirectory(assignmentPath);

            // Check if there are any changes to commit
            const hasChanges = await this.gitService.hasChanges(repoPath);
            if (!hasChanges) {
                vscode.window.showInformationMessage('No changes to save in this assignment.');
                return;
            }

            // Generate automatic commit message with timestamp
            const now = new Date();
            const timestamp = now.toISOString().replace('T', ' ').split('.')[0];
            const commitMessage = `Update ${assignmentName} - ${timestamp}`;

            // Show progress while saving
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Saving ${assignmentName}...`,
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Preparing to save...' });

                // Stage the assignment directory
                progress.report({ increment: 30, message: 'Adding changes...' });
                await this.gitService.stagePath(repoPath, assignmentPath);

                // Check if something is staged
                const hasStagedFiles = await this.gitService.hasStagedFiles(repoPath);
                if (!hasStagedFiles) {
                    throw new Error('No changes to save in the assignment folder');
                }

                // Commit changes
                progress.report({ increment: 50, message: 'Committing changes...' });
                await this.gitService.commitChanges(repoPath, commitMessage);

                // Push to remote with authentication
                progress.report({ increment: 70, message: 'Pushing to remote...' });
                await this.pushWithAuth(repoPath);

                progress.report({ increment: 100, message: 'Successfully saved!' });
            });

            vscode.window.showInformationMessage(`✓ Successfully saved ${assignmentName}`);

            // Refresh tree to update git status
            this.treeProvider.refresh();
        } catch (error: any) {
            console.error('[StudentOfflineCommands] Failed to save assignment:', error);
            vscode.window.showErrorMessage(`Failed to save assignment: ${error.message}`);
        }
    }

    /**
     * Pull latest changes from remote repository
     */
    private async pullChanges(item: any): Promise<void> {
        console.log('[StudentOfflineCommands] Pull changes:', item);

        let repoPath: string | undefined;

        // Handle both course (repo) and assignment items
        if (item.repoPath) {
            repoPath = item.repoPath;
        } else {
            vscode.window.showErrorMessage('No repository selected');
            return;
        }

        if (!repoPath) {
            vscode.window.showErrorMessage('Repository path not found');
            return;
        }

        const repoName = path.basename(repoPath);

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Pulling changes for ${repoName}...`,
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Fetching from remote...' });

                // Use git wrapper to pull
                const { GitWrapper } = await import('../git/GitWrapper');
                const gitWrapper = new GitWrapper();
                await gitWrapper.pull(repoPath!);
            });

            vscode.window.showInformationMessage(`✓ Successfully pulled changes for ${repoName}`);

            // Refresh tree to update git status
            this.treeProvider.refresh();
        } catch (error: any) {
            console.error('[StudentOfflineCommands] Failed to pull changes:', error);
            vscode.window.showErrorMessage(`Failed to pull changes: ${error.message}`);
        }
    }

    /**
     * Open assignment directory in integrated terminal
     */
    private async openInTerminal(item: any): Promise<void> {
        if (!item || !item.assignmentPath) {
            vscode.window.showErrorMessage('No assignment selected');
            return;
        }

        const terminal = vscode.window.createTerminal({
            name: `Assignment: ${item.assignmentName}`,
            cwd: item.assignmentPath
        });

        terminal.show();
    }

    /**
     * Open repository directory in integrated terminal
     */
    private async openRepoInTerminal(item: any): Promise<void> {
        if (!item || !item.repoPath) {
            vscode.window.showErrorMessage('No repository selected');
            return;
        }

        const terminal = vscode.window.createTerminal({
            name: `Course: ${item.courseName}`,
            cwd: item.repoPath
        });

        terminal.show();
    }

    /**
     * Push to remote with GitLab token authentication
     */
    private async pushWithAuth(repoPath: string): Promise<void> {
        try {
            // First, try to get the remote URL
            const { GitWrapper } = await import('../git/GitWrapper');
            const gitWrapper = new GitWrapper();
            const remotes = await gitWrapper.getRemotes(repoPath);

            if (remotes.length === 0) {
                throw new Error('No remote repository configured');
            }

            const originRemote = remotes.find(r => r.name === 'origin') || remotes[0];
            const remoteUrl = originRemote?.url;

            if (!remoteUrl) {
                throw new Error('Remote URL not found');
            }

            // Extract GitLab origin from URL
            const gitlabOrigin = this.extractGitLabOrigin(remoteUrl);

            if (!gitlabOrigin) {
                // Not a GitLab URL, try pushing without token
                await this.gitService.pushCurrentBranch(repoPath);
                return;
            }

            // Check if we have a token for this GitLab instance
            const token = await this.gitLabTokenManager.getToken(gitlabOrigin);

            if (!token) {
                // No token found, ask user to configure it
                const action = await vscode.window.showWarningMessage(
                    `No GitLab token found for ${gitlabOrigin}. Push may fail if authentication is required.`,
                    'Configure Token',
                    'Try Anyway'
                );

                if (action === 'Configure Token') {
                    await vscode.commands.executeCommand('computor.manageGitLabTokens');
                    return;
                }
            }

            // Try to push
            await this.gitService.pushCurrentBranch(repoPath);
        } catch (error: any) {
            // If push failed, check if it's an authentication error
            if (this.isAuthenticationError(error)) {
                const action = await vscode.window.showErrorMessage(
                    'Push failed: Authentication required. Please configure your GitLab token.',
                    'Configure Token'
                );

                if (action === 'Configure Token') {
                    await vscode.commands.executeCommand('computor.manageGitLabTokens');
                }
            }

            throw error;
        }
    }

    /**
     * Extract GitLab origin URL from a git remote URL
     * Examples:
     * - https://gitlab.example.com/user/repo.git -> https://gitlab.example.com
     * - http://localhost:8084/user/repo.git -> http://localhost:8084
     */
    private extractGitLabOrigin(remoteUrl: string): string | null | undefined {
        try {
            // Handle HTTPS URLs
            const httpsMatch = remoteUrl.match(/^(https?:\/\/[^\/]+)/);
            if (httpsMatch) {
                return httpsMatch[1];
            }

            // Handle SSH URLs (git@gitlab.example.com:user/repo.git)
            const sshMatch = remoteUrl.match(/^git@([^:]+):/);
            if (sshMatch) {
                return `https://${sshMatch[1]}`;
            }

            return null;
        } catch (error) {
            console.error('[StudentOfflineCommands] Failed to extract GitLab origin:', error);
            return null;
        }
    }

    /**
     * Check if an error is an authentication error
     */
    private isAuthenticationError(error: any): boolean {
        const errorString = String(error).toLowerCase();
        return errorString.includes('authentication') ||
               errorString.includes('credentials') ||
               errorString.includes('unauthorized') ||
               errorString.includes('403') ||
               errorString.includes('401');
    }

    /**
     * Show README preview for an assignment
     * Priority: README.md > README_en.md > README_*.md
     */
    private async showReadmePreview(item: any): Promise<void> {
        console.log('[StudentOfflineCommands] Show README preview:', item);

        let directoryPath: string | undefined;

        // Handle both course and assignment items
        if (item.assignmentPath) {
            directoryPath = item.assignmentPath;
        } else if (item.repoPath) {
            directoryPath = item.repoPath;
        } else {
            vscode.window.showErrorMessage('No directory selected');
            return;
        }

        if (!directoryPath) {
            vscode.window.showErrorMessage('Directory path not found');
            return;
        }

        try {
            const readmePath = await this.findReadmeFile(directoryPath);

            if (!readmePath) {
                vscode.window.showInformationMessage('No README file found in this directory');
                return;
            }

            // Open README in preview mode
            await vscode.workspace.openTextDocument(readmePath);
            await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(readmePath));
        } catch (error: any) {
            console.error('[StudentOfflineCommands] Failed to show README preview:', error);
            vscode.window.showErrorMessage(`Failed to show README preview: ${error.message}`);
        }
    }

    /**
     * Find README file in directory with priority:
     * 1. README.md
     * 2. README_en.md
     * 3. Any README_*.md
     */
    private async findReadmeFile(directory: string): Promise<string | null> {
        const fs = await import('fs');
        const { promisify } = await import('util');
        const readdir = promisify(fs.readdir);

        try {
            const files = await readdir(directory);

            // Priority 1: README.md
            if (files.includes('README.md')) {
                return path.join(directory, 'README.md');
            }

            // Priority 2: README_en.md
            if (files.includes('README_en.md')) {
                return path.join(directory, 'README_en.md');
            }

            // Priority 3: Any README_*.md
            const readmePattern = /^README_.*\.md$/i;
            const readmeFile = files.find(f => readmePattern.test(f));
            if (readmeFile) {
                return path.join(directory, readmeFile);
            }

            return null;
        } catch (error) {
            console.error('[StudentOfflineCommands] Error finding README:', error);
            return null;
        }
    }

    /**
     * Save all open files in a directory
     */
    private async saveAllFilesInDirectory(directory: string): Promise<void> {
        const normalizedDir = path.normalize(directory);
        const textDocuments = vscode.workspace.textDocuments;

        const savePromises = textDocuments
            .filter(doc => {
                if (!doc.isDirty) {
                    return false;
                }
                const docPath = path.normalize(doc.uri.fsPath);
                return docPath.startsWith(normalizedDir);
            })
            .map(doc => doc.save());

        await Promise.all(savePromises);
    }

}
