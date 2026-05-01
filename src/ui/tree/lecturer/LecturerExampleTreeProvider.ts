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
import { scanCheckedOutExamples, getVersionPath } from '../../../utils/checkedOutExampleManager';
import type { CheckedOutExampleGroup, CheckedOutVersion } from '../../../utils/checkedOutExampleManager';
import { computeExampleDiff } from '../../../utils/exampleDiffHelper';

export {
  ExampleRepositoryTreeItem,
  ExampleTreeItem,
  RepositoryFilterToggleItem,
  CheckedOutGroupTreeItem,
  CheckedOutVersionTreeItem,
  FileSystemTreeItem,
  RootSectionTreeItem
};

interface WorkingDiffStatus {
  modified: number;
  added: number;
  removed: number;
  total: number;
}

interface MergedExample {
  identifier: string;
  title: string;
  repositoryId: string | null;
  repositoryName: string | null;
  remote?: ExampleList;
  local?: CheckedOutExampleGroup;
  category?: string | null;
  tags?: string[];
  /** Diff between the working copy and the snapshot it was checked out from. */
  workingDiff?: WorkingDiffStatus;
}

class RootSectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly section: 'repositories' | 'examples',
    label: string,
    icon: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded
  ) {
    super(label, collapsibleState);
    this.id = `root-${section}`;
    this.contextValue = `rootSection_${section}`;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

class ExampleRepositoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly repository: ExampleRepositoryList,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(repository.name, collapsibleState);
    this.id = `example-repo-${repository.id}`;
    this.contextValue = 'exampleRepository';
    this.iconPath = new vscode.ThemeIcon('repo');
    this.tooltip = repository.description || repository.name;
    this.description = repository.source_type;
  }
}

class RepositoryFilterToggleItem extends vscode.TreeItem {
  constructor(
    public readonly repository: ExampleRepositoryList,
    public readonly selected: boolean
  ) {
    super(repository.name, vscode.TreeItemCollapsibleState.None);
    this.id = `repo-filter-${repository.id}`;
    this.contextValue = 'repositoryFilterToggle';
    this.iconPath = new vscode.ThemeIcon(selected ? 'pass-filled' : 'circle-large-outline');
    this.tooltip = `${repository.name} — click to ${selected ? 'remove from' : 'add to'} filter`;
    this.description = repository.source_type;
    this.command = {
      command: 'computor.lecturer.toggleRepositoryFilter',
      title: 'Toggle Repository Filter',
      arguments: [this]
    };
  }
}

