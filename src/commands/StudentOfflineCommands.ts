import * as vscode from 'vscode';
import * as path from 'path';
import { StudentOfflineTreeProvider } from '../ui/tree/student/StudentOfflineTreeProvider';
import { GitService } from '../services/GitService';
import { OfflineRepositoryManager } from '../services/OfflineRepositoryManager';

/**
 * Commands for the student offline mode
 * Provides git operations without API dependencies
 * Does NOT use secret storage for tokens
 */
export class StudentOfflineCommands {
    private context: vscode.ExtensionContext;
    private treeProvider: StudentOfflineTreeProvider;
    private gitService: GitService;
    private offlineRepoManager: OfflineRepositoryManager;

    constructor(
        context: vscode.ExtensionContext,
        treeProvider: StudentOfflineTreeProvider
    ) {
        this.context = context;
        this.treeProvider = treeProvider;
        this.gitService = GitService.getInstance();
        this.offlineRepoManager = new OfflineRepositoryManager();
    }

    registerCommands(): void {
        // Add new course
        this.context.subscriptions.push(
            vscode.commands.registerCommand('computor.student.offline.addCourse', async () => {
                await this.addCourse();
            })
        );

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
     * Add a new course repository
     */
    private async addCourse(): Promise<void> {
        try {
            await this.offlineRepoManager.addCourse();
            // Refresh tree to show the new repository
            this.treeProvider.refresh();
        } catch (error: any) {
            console.error('[StudentOfflineCommands] Failed to add course:', error);
            vscode.window.showErrorMessage(`Failed to add course: ${error.message}`);
        }
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
                progress.report({ increment: 30, message: 'Staging changes...' });
                await this.gitService.stagePath(repoPath, assignmentPath);

                // Check if something is staged
                const hasStagedFiles = await this.gitService.hasStagedFiles(repoPath);
                if (!hasStagedFiles) {
                    throw new Error('No changes to save in the assignment folder');
                }

                // Commit changes
                progress.report({ increment: 50, message: 'Committing changes...' });
                await this.gitService.commitChanges(repoPath, commitMessage);

                // Push to remote
                progress.report({ increment: 70, message: 'Pushing to remote...' });
                await this.gitService.pushCurrentBranch(repoPath);

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
     * Pull latest changes from remote repository and update fork from upstream
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
                title: `Updating ${repoName}...`,
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Fetching from origin...' });

                // Pull from origin
                const { GitWrapper } = await import('../git/GitWrapper');
                const gitWrapper = new GitWrapper();
                await gitWrapper.pull(repoPath!);

                progress.report({ increment: 50, message: 'Checking for upstream...' });

                // Check if upstream remote exists
                const remotes = await gitWrapper.getRemotes(repoPath!);
                const hasUpstream = remotes.some(r => r.name === 'upstream');

                if (hasUpstream) {
                    progress.report({ increment: 60, message: 'Fetching from upstream (fork origin)...' });

                    // Fetch and merge from upstream using pull (which includes fetch + merge)
                    try {
                        // Try to pull from upstream/main
                        try {
                            await gitWrapper.pull(repoPath!, 'upstream', 'main');
                        } catch {
                            // Fallback to upstream/master
                            try {
                                await gitWrapper.pull(repoPath!, 'upstream', 'master');
                            } catch (mergeError: any) {
                                console.warn('[StudentOfflineCommands] Could not pull from upstream:', mergeError);
                                // Continue even if merge fails - user might need to resolve manually
                            }
                        }
                    } catch (upstreamError: any) {
                        console.warn('[StudentOfflineCommands] Failed to update from upstream:', upstreamError);
                    }

                    progress.report({ increment: 100, message: 'Done!' });
                } else {
                    progress.report({ increment: 100, message: 'Done! (no upstream configured)' });
                }
            });

            vscode.window.showInformationMessage(`✓ Successfully updated ${repoName}`);

            // Refresh tree to update git status
            this.treeProvider.refresh();
        } catch (error: any) {
            console.error('[StudentOfflineCommands] Failed to pull changes:', error);
            vscode.window.showErrorMessage(`Failed to update: ${error.message}`);
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

            // Open README in preview mode beside active editor
            const readmeUri = vscode.Uri.file(readmePath);
            if (vscode.window.activeTextEditor) {
                // Open beside the active editor
                await vscode.commands.executeCommand('markdown.showPreviewToSide', readmeUri);
            } else {
                // No active editor, open in current column
                await vscode.commands.executeCommand('markdown.showPreview', readmeUri);
            }
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
