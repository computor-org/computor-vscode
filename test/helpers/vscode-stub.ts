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
  registerWebviewViewProvider: () => ({ dispose() {} })
};

export const workspace = {
  workspaceFolders: undefined as any,
  getConfiguration: (_section?: string) => configurationStub,
  updateWorkspaceFolders: () => true,
  onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
  openTextDocument: notImplemented('workspace.openTextDocument')
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
  parse: (value: string) => ({ fsPath: value, path: value, scheme: 'unknown', toString: () => value })
};

export class ThemeIcon {
  static readonly File = new ThemeIcon('file');
  static readonly Folder = new ThemeIcon('folder');
  constructor(public id: string, public color?: any) {}
}

export class ThemeColor { constructor(public id: string) {} }

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;

export const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 } as const;

export const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 } as const;

export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const;

export const EventEmitter = EventEmitterStub;
export const CancellationTokenSource = CancellationTokenSourceStub;

export const env = {
  clipboard: { readText: notImplemented('env.clipboard.readText'), writeText: notImplemented('env.clipboard.writeText') },
  openExternal: notImplemented('env.openExternal')
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