class ExampleTreeItem extends vscode.TreeItem {
  constructor(
    public readonly merged: MergedExample
  ) {
    const isLocal = !!merged.local;
    const collapsible = isLocal
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    super(merged.identifier, collapsible);
    this.id = `example-${merged.repositoryId ?? 'local-only'}-${merged.identifier}`;
    if (merged.remote && merged.local) {
      this.contextValue = 'exampleCheckedOut';
    } else if (merged.local) {
      this.contextValue = 'exampleLocalOnly';
    } else {
      this.contextValue = 'example';
    }
    if (isLocal && merged.workingDiff) {
      this.iconPath = new vscode.ThemeIcon('git-commit', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon(isLocal ? 'check' : 'file-code');
    }
    this.tooltip = this.buildTooltip();
    this.description = this.buildDescription();
  }

  public get group(): CheckedOutExampleGroup | undefined {
    return this.merged.local;
  }

  // Aliases used by checkout / upload / reveal commands. Callers must guard via
  // contextValue (`example` / `exampleCheckedOut`) — local-only rows have no remote.
  public get example(): ExampleList {
    return this.merged.remote!;
  }

  public get repository(): { id: string; name: string } {
    return { id: this.merged.repositoryId!, name: this.merged.repositoryName! };
  }

  public get isCheckedOut(): boolean {
    return !!this.merged.local;
  }

  private buildTooltip(): string {
    const parts = [
      `Title: ${this.merged.title}`,
      `Identifier: ${this.merged.identifier}`
    ];
    if (this.merged.repositoryName) {
      parts.push(`Repository: ${this.merged.repositoryName}`);
    } else {
      parts.push('Repository: (local only)');
    }
    if (this.merged.remote?.subject) { parts.push(`Subject: ${this.merged.remote.subject}`); }
    if (this.merged.category) { parts.push(`Category: ${this.merged.category}`); }
    if (this.merged.tags && this.merged.tags.length > 0) {
      parts.push(`Tags: ${this.merged.tags.join(', ')}`);
    }
    if (this.merged.local) {
      const versionCount = this.merged.local.versions.length;
      parts.push(`Local versions: ${versionCount}`);
      if (this.merged.local.workingVersion) {
        parts.push('Working copy: editable');
      }
      if (this.merged.workingDiff) {
        const d = this.merged.workingDiff;
        const segments: string[] = [];
        if (d.modified) { segments.push(`${d.modified} modified`); }
        if (d.added) { segments.push(`${d.added} added`); }
        if (d.removed) { segments.push(`${d.removed} removed`); }
        parts.push(`Working changes: ${segments.join(', ')}`);
      }
    } else {
      parts.push('Status: remote only');
    }
    return parts.join('\n');
  }

  private buildDescription(): string {
    // Title and repository name already appear in the label / tooltip — keep
    // the description tight, only surfacing the bits that change row-to-row
    // (local-checkout state and unsaved working changes).
    const parts: string[] = [];
    if (this.merged.local) {
      parts.push('[local]');
    }
    if (this.merged.workingDiff) {
      parts.push(`● ${this.merged.workingDiff.total} changed`);
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
    const w = group.workingVersion;
    const versionCount = group.versions.length;
    this.tooltip = w
      ? `Directory: ${group.directory}\nWorking version: ${w.localVersion || w.metadata.versionTag}\n${versionCount} version(s) locally`
      : `Directory: ${group.directory}\n${versionCount} version(s) locally`;
    this.description = w
      ? (versionCount > 1 ? `${w.localVersion || w.metadata.versionTag} (${versionCount} versions)` : (w.localVersion || w.metadata.versionTag))
      : `${versionCount} version(s)`;
  }
}

class CheckedOutVersionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly version: CheckedOutVersion,
    public readonly groupDirectory: string,
    public readonly workingDiff?: WorkingDiffStatus
  ) {
    super(
      version.isWorking ? 'working' : version.versionTag,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `checked-out-version-${groupDirectory}-${version.isWorking ? 'working' : version.versionTag}`;
    this.contextValue = version.isWorking ? 'checkedOutWorking' : 'checkedOutVersion';
    if (version.isWorking && workingDiff) {
      this.iconPath = new vscode.ThemeIcon('git-commit', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon(version.isWorking ? 'edit' : 'tag');
    }
    this.tooltip = this.buildTooltip();
    this.description = this.buildDescription();
  }

  private buildTooltip(): string {
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
    if (this.version.isWorking && this.workingDiff) {
      const d = this.workingDiff;
      const segments: string[] = [];
      if (d.modified) { segments.push(`${d.modified} modified`); }
      if (d.added) { segments.push(`${d.added} added`); }
      if (d.removed) { segments.push(`${d.removed} removed`); }
      parts.push(`Working changes vs ${m.versionTag}: ${segments.join(', ')}`);
    }
    return parts.join('\n');
  }

  private buildDescription(): string {
    if (this.version.isWorking && this.workingDiff) {
      const v = this.version.localVersion ? `${this.version.localVersion} ` : '';
      return `${v}● ${this.workingDiff.total} changed`;
    }
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
      if (isDirectory && name === 'content') {
        this.contextValue = 'workingFolderContent';
      } else if (isDirectory) {
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

  // Filter state
  private searchQuery: string = '';
  private selectedCategory: string | undefined;
  private selectedTags: string[] = [];
  private selectedRepositoryIds: Set<string> = new Set();

  // Caches
  private repositoriesCache: ExampleRepositoryList[] | null = null;
  private examplesCache: Map<string, ExampleList[]> = new Map();
  private checkedOutCache: CheckedOutExampleGroup[] | null = null;
  private mergedCache: MergedExample[] | null = null;

  private fileWatchers: vscode.Disposable[] = [];
  private expandIdentifier: string | undefined;
  private treeView?: vscode.TreeView<vscode.TreeItem>;
  private parentMap = new Map<string, vscode.TreeItem>();

  private static readonly REPO_FILTER_STATE_KEY = 'computor.lecturer.examples.repoFilter';
  private context: vscode.ExtensionContext;

  constructor(
    context: vscode.ExtensionContext,
    providedApiService?: ComputorApiService
  ) {
    this.context = context;
    this.apiService = providedApiService || new ComputorApiService(context);
    const storedRepoIds = context.globalState.get<string[]>(LecturerExampleTreeProvider.REPO_FILTER_STATE_KEY, []);
    this.selectedRepositoryIds = new Set(storedRepoIds);
    this.setupFileWatchers(context);
  }

  private persistRepoFilter(): void {
    void this.context.globalState.update(
      LecturerExampleTreeProvider.REPO_FILTER_STATE_KEY,
      Array.from(this.selectedRepositoryIds)
    );
  }

  private setupFileWatchers(context: vscode.ExtensionContext): void {
    const examplesPath = this.getExamplesPath();
    if (!examplesPath) { return; }

    // Single broad watcher across the working-copy directory: any edit, create
    // or delete in any file under examples/<example>/ should bump the merged
    // tree so the per-row diff badge updates as the user edits. The downstream
    // refresh is debounced to absorb bursts (multi-file save, our own checkout
    // writes, etc.).
    const pattern = new vscode.RelativePattern(examplesPath, '**/*');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const debouncedRefresh = this.createDebouncedRefresh();
    watcher.onDidChange(debouncedRefresh);
    watcher.onDidCreate(debouncedRefresh);
    watcher.onDidDelete(debouncedRefresh);
    this.fileWatchers.push(watcher);

    context.subscriptions.push(...this.fileWatchers);
  }

  private createDebouncedRefresh(): () => void {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return () => {
      if (timeout) { clearTimeout(timeout); }
      timeout = setTimeout(() => {
        this.checkedOutCache = null;
        this.mergedCache = null;
        this._onDidChangeTreeData.fire(undefined);
      }, 300);
    };
  }

  refresh(): void {
    this.repositoriesCache = null;
    this.examplesCache.clear();
    this.checkedOutCache = null;
    this.mergedCache = null;
    this.parentMap.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  refreshAndExpand(directory: string): void {
    this.expandIdentifier = directory;
    this.refresh();
  }

  refreshNode(element?: vscode.TreeItem): void {
    this._onDidChangeTreeData.fire(element);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
    if (!element.id) { return undefined; }
    return this.parentMap.get(element.id);
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    try {
      if (!element) {
        return this.getRootItems();
      }

      if (element instanceof RootSectionTreeItem) {
        if (element.section === 'repositories') {
          return this.getRepositoryFilterToggles(element);
        }
        if (element.section === 'examples') {
          return this.getMergedExampleItems(element);
        }
      }

      if (element instanceof ExampleTreeItem) {
        if (!element.merged.local) { return []; }
        const shouldExpand = element.collapsibleState === vscode.TreeItemCollapsibleState.Expanded;
        return element.merged.local.versions.map(v => {
          const item = new CheckedOutVersionTreeItem(
            v,
            element.merged.local!.directory,
            v.isWorking ? element.merged.workingDiff : undefined
          );
          if (shouldExpand && v.isWorking) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
          }
          return item;
        });
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

    if (this.selectedRepositoryIds.size > 0) {
      const repoItem = new vscode.TreeItem(
        `Repositories: ${this.selectedRepositoryIds.size} selected`,
        vscode.TreeItemCollapsibleState.None
      );
      repoItem.iconPath = new vscode.ThemeIcon('repo');
      repoItem.contextValue = 'repositoryFilter';
      repoItem.tooltip = 'Click to clear repository filter';
      repoItem.command = { command: 'computor.lecturer.clearRepositoriesFilter', title: 'Clear Repositories Filter', arguments: [] };
      items.push(repoItem);
    }

    items.push(new RootSectionTreeItem(
      'repositories',
      'Repositories',
      'cloud',
      vscode.TreeItemCollapsibleState.Collapsed
    ));
    items.push(new RootSectionTreeItem(
      'examples',
      'Examples',
      'package',
      vscode.TreeItemCollapsibleState.Expanded
    ));

    return items;
  }

  private async getRepositoryFilterToggles(parent: RootSectionTreeItem): Promise<vscode.TreeItem[]> {
    const repositories = await this.getRepositories();
    return repositories.map(repo => {
      const item = new RepositoryFilterToggleItem(repo, this.selectedRepositoryIds.has(repo.id));
      if (item.id) { this.parentMap.set(item.id, parent); }
      return item;
    });
  }

  private async getMergedExampleItems(parent: RootSectionTreeItem): Promise<vscode.TreeItem[]> {
    const merged = await this.getMergedExamples();

    // Apply filters
    let filtered = merged;
    if (this.selectedRepositoryIds.size > 0) {
      filtered = filtered.filter(m =>
        m.repositoryId !== null && this.selectedRepositoryIds.has(m.repositoryId)
      );
    }
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(m =>
        m.title.toLowerCase().includes(query) ||
        m.identifier.toLowerCase().includes(query) ||
        (m.tags || []).some(t => t.toLowerCase().includes(query))
      );
    }
    if (this.selectedCategory) {
      filtered = filtered.filter(m => m.category === this.selectedCategory);
    }
    if (this.selectedTags.length > 0) {
      filtered = filtered.filter(m =>
        m.tags && this.selectedTags.every(tag => m.tags?.includes(tag))
      );
    }

    if (filtered.length === 0) {
      const empty = new vscode.TreeItem('No examples match the current filters', vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon('info');
      return [empty];
    }

    filtered.sort((a, b) => a.identifier.localeCompare(b.identifier));

    const expandIdentifier = this.expandIdentifier;
    this.expandIdentifier = undefined;

    return filtered.map(m => {
      const item = new ExampleTreeItem(m);
      if (expandIdentifier && m.identifier === expandIdentifier && m.local) {
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      }
      if (item.id) { this.parentMap.set(item.id, parent); }
      return item;
    });
  }

  private async getRepositories(): Promise<ExampleRepositoryList[]> {
    if (!this.repositoriesCache) {
      try {
        this.repositoriesCache = await this.apiService.getExampleRepositories();
      } catch (error) {
        console.error('Failed to load example repositories:', error);
        this.repositoriesCache = [];
      }
    }
    return this.repositoriesCache;
  }

  private async getExamplesForRepository(repository: ExampleRepositoryList): Promise<ExampleList[]> {
    if (!this.examplesCache.has(repository.id)) {
      try {
        const examples = await this.apiService.getExamples(repository.id);
        this.examplesCache.set(repository.id, examples);
      } catch (error) {
        console.error(`Failed to load examples for repository ${repository.name}:`, error);
        this.examplesCache.set(repository.id, []);
      }
    }
    return this.examplesCache.get(repository.id) || [];
  }

  private getCheckedOut(): CheckedOutExampleGroup[] {
    if (!this.checkedOutCache) {
      this.checkedOutCache = scanCheckedOutExamples();
    }
    return this.checkedOutCache;
  }

  private async getMergedExamples(): Promise<MergedExample[]> {
    if (this.mergedCache) { return this.mergedCache; }

    const repositories = await this.getRepositories();
    const localGroups = this.getCheckedOut();

    // Index local groups by exampleId (from metadata) and by directory
    const localByExampleId = new Map<string, CheckedOutExampleGroup>();
    const localByRepoDir = new Map<string, CheckedOutExampleGroup>();
    for (const group of localGroups) {
      const meta = group.versions[0]?.metadata;
      if (meta?.exampleId) {
        localByExampleId.set(meta.exampleId, group);
      }
      if (meta?.repositoryId && meta.directory) {
        localByRepoDir.set(`${meta.repositoryId}::${meta.directory}`, group);
      }
    }

    const merged: MergedExample[] = [];
    const consumedLocal = new Set<CheckedOutExampleGroup>();

    for (const repo of repositories) {
      const examples = await this.getExamplesForRepository(repo);
      for (const ex of examples) {
        const local = localByExampleId.get(ex.id) || localByRepoDir.get(`${repo.id}::${ex.directory}`);
        if (local) { consumedLocal.add(local); }
        merged.push({
          identifier: ex.identifier,
          title: ex.title,
          repositoryId: repo.id,
          repositoryName: repo.name,
          remote: ex,
          local,
          category: ex.category,
          tags: ex.tags,
          workingDiff: this.computeWorkingDiff(local)
        });
      }
    }

    // Local-only orphans (checked out but no matching remote)
    for (const group of localGroups) {
      if (consumedLocal.has(group)) { continue; }
      const meta = group.versions[0]?.metadata;
      const repoId = meta?.repositoryId || null;
      const repoName = repositories.find(r => r.id === repoId)?.name ?? null;
      merged.push({
        identifier: group.directory,
        title: group.workingVersion?.localVersion || group.directory,
        repositoryId: repoId,
        repositoryName: repoName,
        local: group,
        workingDiff: this.computeWorkingDiff(group)
      });
    }

    this.mergedCache = merged;
    return merged;
  }

  /**
   * For a checked-out group with a working version, compares the working
   * directory against the snapshot it was checked out from (recorded in
   * `.computor-example.json` → versionTag). Returns undefined if there is
   * no working version, or if the source snapshot is missing on disk.
   */
  private computeWorkingDiff(group: CheckedOutExampleGroup | undefined): WorkingDiffStatus | undefined {
    if (!group?.workingVersion) { return undefined; }

    let versionsRoot: string;
    try {
      versionsRoot = WorkspaceStructureManager.getInstance().getExampleVersionsPath();
    } catch {
      return undefined;
    }

    const meta = group.workingVersion.metadata;
    const snapshotDir = getVersionPath(versionsRoot, group.directory, meta.versionTag);
    if (!fs.existsSync(snapshotDir)) { return undefined; }

    try {
      const diff = computeExampleDiff(snapshotDir, group.workingVersion.fullPath);
      const total = diff.modified.length + diff.added.length + diff.removed.length;
      if (total === 0) { return undefined; }
      return {
        modified: diff.modified.length,
        added: diff.added.length,
        removed: diff.removed.length,
        total
      };
    } catch (err) {
      console.warn('[LecturerExampleTree] Failed to compute working diff:', err);
      return undefined;
    }
  }

  private getFileSystemItems(dirPath: string, isWorking: boolean = false): vscode.TreeItem[] {
    try {
      if (!fs.existsSync(dirPath)) { return []; }

      const entries = fs.readdirSync(dirPath);
      const treeItems: vscode.TreeItem[] = [];

      for (const item of entries) {
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

  // ------- Filter API (called by commands) -------

  getSearchQuery(): string { return this.searchQuery; }
  setSearchQuery(query: string): void {
    this.searchQuery = query;
    this.mergedCache = null;
    this._onDidChangeTreeData.fire(undefined);
  }
  clearSearch(): void { this.setSearchQuery(''); }

  getSelectedCategory(): string | undefined { return this.selectedCategory; }
  setCategory(category: string | undefined): void {
    this.selectedCategory = category;
    this._onDidChangeTreeData.fire(undefined);
  }
  clearCategoryFilter(): void { this.setCategory(undefined); }

  getSelectedTags(): string[] { return this.selectedTags; }
  setTags(tags: string[]): void {
    this.selectedTags = tags;
    this._onDidChangeTreeData.fire(undefined);
  }
  clearTagsFilter(): void { this.setTags([]); }

  toggleRepositoryFilter(repositoryId: string): void {
    if (this.selectedRepositoryIds.has(repositoryId)) {
      this.selectedRepositoryIds.delete(repositoryId);
    } else {
      this.selectedRepositoryIds.add(repositoryId);
    }
    this.persistRepoFilter();
    this._onDidChangeTreeData.fire(undefined);
  }

  clearRepositoriesFilter(): void {
    this.selectedRepositoryIds.clear();
    this.persistRepoFilter();
    this._onDidChangeTreeData.fire(undefined);
  }

  getSelectedRepositoryIds(): string[] {
    return Array.from(this.selectedRepositoryIds);
  }

  async getFilteredExamplesForRepository(repository: ExampleRepositoryList): Promise<ExampleTreeItem[]> {
    const examples = await this.getExamplesForRepository(repository);
    const localGroups = this.getCheckedOut();
    const localByExampleId = new Map<string, CheckedOutExampleGroup>();
    for (const group of localGroups) {
      const meta = group.versions[0]?.metadata;
      if (meta?.exampleId) { localByExampleId.set(meta.exampleId, group); }
    }

    let filtered = examples;
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(ex =>
        ex.title.toLowerCase().includes(query) ||
        ex.identifier.toLowerCase().includes(query) ||
        ex.directory.toLowerCase().includes(query) ||
        (ex.tags && ex.tags.some(tag => tag.toLowerCase().includes(query)))
      );
    }
    if (this.selectedCategory) {
      filtered = filtered.filter(ex => ex.category === this.selectedCategory);
    }
    if (this.selectedTags.length > 0) {
      filtered = filtered.filter(ex =>
        ex.tags && this.selectedTags.every(tag => ex.tags?.includes(tag))
      );
    }

    return filtered
      .sort((a, b) => a.identifier.localeCompare(b.identifier))
      .map(ex => new ExampleTreeItem({
        identifier: ex.identifier,
        title: ex.title,
        repositoryId: repository.id,
        repositoryName: repository.name,
        remote: ex,
        local: localByExampleId.get(ex.id),
        category: ex.category,
        tags: ex.tags
      }));
  }

  getExamplesPath(): string | undefined {
    try {
      return WorkspaceStructureManager.getInstance().getExamplesPath();
    } catch {
      return undefined;
    }
  }

  setTreeView(view: vscode.TreeView<vscode.TreeItem>): void {
    this.treeView = view;
  }

  async revealExample(params: { identifier?: string; id?: string; repositoryId?: string }): Promise<boolean> {
    if (!this.treeView) { return false; }
    if (!params.identifier && !params.id) { return false; }

    // Make sure the merged list is built and parentMap is populated.
    const examplesSection = new RootSectionTreeItem('examples', 'Examples', 'package');
    await this.getMergedExampleItems(examplesSection);

    const merged = await this.getMergedExamples();
    const match = merged.find(m =>
      (params.id && m.remote?.id === params.id) ||
      (params.identifier && m.identifier === params.identifier &&
        (!params.repositoryId || m.repositoryId === params.repositoryId))
    );
    if (!match) { return false; }

    const item = new ExampleTreeItem(match);
    if (item.id) { this.parentMap.set(item.id, examplesSection); }
    await this.treeView.reveal(item, { select: true, focus: true, expand: true });
    return true;
  }

  public handleDrag(source: readonly vscode.TreeItem[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void | Thenable<void> {
    const exampleItems = source.filter((s): s is ExampleTreeItem => s instanceof ExampleTreeItem);
    if (exampleItems.length > 0) {
      const draggable = exampleItems
        .filter(item => item.merged.remote)
        .map(item => ({
          exampleId: item.merged.remote!.id,
          title: item.merged.title,
          description: null,
          identifier: item.merged.identifier,
          repositoryId: item.merged.remote!.example_repository_id
        }));

      if (draggable.length > 0) {
        const dragDropManager = DragDropManager.getInstance();
        dragDropManager.setDraggedData(draggable);
        treeDataTransfer.set(
          'application/vnd.code.tree.computorexample',
          new vscode.DataTransferItem(JSON.stringify(draggable))
        );
      }
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
