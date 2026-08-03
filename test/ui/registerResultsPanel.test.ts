import { expect } from 'chai';
import * as vscode from 'vscode';
import { registerResultsPanel } from '../../src/ui/results/registerResultsPanel';

// The Results panel used to be set up inside the student-view initialisation, so
// a tutor-only or lecturer-only account had no provider behind the (always
// visible) panel and got "command not found" for every computor.results.* call.
// These commands must therefore come from a role-independent registration.

// Commands the tutor / lecturer code paths dispatch. If any of these stops being
// registered here, staff accounts silently lose their test results again.
const REQUIRED_COMMANDS = [
  'computor.results.open',
  'computor.results.clear',
  'computor.results.panel.update',
  'computor.results.artifact.open',
  'computor.showTestResults'
];

describe('registerResultsPanel', () => {
  let originalRegister: typeof vscode.commands.registerCommand;
  let registered: string[];

  const context = {
    extensionUri: { fsPath: '/tmp/ext' },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: () => Promise.resolve() }
  } as unknown as vscode.ExtensionContext;

  const api = { getStudentCourseContent: async () => undefined, getResult: async () => undefined } as any;

  beforeEach(() => {
    registered = [];
    originalRegister = vscode.commands.registerCommand;
    (vscode.commands as any).registerCommand = (id: string) => {
      registered.push(id);
      return { dispose() {} };
    };
  });

  afterEach(() => {
    (vscode.commands as any).registerCommand = originalRegister;
  });

  it('registers every results command without needing any particular role', () => {
    registerResultsPanel(context, api, async () => {});

    for (const id of REQUIRED_COMMANDS) {
      expect(registered, `${id} must be registered`).to.include(id);
    }
  });

  it('registers showTestResults, which the tutor context menu offers', () => {
    registerResultsPanel(context, api, async () => {});
    expect(registered).to.include('computor.showTestResults');
  });

  it('returns disposables for everything it registered', () => {
    const disposables = registerResultsPanel(context, api, async () => {});

    // one webview provider + one tree provider + the commands
    expect(disposables.length).to.equal(REQUIRED_COMMANDS.length + 2);
    for (const disposable of disposables) {
      expect(disposable.dispose).to.be.a('function');
    }
  });
});
