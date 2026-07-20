import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { ComputorApiService } from '../services/ComputorApiService';
import type { DocumentsTreeProvider } from '../ui/tree/lecturer-documents/DocumentsTreeProvider';
import { notify } from '../utils/notify';
import {
  DocumentsFileItem,
  DocumentsDirectoryItem,
  DocumentsOrgItem,
  DocumentsCourseFamilyItem,
  DocumentsCourseItem
} from '../ui/tree/lecturer-documents/DocumentsTreeItems';
import type { DocumentScope } from '../services/DocumentsCacheService';

/**
 * Wires up commands for the lecturer Documents tree:
 *
 *  - refresh                   (view title)
 *  - openFile / uploadFile / downloadFile / revealInOS / copyPath…
 *  - newFile / newFolder / rename / delete / discardLocal
 *  - uploadAllPending          (per-scope, anchored on org/family/course/dir)
 */
export class DocumentsCommands {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ComputorApiService,
    private readonly tree: DocumentsTreeProvider
  ) {}

  register(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.documents.refresh', () => this.tree.refresh()),
      vscode.commands.registerCommand('computor.lecturer.documents.openFile', (item: any) => this.openFile(item)),
      vscode.commands.registerCommand('computor.lecturer.documents.uploadFile', (item: any) => this.uploadFile(item)),
      vscode.commands.registerCommand('computor.lecturer.documents.downloadFile', (item: any) => this.downloadFile(item)),
      vscode.commands.registerCommand('computor.lecturer.documents.revealInOS', (item: any) => this.revealInOS(item)),
      vscode.commands.registerCommand('computor.lecturer.documents.copyPath', (item: any) => this.copyPath(item, false)),
      vscode.commands.registerCommand('computor.lecturer.documents.copyRelativePath', (item: any) => this.copyPath(item, true)),
      vscode.commands.registerCommand('computor.lecturer.documents.newFile', (item: any) => this.newFile(item)),
      vscode.commands.registerCommand('computor.lecturer.documents.newFolder', (item: any) => this.newFolder(item)),
      vscode.commands.registerCommand('computor.lecturer.documents.rename', (item: any) => this.rename(item)),
      vscode.commands.registerCommand('computor.lecturer.documents.delete', (item: any) => this.delete(item)),
      vscode.commands.registerCommand('computor.lecturer.documents.discardLocal', (item: any) => this.discardLocal(item)),
      vscode.commands.registerCommand('computor.lecturer.documents.uploadAllPending', (item: any) => this.uploadAllPending(item)),
      vscode.commands.registerCommand('computor.lecturer.documents.revealMirrorRoot', () => this.revealMirrorRoot())
    );

    this.installMirrorWatcher();
  }

  /** Watches the local mirror so that edits made in the editor (or anything
   *  else that touches the mirrored files) cause the corresponding tree
   *  directory to re-classify. Without this the tree only re-renders on
   *  manual Refresh, so editing a downloaded file would silently leave the
   *  row showing `synced` until the next refresh. */
  private installMirrorWatcher(): void {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { return; }
    const pattern = new vscode.RelativePattern(ws, '.computor-data/documents/**');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.context.subscriptions.push(watcher);
    const handle = (uri: vscode.Uri) => {
      const parsed = this.parseMirrorPath(uri.fsPath);
      if (parsed) {
        this.tree.invalidateDirectory(parsed.scope, parsed.parentPath);
      }
    };
    this.context.subscriptions.push(
      watcher.onDidChange(handle),
      watcher.onDidCreate(handle),
      watcher.onDidDelete(handle)
    );
  }

  /** Reverses the mirror layout to recover the (scope, parentPath) the
   *  watcher event refers to. Returns undefined for paths outside the
   *  mirror or for events on the scope-root directory itself. */
  private parseMirrorPath(absPath: string): { scope: DocumentScope; parentPath: string } | undefined {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) { return undefined; }
    const mirrorPrefix = path.join(wsRoot, '.computor-data', 'documents') + path.sep;
    if (!absPath.startsWith(mirrorPrefix) && absPath !== mirrorPrefix.slice(0, -1)) { return undefined; }
    const rel = path.relative(path.join(wsRoot, '.computor-data', 'documents'), absPath);
    if (!rel || rel.startsWith('..')) { return undefined; }
    const segs = rel.split(path.sep);
    const scopeType = segs[0];
    if (scopeType !== 'system'
      && scopeType !== 'organization'
      && scopeType !== 'course_family'
      && scopeType !== 'course') {
      return undefined;
    }
    // System has no scope-id segment; everything else does.
    if (scopeType === 'system') {
      if (segs.length < 2) { return undefined; }
      const fileSegs = segs.slice(1);
      const parentPath = fileSegs.slice(0, -1).join('/');
      return { scope: { scope: 'system' }, parentPath };
    }
    if (segs.length < 3) { return undefined; }
    const scopeId = segs[1] || '';
    const fileSegs = segs.slice(2);
    const parentPath = fileSegs.slice(0, -1).join('/');
    return { scope: { scope: scopeType, scopeId }, parentPath };
  }

  // ----- Open / upload / download -----

  private async openFile(item: any): Promise<void> {
    if (!(item instanceof DocumentsFileItem)) { return; }
    const { scope, entry } = item;
    if (entry.local && entry.state !== 'remote-only') {
      await vscode.window.showTextDocument(vscode.Uri.file(entry.local.absPath), { preview: false });
      return;
    }
    const localPath = await this.pullToMirror(scope, entry.relativePath);
    if (localPath) {
      await vscode.window.showTextDocument(vscode.Uri.file(localPath), { preview: false });
    }
  }

  /** Pull bytes from the backend into the mirror, stamping mtime to the
   *  server's last_modified so future classifications report `synced`.
   *  Returns the absolute path of the mirrored copy, or undefined on failure. */
  private async pullToMirror(scope: DocumentScope, relativePath: string): Promise<string | undefined> {
    try {
      const bytes = await this.api.downloadDocument(scope.scope, scope.scopeId ?? null, relativePath);
      const parent = relativePath.includes('/')
        ? relativePath.slice(0, relativePath.lastIndexOf('/'))
        : '';
      // Re-list to get last_modified for the mtime stamp.
      const listing = await this.api.listDocuments(scope.scope, scope.scopeId ?? null, parent);
      const me = listing.find(e => e.name === relativePath.split('/').pop() && e.type === 'file');
      await this.tree.cache.writePulled(scope, relativePath, bytes, me?.last_modified);
      const localPath = this.tree.cache.resolveLocalPath(scope, relativePath);
      if (localPath && fs.existsSync(localPath)) {
        this.tree.invalidateDirectory(scope, parent);
        return localPath;
      }
      return undefined;
    } catch (err: any) {
      notify.error(`Failed to download document: ${err?.message || err}`);
      return undefined;
    }
  }

  private async uploadFile(item: any): Promise<void> {
    if (!(item instanceof DocumentsFileItem)) { return; }
    const { scope, entry } = item;
    if (!entry.local?.absPath) {
      notify.warning('No local copy to upload.');
      return;
    }
    try {
      const bytes = await fs.promises.readFile(entry.local.absPath);
      await this.api.uploadDocument(scope.scope, scope.scopeId ?? null, entry.relativePath, bytes);
      const parent = entry.relativePath.includes('/')
        ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf('/'))
        : '';
      const listing = await this.api.listDocuments(scope.scope, scope.scopeId ?? null, parent);
      const remote = listing.find(e => e.name === entry.name && e.type === 'file');
      // Re-write with the server's last_modified so post-upload state is
      // `synced`, not "modified by 5ms".
      await this.tree.cache.writePulled(scope, entry.relativePath, bytes, remote?.last_modified);
      this.tree.invalidateDirectory(scope, parent);
    } catch (err: any) {
      notify.error(`Failed to upload document: ${err?.message || err}`);
    }
  }

  private async downloadFile(item: any): Promise<void> {
    if (!(item instanceof DocumentsFileItem)) { return; }
    await this.pullToMirror(item.scope, item.entry.relativePath);
  }

  private async revealInOS(item: any): Promise<void> {
    let absPath: string | undefined;
    if (item instanceof DocumentsFileItem) {
      if (item.entry.local) {
        absPath = item.entry.local.absPath;
      } else {
        absPath = await this.pullToMirror(item.scope, item.entry.relativePath);
      }
    } else if (item instanceof DocumentsDirectoryItem
      || item instanceof DocumentsOrgItem
      || item instanceof DocumentsCourseFamilyItem
      || item instanceof DocumentsCourseItem) {
      // For an entity row reveal the scope's mirror root; for a directory
      // reveal that subdirectory, creating it on demand so there's
      // something to show.
      const dirRel = item instanceof DocumentsDirectoryItem ? item.entry.relativePath : '';
      const scope = item.scope;
      absPath = this.tree.cache.resolveLocalPath(scope, dirRel);
      if (absPath) {
        await fs.promises.mkdir(absPath, { recursive: true }).catch(() => undefined);
      }
    }
    if (!absPath) { return; }
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(absPath));
  }

  private async copyPath(item: any, relative: boolean): Promise<void> {
    if (item instanceof DocumentsFileItem || item instanceof DocumentsDirectoryItem) {
      const text = relative
        ? item.entry.relativePath
        : (item.entry.local?.absPath ?? this.tree.cache.resolveLocalPath(item.scope, item.entry.relativePath) ?? item.entry.relativePath);
      await vscode.env.clipboard.writeText(text);
    }
  }

  // ----- Mutating actions -----

  /** Resolves the target for `New File` / `New Folder`:
   *  - command invoked with an item (right-click on org / family / course /
   *    folder) → that entity's scope at its own root,
   *  - command invoked from the title bar with no item → system scope at
   *    the tree root.
   *
   *  We deliberately ignore the tree's current selection: the title-bar
   *  buttons are reserved for the top-level (system) area, while the
   *  entity-scoped New File lives in the right-click menu of each entity
   *  row. */
  private resolveTargetOrSystemRoot(item: any): { scope: DocumentScope; parentPath: string } {
    const direct = this.resolveTarget(item);
    if (direct) { return direct; }
    return { scope: { scope: 'system' }, parentPath: '' };
  }

  /** Resolve scope + parent directory for a New / Drop operation given any
   *  tree item. Org/Family/Course rows mean "scope root"; a Directory row
   *  means the directory itself; a File row uses its containing directory. */
  private resolveTarget(item: any): { scope: DocumentScope; parentPath: string } | undefined {
    if (item instanceof DocumentsOrgItem
      || item instanceof DocumentsCourseFamilyItem
      || item instanceof DocumentsCourseItem) {
      return { scope: item.scope, parentPath: '' };
    }
    if (item instanceof DocumentsDirectoryItem) {
      return { scope: item.scope, parentPath: item.entry.relativePath };
    }
    if (item instanceof DocumentsFileItem) {
      const idx = item.entry.relativePath.lastIndexOf('/');
      const parent = idx >= 0 ? item.entry.relativePath.slice(0, idx) : '';
      return { scope: item.scope, parentPath: parent };
    }
    return undefined;
  }

  private async newFile(item: any): Promise<void> {
    const target = this.resolveTargetOrSystemRoot(item);
    const name = await vscode.window.showInputBox({
      prompt: 'New file name (relative to the selected directory)',
      validateInput: this.validateRelativeSegment
    });
    if (!name) { return; }
    const relativePath = target.parentPath ? `${target.parentPath}/${name}` : name;

    // POST an empty file first so permission checks happen up-front and the
    // local copy is born already synced (no Local-only state to reconcile
    // later). Mirrors what newFolder does for directories.
    const emptyBytes = Buffer.alloc(0);
    try {
      await this.api.uploadDocument(target.scope.scope, target.scope.scopeId ?? null, relativePath, emptyBytes);
    } catch (err: any) {
      notify.error(`Failed to create file on server: ${err?.message || err}`);
      return;
    }

    // Mirror locally with an mtime matching the server, so classifyEntries
    // reports `synced` immediately. Re-list to grab the etag/last_modified
    // for the entry the server just created.
    try {
      const listing = await this.api.listDocuments(target.scope.scope, target.scope.scopeId ?? null, target.parentPath);
      const remote = listing.find(e => e.name === name && e.type === 'file');
      await this.tree.cache.writePulled(target.scope, relativePath, emptyBytes, remote?.last_modified);
    } catch (err: any) {
      // Server-side create succeeded but local mirror write failed — log and
      // continue; the next refresh will reconcile via remote-only.
      console.warn(`[documents] Local mirror write failed for ${relativePath}:`, err);
    }

    this.tree.invalidateDirectory(target.scope, target.parentPath);
    const localPath = this.tree.cache.resolveLocalPath(target.scope, relativePath);
    if (localPath && fs.existsSync(localPath)) {
      await vscode.window.showTextDocument(vscode.Uri.file(localPath), { preview: false });
    }
  }

  private async newFolder(item: any): Promise<void> {
    const target = this.resolveTargetOrSystemRoot(item);
    const name = await vscode.window.showInputBox({
      prompt: 'New folder name (relative to the selected directory)',
      validateInput: this.validateRelativeSegment
    });
    if (!name) { return; }
    const relativePath = target.parentPath ? `${target.parentPath}/${name}` : name;
    try {
      await this.api.createDocumentDirectory(target.scope.scope, target.scope.scopeId ?? null, relativePath);
      const localPath = this.tree.cache.resolveLocalPath(target.scope, relativePath);
      if (localPath) {
        await fs.promises.mkdir(localPath, { recursive: true });
      }
      this.tree.invalidateDirectory(target.scope, target.parentPath);
    } catch (err: any) {
      notify.error(`Failed to create folder: ${err?.message || err}`);
    }
  }

  private async rename(item: any): Promise<void> {
    if (!(item instanceof DocumentsFileItem || item instanceof DocumentsDirectoryItem)) { return; }
    const { scope, entry } = item;
    const newName = await vscode.window.showInputBox({
      prompt: `Rename "${entry.name}"`,
      value: entry.name,
      validateInput: this.validateRelativeSegment
    });
    if (!newName || newName === entry.name) { return; }
    const idx = entry.relativePath.lastIndexOf('/');
    const parent = idx >= 0 ? entry.relativePath.slice(0, idx) : '';
    const newRelativePath = parent ? `${parent}/${newName}` : newName;

    try {
      if (entry.state !== 'local-only') {
        if (entry.type === 'directory') {
          await this.api.renameDocumentDirectory(scope.scope, scope.scopeId ?? null, entry.relativePath, newRelativePath);
        } else {
          await this.api.renameDocument(scope.scope, scope.scopeId ?? null, entry.relativePath, newRelativePath);
        }
      }
      const oldLocal = this.tree.cache.resolveLocalPath(scope, entry.relativePath);
      const newLocal = this.tree.cache.resolveLocalPath(scope, newRelativePath);
      if (oldLocal && newLocal && fs.existsSync(oldLocal)) {
        await fs.promises.mkdir(path.dirname(newLocal), { recursive: true });
        await fs.promises.rename(oldLocal, newLocal);
      }
      this.tree.invalidateDirectory(scope, parent);
    } catch (err: any) {
      notify.error(`Failed to rename: ${err?.message || err}`);
    }
  }

  private async delete(item: any): Promise<void> {
    if (!(item instanceof DocumentsFileItem || item instanceof DocumentsDirectoryItem)) { return; }
    const { scope, entry } = item;
    const kind = entry.type === 'directory' ? 'folder' : 'file';
    const choice = await notify.confirm(
      `Delete ${kind} "${entry.relativePath}"?${entry.type === 'directory' ? ' This removes everything inside it.' : ''}`,
      'Delete'
    );
    if (!choice) { return; }
    const idx = entry.relativePath.lastIndexOf('/');
    const parent = idx >= 0 ? entry.relativePath.slice(0, idx) : '';
    try {
      if (entry.state !== 'local-only') {
        if (entry.type === 'directory') {
          await this.api.deleteDocumentDirectory(scope.scope, scope.scopeId ?? null, entry.relativePath);
        } else {
          await this.api.deleteDocument(scope.scope, scope.scopeId ?? null, entry.relativePath);
        }
      }
      await this.tree.cache.removeLocal(scope, entry.relativePath);
      this.tree.invalidateDirectory(scope, parent);
    } catch (err: any) {
      notify.error(`Failed to delete: ${err?.message || err}`);
    }
  }

  private async discardLocal(item: any): Promise<void> {
    if (!(item instanceof DocumentsFileItem)) { return; }
    if (item.entry.state !== 'modified' && item.entry.state !== 'remote-changed') {
      notify.info('Nothing to discard — file has no local changes.');
      return;
    }
    const choice = await notify.confirm(
      `Discard local changes to "${item.entry.relativePath}"?`,
      'Discard'
    );
    if (!choice) { return; }
    const idx = item.entry.relativePath.lastIndexOf('/');
    const parent = idx >= 0 ? item.entry.relativePath.slice(0, idx) : '';
    await this.tree.cache.removeLocal(item.scope, item.entry.relativePath);
    await this.pullToMirror(item.scope, item.entry.relativePath);
    this.tree.invalidateDirectory(item.scope, parent);
  }

  // ----- Bulk upload -----

  /** Upload every locally-changed or new file. Two entry points:
   *  - per-scope: invoked from the right-click menu on an org / family /
   *    course / directory row. Confined to that subtree.
   *  - global (no `item`): invoked from the view-title bar. Walks every
   *    scope that has a local mirror.
   */
  private async uploadAllPending(item: any): Promise<void> {
    const slices: Array<{ scope: DocumentScope; parentPath: string }> = [];
    if (item) {
      const target = this.resolveTarget(item);
      if (!target) {
        notify.warning('Right-click an organization, course family, course, or folder to upload its pending changes.');
        return;
      }
      slices.push(target);
    } else {
      const scopes = await this.tree.cache.listScopesWithLocalFiles();
      if (scopes.length === 0) {
        notify.info('No local documents staged for upload.');
        return;
      }
      for (const scope of scopes) { slices.push({ scope, parentPath: '' }); }
    }

    // Collect candidates across every slice. Grouping by parent dir keeps
    // the per-directory `listDocuments` call once-per-directory.
    const candidates: Array<{ scope: DocumentScope; relativePath: string }> = [];
    for (const slice of slices) {
      const localFiles = await this.tree.cache.listAllLocalFiles(slice.scope);
      const within = slice.parentPath
        ? localFiles.filter(f => f === slice.parentPath || f.startsWith(`${slice.parentPath}/`))
        : localFiles;
      const byParent = new Map<string, string[]>();
      for (const rel of within) {
        const idx = rel.lastIndexOf('/');
        const parent = idx >= 0 ? rel.slice(0, idx) : '';
        const list = byParent.get(parent) ?? [];
        list.push(rel);
        byParent.set(parent, list);
      }
      for (const [parent, rels] of byParent) {
        try {
          const remote = await this.api.listDocuments(slice.scope.scope, slice.scope.scopeId ?? null, parent);
          const entries = await this.tree.cache.classifyEntries(slice.scope, parent, remote);
          for (const rel of rels) {
            const entry = entries.find(e => e.relativePath === rel);
            if (!entry || entry.type !== 'file') { continue; }
            if (entry.state === 'local-only' || entry.state === 'modified') {
              candidates.push({ scope: slice.scope, relativePath: rel });
            }
          }
        } catch (err: any) {
          console.warn(`[documents] Skipping ${slice.scope.scope}/${slice.scope.scopeId}/${parent} — list failed: ${err?.message || err}`);
        }
      }
    }

    if (candidates.length === 0) {
      notify.info('Nothing to upload — all local files are already in sync.');
      return;
    }

    let succeeded = 0;
    let failed = 0;
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Uploading ${candidates.length} document${candidates.length === 1 ? '' : 's'}…`,
      cancellable: false
    }, async (progress) => {
      let i = 0;
      for (const { scope, relativePath } of candidates) {
        i += 1;
        progress.report({
          increment: (1 / candidates.length) * 100,
          message: `${i}/${candidates.length} · ${scope.scope}/${relativePath}`
        });
        const localPath = this.tree.cache.resolveLocalPath(scope, relativePath);
        if (!localPath) { failed += 1; continue; }
        try {
          const bytes = await fs.promises.readFile(localPath);
          await this.api.uploadDocument(scope.scope, scope.scopeId ?? null, relativePath, bytes);
          const idx = relativePath.lastIndexOf('/');
          const parent = idx >= 0 ? relativePath.slice(0, idx) : '';
          const listing = await this.api.listDocuments(scope.scope, scope.scopeId ?? null, parent);
          const remote = listing.find(e => e.name === relativePath.split('/').pop() && e.type === 'file');
          await this.tree.cache.writePulled(scope, relativePath, bytes, remote?.last_modified);
          succeeded += 1;
        } catch (err: any) {
          console.error(`[documents] Upload failed for ${relativePath}:`, err);
          failed += 1;
        }
      }
    });

    this.tree.refresh();
    if (failed === 0) {
      notify.info(`Uploaded ${succeeded} document${succeeded === 1 ? '' : 's'}.`);
    } else {
      notify.warning(`Uploaded ${succeeded} document${succeeded === 1 ? '' : 's'}, ${failed} failed.`);
    }
  }

  /** Open the local mirror root (`.computor-data/documents/`) in the OS
   *  file explorer. The directory is created on demand so there's something
   *  to reveal even before any file has been pulled. */
  private async revealMirrorRoot(): Promise<void> {
    const root = this.tree.cache.resolveMirrorRoot();
    if (!root) {
      notify.warning('No workspace is open.');
      return;
    }
    await fs.promises.mkdir(root, { recursive: true }).catch(() => undefined);
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(root));
  }

  /** Validates a single path segment for the file/folder name inputs. */
  private readonly validateRelativeSegment = (value: string): string | undefined => {
    if (!value || !value.trim()) { return 'Name cannot be empty.'; }
    if (value.includes('/') || value.includes('\\')) { return 'Name cannot contain path separators.'; }
    if (value === '.' || value === '..') { return 'Reserved name.'; }
    return undefined;
  };
}
