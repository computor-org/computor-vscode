import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Which editor group a thing belongs in.
 *
 * A Computor workspace has a two-column shape: the tree on the left, the file
 * you are editing in the first group, and everything you are *looking at while*
 * editing — figures, the README, an image — in the second. Students rely on it,
 * because a plot appearing must not push their code off screen.
 *
 * Nothing used to say so. Every file-open site passed no column at all, which
 * means "the active group", and the auxiliary surfaces asked for
 * `ViewColumn.Beside`, which means "one to the right of the active group".
 * Both are relative, so the layout drifted as soon as focus moved: click a
 * figure, then open a file from the tree, and the file landed on top of the
 * figure (computor-org/issues#286). `Beside` computed while the figure had
 * focus was worse still — it opened a third group.
 *
 * So the columns are absolute here, and every open site goes through this
 * module. The rule is about the *surface*, not only the file: a markdown
 * preview is auxiliary because it is a preview, while a .md file opened to be
 * edited is source like any other.
 */

/** Files being edited. The first group right of the tree. */
export const SOURCE_COLUMN = vscode.ViewColumn.One;

/** Figures, previews, images — things you look at while editing. */
export const AUX_COLUMN = vscode.ViewColumn.Two;

/**
 * Make sure the auxiliary group exists before a webview panel opens into it.
 *
 * VS Code quietly discards a webview panel's requested column when there is
 * exactly one editor group and it is empty (MainThreadWebviewPanels
 * getTargetGroupFromShowOptions), so a README or the Figures panel opened
 * before any source file landed in group 1 — and stayed there. Text documents
 * do not need this: their open path creates missing groups on its own.
 *
 * setEditorLayout keeps the currently active group active, so this does not
 * steal focus; the guard leaves any richer user layout alone.
 */
export async function ensureAuxColumn(): Promise<void> {
  // Optional chaining: hosts without the tabGroups API (tests) just skip.
  const groupCount = vscode.window.tabGroups?.all?.length ?? 2;
  if (groupCount >= 2) {
    return;
  }
  await vscode.commands.executeCommand('vscode.setEditorLayout', {
    orientation: 0,
    groups: [{}, {}]
  });
}

/**
 * Images are figures. A student's plot arrives as a PNG, and the workspace
 * templates map these extensions to the `computor.imagePreview` editor via
 * `workbench.editorAssociations`, so opening one is the same gesture as
 * opening the Figures panel and belongs in the same place.
 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.jpe', '.gif', '.bmp', '.ico', '.webp', '.avif', '.svg'
]);

/** The group a file belongs in, from its path. */
export function columnFor(uri: vscode.Uri | string): vscode.ViewColumn {
  const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
  return IMAGE_EXTENSIONS.has(path.extname(fsPath).toLowerCase()) ? AUX_COLUMN : SOURCE_COLUMN;
}

/** Show options for a file, with its column filled in. */
export function showOptions(
  uri: vscode.Uri | string,
  extra?: vscode.TextDocumentShowOptions
): vscode.TextDocumentShowOptions {
  return { ...extra, viewColumn: columnFor(uri) };
}

/**
 * Open a file in the group it belongs in.
 *
 * Routed through the `vscode.open` command rather than `showTextDocument` so
 * that editor associations still apply — an image has to reach the Computor
 * image preview, which is the only one that renders under code-server in
 * Safari and Firefox (computor-org/issues#282).
 *
 * `preview` is deliberately left alone unless a caller asks: `vscode.open`
 * follows the user's `workbench.editor.enablePreview` setting, and forcing it
 * would pin a tab for every file clicked in the tree. A single tree click is
 * therefore a preview; the command handler below turns a double click into
 * `preview: false` (computor-org/issues#319).
 */
export async function openFile(
  uri: vscode.Uri | string,
  extra?: vscode.TextDocumentShowOptions
): Promise<void> {
  const target = typeof uri === 'string' ? vscode.Uri.file(uri) : uri;
  await vscode.commands.executeCommand('vscode.open', target, showOptions(target, extra));
}

/** The command tree items bind to, so a click lands in the right group. */
export const OPEN_FILE_COMMAND = 'computor.openFile';

export function registerEditorLayout(context: vscode.ExtensionContext): void {
  let lastStudentOpen: { key: string; at: number } | undefined;
  context.subscriptions.push(vscode.commands.registerCommand('computor.student.openFile',
    (uri: vscode.Uri | string, extra?: vscode.TextDocumentShowOptions) => {
      const request = studentNavigationInvalidator?.();
      const key = typeof uri === 'string' ? uri : uri.toString();
      const at = Date.now();
      const pin = lastStudentOpen?.key === key && at - lastStudentOpen.at < 400;
      lastStudentOpen = { key, at };
      return openStudentFile(uri, pin ? { ...extra, preview: false } : extra, request ? () => request.isCurrent() : undefined);
    }));
  // Tree views have no double-click event — the item's command just fires once
  // per click. So the handler remembers the last file and time it saw, and a
  // second click on the same file within the double-click window reopens it
  // with `preview: false`: same tab, now pinned. Single click stays a preview
  // that the next click reuses; double click means "keep this one open"
  // (computor-org/issues#319). Keyed on the uri, not the tree item, because
  // the uri is the tab's identity and survives tree refreshes in between.
  const DOUBLE_CLICK_MS = 400;
  let lastOpen: { key: string; at: number } | undefined;
  context.subscriptions.push(
    vscode.commands.registerCommand(
      OPEN_FILE_COMMAND,
      async (uri: vscode.Uri | string, extra?: vscode.TextDocumentShowOptions) => {
        const target = typeof uri === 'string' ? vscode.Uri.file(uri) : uri;
        const key = target.toString();
        const now = Date.now();
        const pin = lastOpen?.key === key && now - lastOpen.at < DOUBLE_CLICK_MS;
        lastOpen = { key, at: now };
        await openFile(target, pin ? { ...extra, preview: false } : extra);
      }
    )
  );
}

/** A tree item's `command`, for a file that should open in its own group. */
export function openFileCommand(uri: vscode.Uri | string, title = 'Open File'): vscode.Command {
  return { command: OPEN_FILE_COMMAND, title, arguments: [uri] };
}

/** Desktop learner instructions sit beside code, sharing its group at narrow widths. */
export const LEARNER_READING_COLUMN = vscode.ViewColumn.Two;
let learnerNarrow = true;
let learnerLayoutManaged = false;
let learnerGeometryRevision = 0;
let lastStudentSource: vscode.Uri | undefined;
let studentNavigationInvalidator: (() => { isCurrent(): boolean } | void) | undefined;
const learnerReadingPanels = new Set<vscode.WebviewPanel>();

export function setStudentNavigationInvalidator(invalidate: () => { isCurrent(): boolean } | void): void {
  studentNavigationInvalidator = invalidate;
}

export function trackLearnerReadingPanel(panel: vscode.WebviewPanel): void {
  if (learnerReadingPanels.has(panel)) return;
  learnerReadingPanels.add(panel);
  panel.onDidDispose(() => learnerReadingPanels.delete(panel));
}
let learnerLayoutUpdate: Promise<void> = Promise.resolve();

/** Select the existing webview before a native move, which keeps its input pinned. */
async function moveLearnerReadingPanel(
  panel: vscode.WebviewPanel, isCurrent: () => boolean, isOwnerCurrent: () => boolean, restorePanel?: vscode.WebviewPanel
): Promise<boolean> {
  if (!isCurrent() || !learnerReadingPanels.has(panel)) return false;
  let canceled = false;
  let confirmed = false;
  let expectedPanel = panel;
  let finish!: (selected: boolean) => void;
  let stop!: () => void;
  const stopped = new Promise<void>(resolve => { stop = resolve; });
  const selected = new Promise<boolean>(resolve => { finish = resolve; });
  const subscriptions: vscode.Disposable[] = [];
  const cancel = () => { canceled = true; finish(false); stop(); };
  subscriptions.push(panel.onDidDispose(cancel));
  for (const reading of learnerReadingPanels) {
    subscriptions.push(reading.onDidChangeViewState(({ webviewPanel }) => {
      if (!webviewPanel.active) return;
      if (webviewPanel === expectedPanel) finish(true);
      else cancel();
    }));
  }
  subscriptions.push(vscode.window.onDidChangeActiveTextEditor?.(editor => { if (editor) cancel(); }) ?? { dispose() {} });
  // Missing native notifications must not strand the serialized layout queue.
  const timeout = setTimeout(cancel, 1000);
  try {
    // An already-active panel is itself authoritative native selection state.
    if (panel.active) finish(true);
    panel.reveal(panel.viewColumn, false);
    confirmed = await selected;
    if (!confirmed || canceled || !isCurrent() || !learnerReadingPanels.has(panel)) return false;
    await Promise.race([vscode.commands.executeCommand('moveActiveEditor', { to: 'position', by: 'group', value: LEARNER_READING_COLUMN }), stopped]);
    return !canceled && isCurrent() && learnerReadingPanels.has(panel);
  } finally {
    // A newer width can supersede our own selection. Restore its reading
    // owner so the admitted successor remains eligible, without moving input.
    if (confirmed && !canceled && !isCurrent() && isOwnerCurrent() && restorePanel && learnerReadingPanels.has(restorePanel)) {
      expectedPanel = restorePanel;
      const restored = new Promise<boolean>(resolve => { finish = resolve; });
      if (restorePanel.active) finish(true);
      restorePanel.reveal(restorePanel.viewColumn, false);
      await restored;
    }
    clearTimeout(timeout);
    subscriptions.forEach(subscription => subscription.dispose());
  }
}

/** Width comes from the visible intersection of our own reading webview. */
export function updateLearnerReadingWidth(
  width: number,
  isCurrent: () => boolean = () => true,
  isOwnerCurrent: () => boolean = isCurrent
): Promise<void> {
  if (!Number.isFinite(width) || width <= 0) return learnerLayoutUpdate;
  const revision = ++learnerGeometryRevision;
  learnerLayoutUpdate = learnerLayoutUpdate.catch(error => console.warn('[LearnerLayout]', error)).then(async () => {
    if (!isCurrent() || revision !== learnerGeometryRevision) return;
    const groups = vscode.window.tabGroups?.all;
    if (!groups || groups.length > 2) {
      learnerLayoutManaged = false;
      return;
    }
    const layout = await vscode.commands.executeCommand<{ orientation?: number; groups: Array<{ groups?: unknown[] }> }>('vscode.getEditorLayout');
    if (!isCurrent() || revision !== learnerGeometryRevision) return;
    if (!layout || (layout.orientation === 1 && groups.length === 2) || layout.groups.length !== groups.length
      || vscode.window.tabGroups.all.length !== groups.length || layout.groups.some(group => group.groups)) {
      learnerLayoutManaged = false;
      return;
    }
    learnerLayoutManaged = true;
    // A readable/code group needs 320px; 64px above the combined minimum
    // prevents a split immediately merging again after its own resize.
    if (groups.length === 1 && width >= 704) {
      // Split only once there is code for the left group. A fresh workspace
      // shows nothing but the course text, and splitting then moved it right
      // and left an empty group with the watermark beside it. Reading still
      // goes to the second column, so the next file open splits natively.
      if (groups[0]?.tabs?.some(hasFileInput)) {
        await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{}, {}] });
      }
      learnerNarrow = false;
    } else if (groups.length === 2) {
      // Adopt the existing simple learner layout, including saved user tabs.
      learnerNarrow = false;
      if (width < 320) {
        // Native applyLayout merges EditorInputs, retaining dirty buffers.
        await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{}] });
        learnerNarrow = true;
      }
    } else if (groups.length === 1) {
      learnerNarrow = true;
    }
    const activeReading = [...learnerReadingPanels].find(panel => panel.active);
    let readingPlacementChanged = false;
    // A split can report its new width before the first move settles. The
    // latest accepted observation completes placement in the simple layout.
    if (!learnerNarrow && lastStudentSource && isCurrent() && revision === learnerGeometryRevision
      && vscode.window.tabGroups.all.length === 2 && vscode.window.tabGroups.all[1]?.tabs?.some(tab =>
        (tab.input as { uri?: vscode.Uri })?.uri?.toString() === lastStudentSource?.toString())) {
      readingPlacementChanged = true;
      await placeStudentFile(lastStudentSource, { preview: false }, vscode.ViewColumn.One, () => isCurrent() && revision === learnerGeometryRevision);
    }
    // Moving every reading input right would empty a left group that holds
    // no code, which is the same empty group again.
    if (!learnerNarrow && vscode.window.tabGroups.all.length === 2
      && vscode.window.tabGroups.all[0]?.tabs?.some(hasFileInput)) {
      if (!isCurrent() || revision !== learnerGeometryRevision) return;
      // Move the existing reading inputs, including an inactive pinned Welcome.
      const panels = [...learnerReadingPanels].sort((a, b) => Number(a === activeReading) - Number(b === activeReading));
      for (const panel of panels) {
        if (!isOwnerCurrent() || revision !== learnerGeometryRevision || vscode.window.tabGroups.all.length !== 2) return;
        if (panel.viewColumn !== LEARNER_READING_COLUMN) {
          readingPlacementChanged = true;
          if (!await moveLearnerReadingPanel(panel, () => isOwnerCurrent() && revision === learnerGeometryRevision
            && vscode.window.tabGroups.all.length === 2, isOwnerCurrent, activeReading)) return;
        }
      }
      if (readingPlacementChanged && activeReading && isOwnerCurrent() && revision === learnerGeometryRevision) {
        activeReading.reveal(LEARNER_READING_COLUMN, false);
      }
    }
  });
  return learnerLayoutUpdate;
}

