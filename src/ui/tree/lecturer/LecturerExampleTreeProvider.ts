import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { DragDropManager } from '../../../services/DragDropManager';
import { 
  ExampleRepositoryList,
  ExampleList
} from '../../../types/generated';
import { LecturerRepositoryManager } from '../../../services/LecturerRepositoryManager';

// Export tree items for use in commands
export { ExampleRepositoryTreeItem, ExampleTreeItem, FileSystemTreeItem };

// Tree items for example view
class ExampleRepositoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly repository: ExampleRepositoryList,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
  ) {
    super(repository.name, collapsibleState);
    this.id = `example-repo-${repository.id}`;
    this.contextValue = 'exampleRepository';
    this.iconPath = new vscode.ThemeIcon('repo');
    this.tooltip = repository.description || repository.name;
    this.description = repository.source_type;
  }
}

class ExampleTreeItem extends vscode.TreeItem {
  constructor(
    public readonly example: ExampleList,
    public readonly repository: ExampleRepositoryList,
    public readonly isDownloaded: boolean = false,
    public readonly downloadPath?: string,
    public readonly version?: string
  ) {
    super(
      example.title, 
      isDownloaded ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    this.id = `example-${example.id}`;
    this.contextValue = isDownloaded ? 'exampleDownloaded' : 'example';
    this.iconPath = new vscode.ThemeIcon(isDownloaded ? 'folder-library' : 'file-code');
    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
    
    // Make it draggable for drag & drop to course content
    this.command = undefined; // No default action on click
  }

  private getTooltip(): string {
    const parts = [
      `Title: ${this.example.title}`,
      `Identifier: ${this.example.identifier}`
    ];
    
    if (this.example.subject) {
      parts.push(`Subject: ${this.example.subject}`);
    }
    
    if (this.example.category) {
      parts.push(`Category: ${this.example.category}`);
    }
    
    if (this.example.tags && this.example.tags.length > 0) {
      parts.push(`Tags: ${this.example.tags.join(', ')}`);
    }
    
    return parts.join('\n');
  }

  private getDescription(): string {
    const parts = [];
    
    if (this.isDownloaded) {
      // Use the version passed to constructor if available
      if (this.version) {
        parts.push(`📁 [${this.version}] checked out`);
      } else if (this.downloadPath) {
        // Fallback: try to read version from .meta.yaml
        try {
          const metaPath = path.join(this.downloadPath, '.meta.yaml');
          if (fs.existsSync(metaPath)) {
            const metaContent = fs.readFileSync(metaPath, 'utf8');
            const metaData = yaml.load(metaContent) as any;
            if (metaData && metaData.version) {
              parts.push(`📁 [${metaData.version}] checked out`);
            } else {
              parts.push('📁 checked out (error: no version found)');
            }
          } else {
            parts.push('📁 checked out (error: Failed to read .meta.yaml)');
          }
        } catch (error) {
          console.warn('Failed to read .meta.yaml:', error);
          parts.push('📁 checked out (error: Failed to read .meta.yaml)');
        }
      } else {
        parts.push('📁 checked out (error: downloadPath is undefined or null)');
      }
    }
    
    if (this.example.category) {
      parts.push(this.example.category);
    }
    
    if (this.example.tags && this.example.tags.length > 0) {
      const tagStr = this.example.tags.slice(0, 2).join(', ');
      parts.push(`[${tagStr}${this.example.tags.length > 2 ? '...' : ''}]`);
    }
    
    return parts.join(' ');
  }
}

// Tree item for file system entries
class FileSystemTreeItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly isDirectory: boolean,
    public readonly relativePath: string
  ) {
    super(
      path.basename(filePath),
      isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    this.id = `file-${filePath}`;
    this.contextValue = isDirectory ? 'folder' : 'file';
    this.iconPath = new vscode.ThemeIcon(isDirectory ? 'folder' : 'file');
    this.tooltip = relativePath;
    this.resourceUri = vscode.Uri.file(filePath);
    
    // Allow opening files on click
    if (!isDirectory) {
      this.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [this.resourceUri]
      };
    }
  }
}

