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
import type { CheckedOutExampleGroup, CheckedOutVersion } from '../../../utils/checkedOutExampleManager';

export {
  ExampleRepositoryTreeItem,
  ExampleTreeItem,
  CheckedOutGroupTreeItem,
  CheckedOutVersionTreeItem,
  FileSystemTreeItem,
  RootSectionTreeItem
};

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

class CheckedOutGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly group: CheckedOutExampleGroup
  ) {
    super(group.directory, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `checked-out-group-${group.directory}`;
    this.contextValue = 'checkedOutGroup';
    this.iconPath = new vscode.ThemeIcon('folder-library');
    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
  }

  private getTooltip(): string {
    const parts = [`Directory: ${this.group.directory}`];
    const w = this.group.workingVersion;
    if (w) {
      parts.push(`Working version: ${w.localVersion || w.metadata.versionTag}`);
      parts.push(`Example ID: ${w.metadata.exampleId}`);
    }
    parts.push(`${this.group.versions.length} version(s) locally`);
    return parts.join('\n');
  }

  private getDescription(): string {
    const versionCount = this.group.versions.length;
    const w = this.group.workingVersion;
    if (w) {
      const version = w.localVersion || w.metadata.versionTag;
      return versionCount > 1 ? `${version} (${versionCount} versions)` : version;
    }
    return `${versionCount} version(s)`;
  }
}

class CheckedOutVersionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly version: CheckedOutVersion,
    public readonly groupDirectory: string
  ) {
    super(
      version.isWorking ? 'working' : version.versionTag,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `checked-out-version-${groupDirectory}-${version.isWorking ? 'working' : version.versionTag}`;
    this.contextValue = version.isWorking ? 'checkedOutWorking' : 'checkedOutVersion';
    this.iconPath = new vscode.ThemeIcon(version.isWorking ? 'edit' : 'tag');
    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
  }

  private getTooltip(): string {
    const m = this.version.metadata;
    const parts: string[] = [];
    if (this.version.isWorking) {
      parts.push('Working copy — editable');
    } else {
      parts.push(`Version snapshot: ${this.version.versionTag}`);
    }
    parts.push(`Checked out from: ${m.versionTag} (#${m.versionNumber})`);
    if (this.version.localVersion) {
      parts.push(`Local meta.yaml version: ${this.version.localVersion}`);
    }
    parts.push(`Checked out: ${new Date(m.checkedOutAt).toLocaleString()}`);
    return parts.join('\n');
  }

  private getDescription(): string {
    if (this.version.isWorking && this.version.localVersion) {
      return this.version.localVersion;
    }
    return '';
  }
}

const PROTECTED_NAMES = new Set(['meta.yaml', 'test.yaml', 'content']);

class FileSystemTreeItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly isDirectory: boolean,
    public readonly relativePath: string,
    public readonly isWorking: boolean = false
  ) {
    super(
      path.basename(filePath),
      isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    this.id = `file-${filePath}`;
    const name = path.basename(filePath);
    const isProtected = PROTECTED_NAMES.has(name);
    if (isWorking) {
      if (isDirectory) {
        this.contextValue = isProtected ? 'workingFolderProtected' : 'workingFolder';
      } else if (name === 'test.yaml') {
        this.contextValue = 'workingFileTestYaml';
      } else if (name === 'meta.yaml') {
        this.contextValue = 'workingFileMetaYaml';
      } else {
        this.contextValue = isProtected ? 'workingFileProtected' : 'workingFile';
      }
    } else {
      this.contextValue = isDirectory ? 'versionFolder' : 'versionFile';
    }
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

export class LecturerExampleTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private static readonly FS_MIME_TYPE = 'application/vnd.code.tree.computorfilesystem';

  public readonly dropMimeTypes: string[] = [LecturerExampleTreeProvider.FS_MIME_TYPE];
  public readonly dragMimeTypes = ['application/vnd.code.tree.computorexample', LecturerExampleTreeProvider.FS_MIME_TYPE];

  private apiService: ComputorApiService;
  private searchQuery: string = '';
  private selectedCategory: string | undefined;
  private selectedTags: string[] = [];

  private repositoriesCache: ExampleRepositoryList[] | null = null;
  private examplesCache: Map<string, ExampleList[]> = new Map();
  private checkedOutCache: CheckedOutExampleGroup[] | null = null;
  private fileWatchers: vscode.Disposable[] = [];

  constructor(
    context: vscode.ExtensionContext,
    providedApiService?: ComputorApiService
  ) {
    this.apiService = providedApiService || new ComputorApiService(context);
    this.setupFileWatchers(context);
  }

  private setupFileWatchers(context: vscode.ExtensionContext): void {
    const examplesPath = this.getExamplesPath();
    if (!examplesPath) { return; }

    const patterns = [
      new vscode.RelativePattern(examplesPath, '**/working/meta.yaml'),
      new vscode.RelativePattern(examplesPath, '**/working/test.yaml'),
      new vscode.RelativePattern(examplesPath, '**/working/content/**'),
    ];

    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const debouncedRefresh = this.createDebouncedRefresh();
      watcher.onDidChange(debouncedRefresh);
      watcher.onDidCreate(debouncedRefresh);
      watcher.onDidDelete(debouncedRefresh);
      this.fileWatchers.push(watcher);
    }

    context.subscriptions.push(...this.fileWatchers);
  }

  private createDebouncedRefresh(): () => void {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return () => {
      if (timeout) { clearTimeout(timeout); }
      timeout = setTimeout(() => {
        this.checkedOutCache = null;
        this._onDidChangeTreeData.fire(undefined);
      }, 300);
    };
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
          return this.getCheckedOutGroups();
        }
      }

      if (element instanceof ExampleRepositoryTreeItem) {
        return this.getExamplesForRepository(element.repository);
      }

      if (element instanceof CheckedOutGroupTreeItem) {
        return element.group.versions.map(v =>
          new CheckedOutVersionTreeItem(v, element.group.directory)
        );
      }

      if (element instanceof CheckedOutVersionTreeItem) {
        return this.getFileSystemItems(element.version.fullPath, element.version.isWorking);
      }

      if (element instanceof FileSystemTreeItem) {
        if (element.isDirectory) {
          return this.getFileSystemItems(element.filePath, element.isWorking);
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

    if (this.searchQuery) {
      const searchItem = new vscode.TreeItem(`Search: "${this.searchQuery}"`, vscode.TreeItemCollapsibleState.None);
      searchItem.iconPath = new vscode.ThemeIcon('search');
      searchItem.contextValue = 'searchFilter';
      searchItem.tooltip = `Current search filter: ${this.searchQuery}\nClick to clear`;
      searchItem.command = { command: 'computor.lecturer.clearSearch', title: 'Clear Search', arguments: [] };
      items.push(searchItem);
    }

    if (this.selectedCategory) {
      const categoryItem = new vscode.TreeItem(`Category: ${this.selectedCategory}`, vscode.TreeItemCollapsibleState.None);
      categoryItem.iconPath = new vscode.ThemeIcon('filter');
      categoryItem.contextValue = 'categoryFilter';
      categoryItem.tooltip = `Current category filter: ${this.selectedCategory}\nClick to clear`;
      categoryItem.command = { command: 'computor.lecturer.clearCategoryFilter', title: 'Clear Category Filter', arguments: [] };
      items.push(categoryItem);
    }

    if (this.selectedTags.length > 0) {
      const tagsItem = new vscode.TreeItem(`Tags: ${this.selectedTags.join(', ')}`, vscode.TreeItemCollapsibleState.None);
      tagsItem.iconPath = new vscode.ThemeIcon('tag');
      tagsItem.contextValue = 'tagsFilter';
      tagsItem.tooltip = `Current tags filter: ${this.selectedTags.join(', ')}\nClick to clear`;
      tagsItem.command = { command: 'computor.lecturer.clearTagsFilter', title: 'Clear Tags Filter', arguments: [] };
      items.push(tagsItem);
    }

    items.push(new RootSectionTreeItem('checkedOut', 'Local Examples', 'folder-library'));
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

  private getCheckedOutGroups(): vscode.TreeItem[] {
    if (!this.checkedOutCache) {
      this.checkedOutCache = scanCheckedOutExamples();
    }

    if (this.checkedOutCache.length === 0) {
      const empty = new vscode.TreeItem('No local examples', vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon('info');
      empty.tooltip = 'Check out an example from Repositories or create a new one';
      return [empty];
    }

    return this.checkedOutCache.map(group => new CheckedOutGroupTreeItem(group));
  }

  private getCheckedOutExampleIds(): Set<string> {
    if (!this.checkedOutCache) {
      this.checkedOutCache = scanCheckedOutExamples();
    }
    const ids = new Set<string>();
    for (const group of this.checkedOutCache) {
      for (const version of group.versions) {
        ids.add(version.metadata.exampleId);
      }
    }
    return ids;
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

  private getFileSystemItems(dirPath: string, isWorking: boolean = false): vscode.TreeItem[] {
    try {
      if (!fs.existsSync(dirPath)) { return []; }

      const items = fs.readdirSync(dirPath);
      const treeItems: vscode.TreeItem[] = [];

      for (const item of items) {
        if (item === '.computor-example.json') { continue; }
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);
        const relativePath = vscode.workspace.asRelativePath(fullPath);
        treeItems.push(new FileSystemTreeItem(fullPath, stat.isDirectory(), relativePath, isWorking));
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

  public handleDrag(source: readonly vscode.TreeItem[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void | Thenable<void> {
    const exampleItems = source.filter((s): s is ExampleTreeItem => s instanceof ExampleTreeItem);
    if (exampleItems.length > 0) {
      const draggedExamples = exampleItems.map(item => ({
        exampleId: item.example.id,
        title: item.example.title,
        description: null,
        identifier: item.example.identifier,
        repositoryId: item.example.example_repository_id
      }));

      const dragDropManager = DragDropManager.getInstance();
      dragDropManager.setDraggedData(draggedExamples);

      const jsonData = JSON.stringify(draggedExamples);
      treeDataTransfer.set('application/vnd.code.tree.computorexample', new vscode.DataTransferItem(jsonData));
    }

    const fsItems = source.filter((s): s is FileSystemTreeItem => s instanceof FileSystemTreeItem && s.isWorking);
    if (fsItems.length > 0) {
      const paths = fsItems.map(item => item.filePath);
      treeDataTransfer.set(LecturerExampleTreeProvider.FS_MIME_TYPE, new vscode.DataTransferItem(JSON.stringify(paths)));
    }
  }

  public async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const fsData = dataTransfer.get(LecturerExampleTreeProvider.FS_MIME_TYPE);
    if (!fsData) { return; }

    let targetDir: string | undefined;
    if (target instanceof FileSystemTreeItem && target.isWorking) {
      targetDir = target.isDirectory ? target.filePath : path.dirname(target.filePath);
    } else if (target instanceof CheckedOutVersionTreeItem && target.version.isWorking) {
      targetDir = target.version.fullPath;
    }

    if (!targetDir) { return; }

    let sourcePaths: string[];
    try {
      sourcePaths = JSON.parse(fsData.value as string) as string[];
    } catch {
      return;
    }

    const moved: string[] = [];
    for (const sourcePath of sourcePaths) {
      const name = path.basename(sourcePath);
      const dest = path.join(targetDir, name);

      if (sourcePath === dest) { continue; }
      if (dest.startsWith(sourcePath + path.sep)) {
        vscode.window.showWarningMessage(`Cannot move "${name}" into itself.`);
        continue;
      }
      if (PROTECTED_NAMES.has(name)) {
        vscode.window.showWarningMessage(`Cannot move protected item "${name}".`);
        continue;
      }

      if (fs.existsSync(dest)) {
        const overwrite = await vscode.window.showWarningMessage(
          `"${name}" already exists in the target folder. Overwrite?`,
          { modal: true },
          'Overwrite'
        );
        if (overwrite !== 'Overwrite') { continue; }
      }

      try {
        fs.renameSync(sourcePath, dest);
        moved.push(name);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to move "${name}": ${error}`);
      }
    }

    if (moved.length > 0) {
      this.refresh();
    }
  }
}