/** A file editor (code, image), as opposed to a webview such as the course text. */
function hasFileInput(tab: vscode.Tab): boolean {
  return Boolean((tab.input as { uri?: vscode.Uri } | undefined)?.uri);
}

export function learnerCodeColumn(): vscode.ViewColumn {
  return vscode.ViewColumn.One;
}

export function learnerReadingColumn(): vscode.ViewColumn {
  return learnerNarrow ? vscode.ViewColumn.One : LEARNER_READING_COLUMN;
}

/** Keep the shared lecturer/source and figure routes unchanged. */
export async function openStudentFile(uri: vscode.Uri | string, extra?: vscode.TextDocumentShowOptions, isCurrent: () => boolean = () => true): Promise<void> {
  await learnerLayoutUpdate;
  if (!isCurrent()) return;
  const target = typeof uri === 'string' ? vscode.Uri.file(uri) : uri;
  const image = IMAGE_EXTENSIONS.has(path.extname(target.fsPath).toLowerCase());
  const viewColumn = image ? learnerReadingColumn() : learnerCodeColumn();
  if (path.extname(target.fsPath).toLowerCase() === '.py') lastStudentSource = target;
  await placeStudentFile(target, extra, viewColumn, isCurrent);
}

/** Select the exact input before moving, so unrelated selected tabs stay put. */
async function placeStudentFile(target: vscode.Uri, extra: vscode.TextDocumentShowOptions | undefined, viewColumn: vscode.ViewColumn, isCurrent: () => boolean = () => true): Promise<void> {
  if (!isCurrent()) return;
  const existing = vscode.window.tabGroups?.all.find(group => group.tabs?.some(tab => {
    const input = tab.input as { uri?: vscode.Uri };
    return input?.uri?.toString() === target.toString();
  }));
  if ((vscode.window.tabGroups?.all.length ?? 0) > 2) learnerLayoutManaged = false;
  if (existing && !learnerLayoutManaged) viewColumn = existing.viewColumn;
  if (existing && existing.viewColumn !== viewColumn) {
    await vscode.commands.executeCommand('vscode.open', target, { ...extra, viewColumn: existing.viewColumn, preview: false, preserveFocus: false });
    if (!isCurrent()) return;
    await vscode.commands.executeCommand('moveActiveEditor', { to: 'position', by: 'group', value: viewColumn });
  } else {
    await vscode.commands.executeCommand('vscode.open', target, { ...extra, viewColumn });
  }
}

export function studentOpenFileCommand(uri: vscode.Uri | string, title = 'Open File'): vscode.Command {
  return { command: 'computor.student.openFile', title, arguments: [uri] };
}
