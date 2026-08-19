import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { commandRegistrar } from './commandHelpers';
import { notify } from '../utils/notify';
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
  moveEntry,
  renameEntry,
  uniqueName,
  validateSegment
} from '../utils/studentFsOperations';

/** Set while an entry is on the clipboard, so Paste can be hidden otherwise. */
const CLIPBOARD_CONTEXT_KEY = 'computor.student.fs.hasClipboard';

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
    register('computor.student.fs.delete', async (item: any) => {
      await this.delete(item);
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
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target.path));
    });
    register('computor.student.fs.copyPath', async (item: any) => {
      const target = this.resolveAnyPath(item);
      if (!target) { return; }
      await vscode.env.clipboard.writeText(target.path);
    });
    register('computor.student.fs.copyRelativePath', async (item: any) => {
      const target = this.resolveAnyPath(item);
      if (!target) { return; }
      const relative = path.relative(target.root, target.path);
      await vscode.env.clipboard.writeText(relative || path.basename(target.path));
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
      if (dir) { return { dir, root: dir, refresh: item }; }
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
    const confirmed = await notify.confirm(
      `Delete ${entry.isDirectory ? 'folder' : 'file'} "${name}"?`,
      'Delete',
      entry.isDirectory ? 'This removes everything inside it.' : undefined
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
}
