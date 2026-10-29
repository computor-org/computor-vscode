import * as vscode from 'vscode';
import * as path from 'path';
import { StudentOfflineTreeProvider } from '../ui/tree/student/StudentOfflineTreeProvider';
import { GitService } from '../services/GitService';
import { OfflineRepositoryManager } from '../services/OfflineRepositoryManager';
import { commandRegistrar } from './commandHelpers';
import { showMarkdownPreview } from '../ui/webviews/markdownPreview';
import { notify } from '../utils/notify';
import { say } from '../utils/uiLanguage';
import { pickDescriptionFile } from '../utils/descriptionLanguage';

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

      const register = commandRegistrar(this.context);
        // Add new course
        register('computor.student.offline.addCourse', async () => {
            await this.addCourse();
        });

        // Refresh offline view
        register('computor.student.offline.refresh', () => {
            this.treeProvider.refresh();
        });

        // Save (add + commit + push) assignment
        register('computor.student.offline.saveAssignment', async (item: any) => {
            await this.saveAssignment(item);
        });

        // Open assignment in terminal
        register('computor.student.offline.openInTerminal', async (item: any) => {
            await this.openInTerminal(item);
        });

        // Open repository in terminal (course level)
        register('computor.student.offline.openRepoInTerminal', async (item: any) => {
            await this.openRepoInTerminal(item);
        });

        // Pull latest changes from remote
        register('computor.student.offline.pullChanges', async (item: any) => {
            await this.pullChanges(item);
        });

        // Show preview for README
        register('computor.student.offline.showPreview', async (item: any) => {
            await this.showReadmePreview(item);
        });
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
            notify.error(say(`Failed to add course: ${error.message}`, `Der Kurs konnte nicht hinzugefügt werden: ${error.message}`));
        }
    }

    /**
     * Save assignment: add all changes, commit, and push
     * This is the main "Save" button for offline mode
     */
    private async saveAssignment(item: any): Promise<void> {
        console.log('[StudentOfflineCommands] Save assignment:', item);

        if (!item || !item.assignmentPath || !item.repoPath) {
            notify.error(say('No assignment selected', 'Keine Aufgabe ausgewählt.'));
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
                notify.info(say('No changes to save in this assignment.', 'In dieser Aufgabe gibt es keine Änderungen zu speichern.'));
                return;
            }

            // Generate automatic commit message with timestamp
            const now = new Date();
            const timestamp = now.toISOString().replace('T', ' ').split('.')[0];
            const commitMessage = `Update ${assignmentName} - ${timestamp}`;

            // Show progress while saving
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: say(`Saving ${assignmentName}...`, `${assignmentName} wird gespeichert …`),
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: say('Preparing to save...', 'Speichern wird vorbereitet …') });

                // Stage the assignment directory
                progress.report({ increment: 30, message: say('Staging changes...', 'Änderungen werden vorgemerkt …') });
                await this.gitService.stagePath(repoPath, assignmentPath);

                // Check if something is staged
                const hasStagedFiles = await this.gitService.hasStagedFiles(repoPath);
                if (!hasStagedFiles) {
                    throw new Error(say('No changes to save in the assignment folder', 'Im Aufgabenordner gibt es keine Änderungen zu speichern'));
                }

                // Commit changes
                progress.report({ increment: 50, message: say('Committing changes...', 'Änderungen werden gesichert …') });
                await this.gitService.commitChanges(repoPath, commitMessage);

                // Push to remote
                progress.report({ increment: 70, message: say('Pushing to remote...', 'Änderungen werden hochgeladen …') });
                await this.gitService.pushCurrentBranch(repoPath);

                progress.report({ increment: 100, message: say('Successfully saved!', 'Gespeichert.') });
            });

            notify.info(`✓ Successfully saved ${assignmentName}`);

            // Refresh tree to update git status
            this.treeProvider.refresh();
        } catch (error: any) {
            console.error('[StudentOfflineCommands] Failed to save assignment:', error);
            notify.error(say(`Failed to save assignment: ${error.message}`, `Die Aufgabe konnte nicht gespeichert werden: ${error.message}`));
        }
    }

    /**
     * Pull latest changes from remote repository and update fork from upstream
     * Uses robust CTGit.forkUpdate() for proper conflict resolution and merge handling
     */
    private async pullChanges(item: any): Promise<void> {
        console.log('[StudentOfflineCommands] Pull changes:', item);

        let repoPath: string | undefined;

        // Handle both course (repo) and assignment items
        if (item.repoPath) {
            repoPath = item.repoPath;
        } else {
            notify.error(say('No repository selected', 'Kein Repository ausgewählt.'));
            return;
        }

        if (!repoPath) {
            notify.error(say('Repository path not found', 'Der Ordner des Repositorys wurde nicht gefunden.'));
            return;
        }

        const repoName = path.basename(repoPath);

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: say(`Updating ${repoName}...`, `${repoName} wird aktualisiert …`),
                cancellable: false
            }, async (progress) => {
                progress.report({ message: say('Fetching from origin...', 'Änderungen werden abgerufen …') });

                // Pull from origin first
                const { GitWrapper } = await import('../git/GitWrapper');
                const gitWrapper = new GitWrapper();
                await gitWrapper.pull(repoPath!);

                progress.report({ message: say('Checking for upstream...', 'Kursvorlage wird gesucht …') });

                // Check if upstream remote exists
                const remotes = await gitWrapper.getRemotes(repoPath!);
                const upstreamRemote = remotes.find(r => r.name === 'upstream');

                if (upstreamRemote) {
                    progress.report({ message: say('Syncing fork with upstream...', 'Änderungen aus der Kursvorlage werden übernommen …') });

                    // Use CTGit.forkUpdate() for robust fork syncing
                    // This matches the implementation in StudentRepositoryManager.syncForkWithUpstream()
                    const { CTGit } = await import('../git/CTGit');
                    const ctGit = new CTGit(repoPath!);

                    try {
                        // Use the same robust fork update logic as online mode
                        // autoResolveConflicts: true enables automatic conflict resolution
                        const result = await ctGit.forkUpdate(upstreamRemote.url, {
                            autoResolveConflicts: true
                        });

                        if (result.updated) {
                            progress.report({ message: say('Pushing merged changes to origin...', 'Zusammengeführte Änderungen werden hochgeladen …') });
                            try {
                                await gitWrapper.push(repoPath!, 'origin');
                                console.log('[StudentOfflineCommands] Successfully pushed fork update to origin');
                            } catch (pushError) {
                                console.warn('[StudentOfflineCommands] Failed to push fork update to origin:', pushError);
                                notify.warning(
                                    say('Fork updated locally, but failed to push to origin. You may need to push manually.', 'Dein Repository wurde lokal aktualisiert, konnte aber nicht hochgeladen werden. Lade die Änderungen gegebenenfalls selbst hoch (Push).')
                                );
                            }
                        } else {
                            console.log('[StudentOfflineCommands] Fork is already up-to-date with upstream');
                        }
                    } catch (forkUpdateError: any) {
                        console.error('[StudentOfflineCommands] Fork update failed:', forkUpdateError);

                        // Provide helpful error messages based on error type
                        const errorMessage = forkUpdateError.message || String(forkUpdateError);
                        if (errorMessage.includes('merge-unresolved')) {
                            notify.error(
                                say('Fork update failed due to conflicts that could not be resolved automatically. ' +
                                'Please resolve conflicts manually using your Git client.', 'Die Aktualisierung ist an Konflikten gescheitert, die sich nicht automatisch lösen ließen. ' +
                                'Löse die Konflikte bitte selbst mit deinem Git-Programm.')
                            );
                        } else if (errorMessage.includes('merge-abort')) {
                            notify.info(say('Fork update was cancelled.', 'Die Aktualisierung wurde abgebrochen.'));
                        } else if (errorMessage.includes('merge-editor')) {
                            notify.info(
                                say('Please resolve conflicts in the merge editor, then commit and push manually.', 'Löse die Konflikte im Merge-Editor, sichere sie dann mit einem Commit und lade sie hoch (Push).')
                            );
                        } else {
                            throw forkUpdateError;
                        }
                        return;
                    }

                    progress.report({ message: say('Done!', 'Fertig.') });
                } else {
                    progress.report({ message: say('Done! (no upstream configured)', 'Fertig (keine Kursvorlage eingetragen).') });
                }
            });

            notify.info(`✓ Successfully updated ${repoName}`);

            // Refresh tree to update git status
            this.treeProvider.refresh();
        } catch (error: any) {
            console.error('[StudentOfflineCommands] Failed to pull changes:', error);
            notify.error(say(`Failed to update: ${error.message}`, `Die Aktualisierung ist fehlgeschlagen: ${error.message}`));
        }
    }

    /**
     * Open assignment directory in integrated terminal
     */
    private async openInTerminal(item: any): Promise<void> {
        if (!item || !item.assignmentPath) {
            notify.error(say('No assignment selected', 'Keine Aufgabe ausgewählt.'));
            return;
        }

        const terminal = vscode.window.createTerminal({
            name: say(`Assignment: ${item.assignmentName}`, `Aufgabe: ${item.assignmentName}`),
            cwd: item.assignmentPath
        });

        terminal.show();
    }

    /**
     * Open repository directory in integrated terminal
     */
    private async openRepoInTerminal(item: any): Promise<void> {
        if (!item || !item.repoPath) {
            notify.error(say('No repository selected', 'Kein Repository ausgewählt.'));
            return;
        }

        const terminal = vscode.window.createTerminal({
            name: say(`Course: ${item.courseName}`, `Kurs: ${item.courseName}`),
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
            notify.error(say('No directory selected', 'Kein Ordner ausgewählt.'));
            return;
        }

        if (!directoryPath) {
            notify.error(say('Directory path not found', 'Der Ordner wurde nicht gefunden.'));
            return;
        }

        try {
            const readmePath = await this.findReadmeFile(directoryPath);

            if (!readmePath) {
                notify.info(say('No README file found in this directory', 'In diesem Ordner gibt es keine README-Datei.'));
                return;
            }

            // Self-contained preview webview (renders under code-server on
            // Firefox/Safari where the built-in preview stays blank, #267)
            await showMarkdownPreview(this.context, readmePath);
        } catch (error: any) {
            console.error('[StudentOfflineCommands] Failed to show README preview:', error);
            notify.error(say(`Failed to show README preview: ${error.message}`, `Die Anleitung konnte nicht angezeigt werden: ${error.message}`));
        }
    }

    /**
     * Find the README to show, using the same language order as the online
     * view (computor-org/issues#328). There is no profile to read offline, so
     * no language is preferred and English wins over an unlabelled default.
     */
    private async findReadmeFile(directory: string): Promise<string | null> {
        const fs = await import('fs');
        const { promisify } = await import('util');
        const readdir = promisify(fs.readdir);

        try {
            const chosen = pickDescriptionFile(await readdir(directory));
            return chosen ? path.join(directory, chosen) : null;
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
