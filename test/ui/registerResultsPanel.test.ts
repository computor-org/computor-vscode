import { expect } from 'chai';
import * as vscode from 'vscode';
import { HttpError } from '../../src/exceptions/errors';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';
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

  it('redraws the result details in a new reading language without reopening them', () => {
    const originalProvider = vscode.window.registerWebviewViewProvider;
    let panel: any;
    (vscode.window as any).registerWebviewViewProvider = (_id: string, provider: any) => { panel = provider; return { dispose() {} }; };
    const posted: any[] = [];
    const disposables = registerResultsPanel(context, api, async () => {});
    try {
      panel.view = { webview: { postMessage: (message: any) => { posted.push(message); return Promise.resolve(true); } } };
      setUiProfileLanguage('en');
      panel.clearDetails(false);
      setUiProfileLanguage('de');
      expect(posted.map(message => message.data.label)).to.deep.equal(['Result Details', 'Ergebnisdetails']);
    } finally {
      for (const disposable of disposables) disposable.dispose();
      (vscode.window as any).registerWebviewViewProvider = originalProvider;
      setUiProfileLanguage(undefined);
    }
  });

  it('titles both Results views in the reading language and renames them on a switch', () => {
    const originalProvider = vscode.window.registerWebviewViewProvider;
    const originalTreeView = vscode.window.createTreeView;
    let panel: any;
    let tree: any;
    (vscode.window as any).registerWebviewViewProvider = (_id: string, provider: any) => { panel = provider; return { dispose() {} }; };
    (vscode.window as any).createTreeView = (...args: any[]) => { tree = (originalTreeView as any)(...args); return tree; };
    setUiProfileLanguage('de');
    const disposables = registerResultsPanel(context, api, async () => {});
    try {
      const view: any = {
        visible: true,
        webview: { options: {}, html: '', postMessage: () => Promise.resolve(true), onDidReceiveMessage: () => ({ dispose() {} }), asWebviewUri: (uri: any) => uri, cspSource: '' },
        onDidChangeVisibility: () => ({ dispose() {} }),
        onDidDispose: () => ({ dispose() {} })
      };
      panel.resolveWebviewView(view, {} as any, {} as any);
      expect([tree.title, view.title]).to.deep.equal(['Ergebnisliste', 'Ergebnisdetails']);
      setUiProfileLanguage('en');
      expect([tree.title, view.title]).to.deep.equal(['Result Tree', 'Result Details']);
    } finally {
      for (const disposable of disposables) disposable.dispose();
      (vscode.window as any).registerWebviewViewProvider = originalProvider;
      (vscode.window as any).createTreeView = originalTreeView;
      setUiProfileLanguage(undefined);
    }
  });

  it('returns disposables for everything it registered', () => {
    const disposables = registerResultsPanel(context, api, async () => {});

    // one webview provider + one tree provider + the language listener + the commands
    expect(disposables.length).to.equal(REQUIRED_COMMANDS.length + 3);
    for (const disposable of disposables) {
      expect(disposable.dispose).to.be.a('function');
    }
  });
});

