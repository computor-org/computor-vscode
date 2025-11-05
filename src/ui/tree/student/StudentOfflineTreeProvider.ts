import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { GitWrapper } from '../../../git/GitWrapper';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

type TreeItem = CourseRepositoryItem | AssignmentDirectoryItem | FileSystemItem;

/**
 * Tree provider for offline student mode
 * Shows course repositories and assignments from the filesystem without API calls
 */
export class StudentOfflineTreeProvider implements vscode.TreeDataProvider<TreeItem> {
    private onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private studentBasePath: string | undefined;

    constructor(context: vscode.ExtensionContext) {
        void context; // Unused parameter
        this.initializeBasePath();
    }

    private initializeBasePath(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0 && workspaceFolders[0]) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            this.studentBasePath = path.join(workspaceRoot, 'student');
        }
    }

    refresh(): void {
        this.initializeBasePath();
        this.onDidChangeTreeDataEmitter.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        if (!this.studentBasePath) {
            return [];
        }

        // Root level: show course repositories
        if (!element) {
            return this.getCourseRepositories();
        }

        // Course level: show assignment directories
        if (element instanceof CourseRepositoryItem) {
            return this.getAssignmentDirectories(element);
        }

        // Assignment level: show file system contents
        if (element instanceof AssignmentDirectoryItem) {
            return this.getFileSystemItems(element.assignmentPath);
        }

        // File system level: show subdirectories and files
        if (element instanceof FileSystemItem && element.type === vscode.FileType.Directory) {
            return this.getFileSystemItems(element.uri.fsPath);
        }

        return [];
    }

    /**
     * Get all course repositories from student/ directory
     * A course is any directory containing a .git folder
     */
    private async getCourseRepositories(): Promise<CourseRepositoryItem[]> {
        if (!this.studentBasePath) {
            return [];
        }

        try {
            // Check if student directory exists
            await access(this.studentBasePath, fs.constants.R_OK);

            const entries = await readdir(this.studentBasePath);
            const courses: CourseRepositoryItem[] = [];

            for (const entry of entries) {
                const entryPath = path.join(this.studentBasePath, entry);
                const entryStat = await stat(entryPath);

                if (entryStat.isDirectory()) {
                    // Check if this directory contains a .git folder
                    const gitPath = path.join(entryPath, '.git');
                    try {
                        await access(gitPath, fs.constants.R_OK);
                        // This is a git repository (course)
                        const gitStatus = await this.getGitStatus(entryPath);
                        courses.push(new CourseRepositoryItem(entry, entryPath, gitStatus));
                    } catch {
                        // Not a git repository, skip
                        continue;
                    }
                }
            }

            // Sort courses alphabetically
            courses.sort((a, b) => {
                const labelA = a.label?.toString() || '';
                const labelB = b.label?.toString() || '';
                return labelA.localeCompare(labelB);
            });

            return courses;
        } catch (error) {
            console.error('[StudentOfflineTreeProvider] Error reading course repositories:', error);
            return [];
        }
    }

    /**
     * Get all assignment directories within a course repository
     * Assignments are all subdirectories in the repository root
     */
    private async getAssignmentDirectories(course: CourseRepositoryItem): Promise<AssignmentDirectoryItem[]> {
        try {
            const entries = await readdir(course.repoPath);
            const assignments: AssignmentDirectoryItem[] = [];

            for (const entry of entries) {
                // Skip hidden files and .git directory
                if (entry.startsWith('.')) {
                    continue;
                }

                const entryPath = path.join(course.repoPath, entry);
                const entryStat = await stat(entryPath);

                if (entryStat.isDirectory()) {
                    assignments.push(new AssignmentDirectoryItem(entry, entryPath, course.repoPath));
                }
            }

            // Sort assignments alphabetically
            assignments.sort((a, b) => {
                const labelA = a.label?.toString() || '';
                const labelB = b.label?.toString() || '';
                return labelA.localeCompare(labelB);
            });

            return assignments;
        } catch (error) {
            console.error('[StudentOfflineTreeProvider] Error reading assignment directories:', error);
            return [];
        }
    }

    /**
     * Get file system items (files and folders) from a directory
     * Reuses the pattern from StudentCourseContentTreeProvider
     */
    private async getFileSystemItems(dirPath: string): Promise<FileSystemItem[]> {
        try {
            const entries = await readdir(dirPath);
            const items: FileSystemItem[] = [];

            for (const entry of entries) {
                // Skip hidden files
                if (entry.startsWith('.')) {
                    continue;
                }

                const entryPath = path.join(dirPath, entry);
                const entryStat = await stat(entryPath);

                const fileType = entryStat.isDirectory()
                    ? vscode.FileType.Directory
                    : vscode.FileType.File;

                items.push(new FileSystemItem(entry, vscode.Uri.file(entryPath), fileType));
            }

            // Sort: directories first, then files, both alphabetically
            items.sort((a, b) => {
                if (a.type === b.type) {
                    return a.name.localeCompare(b.name);
                }
                return a.type === vscode.FileType.Directory ? -1 : 1;
            });

            return items;
        } catch (error) {
            console.error('[StudentOfflineTreeProvider] Error reading file system items:', error);
            return [];
        }
    }

    /**
     * Get git status for a repository
     * Returns status indicators: clean, modified, ahead, behind
     */
    private async getGitStatus(repoPath: string): Promise<GitStatus> {
        try {
            const gitWrapper = new GitWrapper();
            const status = await gitWrapper.status(repoPath);

            return {
                hasChanges: !status.isClean,
                ahead: status.ahead || 0,
                behind: status.behind || 0
            };
        } catch (error) {
            console.error('[StudentOfflineTreeProvider] Error getting git status:', error);
            return {
                hasChanges: false,
                ahead: 0,
                behind: 0
            };
        }
    }
}

