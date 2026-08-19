/**
 * Minimal `vscode` API stub for Node-only unit tests.
 * Registered by test/helpers/register-vscode-stub.ts which aliases
 * `require('vscode')` to this module so Mocha tests can load extension
 * sources without spinning up an Extension Host.
 *
 * Behaviour: methods that are called during module load time (e.g. creating
 * EventEmitters, reading ThemeIcon) return harmless defaults. Runtime-only
 * methods (showInformationMessage, showInputBox, etc.) return rejected
 * promises with a clear message so any test that accidentally exercises UI
 * fails fast.
 */

type Disposable = { dispose(): void };

class EventEmitterStub<T> {
  private listeners: Array<(e: T) => void> = [];
  readonly event = (listener: (e: T) => void): Disposable => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T): void { for (const l of this.listeners) l(data); }
  dispose(): void { this.listeners = []; }
}

class CancellationTokenSourceStub {
  private emitter = new EventEmitterStub<void>();
  readonly token = { isCancellationRequested: false, onCancellationRequested: this.emitter.event };
  cancel(): void { (this.token as any).isCancellationRequested = true; this.emitter.fire(undefined as any); }
  dispose(): void { this.emitter.dispose(); }
}

const notImplemented = (name: string) => async () => {
  throw new Error(`[vscode-stub] ${name} is not implemented in the Node test stub`);
};

const configurationStub = {
  get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
  has: () => false,
  inspect: () => undefined,
  update: notImplemented('configuration.update')
};

/** Per-section overrides a test can install; cleared in its own teardown. */
export const configurationOverrides: Record<string, any> = {};

export const window = {
  showInformationMessage: notImplemented('window.showInformationMessage'),
  showWarningMessage: notImplemented('window.showWarningMessage'),
  showErrorMessage: notImplemented('window.showErrorMessage'),
  showInputBox: notImplemented('window.showInputBox'),
  showQuickPick: notImplemented('window.showQuickPick'),
  showOpenDialog: notImplemented('window.showOpenDialog'),
  createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {}, text: '', tooltip: '', command: '' }),
  createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {}, clear() {}, name: 'stub' }),
  createTreeView: () => ({ dispose() {}, reveal: notImplemented('TreeView.reveal'), onDidExpandElement: () => ({ dispose() {} }), onDidCollapseElement: () => ({ dispose() {} }), onDidChangeSelection: () => ({ dispose() {} }), onDidChangeVisibility: () => ({ dispose() {} }) }),
  registerTreeDataProvider: () => ({ dispose() {} }),
  registerWebviewViewProvider: () => ({ dispose() {} }),
  registerCustomEditorProvider: (viewType: string, provider: any, options?: any): Disposable => {
    customEditorProviders.push({ viewType, provider, options });
    return { dispose() {} };
  },
  createWebviewPanel: (viewType: string, title: string, _column?: any, _options?: any): WebviewPanelStub => {
    const disposeEmitter = new EventEmitterStub<void>();
    const messageEmitter = new EventEmitterStub<any>();
    const panel: WebviewPanelStub = {
      viewType,
      title,
      viewColumn: 2,
      disposed: false,
      posted: [],
      webview: {
        options: {},
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: any) => uri,
        onDidReceiveMessage: messageEmitter.event,
        postMessage: async (message: any) => { panel.posted.push(message); return true; }
      },
      onDidDispose: disposeEmitter.event,
      reveal: () => {},
      // What a click in the webview does, for a test that needs one.
      fireMessage: (message: any) => messageEmitter.fire(message),
      // What the editor's [x] does, for a test that needs the panel closed.
      dispose: () => {
        if (panel.disposed) { return; }
        panel.disposed = true;
        disposeEmitter.fire(undefined as any);
      }
    };
    webviewPanels.push(panel);
    return panel;
  }
};

export interface WebviewPanelStub {
  viewType: string;
  title: string;
  viewColumn: number;
  disposed: boolean;
  /** Everything the extension posted to this panel's webview. */
  posted: any[];
  webview: any;
  onDidDispose: (listener: (e: void) => void) => Disposable;
  reveal(): void;
  /** Deliver a message as the webview's script would have posted it. */
  fireMessage(message: any): void;
  dispose(): void;
}

/** Panels handed out by `window.createWebviewPanel`, newest last. */
export const webviewPanels: WebviewPanelStub[] = [];