// The panel shows exactly one result, so whose it is has to be decided before
// any request goes out. /students/course-contents/{id} answers for whoever is
// signed in, and a tutor is usually a course member with a result of their own:
// asking it while looking at a student's assignment put the tutor's own passing
// run in the panel while the tree kept showing the student's real percentage
// (computor-org/issues#389).
describe('showTestResults result scoping', () => {
  const TUTOR_ITEM = {
    content: { id: 'content-1' },
    memberId: 'member-1',
    contextValue: 'tutorStudentContent.assignment.hasRepo'
  };
  const STUDENT_ITEM = {
    courseContent: { id: 'content-1' },
    contextValue: 'studentCourseContent.assignment'
  };

  let originalRegister: typeof vscode.commands.registerCommand;
  let originalExecute: typeof vscode.commands.executeCommand;
  let handlers: Map<string, (...args: any[]) => any>;
  let executed: { command: string; args: any[] }[];
  let workspaceState: Map<string, any>;
  let context: vscode.ExtensionContext;

  /** What `computor.results.open` was handed, or undefined if it never ran. */
  const openedPayload = () => executed.find(call => call.command === 'computor.results.open')?.args[0];
  const cleared = () => executed.some(call => call.command === 'computor.results.clear');
  const showTestResults = (item: any) => handlers.get('computor.showTestResults')!(item, { silent: true });

  beforeEach(() => {
    handlers = new Map();
    executed = [];
    workspaceState = new Map();
    context = {
      extensionUri: { fsPath: '/tmp/ext' },
      subscriptions: [],
      workspaceState: {
        get: (key: string) => workspaceState.get(key),
        update: (key: string, value: any) => {
          workspaceState.set(key, value);
          return Promise.resolve();
        }
      }
    } as unknown as vscode.ExtensionContext;

    originalRegister = vscode.commands.registerCommand;
    originalExecute = vscode.commands.executeCommand;
    (vscode.commands as any).registerCommand = (id: string, callback: (...args: any[]) => any) => {
      handlers.set(id, callback);
      return { dispose() {} };
    };
    // Record rather than dispatch: these tests are about which result gets
    // resolved, not about what the tree does with it afterwards.
    (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
      executed.push({ command, args });
      return undefined;
    };
  });

  afterEach(() => {
    (vscode.commands as any).registerCommand = originalRegister;
    (vscode.commands as any).executeCommand = originalExecute;
  });

  it('keeps the localized sign-in hint when fetching results fails after sign-out', async () => {
    const originalError = vscode.window.showErrorMessage;
    const messages: string[] = [];
    (vscode.window as any).showErrorMessage = async (message: string) => { messages.push(message); };
    setUiProfileLanguage('de');
    registerResultsPanel(context, {
      getStudentCourseContent: async () => { throw new HttpError('Login HTML', 401, 'Unauthorized'); }
    } as any, async () => {});
    try {
      await handlers.get('computor.showTestResults')!(STUDENT_ITEM);
      expect(openedPayload()).to.equal(undefined);
      expect(messages).to.deep.equal(['Deine Sitzung ist abgelaufen. Melde dich bitte erneut an.']);
    } finally {
      (vscode.window as any).showErrorMessage = originalError;
      setUiProfileLanguage(undefined);
    }
  });

  function stubApi(overrides: Record<string, any> = {}) {
    const calls: { student: string[]; member: [string, string][]; result: string[] } = {
      student: [],
      member: [],
      result: []
    };
    const api = {
      getStudentCourseContent: async (contentId: string) => {
        calls.student.push(contentId);
        return overrides.studentCourseContent;
      },
      getTutorMemberCourseContent: async (memberId: string, contentId: string) => {
        calls.member.push([memberId, contentId]);
        return overrides.memberCourseContent;
      },
      getResult: async (resultId: string) => {
        calls.result.push(resultId);
        return overrides.result;
      }
    } as any;
    return { api, calls };
  }

  it('asks the member-scoped endpoint for a tutor item, never the student one', async () => {
    const { api, calls } = stubApi({
      memberCourseContent: { result: { id: 'r-student', result_json: { whose: 'student' } } }
    });
    registerResultsPanel(context, api, async () => {});

    await showTestResults(TUTOR_ITEM);

    expect(calls.member).to.deep.equal([['member-1', 'content-1']]);
    expect(calls.student, 'the student endpoint answers for the signed-in user').to.be.empty;
    expect(openedPayload()).to.deep.equal({ whose: 'student' });
  });

  it("shows the student's result even when the tutor has one of their own", async () => {
    const { api } = stubApi({
      memberCourseContent: { result: { id: 'r-student', result_json: { whose: 'student' } } },
      studentCourseContent: { result: { id: 'r-tutor', result_json: { whose: 'tutor' } } }
    });
    registerResultsPanel(context, api, async () => {});

    await showTestResults(TUTOR_ITEM);

    expect(openedPayload()).to.deep.equal({ whose: 'student' });
  });

  it('keeps asking the student endpoint in the student view', async () => {
    const { api, calls } = stubApi({
      studentCourseContent: { result: { id: 'r-own', result_json: { whose: 'me' } } }
    });
    registerResultsPanel(context, api, async () => {});

    await showTestResults(STUDENT_ITEM);

    expect(calls.student).to.deep.equal(['content-1']);
    expect(calls.member).to.be.empty;
    expect(openedPayload()).to.deep.equal({ whose: 'me' });
  });

  it('refreshes selected exercise results without moving focus from the tree', async () => {
    const { api } = stubApi({ studentCourseContent: { result: { id: 'r-own', result_json: { passed: true } } } });
    registerResultsPanel(context, api, async () => {});
    await showTestResults(STUDENT_ITEM);
    const open = executed.find(call => call.command === 'computor.results.open');
    expect(open?.args[0]).to.deep.equal({ passed: true });
    expect(open?.args[3]).to.deep.equal({ preserveFocus: true });
    expect(executed.filter(call => call.command.endsWith('.focus'))).to.be.empty;
    executed = [];
    await handlers.get('computor.results.open')!(...open!.args);
    expect(executed.filter(call => call.command.endsWith('.focus'))).to.be.empty;
  });

  it('clears empty selected exercise results silently while explicit results actions still focus', async () => {
    const { api } = stubApi();
    registerResultsPanel(context, api, async () => {});
    await showTestResults(STUDENT_ITEM);
    expect(cleared()).to.equal(true);
    expect(executed.filter(call => call.command.endsWith('.focus'))).to.be.empty;
    executed = [];
    await handlers.get('computor.showTestResults')!(STUDENT_ITEM);
    expect(executed.some(call => call.command === 'computor.testResultsPanel.focus')).to.equal(true);
    executed = [];
    await handlers.get('computor.results.open')!({ passed: true });
    expect(executed.some(call => call.command === 'computor.testResultsPanel.focus')).to.equal(true);
  });

  it('shows nothing rather than the caller\'s own run when a staff item has no member', async () => {
    const { api, calls } = stubApi({
      studentCourseContent: { result: { id: 'r-tutor', result_json: { whose: 'tutor' } } }
    });
    registerResultsPanel(context, api, async () => {});

    await showTestResults({ content: { id: 'content-1' }, contextValue: 'tutorStudentContent.assignment.noRepo' });

    expect(calls.student).to.be.empty;
    expect(openedPayload()).to.be.undefined;
    expect(cleared()).to.be.true;
  });

  it("hydrates a tree item's result through GET /results/{id}", async () => {
    // The list DTOs carry `result` without result_json, so a result that came
    // off the tree rather than from the scoped fetch still needs hydrating.
    const { api, calls } = stubApi({
      memberCourseContent: { result: null },
      result: { result_json: { whose: 'student' }, result_artifacts: [{ id: 'a1' }] }
    });
    registerResultsPanel(context, api, async () => {});

    await showTestResults({ ...TUTOR_ITEM, content: { id: 'content-1', result: { id: 'r-student' } } });

    expect(calls.result).to.deep.equal(['r-student']);
    expect(openedPayload()).to.deep.equal({ whose: 'student' });
  });

  it('does not replay one student\'s results for the next student', async () => {
    // The persisted key names the course content alone, so a staff payload in
    // it came back for whoever was opened next.
    const { api: firstApi } = stubApi({
      memberCourseContent: { result: { id: 'r-a', result_json: { whose: 'student-a' } } }
    });
    registerResultsPanel(context, firstApi, async () => {});
    await showTestResults(TUTOR_ITEM);
    expect(workspaceState.size, 'a staff view has no business writing that key').to.equal(0);

    executed = [];
    handlers.clear();
    const { api: secondApi } = stubApi({ memberCourseContent: { result: null } });
    registerResultsPanel(context, secondApi, async () => {});
    await showTestResults({ ...TUTOR_ITEM, memberId: 'member-2' });

    expect(openedPayload()).to.be.undefined;
    expect(cleared()).to.be.true;
  });

  it('still persists the signed-in user\'s own result across a restart', async () => {
    const { api } = stubApi({
      studentCourseContent: { result: { id: 'r-own', result_json: { whose: 'me' } } }
    });
    registerResultsPanel(context, api, async () => {});
    await showTestResults(STUDENT_ITEM);

    expect(workspaceState.get('testResults:content-1')?.resultPayload).to.deep.equal({ whose: 'me' });

    // Nothing to fetch after a restart: the cached payload stands in (#273).
    executed = [];
    handlers.clear();
    const { api: emptyApi } = stubApi();
    registerResultsPanel(context, emptyApi, async () => {});
    await showTestResults(STUDENT_ITEM);

    expect(openedPayload()).to.deep.equal({ whose: 'me' });
  });
});
