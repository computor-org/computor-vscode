import * as fs from 'fs';
import * as path from 'path';

/**
 * When the extension is allowed to wake up, and how it recognises a Computor
 * workspace once it has.
 *
 * The extension used to declare `onStartupFinished`, so every VS Code window on
 * the machine loaded it — and any window whose folder carried a `.computor`
 * marker went straight on to probe the backend, restore a session, connect a
 * websocket and put status items in the bar, whether or not the person had come
 * to do Computor work (computor-org/issues#258).
 *
 * The marker is the gate now. A folder without one never activates the
 * extension at all: no icons, no watchers, no traffic. A folder with one is a
 * Computor workspace by definition — the Coder templates `touch` it next to the
 * injected `COMPUTOR_AUTH_TOKEN` — so there it comes up connected exactly as
 * before.
 *
 * Everything else still reaches the extension through VS Code's implicit
 * activation for contributed commands, views and custom editors (generated
 * since 1.74, which is the engine floor in package.json). `Computor: Login`,
 * offline mode and the settings view therefore keep working in a plain folder,
 * on the one condition that the user asked for them.
 */

/** The file a Computor workspace carries at its root. */
export const COMPUTOR_MARKER = '.computor';

/**
 * The activation event package.json has to declare. Derived from the marker so
 * the two cannot drift apart: renaming the marker without renaming the event
 * would leave the extension permanently asleep, and nothing at runtime would
 * say so.
 */
export const MARKER_ACTIVATION_EVENT = `workspaceContains:${COMPUTOR_MARKER}`;

/**
 * The marker file of the first workspace folder that has one, or undefined.
 *
 * Scans *every* folder, not just the first. `workspaceContains` fires when any
 * folder in a multi-root workspace matches, so looking only at folder #1 — as
 * the old startup check did — could wake the extension and then find nothing.
 *
 * `fileExists` is injectable for tests; it is `fs.existsSync` in production.
 */
export function findComputorMarker(
  roots: readonly string[],
  fileExists: (file: string) => boolean = fs.existsSync
): string | undefined {
  for (const root of roots) {
    const marker = path.join(root, COMPUTOR_MARKER);
    if (fileExists(marker)) return marker;
  }
  return undefined;
}