/**
 * Custom editors registered through `window.registerCustomEditorProvider`.
 * VS Code resolves these when a matching file is opened; a test drives that
 * itself: `customEditorProviders.at(-1).provider.resolveCustomEditor(doc, panel)`.
 */
export const customEditorProviders: { viewType: string; provider: any; options?: any }[] = [];

/**
 * Watchers handed out by `workspace.createFileSystemWatcher`, newest last.
 * Nothing watches the file system in a Node test, so a test that needs a
 * watcher to fire drives it here: `fileSystemWatchers.at(-1).fireCreate(uri)`.
 */
export const fileSystemWatchers: FileSystemWatcherStub[] = [];

export interface FileSystemWatcherStub {
  onDidCreate: (listener: (e: any) => void) => Disposable;
  onDidChange: (listener: (e: any) => void) => Disposable;
  onDidDelete: (listener: (e: any) => void) => Disposable;
  dispose(): void;
  fireCreate(uri?: any): void;
  fireChange(uri?: any): void;
  fireDelete(uri?: any): void;
}

export const workspace = {
  workspaceFolders: undefined as any,
  getConfiguration: (section?: string) => (section ? configurationOverrides[section] : undefined) ?? configurationStub,
  updateWorkspaceFolders: () => true,
  onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
  openTextDocument: notImplemented('workspace.openTextDocument'),
  createFileSystemWatcher: (_pattern: any): FileSystemWatcherStub => {
    const created = new EventEmitterStub<any>();
    const changed = new EventEmitterStub<any>();
    const deleted = new EventEmitterStub<any>();
    const watcher: FileSystemWatcherStub = {
      onDidCreate: created.event,
      onDidChange: changed.event,
      onDidDelete: deleted.event,
      dispose: () => { created.dispose(); changed.dispose(); deleted.dispose(); },
      fireCreate: (uri?: any) => created.fire(uri),
      fireChange: (uri?: any) => changed.fire(uri),
      fireDelete: (uri?: any) => deleted.fire(uri)
    };
    fileSystemWatchers.push(watcher);
    return watcher;
  }
};

export const commands = {
  registerCommand: (_id: string, _cb: Function): Disposable => ({ dispose() {} }),
  executeCommand: notImplemented('commands.executeCommand') as unknown as (cmd: string, ...args: any[]) => Thenable<any>
};

export const extensions = {
  getExtension: (_id: string) => undefined as any,
  all: [] as any[]
};

export const Uri = {
  file: (path: string) => ({ fsPath: path, path, scheme: 'file', toString: () => `file://${path}` }),
  parse: (value: string) => ({ fsPath: value, path: value, scheme: 'unknown', toString: () => value }),
  joinPath: (base: any, ...segments: string[]) => {
    const path = [String(base?.path ?? '').replace(/\/+$/, ''), ...segments].join('/');
    const scheme = base?.scheme ?? 'file';
    return { fsPath: path, path, scheme, toString: () => `${scheme}://${path}` };
  }
};

export class ThemeIcon {
  static readonly File = new ThemeIcon('file');
  static readonly Folder = new ThemeIcon('folder');
  constructor(public id: string, public color?: any) {}
}

export class ThemeColor { constructor(public id: string) {} }

export class MarkdownString {
  isTrusted?: boolean;
  supportThemeIcons?: boolean;
  constructor(public value: string = '') {}
  appendMarkdown(markdown: string): MarkdownString {
    this.value += markdown;
    return this;
  }
  appendText(text: string): MarkdownString {
    this.value += text;
    return this;
  }
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;

export const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 } as const;

export const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 } as const;

export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const;

export const EventEmitter = EventEmitterStub;
export const CancellationTokenSource = CancellationTokenSourceStub;

export const UIKind = { Desktop: 1, Web: 2 } as const;

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

export const env = {
  clipboard: { readText: notImplemented('env.clipboard.readText'), writeText: notImplemented('env.clipboard.writeText') },
  openExternal: notImplemented('env.openExternal'),
  uiKind: UIKind.Desktop as number,
  remoteName: undefined as string | undefined
};

export class TreeItem {
  label: string;
  collapsibleState: number;
  id?: string;
  description?: string;
  tooltip?: any;
  iconPath?: any;
  contextValue?: string;
  command?: any;
  constructor(label: string, collapsibleState: number = 0) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class RelativePattern {
  constructor(public base: any, public pattern: string) {}
}
