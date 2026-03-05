import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { DragDropManager } from '../../../services/DragDropManager';
import {
  ExampleRepositoryList,
  ExampleList
} from '../../../types/generated';
import { WorkspaceStructureManager } from '../../../utils/workspaceStructure';
import { scanCheckedOutExamples } from '../../../utils/checkedOutExampleManager';
import type { CheckedOutExample } from '../../../utils/checkedOutExampleManager';

// Export tree items for use in commands
export { ExampleRepositoryTreeItem, ExampleTreeItem, CheckedOutExampleTreeItem, FileSystemTreeItem, RootSectionTreeItem };

class RootSectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly section: 'repositories' | 'checkedOut',
    label: string,
    icon: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `root-${section}`;
    this.contextValue = `rootSection_${section}`;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

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
    public readonly isCheckedOut: boolean = false
  ) {
    super(example.title, vscode.TreeItemCollapsibleState.None);
    this.id = `example-${example.id}`;
    this.contextValue = isCheckedOut ? 'exampleCheckedOut' : 'example';
    this.iconPath = new vscode.ThemeIcon(isCheckedOut ? 'check' : 'file-code');
    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
    this.command = undefined;
  }

  private getTooltip(): string {
    const parts = [
      `Title: ${this.example.title}`,
      `Identifier: ${this.example.identifier}`
    ];
    if (this.example.subject) { parts.push(`Subject: ${this.example.subject}`); }
    if (this.example.category) { parts.push(`Category: ${this.example.category}`); }
    if (this.example.tags && this.example.tags.length > 0) {
      parts.push(`Tags: ${this.example.tags.join(', ')}`);
    }
    if (this.isCheckedOut) { parts.push('Status: Checked out locally'); }
    return parts.join('\n');
  }

  private getDescription(): string {
    const parts = [];
    if (this.isCheckedOut) { parts.push('checked out'); }
    if (this.example.category) { parts.push(this.example.category); }
    if (this.example.tags && this.example.tags.length > 0) {
      const tagStr = this.example.tags.slice(0, 2).join(', ');
      parts.push(`[${tagStr}${this.example.tags.length > 2 ? '...' : ''}]`);
    }
    return parts.join(' ');
  }
}

