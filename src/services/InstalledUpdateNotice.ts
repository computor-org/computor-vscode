import * as fs from 'fs';
import * as vscode from 'vscode';
import semver from 'semver';
import { notify } from '../utils/notify';

/**
 * A Coder workspace brings this extension up to the version its instance has
 * approved, in place, while the editor is open (computor-backend
 * ops/coder/templates/README.md, "Extension updates"). The running window keeps
 * the old code until it reloads, so the installer records the new version in
 * the file named by COMPUTOR_EXTENSION_UPDATE_MARKER and this offers the
 * reload. It never reloads by itself: the student may be in the middle of
 * something.
 */
export const reloadAction = 'Reload Window';

/** The installed version when it is newer than the running one, else undefined. */
export function readInstalledUpdate(markerPath: string, runningVersion: string): string | undefined {
  try {
    const installed = semver.valid(JSON.parse(fs.readFileSync(markerPath, 'utf8')).version);
    const running = semver.coerce(runningVersion);
    return installed && running && semver.gt(installed, running) ? installed : undefined;
  } catch {
    return undefined;
  }
}

export function watchInstalledUpdates(
  markerPath: string | undefined,
  runningVersion: string,
  intervalMs = 30_000
): vscode.Disposable {
  if (!markerPath) {
    return { dispose: () => undefined };
  }
  let offered: string | undefined;
  const check = (): void => {
    const version = readInstalledUpdate(markerPath, runningVersion);
    if (!version || version === offered) {
      return;
    }
    offered = version;
    void notify
      .info(`Computor ${version} has been installed. Reload the window to start using it.`, reloadAction)
      .then((choice) => {
        if (choice === reloadAction) {
          void vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
  };
  // Polling stat, not fs.watch: the marker may not exist yet, and /tmp in a
  // container is not always backed by inotify-friendly storage.
  fs.watchFile(markerPath, { interval: intervalMs, persistent: false }, check);
  check();
  return { dispose: () => fs.unwatchFile(markerPath, check) };
}
