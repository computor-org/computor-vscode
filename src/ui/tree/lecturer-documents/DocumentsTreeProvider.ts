import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { ComputorApiService } from '../../../services/ComputorApiService';
import { DocumentsCacheService, type DocumentScope } from '../../../services/DocumentsCacheService';
import { notify } from '../../../utils/notify';
import {
  DocumentsOrgItem,
  DocumentsCourseFamilyItem,
  DocumentsCourseItem,
  DocumentsDirectoryItem,
  DocumentsFileItem,
  DocumentsLoadingItem,
  DocumentsErrorItem,
  type DocumentsTreeItem
} from './DocumentsTreeItems';
import { BaseTreeDataProvider } from '../BaseTreeDataProvider';

/** Fixed scope used for the documents that live at the very top of the
 *  tree (no entity scope). Listing/uploading at this scope is admin-only
 *  on the backend; non-admins simply see no entries here. */
const SYSTEM_SCOPE: DocumentScope = { scope: 'system' };

/**
 * Tree shaped like the lecturer course tree:
 *
 *   Org → Course Family → Course
 *
 * Each entity row, when expanded, yields:
 *   1. its child entities (organizations → families → courses)
 *   2. the documents at the root of that scope (org-scope / family-scope /
 *      course-scope), as `DocumentsDirectoryItem` / `DocumentsFileItem` rows
 *
 * Course is the leaf entity; expanding a course yields just its documents.
 */
export class DocumentsTreeProvider extends BaseTreeDataProvider<DocumentsTreeItem> implements vscode.TreeDragAndDropController<DocumentsTreeItem> {
  /** External files dropped onto the view. We don't drag rows out of the
   *  view, so dragMimeTypes is empty. */
  readonly dropMimeTypes = ['text/uri-list', 'application/vnd.code.uri-list'];
  readonly dragMimeTypes: string[] = [];

  /** Per-(scope, dirPath) cache of last-built document rows. Refresh clears it. */
  private listingCache = new Map<string, DocumentsTreeItem[]>();
  /** Top-level org list cache so we don't re-fetch on every collapse/expand. */
  private orgsCache: Awaited<ReturnType<ComputorApiService['getOrganizations']>> | undefined;
  /** Per-org family list cache. */
  private familiesCache = new Map<string, Awaited<ReturnType<ComputorApiService['getCourseFamilies']>>>();
  /** Per-family course list cache. */
  private coursesCache = new Map<string, Awaited<ReturnType<ComputorApiService['getCourses']>>>();
  /**
   * Entity-path segments per scope, e.g. `['tugraz', 'physics', 'mech-2026']`
   * for a course. The backend lays the documents store out along exactly these
   * (`resolve_scope_root`), and the static server publishes that same tree at
   * `/docs`, so this is what turns a document into the URL an assignment can
   * link to. Filled in as entity rows are built — a document row only exists
   * under one — and cleared with the rest on refresh.
   */
  private scopeSegments = new Map<string, string[]>();

  constructor(
    private readonly api: ComputorApiService,
    public readonly cache: DocumentsCacheService = new DocumentsCacheService()
  ) {
    super();
  }

  override refresh(): void {
    this.listingCache.clear();
    this.orgsCache = undefined;
    this.familiesCache.clear();
    this.coursesCache.clear();
    this.scopeSegments.clear();
    super.refresh();
  }

  /**
   * The entity-path segments a scope's documents live under, or undefined when
   * that scope's entity row has not been expanded in this session yet. System
   * scope is the store's root, so it answers an empty list.
   */
  scopePathSegments(scope: DocumentScope): string[] | undefined {
    if (scope.scope === 'system') { return []; }
    return this.scopeSegments.get(`${scope.scope}:${scope.scopeId ?? ''}`);
  }

  private rememberScopeSegments(scope: DocumentScope, segments: string[]): void {
    this.scopeSegments.set(`${scope.scope}:${scope.scopeId ?? ''}`, segments);
  }