export class LecturerExampleTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<ExampleTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  // Drag and drop support
  public readonly dropMimeTypes: string[] = [];
  public readonly dragMimeTypes = ['application/vnd.code.tree.computorexample'];

  private apiService: ComputorApiService;
  private searchQuery: string = '';
  private selectedCategory: string | undefined;
  private selectedTags: string[] = [];
  
  // Caches
  private repositoriesCache: ExampleRepositoryList[] | null = null;
  private examplesCache: Map<string, ExampleList[]> = new Map();
  
  // Track downloaded examples with version information
  private downloadedExamples: Map<string, { path: string; version?: string }> = new Map(); // exampleId -> {path, version}
  private context: vscode.ExtensionContext;
  private assignmentsRootCache: { courseId: string; path: string } | null = null;

  constructor(
    context: vscode.ExtensionContext,
    providedApiService?: ComputorApiService
  ) {
    this.context = context;
    this.apiService = providedApiService || new ComputorApiService(context);
  }

  refresh(): void {
    // Clear caches
    this.repositoriesCache = null;
    this.examplesCache.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  refreshNode(element?: vscode.TreeItem): void {
    this._onDidChangeTreeData.fire(element);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    try {
      if (!element) {
        // Root level - show search filter if active, then example repositories
        const items: vscode.TreeItem[] = [];
        
        // Add search filter indicator if search is active
        if (this.searchQuery) {
          const searchItem = new vscode.TreeItem(
            `🔍 Search: "${this.searchQuery}"`,
            vscode.TreeItemCollapsibleState.None
          );
          searchItem.contextValue = 'searchFilter';
          searchItem.tooltip = `Current search filter: ${this.searchQuery}\nClick to clear`;
          searchItem.command = {
            command: 'computor.lecturer.clearSearch',
            title: 'Clear Search',
            arguments: []
          };
          items.push(searchItem);
        }
        
        // Add category filter indicator if active
        if (this.selectedCategory) {
          const categoryItem = new vscode.TreeItem(
            `📁 Category: ${this.selectedCategory}`,
            vscode.TreeItemCollapsibleState.None
          );
          categoryItem.contextValue = 'categoryFilter';
          categoryItem.tooltip = `Current category filter: ${this.selectedCategory}\nClick to clear`;
          categoryItem.command = {
            command: 'computor.lecturer.clearCategoryFilter',
            title: 'Clear Category Filter',
            arguments: []
          };
          items.push(categoryItem);
        }
        
        // Add tags filter indicator if active
        if (this.selectedTags.length > 0) {
          const tagsItem = new vscode.TreeItem(
            `🏷️ Tags: ${this.selectedTags.join(', ')}`,
            vscode.TreeItemCollapsibleState.None
          );
          tagsItem.contextValue = 'tagsFilter';
          tagsItem.tooltip = `Current tags filter: ${this.selectedTags.join(', ')}\nClick to clear`;
          tagsItem.command = {
            command: 'computor.lecturer.clearTagsFilter',
            title: 'Clear Tags Filter',
            arguments: []
          };
          items.push(tagsItem);
        }
        
        // Add repositories
        const repositories = await this.getExampleRepositories();
        items.push(...repositories);
        
        return items;
      }

      if (element instanceof ExampleRepositoryTreeItem) {
        // Show examples in this repository
        return this.getExamplesForRepository(element.repository);
      }

      if (element instanceof ExampleTreeItem) {
        // Show file structure for downloaded examples
        if (element.isDownloaded && element.downloadPath) {
          return this.getFileSystemItems(element.downloadPath);
        }
      }

      if (element instanceof FileSystemTreeItem) {
        // Show subdirectory contents
        if (element.isDirectory) {
          return this.getFileSystemItems(element.filePath);
        }
      }

      return [];
    } catch (error) {
      console.error('Failed to load example tree data:', error);
      vscode.window.showErrorMessage(`Failed to load examples: ${error}`);
      return [];
    }
  }

  private async getExampleRepositories(): Promise<ExampleRepositoryTreeItem[]> {
    if (!this.repositoriesCache) {
      try {
        // Fetch example repositories from API
        this.repositoriesCache = await this.apiService.getExampleRepositories();
        console.log(`Loaded ${this.repositoriesCache.length} example repositories`);
      } catch (error) {
        console.error('Failed to load example repositories:', error);
        vscode.window.showErrorMessage(`Failed to load example repositories: ${error}`);
        this.repositoriesCache = [];
      }
    }

    return this.repositoriesCache.map(repo => 
      new ExampleRepositoryTreeItem(repo)
    );
  }

  private async getExamplesForRepository(repository: ExampleRepositoryList): Promise<ExampleTreeItem[]> {
    const cacheKey = repository.id;
    
    if (!this.examplesCache.has(cacheKey)) {
      try {
        // Fetch examples for this repository from API
        const examples = await this.apiService.getExamples(repository.id);
        console.log(`Loaded ${examples.length} examples for repository ${repository.name}`);
        this.examplesCache.set(cacheKey, examples);
      } catch (error) {
        console.error(`Failed to load examples for repository ${repository.name}:`, error);
        vscode.window.showErrorMessage(`Failed to load examples: ${error}`);
        this.examplesCache.set(cacheKey, []);
      }
    }

    const examples = this.examplesCache.get(cacheKey) || [];
    const assignmentsRoot = await this.getAssignmentsRoot();
    
    // Apply filters if any
    let filteredExamples = examples;
    
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filteredExamples = filteredExamples.filter(ex =>
        ex.title.toLowerCase().includes(query) ||
        ex.identifier.toLowerCase().includes(query) ||
        ex.directory.toLowerCase().includes(query) ||
        (ex.tags && ex.tags.some(tag => tag.toLowerCase().includes(query)))
      );
    }
    
    if (this.selectedCategory) {
      filteredExamples = filteredExamples.filter(ex =>
        ex.category === this.selectedCategory
      );
    }
    
    if (this.selectedTags.length > 0) {
      filteredExamples = filteredExamples.filter(ex =>
        ex.tags && this.selectedTags.every(tag => ex.tags?.includes(tag))
      );
    }

    return filteredExamples.map(example => {
      const downloadInfo = this.downloadedExamples.get(example.id);

      // Check if the example is downloaded by checking if directory exists
      let isDownloaded = false;
      let actualPath: string | undefined;
      let version: string | undefined;
      
      if (assignmentsRoot) {
        const expectedPath = path.join(assignmentsRoot, example.directory);
        if (fs.existsSync(expectedPath)) {
          isDownloaded = true;
          actualPath = expectedPath;
          if (!downloadInfo) {
            this.downloadedExamples.set(example.id, { path: expectedPath });
          } else {
            version = downloadInfo.version;
          }
        }
      }

      if (!isDownloaded && downloadInfo) {
        if (fs.existsSync(downloadInfo.path)) {
          isDownloaded = true;
          actualPath = downloadInfo.path;
          version = downloadInfo.version;
        } else {
          this.downloadedExamples.delete(example.id);
        }
      }
      
      return new ExampleTreeItem(example, repository, isDownloaded, actualPath, version);
    });
  }

  private async getAssignmentsRoot(): Promise<string | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return undefined;
    }

    const markerPath = path.join(workspaceFolder.uri.fsPath, '.computor');
    let courseId: string | undefined;

    try {
      const raw = await fs.promises.readFile(markerPath, 'utf8');
      const marker = JSON.parse(raw);
      if (marker && typeof marker.courseId === 'string') {
        courseId = marker.courseId;
      }
    } catch {
      return undefined;
    }

    if (!courseId) {
      return undefined;
    }

    if (this.assignmentsRootCache && this.assignmentsRootCache.courseId === courseId) {
      if (fs.existsSync(this.assignmentsRootCache.path)) {
        return this.assignmentsRootCache.path;
      }
      this.assignmentsRootCache = null;
    }

    const course = await this.apiService.getCourse(courseId);
    if (!course) {
      return undefined;
    }

    const repoManager = new LecturerRepositoryManager(this.context, this.apiService);
    const assignmentsRoot = repoManager.getAssignmentsRepoRoot(course);
    if (!assignmentsRoot || !fs.existsSync(assignmentsRoot)) {
      return undefined;
    }

    this.assignmentsRootCache = { courseId, path: assignmentsRoot };
    return assignmentsRoot;
  }

  private getFileSystemItems(dirPath: string): vscode.TreeItem[] {
    try {
      if (!fs.existsSync(dirPath)) {
        return [];
      }

      const items = fs.readdirSync(dirPath);
      const treeItems: vscode.TreeItem[] = [];

      for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);
        const relativePath = vscode.workspace.asRelativePath(fullPath);
        
        treeItems.push(new FileSystemTreeItem(fullPath, stat.isDirectory(), relativePath));
      }

      // Sort: directories first, then files
      treeItems.sort((a, b) => {
        if (a instanceof FileSystemTreeItem && b instanceof FileSystemTreeItem) {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.label!.toString().localeCompare(b.label!.toString());
        }
        return 0;
      });

      return treeItems;
    } catch (error) {
      console.error(`Failed to read directory ${dirPath}:`, error);
      return [];
    }
  }

  // Search and filter methods
  getSearchQuery(): string {
    return this.searchQuery;
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
    this._onDidChangeTreeData.fire(undefined);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this._onDidChangeTreeData.fire(undefined);
  }

  getSelectedCategory(): string | undefined {
    return this.selectedCategory;
  }

  setCategory(category: string | undefined): void {
    this.selectedCategory = category;
    this._onDidChangeTreeData.fire(undefined);
  }

  clearCategoryFilter(): void {
    this.selectedCategory = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  getSelectedTags(): string[] {
    return this.selectedTags;
  }

  setTags(tags: string[]): void {
    this.selectedTags = tags;
    this._onDidChangeTreeData.fire(undefined);
  }

  clearTagsFilter(): void {
    this.selectedTags = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  // Public method to get filtered examples for a repository
  async getFilteredExamplesForRepository(repository: ExampleRepositoryList): Promise<ExampleTreeItem[]> {
    return this.getExamplesForRepository(repository);
  }

  // Mark an example as downloaded and refresh the tree
  markExampleAsDownloaded(exampleId: string, downloadPath: string, version?: string): void {
    this.downloadedExamples.set(exampleId, { path: downloadPath, version });
    // Refresh just the affected repository to show the example as downloaded
    this._onDidChangeTreeData.fire(undefined);
  }

  // Drag and drop implementation
  public handleDrag(source: readonly ExampleTreeItem[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void | Thenable<void> {
    // Prepare example data for drag
    const draggedExamples = source.map(item => ({
      exampleId: item.example.id,
      title: item.example.title,
      description: null, // ExampleList doesn't have description field
      identifier: item.example.identifier,
      repositoryId: item.example.example_repository_id
    }));
    
    // Store in shared manager as a workaround for VS Code DataTransfer limitations
    const dragDropManager = DragDropManager.getInstance();
    dragDropManager.setDraggedData(draggedExamples);
    
    // Still set data on transfer for compatibility (even though it may come through empty)
    const jsonData = JSON.stringify(draggedExamples);
    const item = new vscode.DataTransferItem(jsonData);
    treeDataTransfer.set('application/vnd.code.tree.computorexample', item);
    
    console.log('Drag initiated - data stored in DragDropManager');
  }

  public async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    // Examples tree doesn't accept drops
    void target;
    void dataTransfer;
  }
}
