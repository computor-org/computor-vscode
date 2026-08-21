import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { commandRegistrar } from './commandHelpers';
import { copyToClipboard } from '../utils/clipboard';
import { notify } from '../utils/notify';
import { revealUri } from '../utils/reveal';
import { openFile } from '../ui/editorLayout';
import type { StudentCourseContentTreeProvider } from '../ui/tree/student/StudentCourseContentTreeProvider';
import {
  copyEntry,
  createFile,
  createFolder,
  deleteEntry,
  findRepoRoot,
  isProtectedName,
  isReservedAtAssignmentRoot,
  isWithinRoot,
  moveEntry,
  renameEntry,
  uniqueName,
  validateSegment
} from '../utils/studentFsOperations';

/** Set while an entry is on the clipboard, so Paste can be hidden otherwise. */
const CLIPBOARD_CONTEXT_KEY = 'computor.student.fs.hasClipboard';

/** How deep Copy/Move To looks for destination folders. Assignments are small;
 *  this only keeps a pathological tree from stalling the quick pick. */
const MAX_DESTINATION_DEPTH = 6;

/** A directory a New/Paste can write into, plus the root that bounds it. */
interface Container {
  dir: string;
  root: string;
  /** Tree node to re-render once the directory's contents change. */
  refresh?: any;
}

/** An existing entry a Rename/Delete/Duplicate/Cut/Copy acts on. */
interface Entry {
  path: string;
  isDirectory: boolean;
  root: string;
  refresh?: any;
}

/**
 * Ordinary filesystem actions for the student tree.
 *
 * The tree already lists a cloned assignment's files; these commands make those
 * rows editable without leaving the view. Nodes are duck-typed rather than
 * `instanceof`-checked because the provider's item classes are module-private
 * (the same approach `StudentCommands` takes for `getRepositoryPath`).
 *
 * Every mutation is bounded by a root directory the student owns — the
 * repository a file row came from, or the assignment folder — and the
 * primitives in `studentFsOperations` enforce that bound plus the `.git` guard.
 */