  /** Re-render a single document subtree without dropping the rest. */
  invalidateDirectory(scope: DocumentScope, dirPath: string): void {
    this.listingCache.delete(this.cacheKey(scope, dirPath));
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  // ----- TreeDataProvider -----

  getTreeItem(element: DocumentsTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DocumentsTreeItem): Promise<DocumentsTreeItem[]> {
    if (!element) {
      return this.getRootChildren();
    }
    if (element instanceof DocumentsOrgItem) {
      return this.getOrgChildren(element);
    }
    if (element instanceof DocumentsCourseFamilyItem) {
      return this.getCourseFamilyChildren(element);
    }
    if (element instanceof DocumentsCourseItem) {
      return this.listChildrenAt(element.scope, '');
    }
    if (element instanceof DocumentsDirectoryItem) {
      return this.listChildrenAt(element.scope, element.entry.relativePath);
    }
    return [];
  }

  // ----- Entity-level fetches -----

  private async getRootChildren(): Promise<DocumentsTreeItem[]> {
    // Root layout: every org row, then the system-scope documents living at
    // the top (no dedicated System node). System listing is admin-only on
    // the backend; non-admins get an empty list and we silently skip it.
    const items: DocumentsTreeItem[] = [];
    let orgPaths: ReadonlySet<string> = new Set();
    try {
      if (!this.orgsCache) {
        this.orgsCache = await this.api.getOrganizations();
      }
      const sorted = [...(this.orgsCache ?? [])].sort((a, b) =>
        (a.title || a.path).localeCompare(b.title || b.path)
      );
      orgPaths = new Set(sorted.map(o => o.path));
      items.push(...sorted.map(org => {
        const item = new DocumentsOrgItem(org);
        this.rememberScopeSegments(item.scope, [org.path]);
        return item;
      }));
    } catch (err: any) {
      items.push(new DocumentsErrorItem(`Failed to load organizations: ${err?.message || err}`));
    }
    items.push(...(await this.listSystemRootEntries(orgPaths)));
    return items;
  }

  /** System-scope listing for the tree root, with org-path directories
   *  filtered out so they don't duplicate the org entity rows. */
  private async listSystemRootEntries(excludeNames: ReadonlySet<string>): Promise<DocumentsTreeItem[]> {
    try {
      const children = await this.listChildrenAt(SYSTEM_SCOPE, '', excludeNames);
      return children.filter(child => !(child instanceof DocumentsErrorItem));
    } catch {
      return [];
    }
  }

  private async getOrgChildren(item: DocumentsOrgItem): Promise<DocumentsTreeItem[]> {
    const families = await this.fetchFamilies(item.organization.id);
    const familyItems = families.map(f => {
      const row = new DocumentsCourseFamilyItem(f, item.organization);
      this.rememberScopeSegments(row.scope, [item.organization.path, f.path]);
      return row;
    });
    // Drop family-path directories from the org-scope listing so they don't
    // duplicate the family entity rows above.
    const documents = await this.listChildrenAt(item.scope, '', new Set(families.map(f => f.path)));
    return [...familyItems, ...documents];
  }

  private async getCourseFamilyChildren(item: DocumentsCourseFamilyItem): Promise<DocumentsTreeItem[]> {
    const courses = await this.fetchCourses(item.courseFamily.id);
    const courseItems = courses.map(c => {
      const row = new DocumentsCourseItem(c, item.courseFamily, item.organization);
      this.rememberScopeSegments(row.scope, [item.organization.path, item.courseFamily.path, c.path]);
      return row;
    });
    // Drop course-path directories from the family-scope listing so they
    // don't duplicate the course entity rows above.
    const documents = await this.listChildrenAt(item.scope, '', new Set(courses.map(c => c.path)));
    return [...courseItems, ...documents];
  }

  private async fetchFamilies(orgId: string): Promise<Awaited<ReturnType<ComputorApiService['getCourseFamilies']>>> {
    const cached = this.familiesCache.get(orgId);
    if (cached) { return cached; }
    try {
      const families = await this.api.getCourseFamilies(orgId) || [];
      const sorted = [...families].sort((a, b) =>
        (a.title || a.path).localeCompare(b.title || b.path)
      );
      this.familiesCache.set(orgId, sorted);
      return sorted;
    } catch (err) {
      console.error('[documents] Failed to load course families', err);
      return [];
    }
  }

  private async fetchCourses(familyId: string): Promise<Awaited<ReturnType<ComputorApiService['getCourses']>>> {
    const cached = this.coursesCache.get(familyId);
    if (cached) { return cached; }
    try {
      const courses = await this.api.getCourses(familyId) || [];
      const sorted = [...courses].sort((a, b) =>
        (a.title || a.path).localeCompare(b.title || b.path)
      );
      this.coursesCache.set(familyId, sorted);
      return sorted;
    } catch (err) {
      console.error('[documents] Failed to load courses', err);
      return [];
    }
  }

  // ----- Document-level fetches -----

  /**
   * Lists one directory under a scope. `excludeNames` drops entries whose
   * `name` collides with a sibling entity directory — the backend stores
   * org/family/course documents under directories named after each
   * entity's `path` (Ltree identifier), so listing the parent scope's root
   * would otherwise show those entity directories side-by-side with the
   * dedicated entity tree items. The filter is applied before caching, so
   * each (scope, parentPath) is asked exactly once.
   */
  private async listChildrenAt(
    scope: DocumentScope,
    parentPath: string,
    excludeNames?: ReadonlySet<string>
  ): Promise<DocumentsTreeItem[]> {
    const cacheKey = this.cacheKey(scope, parentPath);
    const cached = this.listingCache.get(cacheKey);
    if (cached) { return cached; }

    let items: DocumentsTreeItem[];
    try {
      const remote = await this.api.listDocuments(scope.scope, scope.scopeId ?? null, parentPath);
      const filtered = excludeNames && excludeNames.size > 0
        ? remote.filter(item => !excludeNames.has(item.name))
        : remote;
      const entries = await this.cache.classifyEntries(scope, parentPath, filtered);
      items = entries.map(entry =>
        entry.type === 'directory'
          ? new DocumentsDirectoryItem(scope, entry)
          : new DocumentsFileItem(scope, entry)
      );
    } catch (err: any) {
      const message = err?.message || String(err);
      items = [new DocumentsErrorItem(`Failed to list documents: ${message}`)];
    }

    this.listingCache.set(cacheKey, items);
    return items;
  }

  private cacheKey(scope: DocumentScope, parentPath: string): string {
    return `${scope.scope}::${scope.scopeId ?? 'system'}::${parentPath}`;
  }

  // ----- Drag and drop -----

  /** External files/folders dropped onto an entity row or a directory row.
   *  Files are copied into the local mirror as `local-only` so the user
   *  can review them before clicking Upload. */
  async handleDrop(target: DocumentsTreeItem | undefined, sources: vscode.DataTransfer): Promise<void> {
    if (!target) {
      notify.warning('Drop into an organization, course family, course, or document folder.');
      return;
    }

    const dest = this.resolveDropTarget(target);
    if (!dest) {
      notify.warning('Drop target is not a documents container.');
      return;
    }

    const uriListItem = sources.get('text/uri-list') ?? sources.get('application/vnd.code.uri-list');
    if (!uriListItem) { return; }
    const value = await uriListItem.asString();
    if (!value) { return; }

    const uris = value
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => {
        try { return vscode.Uri.parse(line); } catch { return undefined; }
      })
      .filter((u): u is vscode.Uri => !!u && u.scheme === 'file');

    if (uris.length === 0) { return; }

    let added = 0;
    let failed = 0;
    for (const uri of uris) {
      try {
        await this.copyExternalIntoMirror(dest.scope, dest.parentPath, uri.fsPath);
        added += 1;
      } catch (err: any) {
        console.warn('[documents] Drop failed for', uri.fsPath, err);
        failed += 1;
      }
    }

    this.invalidateDirectory(dest.scope, dest.parentPath);
    if (failed > 0) {
      notify.warning(`Added ${added} item(s), ${failed} failed.`);
    } else if (added > 0) {
      notify.info(`Added ${added} item(s) as local-only. Right-click the scope to Upload All Pending when ready.`);
    }
  }

