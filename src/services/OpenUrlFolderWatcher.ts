import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export const DEFAULT_OPEN_URL_DIR = '/tmp/computor-open-urls';

/**
 * The folder to watch for URL-open requests, or undefined when this is not a
 * workspace that publishes them. Same gating as the figures folder: an env
 * override always wins; the default path only counts if it already exists,
 * so a lecturer's own machine is left alone.
 */
export function resolveOpenUrlDirectory(): string | undefined {
  const configured = (process.env.COMPUTOR_OPEN_URL_DIR ?? '').trim();
  if (configured) {
    return configured;
  }
  return fs.existsSync(DEFAULT_OPEN_URL_DIR) ? DEFAULT_OPEN_URL_DIR : undefined;
}

/**
 * Opens URLs that programs inside the workspace ask for.
 *
 * A container has no browser, so MATLAB's `doc` (and anything else that
 * wants "the system browser") runs the computor-open shim instead, which
 * drops the URL as a file into this folder (computor-org/issues#312). Each
 * file is opened through vscode.env.openExternal — the one channel that
 * reliably reaches the student's real browser under code-server — and then
 * deleted.
 *
 * Only http(s) URLs are honored: the folder is writable by anything in the
 * container, and openExternal on e.g. file: or vscode: URIs would be a
 * gadget, not a feature.
 */
export class OpenUrlFolderWatcher implements vscode.Disposable {
  private watcher: fs.FSWatcher | undefined;
  private readonly handled = new Set<string>();

  constructor(private readonly directory: string) {}

  start(): void {
    // Requests from before this window are stale: opening a pile of tabs on
    // reload helps nobody. Clear them without opening.
    try {
      for (const name of fs.readdirSync(this.directory)) {
        fs.rmSync(path.join(this.directory, name), { force: true });
      }
    } catch {
      /* the folder may not exist yet; the watch below will just fail too */
    }

    try {
      this.watcher = fs.watch(this.directory, (_event, filename) => {
        if (filename) {
          void this.handleFile(String(filename));
        }
      });
    } catch (error) {
      console.warn('[OpenUrlFolderWatcher] could not watch', this.directory, error);
    }
  }

  private async handleFile(filename: string): Promise<void> {
    const filePath = path.join(this.directory, filename);
    // fs.watch fires more than once per file (create + write); open once.
    if (this.handled.has(filePath)) {
      return;
    }
    this.handled.add(filePath);
    // The set only tracks in-flight names; the shim never reuses a filename.
    setTimeout(() => this.handled.delete(filePath), 5000);

    let url: string;
    try {
      // Tiny file written in one go by the shim; a short delay covers the
      // create-then-write race without inotify gymnastics.
      await new Promise((resolve) => setTimeout(resolve, 50));
      url = (await fs.promises.readFile(filePath, 'utf8')).trim();
    } catch {
      return;
    }
    fs.rm(filePath, { force: true }, () => {});

    if (!/^https?:\/\//i.test(url)) {
      return;
    }
    try {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      console.warn('[OpenUrlFolderWatcher] openExternal failed for', url, error);
    }
  }

  dispose(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }
}

/** Wire up the URL-open watcher, if this workspace publishes URL requests. */
export function registerOpenUrlWatcher(context: vscode.ExtensionContext): void {
  const directory = resolveOpenUrlDirectory();
  if (!directory) {
    return;
  }
  const watcher = new OpenUrlFolderWatcher(directory);
  context.subscriptions.push(watcher);
  watcher.start();
}