class CheckedOutExampleTreeItem extends vscode.TreeItem {
  constructor(
    public readonly checkedOut: CheckedOutExample
  ) {
    super(checkedOut.directory, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `checked-out-${checkedOut.metadata.exampleId}`;
    this.contextValue = 'checkedOutExample';
    this.iconPath = new vscode.ThemeIcon('folder-library');
    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
  }

  private getTooltip(): string {
    const m = this.checkedOut.metadata;
    const parts = [
      `Directory: ${this.checkedOut.directory}`,
      `Example ID: ${m.exampleId}`,
      `Checked out version: ${m.versionTag} (#${m.versionNumber})`,
    ];
    if (this.checkedOut.localVersion) {
      parts.push(`Local meta.yaml version: ${this.checkedOut.localVersion}`);
    }
    parts.push(`Checked out: ${new Date(m.checkedOutAt).toLocaleString()}`);
    return parts.join('\n');
  }

  private getDescription(): string {
    const m = this.checkedOut.metadata;
    if (this.checkedOut.localVersion && this.checkedOut.localVersion !== m.versionTag) {
      return `${m.versionTag} -> ${this.checkedOut.localVersion} (modified)`;
    }
    return `v${m.versionTag}`;
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
  private checkedOutCache: CheckedOutExample[] | null = null;

  constructor(
    context: vscode.ExtensionContext,
    providedApiService?: ComputorApiService
  ) {
    this.apiService = providedApiService || new ComputorApiService(context);
  }

  refresh(): void {
    this.repositoriesCache = null;
    this.examplesCache.clear();
    this.checkedOutCache = null;
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
        return this.getRootItems();
      }

      if (element instanceof RootSectionTreeItem) {
        if (element.section === 'repositories') {
          return this.getRepositorySectionItems();
        }
        if (element.section === 'checkedOut') {
          return this.getCheckedOutItems();
        }
      }

      if (element instanceof ExampleRepositoryTreeItem) {
        return this.getExamplesForRepository(element.repository);
      }

      if (element instanceof CheckedOutExampleTreeItem) {
        return this.getFileSystemItems(element.checkedOut.fullPath);
      }

      if (element instanceof FileSystemTreeItem) {
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

  private getRootItems(): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];

    // Add active filter indicators
    if (this.searchQuery) {
      const searchItem = new vscode.TreeItem(
        `Search: "${this.searchQuery}"`,
        vscode.TreeItemCollapsibleState.None
      );
      searchItem.iconPath = new vscode.ThemeIcon('search');
      searchItem.contextValue = 'searchFilter';
      searchItem.tooltip = `Current search filter: ${this.searchQuery}\nClick to clear`;
      searchItem.command = { command: 'computor.lecturer.clearSearch', title: 'Clear Search', arguments: [] };
      items.push(searchItem);
    }

    if (this.selectedCategory) {
      const categoryItem = new vscode.TreeItem(
        `Category: ${this.selectedCategory}`,
        vscode.TreeItemCollapsibleState.None
      );
      categoryItem.iconPath = new vscode.ThemeIcon('filter');
      categoryItem.contextValue = 'categoryFilter';
      categoryItem.tooltip = `Current category filter: ${this.selectedCategory}\nClick to clear`;
      categoryItem.command = { command: 'computor.lecturer.clearCategoryFilter', title: 'Clear Category Filter', arguments: [] };
      items.push(categoryItem);
    }

    if (this.selectedTags.length > 0) {
      const tagsItem = new vscode.TreeItem(
        `Tags: ${this.selectedTags.join(', ')}`,
        vscode.TreeItemCollapsibleState.None
      );
      tagsItem.iconPath = new vscode.ThemeIcon('tag');
      tagsItem.contextValue = 'tagsFilter';
      tagsItem.tooltip = `Current tags filter: ${this.selectedTags.join(', ')}\nClick to clear`;
      tagsItem.command = { command: 'computor.lecturer.clearTagsFilter', title: 'Clear Tags Filter', arguments: [] };
      items.push(tagsItem);
    }

    items.push(new RootSectionTreeItem('checkedOut', 'Checked Out', 'folder-library'));
    items.push(new RootSectionTreeItem('repositories', 'Repositories', 'cloud'));

    return items;
  }

  private async getRepositorySectionItems(): Promise<ExampleRepositoryTreeItem[]> {
    if (!this.repositoriesCache) {
      try {
        this.repositoriesCache = await this.apiService.getExampleRepositories();
      } catch (error) {
        console.error('Failed to load example repositories:', error);
        this.repositoriesCache = [];
      }
    }
    return this.repositoriesCache.map(repo => new ExampleRepositoryTreeItem(repo));
  }

  private getCheckedOutItems(): vscode.TreeItem[] {
    if (!this.checkedOutCache) {
      this.checkedOutCache = scanCheckedOutExamples();
    }

    if (this.checkedOutCache.length === 0) {
      const empty = new vscode.TreeItem('No examples checked out', vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon('info');
      empty.tooltip = 'Right-click an example in Repositories to check it out';
      return [empty];
    }

    return this.checkedOutCache.map(co => new CheckedOutExampleTreeItem(co));
  }

  private getCheckedOutExampleIds(): Set<string> {
    if (!this.checkedOutCache) {
      this.checkedOutCache = scanCheckedOutExamples();
    }
    return new Set(this.checkedOutCache.map(co => co.metadata.exampleId));
  }

  private async getExamplesForRepository(repository: ExampleRepositoryList): Promise<ExampleTreeItem[]> {
    const cacheKey = repository.id;

    if (!this.examplesCache.has(cacheKey)) {
      try {
        const examples = await this.apiService.getExamples(repository.id);
        this.examplesCache.set(cacheKey, examples);
      } catch (error) {
        console.error(`Failed to load examples for repository ${repository.name}:`, error);
        this.examplesCache.set(cacheKey, []);
      }
    }

    const examples = this.examplesCache.get(cacheKey) || [];
    const checkedOutIds = this.getCheckedOutExampleIds();

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
      filteredExamples = filteredExamples.filter(ex => ex.category === this.selectedCategory);
    }

    if (this.selectedTags.length > 0) {
      filteredExamples = filteredExamples.filter(ex =>
        ex.tags && this.selectedTags.every(tag => ex.tags?.includes(tag))
      );
    }

    return filteredExamples.map(example =>
      new ExampleTreeItem(example, repository, checkedOutIds.has(example.id))
    );
  }

  private getFileSystemItems(dirPath: string): vscode.TreeItem[] {
    try {
      if (!fs.existsSync(dirPath)) { return []; }

      const items = fs.readdirSync(dirPath);
      const treeItems: vscode.TreeItem[] = [];

      for (const item of items) {
        if (item === '.computor-example.json') { continue; }
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);
        const relativePath = vscode.workspace.asRelativePath(fullPath);
        treeItems.push(new FileSystemTreeItem(fullPath, stat.isDirectory(), relativePath));
      }

      treeItems.sort((a, b) => {
        if (a instanceof FileSystemTreeItem && b instanceof FileSystemTreeItem) {
          if (a.isDirectory !== b.isDirectory) { return a.isDirectory ? -1 : 1; }
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
  getSearchQuery(): string { return this.searchQuery; }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
    this._onDidChangeTreeData.fire(undefined);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this._onDidChangeTreeData.fire(undefined);
  }

  getSelectedCategory(): string | undefined { return this.selectedCategory; }

  setCategory(category: string | undefined): void {
    this.selectedCategory = category;
    this._onDidChangeTreeData.fire(undefined);
  }

  clearCategoryFilter(): void {
    this.selectedCategory = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  getSelectedTags(): string[] { return this.selectedTags; }

  setTags(tags: string[]): void {
    this.selectedTags = tags;
    this._onDidChangeTreeData.fire(undefined);
  }

  clearTagsFilter(): void {
    this.selectedTags = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  async getFilteredExamplesForRepository(repository: ExampleRepositoryList): Promise<ExampleTreeItem[]> {
    return this.getExamplesForRepository(repository);
  }

  getExamplesPath(): string | undefined {
    try {
      return WorkspaceStructureManager.getInstance().getExamplesPath();
    } catch {
      return undefined;
    }
  }

  // Drag and drop implementation
  public handleDrag(source: readonly ExampleTreeItem[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void | Thenable<void> {
    const draggedExamples = source.map(item => ({
      exampleId: item.example.id,
      title: item.example.title,
      description: null,
      identifier: item.example.identifier,
      repositoryId: item.example.example_repository_id
    }));

    const dragDropManager = DragDropManager.getInstance();
    dragDropManager.setDraggedData(draggedExamples);

    const jsonData = JSON.stringify(draggedExamples);
    const item = new vscode.DataTransferItem(jsonData);
    treeDataTransfer.set('application/vnd.code.tree.computorexample', item);
  }

  public async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    void target;
    void dataTransfer;
  }
}