  private resolveDropTarget(target: DocumentsTreeItem): { scope: DocumentScope; parentPath: string } | undefined {
    if (target instanceof DocumentsOrgItem
      || target instanceof DocumentsCourseFamilyItem
      || target instanceof DocumentsCourseItem) {
      return { scope: target.scope, parentPath: '' };
    }
    if (target instanceof DocumentsDirectoryItem) {
      return { scope: target.scope, parentPath: target.entry.relativePath };
    }
    return undefined;
  }

  private async copyExternalIntoMirror(scope: DocumentScope, parentPath: string, sourceAbs: string): Promise<void> {
    const baseName = path.basename(sourceAbs);
    const stat = await fs.promises.stat(sourceAbs);
    const targetRelative = parentPath ? `${parentPath}/${baseName}` : baseName;
    const targetAbs = this.cache.resolveLocalPath(scope, targetRelative);
    if (!targetAbs) { throw new Error('No workspace open.'); }
    await fs.promises.mkdir(path.dirname(targetAbs), { recursive: true });
    if (stat.isDirectory()) {
      await this.copyDirectoryRecursive(sourceAbs, targetAbs);
    } else {
      await fs.promises.copyFile(sourceAbs, targetAbs);
    }
  }

  private async copyDirectoryRecursive(src: string, dst: string): Promise<void> {
    await fs.promises.mkdir(dst, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (const ent of entries) {
      const s = path.join(src, ent.name);
      const d = path.join(dst, ent.name);
      if (ent.isDirectory()) {
        await this.copyDirectoryRecursive(s, d);
      } else if (ent.isFile()) {
        await fs.promises.copyFile(s, d);
      }
    }
  }
}

export { DocumentsLoadingItem };