/**
 * Git status information
 */
interface GitStatus {
    hasChanges: boolean;
    ahead: number;
    behind: number;
}

/**
 * Represents a course repository in the tree
 * This is a git repository in the student/ directory
 */
class CourseRepositoryItem extends vscode.TreeItem {
    constructor(
        public readonly courseName: string,
        public readonly repoPath: string,
        public readonly gitStatus: GitStatus
    ) {
        super(courseName, vscode.TreeItemCollapsibleState.Collapsed);

        this.id = repoPath;
        this.tooltip = repoPath;
        this.contextValue = 'offlineCourse';
        this.iconPath = new vscode.ThemeIcon('repo');

        // Add status indicators to description
        const statusParts: string[] = [];
        if (gitStatus.hasChanges) {
            statusParts.push('●');
        }
        if (gitStatus.ahead > 0) {
            statusParts.push(`↑${gitStatus.ahead}`);
        }
        if (gitStatus.behind > 0) {
            statusParts.push(`↓${gitStatus.behind}`);
        }

        if (statusParts.length > 0) {
            this.description = statusParts.join(' ');
        }
    }
}

/**
 * Represents an assignment directory within a course repository
 * This is a subdirectory in the repository root
 */
class AssignmentDirectoryItem extends vscode.TreeItem {
    public readonly assignmentName: string;
    public readonly assignmentPath: string;
    public readonly repoPath: string;

    constructor(
        assignmentName: string,
        assignmentPath: string,
        repoPath: string
    ) {
        super(assignmentName, vscode.TreeItemCollapsibleState.Collapsed);

        this.assignmentName = assignmentName;
        this.assignmentPath = assignmentPath;
        this.repoPath = repoPath;
        this.id = assignmentPath;
        this.tooltip = assignmentPath;
        this.contextValue = 'offlineAssignment';
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

/**
 * Represents a file or folder in the file system
 * Reused from StudentCourseContentTreeProvider
 */
class FileSystemItem extends vscode.TreeItem {
    constructor(
        public readonly name: string,
        public readonly uri: vscode.Uri,
        public readonly type: vscode.FileType
    ) {
        super(
            name,
            type === vscode.FileType.Directory
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );

        this.id = uri.fsPath;
        this.resourceUri = uri;

        if (type === vscode.FileType.File) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [uri]
            };
            this.contextValue = 'offlineFile';

            // Set appropriate icon based on file extension
            const ext = path.extname(name).toLowerCase();
            if (['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
                this.iconPath = new vscode.ThemeIcon('file-code');
            } else if (['.json', '.xml', '.yaml', '.yml'].includes(ext)) {
                this.iconPath = new vscode.ThemeIcon('file-code');
            } else if (['.md', '.txt'].includes(ext)) {
                this.iconPath = new vscode.ThemeIcon('file-text');
            } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext)) {
                this.iconPath = new vscode.ThemeIcon('file-media');
            } else {
                this.iconPath = new vscode.ThemeIcon('file');
            }
        } else {
            this.contextValue = 'offlineFolder';
            this.iconPath = new vscode.ThemeIcon('folder');
        }

        this.tooltip = uri.fsPath;
    }
}
