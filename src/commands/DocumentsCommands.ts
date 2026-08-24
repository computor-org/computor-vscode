import * as vscode from 'vscode';
import { openFile as openInEditor, OPEN_FILE_COMMAND } from '../ui/editorLayout';
import * as fs from 'fs';
import * as path from 'path';
import type { ComputorApiService } from '../services/ComputorApiService';
import type { DocumentsTreeProvider } from '../ui/tree/lecturer-documents/DocumentsTreeProvider';
import { notify } from '../utils/notify';
import { revealUri } from '../utils/reveal';
import {
  DocumentsFileItem,
  DocumentsDirectoryItem,
  DocumentsOrgItem,
  DocumentsCourseFamilyItem,
  DocumentsCourseItem
} from '../ui/tree/lecturer-documents/DocumentsTreeItems';
import type { DocumentScope } from '../services/DocumentsCacheService';
import { validateSegment } from '../utils/studentFsOperations';
import JSZip from 'jszip';
import { downloadBytesInBrowser } from '../ui/webviews/browserDownload';
import { pickFilesFromBrowser, type PickedFile } from '../ui/webviews/browserUpload';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { copyToClipboard } from '../utils/clipboard';
import { buildPublicDocumentUrl, mimeTypeFor, normalizeUploadPath } from '../utils/documentTransfer';

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
      vscode.commands.registerCommand('computor.lecturer.documents.revealMirrorRoot', () => this.revealMirrorRoot()),
      vscode.commands.registerCommand('computor.lecturer.documents.downloadToComputer', (item: any) => this.downloadToComputer(item)),
      vscode.commands.registerCommand('computor.lecturer.documents.uploadFromComputer', (item: any) => this.uploadFromComputer(item, { folder: false })),
      vscode.commands.registerCommand('computor.lecturer.documents.uploadFolderFromComputer', (item: any) => this.uploadFromComputer(item, { folder: true })),
      vscode.commands.registerCommand('computor.lecturer.documents.copyPublicUrl', (item: any) => this.copyPublicUrl(item))
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

  /**
   * A document can be anything a lecturer uploaded — a slide deck, a figure, a
   * dataset — so the open goes through `computor.openFile` rather than
   * `showTextDocument`. A text editor is the *only* thing showTextDocument can
   * produce: asked for a PDF it refuses outright ("File seems to be binary and
   * cannot be opened as text"), and asked for a PNG it ignores the
   * `computor.imagePreview` association, because editor associations apply to
   * the `vscode.open` command alone.
   *
   * Going through the command rather than calling `openFile` directly also
   * gets the Documents tree the click behaviour every other Computor tree has:
   * a single click previews, a second one pins (computor-org/issues#319).
   * Hardcoding `preview: false` here used to pin every file on first click.
   */
  private async openFile(item: any): Promise<void> {
    if (!(item instanceof DocumentsFileItem)) { return; }
    const { scope, entry } = item;
    const localPath = entry.local && entry.state !== 'remote-only'
      ? entry.local.absPath
      : await this.pullToMirror(scope, entry.relativePath);
    if (localPath) {
      await vscode.commands.executeCommand(OPEN_FILE_COMMAND, vscode.Uri.file(localPath));
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

  // ----- The lecturer's own computer -----

  /**
   * Hand a document — or a whole folder, zipped — to the machine the lecturer
   * is sitting at.
   *
   * Everything else in this view moves bytes between the backend and the
   * workspace mirror, and under code-server that mirror is still the *server's*
   * disk. So a lecturer whose source material is a Keynote deck on their laptop
   * had no way out and no way in (computor-org/issues#361). This is the way
   * out; `uploadFromComputer` is the way in. On desktop VS Code the save dialog
   * already reaches the real machine, so it is used there.
   */
  private async downloadToComputer(item: any): Promise<void> {
    const target = this.resolveDownloadTarget(item);
    if (!target) {
      notify.warning('Select a document, a folder, or a course to download.');
      return;
    }

    try {
      const payload = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: target.isDirectory
          ? `Collecting "${target.label}"…`
          : `Preparing "${target.label}"…`,
        cancellable: false
      }, () => target.isDirectory
        ? this.buildDirectoryArchive(target.scope, target.relativePath)
        : this.readDocumentBytes(target.scope, target.relativePath));

      if (!payload) { return; }

      if (vscode.env.uiKind === vscode.UIKind.Web) {
        const handed = await downloadBytesInBrowser(
          this.context.extensionUri,
          payload.name,
          payload.contents,
          payload.mimeType
        );
        if (!handed) {
          notify.warning(
            `"${payload.name}" is too large to hand to the browser. Open it from the ` +
            'workspace mirror instead.'
          );
        }
        return;
      }

      const destination = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(payload.name),
        saveLabel: 'Save'
      });
      if (!destination) { return; }
      await fs.promises.writeFile(destination.fsPath, payload.contents);
      notify.info(`Saved ${payload.name}.`);
    } catch (err: any) {
      notify.error(`Failed to download: ${err?.message || err}`);
    }
  }

  /** What a download command was invoked on, if it was anything downloadable. */
  private resolveDownloadTarget(item: any):
    { scope: DocumentScope; relativePath: string; isDirectory: boolean; label: string } | undefined {
    if (item instanceof DocumentsFileItem) {
      return {
        scope: item.scope,
        relativePath: item.entry.relativePath,
        isDirectory: false,
        label: item.entry.name
      };
    }
    if (item instanceof DocumentsDirectoryItem) {
      return {
        scope: item.scope,
        relativePath: item.entry.relativePath,
        isDirectory: true,
        label: item.entry.name
      };
    }
    if (item instanceof DocumentsOrgItem) {
      return { scope: item.scope, relativePath: '', isDirectory: true, label: item.organization.path };
    }
    if (item instanceof DocumentsCourseFamilyItem) {
      return { scope: item.scope, relativePath: '', isDirectory: true, label: item.courseFamily.path };
    }
    if (item instanceof DocumentsCourseItem) {
      return { scope: item.scope, relativePath: '', isDirectory: true, label: item.course.path };
    }
    return undefined;
  }

  /** The current bytes of one document, straight from the backend. */
  private async readDocumentBytes(
    scope: DocumentScope,
    relativePath: string
  ): Promise<{ name: string; contents: Buffer; mimeType: string }> {
    const bytes = await this.api.downloadDocument(scope.scope, scope.scopeId ?? null, relativePath);
    const name = relativePath.split('/').pop() || 'document';
    return { name, contents: Buffer.from(bytes), mimeType: mimeTypeFor(name) };
  }

  /**
   * Zip a documents subtree by walking the backend's listings. The mirror is
   * deliberately not used as the source: it holds only what happens to have
   * been pulled, so an archive built from it would silently omit everything the
   * lecturer never opened.
   */
  private async buildDirectoryArchive(
    scope: DocumentScope,
    relativePath: string
  ): Promise<{ name: string; contents: Buffer; mimeType: string } | undefined> {
    const zip = new JSZip();
    let fileCount = 0;

    const walk = async (dirPath: string): Promise<void> => {
      const entries = await this.api.listDocuments(scope.scope, scope.scopeId ?? null, dirPath);
      for (const entry of entries) {
        const childPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
        if (entry.type === 'directory') {
          await walk(childPath);
          continue;
        }
        const bytes = await this.api.downloadDocument(scope.scope, scope.scopeId ?? null, childPath);
        const within = relativePath && childPath.startsWith(`${relativePath}/`)
          ? childPath.slice(relativePath.length + 1)
          : childPath;
        zip.file(within, Buffer.from(bytes));
        fileCount += 1;
      }
    };

    await walk(relativePath);

    if (fileCount === 0) {
      notify.info('That folder has no documents to download.');
      return undefined;
    }

    const base = relativePath.split('/').pop() || scope.scope;
    const contents = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { name: `${base}.zip`, contents, mimeType: 'application/zip' };
  }

  /**
   * Take files (or a folder) off the lecturer's machine, into the mirror and
   * straight on to the backend — which is the same thing as publishing them,
   * since the store the upload writes to is the one the web server serves.
   */
  private async uploadFromComputer(item: any, options: { folder: boolean }): Promise<void> {
    const target = this.resolveTarget(item);
    if (!target) {
      notify.warning('Right-click an organization, course family, course, or folder to upload into it.');
      return;
    }

    const picked = vscode.env.uiKind === vscode.UIKind.Web
      ? await pickFilesFromBrowser(this.context.extensionUri, {
        folder: options.folder,
        title: options.folder ? 'Upload a folder' : 'Upload files'
      })
      : await this.pickFilesFromDisk(options.folder);

    if (picked.length === 0) { return; }

    let succeeded = 0;
    const failures: string[] = [];
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Uploading ${picked.length} file${picked.length === 1 ? '' : 's'}…`,
      cancellable: false
    }, async (progress) => {
      let index = 0;
      for (const file of picked) {
        index += 1;
        progress.report({
          increment: (1 / picked.length) * 100,
          message: `${index}/${picked.length} · ${file.relativePath}`
        });

        const relative = normalizeUploadPath(file.relativePath);
        if (!relative) {
          failures.push(`${file.relativePath} (unusable name)`);
          continue;
        }
        const destination = target.parentPath ? `${target.parentPath}/${relative}` : relative;

        try {
          await this.api.uploadDocument(
            target.scope.scope,
            target.scope.scopeId ?? null,
            destination,
            file.contents
          );
          const idx = destination.lastIndexOf('/');
          const parent = idx >= 0 ? destination.slice(0, idx) : '';
          const listing = await this.api.listDocuments(target.scope.scope, target.scope.scopeId ?? null, parent);
          const remote = listing.find(e => e.name === destination.split('/').pop() && e.type === 'file');
          await this.tree.cache.writePulled(target.scope, destination, file.contents, remote?.last_modified);
          succeeded += 1;
        } catch (err: any) {
          failures.push(`${relative} (${err?.message || err})`);
        }
      }
    });

    this.tree.invalidateDirectory(target.scope, target.parentPath);

    if (failures.length === 0) {
      notify.info(`Uploaded ${succeeded} file${succeeded === 1 ? '' : 's'}. They are live at /docs.`);
    } else {
      notify.warning(
        `Uploaded ${succeeded} of ${picked.length}. Failed: ${failures.slice(0, 5).join('; ')}` +
        `${failures.length > 5 ? `; and ${failures.length - 5} more` : ''}`
      );
    }
  }

  /** Desktop VS Code: the open dialog already browses the lecturer's machine. */
  private async pickFilesFromDisk(folder: boolean): Promise<PickedFile[]> {
    const chosen = await vscode.window.showOpenDialog({
      canSelectFiles: !folder,
      canSelectFolders: folder,
      canSelectMany: !folder,
      openLabel: folder ? 'Upload folder' : 'Upload'
    });
    if (!chosen || chosen.length === 0) { return []; }

    const collected: PickedFile[] = [];
    const addFile = async (absPath: string, relativePath: string): Promise<void> => {
      collected.push({ relativePath, contents: await fs.promises.readFile(absPath) });
    };

    for (const uri of chosen) {
      const stat = await fs.promises.stat(uri.fsPath);
      if (!stat.isDirectory()) {
        await addFile(uri.fsPath, path.basename(uri.fsPath));
        continue;
      }
      const base = path.basename(uri.fsPath);
      const walk = async (dir: string, prefix: string): Promise<void> => {
        for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
          const child = path.join(dir, entry.name);
          const rel = `${prefix}/${entry.name}`;
          if (entry.isDirectory()) {
            await walk(child, rel);
          } else if (entry.isFile()) {
            await addFile(child, rel);
          }
        }
      };
      await walk(uri.fsPath, base);
    }
    return collected;
  }

  /**
   * The URL an assignment can link to. Uploading already publishes — the store
   * the API writes into is the directory the static server exposes at `/docs` —
   * but nothing in the tree ever showed the address, which is what a lecturer
   * actually needs from this view (computor-org/issues#361).
   */
  private async copyPublicUrl(item: any): Promise<void> {
    if (!(item instanceof DocumentsFileItem || item instanceof DocumentsDirectoryItem)) { return; }
    const segments = this.tree.scopePathSegments(item.scope);
    if (!segments) {
      notify.warning('Expand this document\'s course first, so its address can be resolved.');
      return;
    }

    let origin: string;
    try {
      const base = await new ComputorSettingsManager(this.context).getBaseUrl();
      origin = new URL(base).origin;
    } catch {
      notify.warning('No backend URL is configured, so the public address cannot be built.');
      return;
    }

    const url = buildPublicDocumentUrl(origin, segments, item.entry.relativePath);

    await copyToClipboard(url, 'Document URL', `Public URL: ${url}`);
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
    await revealUri(vscode.Uri.file(absPath));
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
      await openInEditor(localPath, { preview: false });
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

    // A published document can be linked from any number of assignments, and
    // the backend deletes a directory with a plain rmtree — no trash, no
    // history, nothing to undo it with. A folder delete therefore has to be
    // typed out, the way deleting an entity in the course tree is
    // (computor-org/issues#361).
    if (entry.type === 'directory' && entry.state !== 'local-only') {
      const typed = await vscode.window.showInputBox({
        title: `Delete folder "${entry.name}"`,
        prompt: `This permanently removes the folder and everything inside it, for everyone, and any assignment linking to those documents will break. There is no undo. Type "${entry.name}" to confirm.`,
        ignoreFocusOut: true,
        validateInput: (value) => value === entry.name || value.length === 0
          ? undefined
          : `Type "${entry.name}" exactly, or leave empty to cancel.`
      });
      if (typed !== entry.name) { return; }
    } else {
      const choice = await notify.confirm(
        `Delete ${kind} "${entry.relativePath}"?${entry.type === 'directory' ? ' This removes everything inside it.' : ''}` +
        (entry.state === 'local-only' ? '' : ' It disappears for everyone, and any assignment linking to it will break.'),
        'Delete'
      );
      if (!choice) { return; }
    }
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
    await revealUri(vscode.Uri.file(root));
  }

  /** Validates a single path segment for the file/folder name inputs. */
  private readonly validateRelativeSegment = (value: string): string | undefined =>
    validateSegment(value);
}