export class StudentFileCommands {
  /** Single-entry: the student view is single-select (`canSelectMany` is off). */
  private clipboard: { path: string; root: string; op: 'copy' | 'cut' } | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly treeDataProvider: StudentCourseContentTreeProvider
  ) {}

  registerCommands(): void {
    const register = commandRegistrar(this.context);

    register('computor.student.fs.newFile', async (item: any) => {
      await this.createEntry(item, false);
    });
    register('computor.student.fs.newFolder', async (item: any) => {
      await this.createEntry(item, true);
    });
    register('computor.student.fs.rename', async (item: any) => {
      await this.rename(item);
    });
    // Two ids for one operation, so the menu entries can read "Delete File"
    // and "Delete Folder": a menu contribution cannot override a command's
    // title, and "Delete" alone was not what the issue asked for.
    register('computor.student.fs.deleteFile', async (item: any) => {
      await this.delete(item);
    });
    register('computor.student.fs.deleteFolder', async (item: any) => {
      await this.delete(item);
    });
    register('computor.student.fs.copyTo', async (item: any) => {
      await this.transferTo(item, 'copy');
    });
    register('computor.student.fs.moveTo', async (item: any) => {
      await this.transferTo(item, 'move');
    });
    register('computor.student.fs.duplicate', async (item: any) => {
      await this.duplicate(item);
    });
    register('computor.student.fs.cut', async (item: any) => {
      await this.stash(item, 'cut');
    });
    register('computor.student.fs.copy', async (item: any) => {
      await this.stash(item, 'copy');
    });
    register('computor.student.fs.paste', async (item: any) => {
      await this.paste(item);
    });
    register('computor.student.fs.revealInOS', async (item: any) => {
      const target = this.resolveAnyPath(item);
      if (!target) { return; }
      await revealUri(vscode.Uri.file(target.path));
    });
    register('computor.student.fs.copyPath', async (item: any) => {
      const target = this.resolveAnyPath(item);
      if (!target) {
        void notify.warning('This item has no path on disk yet.');
        return;
      }
      await copyToClipboard(target.path, 'Path');
    });
    register('computor.student.fs.copyRelativePath', async (item: any) => {
      const target = this.resolveAnyPath(item);
      if (!target) {
        void notify.warning('This item has no path on disk yet.');
        return;
      }
      const relative = path.relative(target.root, target.path);
      await copyToClipboard(relative || path.basename(target.path), 'Relative path');
    });
  }

  // --- node resolution -----------------------------------------------------

  /** True for the provider's FileSystemItem rows. Duck-typed rather than
   *  `instanceof vscode.Uri`, which is unreliable across module realms. */
  private isFsItem(item: any): boolean {
    return !!item && typeof item.uri?.fsPath === 'string' && typeof item.type === 'number';
  }

  /**
   * The bounding root for a filesystem row. Prefers the root threaded through
   * by the tree; falls back to walking for `.git` so a row from any other
   * listing path still gets a bound rather than none.
   */
  private rootForFsItem(item: any): string | undefined {
    return item.repoRoot || findRepoRoot(item.uri.fsPath);
  }

  /** The directory a New/Paste lands in. */
  private resolveContainer(item: any): Container | undefined {
    if (this.isFsItem(item)) {
      const root = this.rootForFsItem(item);
      if (!root) { return undefined; }
      if (item.type === vscode.FileType.Directory) {
        return { dir: item.uri.fsPath, root, refresh: item };
      }
      // A file row means "next to this file".
      return { dir: path.dirname(item.uri.fsPath), root, refresh: item.parent };
    }
    // Assignment row: bounded by the assignment folder. Course and unit rows
    // deliberately have no filesystem actions — they are logical groupings and
    // the tree never lists their directories, so anything created there would be
    // invisible.
    if (typeof item?.getRepositoryPath === 'function') {
      const dir = item.getRepositoryPath();
      // Bound by the REPOSITORY, not the assignment folder: file rows are
      // bounded that way too, and a mismatch made Copy Relative Path answer a
      // bare basename on the assignment row and a repo-relative path one level
      // down (computor-org/issues#353).
      if (dir) { return { dir, root: findRepoRoot(dir) ?? dir, refresh: item }; }
    }
    return undefined;
  }

  /** The existing entry a Rename/Delete/Duplicate/Cut/Copy acts on. */
  private resolveEntry(item: any): Entry | undefined {
    if (!this.isFsItem(item)) { return undefined; }
    const root = this.rootForFsItem(item);
    if (!root) { return undefined; }
    return {
      path: item.uri.fsPath,
      isDirectory: item.type === vscode.FileType.Directory,
      root,
      refresh: item.parent
    };
  }

  /** Any node that has a path worth revealing or copying. */
  private resolveAnyPath(item: any): { path: string; root: string } | undefined {
    const entry = this.resolveEntry(item);
    if (entry) { return { path: entry.path, root: entry.root }; }
    const container = this.resolveContainer(item);
    return container ? { path: container.dir, root: container.root } : undefined;
  }

  // --- operations ----------------------------------------------------------

  private async createEntry(item: any, isDirectory: boolean): Promise<void> {
    const target = this.resolveContainer(item);
    if (!target) {
      void notify.error('This item has no folder on disk yet.');
      return;
    }

    const name = await vscode.window.showInputBox({
      title: isDirectory ? 'New Folder' : 'New File',
      prompt: `Name of the new ${isDirectory ? 'folder' : 'file'}`,
      placeHolder: isDirectory ? 'e.g. src' : 'e.g. solution.py',
      ignoreFocusOut: true,
      validateInput: value => this.validateNewName(value, target.dir, target.root)
    });
    if (!name) { return; }

    const created = isDirectory
      ? createFolder(target.root, target.dir, name)
      : createFile(target.root, target.dir, name);

    this.treeDataProvider.refreshNode(target.refresh);
    if (!isDirectory) {
      await openFile(vscode.Uri.file(created), { preview: false });
    }
  }

  /**
   * Name check for the input box. Beyond the generic segment rules, the
   * backend-owned description assets are refused at an assignment root — the
   * tree hides them there, so a colliding "New File" would silently shadow one.
   */
  private validateNewName(value: string, dir: string, root: string): string | undefined {
    const base = validateSegment(value);
    if (base) { return base; }
    if (isProtectedName(value)) {
      return `"${value}" is managed by Computor.`;
    }
    if (dir === root && isReservedAtAssignmentRoot(value)) {
      return `"${value}" is managed by Computor.`;
    }
    if (fs.existsSync(path.join(dir, value))) {
      return `"${value}" already exists.`;
    }
    return undefined;
  }

  private async rename(item: any): Promise<void> {
    const entry = this.resolveEntry(item);
    if (!entry) { return; }

    const current = path.basename(entry.path);
    const parentDir = path.dirname(entry.path);
    const name = await vscode.window.showInputBox({
      title: 'Rename',
      prompt: `New name for "${current}"`,
      value: current,
      ignoreFocusOut: true,
      validateInput: value =>
        value === current ? undefined : this.validateNewName(value, parentDir, entry.root)
    });
    if (!name || name === current) { return; }

    renameEntry(entry.root, entry.path, name);
    this.treeDataProvider.refreshNode(entry.refresh);
  }

  private async delete(item: any): Promise<void> {
    const entry = this.resolveEntry(item);
    if (!entry) { return; }

    const name = path.basename(entry.path);
    const detail = [
      entry.isDirectory ? 'This removes everything inside it.' : undefined,
      'Anything that came from the course template can be brought back with "Update Repository from Template".'
    ].filter(Boolean).join(' ');
    const confirmed = await notify.confirm(
      `Delete ${entry.isDirectory ? 'folder' : 'file'} "${name}"?`,
      'Delete',
      detail
    );
    if (!confirmed) { return; }

    deleteEntry(entry.root, entry.path);
    this.treeDataProvider.refreshNode(entry.refresh);
  }

  private async duplicate(item: any): Promise<void> {
    const entry = this.resolveEntry(item);
    if (!entry) { return; }

    const dir = path.dirname(entry.path);
    const name = uniqueName(dir, path.basename(entry.path), entry.isDirectory);
    copyEntry(entry.root, entry.path, dir, { name });
    this.treeDataProvider.refreshNode(entry.refresh);
  }

  private async stash(item: any, op: 'copy' | 'cut'): Promise<void> {
    const entry = this.resolveEntry(item);
    if (!entry) { return; }
    this.clipboard = { path: entry.path, root: entry.root, op };
    await vscode.commands.executeCommand('setContext', CLIPBOARD_CONTEXT_KEY, true);
  }

  private async clearClipboard(): Promise<void> {
    this.clipboard = undefined;
    await vscode.commands.executeCommand('setContext', CLIPBOARD_CONTEXT_KEY, false);
  }

  private async paste(item: any): Promise<void> {
    const pending = this.clipboard;
    if (!pending) { return; }

    const target = this.resolveContainer(item);
    if (!target) { return; }

    if (!fs.existsSync(pending.path)) {
      await this.clearClipboard();
      void notify.error(`"${path.basename(pending.path)}" no longer exists.`);
      return;
    }

    const name = path.basename(pending.path);
    let finalName = name;
    let overwrite = false;

    if (fs.existsSync(path.join(target.dir, name))) {
      // A cut back into the same folder is a no-op, not a collision.
      if (pending.op === 'cut' && path.dirname(pending.path) === target.dir) {
        await this.clearClipboard();
        return;
      }
      const choice = await notify.modal(
        'warning',
        `"${name}" already exists here.`,
        { actions: ['Keep Both', 'Overwrite'] }
      );
      if (choice === 'Keep Both') {
        finalName = uniqueName(target.dir, name, fs.statSync(pending.path).isDirectory());
      } else if (choice === 'Overwrite') {
        overwrite = true;
      } else {
        return;
      }
    }

    if (pending.op === 'cut') {
      moveEntry(target.root, pending.path, target.dir, {
        overwrite,
        name: finalName,
        srcRoot: pending.root
      });
      await this.clearClipboard();
    } else {
      copyEntry(target.root, pending.path, target.dir, { overwrite, name: finalName });
    }

    this.treeDataProvider.refreshNode(target.refresh);
  }

  /**
   * One-step Copy File… / Move File…: pick a destination folder inside the
   * same assignment and act, with no clipboard round trip. The issue asked for
   * actions that "just work locally in the pertinent assignment"
   * (computor-org/issues#353); Cut/Copy/Paste stays for anyone who prefers it.
   */
  private async transferTo(item: any, op: 'copy' | 'move'): Promise<void> {
    const entry = this.resolveEntry(item);
    if (!entry) {
      void notify.warning('Select a file or folder inside an assignment first.');
      return;
    }

    const assignmentRoot = this.assignmentRootFor(item) ?? entry.root;
    const choices = this.destinationChoices(assignmentRoot, entry);
    if (choices.length === 0) {
      void notify.info('This assignment has no other folder to move into yet. Create one with "New Folder…" first.');
      return;
    }

    const name = path.basename(entry.path);
    const picked = await vscode.window.showQuickPick(choices, {
      title: op === 'copy' ? `Copy "${name}" to…` : `Move "${name}" to…`,
      placeHolder: 'Destination folder in this assignment',
      ignoreFocusOut: true
    });
    if (!picked) { return; }

    let finalName = name;
    let overwrite = false;
    if (fs.existsSync(path.join(picked.dir, name))) {
      const choice = await notify.modal(
        'warning',
        `"${name}" already exists in the destination.`,
        { actions: ['Keep Both', 'Overwrite'] }
      );
      if (choice === 'Keep Both') {
        finalName = uniqueName(picked.dir, name, entry.isDirectory);
      } else if (choice === 'Overwrite') {
        overwrite = true;
      } else {
        return;
      }
    }

    if (op === 'move') {
      moveEntry(entry.root, entry.path, picked.dir, {
        overwrite,
        name: finalName,
        srcRoot: entry.root
      });
    } else {
      copyEntry(entry.root, entry.path, picked.dir, { overwrite, name: finalName });
    }

    // Both ends of the tree changed and the destination node may not even be
    // rendered, so this is the one filesystem action that refreshes wholesale.
    this.treeDataProvider.refreshNode(undefined);
  }

  /**
   * The assignment folder that owns `item`, found by walking the tree parents
   * up to the row that can answer `getRepositoryPath`. `FileSystemItem` carries
   * only the repository root, and the repository holds every assignment in the
   * course — bounding a destination pick by it would let a student move work
   * into a different assignment.
   */
  private assignmentRootFor(item: any): string | undefined {
    let node = item;
    for (let hops = 0; node && hops < 64; hops++) {
      if (typeof node.getRepositoryPath === 'function') {
        const dir = node.getRepositoryPath();
        if (dir) { return dir; }
      }
      node = node.parent;
    }
    return undefined;
  }

  /** Folders under `root` that `entry` may be copied or moved into. */
  private destinationChoices(
    root: string,
    entry: Entry
  ): Array<vscode.QuickPickItem & { dir: string }> {
    const found: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > MAX_DESTINATION_DEPTH) { return; }
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (name.startsWith('.')) { continue; }
        const abs = path.join(dir, name);
        try {
          if (!fs.statSync(abs).isDirectory()) { continue; }
        } catch {
          continue;
        }
        found.push(abs);
        walk(abs, depth + 1);
      }
    };
    walk(root, 1);

    const currentDir = path.dirname(entry.path);
    return [root, ...found]
      .filter(dir => dir !== currentDir)
      // A folder can neither contain itself nor land inside its own subtree.
      .filter(dir => !(entry.isDirectory && isWithinRoot(entry.path, dir)))
      .map(dir => ({
        label: dir === root ? '$(root-folder) Assignment root' : `$(folder) ${path.relative(root, dir)}`,
        dir
      }));
  }
}
