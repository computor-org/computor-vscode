import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import { StudentCommands } from '../../src/commands/StudentCommands';
import { CourseSelectionService } from '../../src/services/CourseSelectionService';
import { showMarkdownTextPreview } from '../../src/ui/webviews/markdownPreview';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';
import { webviewPanels } from '../helpers/vscode-stub';

describe('course questions from bundled course Help', () => {
  let handlers: Map<string, (...args: any[]) => Promise<void>>;
  let student: any;
  let courseId: string | undefined;
  let membership: any;
  let lookedUp: string[];
  let targets: any[];
  let notices: string[];
  let original: any;
  const context = {
    subscriptions: [], extensionPath: path.resolve(__dirname, '../..'),
    extensionUri: vscode.Uri.file(path.resolve(__dirname, '../..'))
  } as any;

  beforeEach(() => {
    for (const panel of webviewPanels) panel.dispose();
    webviewPanels.length = 0;
    setUiProfileLanguage('en');
    courseId = 'current-course';
    membership = { id: 'own-member', user_id: 'me', course_id: 'current-course' };
    lookedUp = [];
    targets = [];
    notices = [];
    handlers = new Map();
    original = {
      register: vscode.commands.registerCommand,
      create: vscode.window.createWebviewPanel,
      selection: CourseSelectionService.getInstance,
      warning: vscode.window.showWarningMessage,
      error: vscode.window.showErrorMessage
    };
    (vscode.commands as any).registerCommand = (id: string, handler: any) => {
      handlers.set(id, handler);
      return { dispose() {} };
    };
    (vscode.window as any).createWebviewPanel = (viewType: string, title: string, column: any, options: any) => {
      const panel = original.create(viewType, title, column, options);
      panel.webview.options = options;
      return panel;
    };
    (CourseSelectionService as any).getInstance = () => ({
      getCurrentCourseId: () => courseId,
      getCurrentCourseInfo: () => courseId ? { id: courseId, title: 'Current course' } : undefined
    });
    for (const method of ['showWarningMessage', 'showErrorMessage']) {
      (vscode.window as any)[method] = async (message: string) => { notices.push(message); };
    }
    student = Object.create(StudentCommands.prototype);
    student.context = context;
    student.apiService = {
      getOwnCourseMember: async (id: string) => { lookedUp.push(id); return membership; }
    };
    student.messagesWebviewProvider = { showMessages: async (target: any) => { targets.push(target); } };
    student.registerCommands();
  });

  afterEach(() => {
    (vscode.commands as any).registerCommand = original.register;
    (vscode.window as any).createWebviewPanel = original.create;
    (CourseSelectionService as any).getInstance = original.selection;
    (vscode.window as any).showWarningMessage = original.warning;
    (vscode.window as any).showErrorMessage = original.error;
    for (const panel of webviewPanels) panel.dispose();
    webviewPanels.length = 0;
    setUiProfileLanguage(undefined);
  });

  it('opens the existing Messages panel with exactly the own-member conversation target', async () => {
    await handlers.get('computor.student.askCourseQuestion')!('untrusted-member-or-course');
    expect(lookedUp).to.deep.equal(['current-course']);
    expect(targets).to.deep.equal([{
      title: 'Course question', subtitle: 'Current course',
      query: { scope: 'course_member', course_member_id: 'own-member' },
      createPayload: { course_member_id: 'own-member' },
      wsChannel: 'course_member:own-member', sourceRole: 'student'
    }]);
  });

  it('keeps the course from the native Help entry when global selection differs', async () => {
    await handlers.get('computor.student.help')!({ contextValue: 'studentCourseRoot', courseId: 'help-course' });
    membership = { id: 'own-member', user_id: 'me', course_id: 'help-course' };
    courseId = 'different-selected-course';
    await handlers.get('computor.student.askCourseQuestion')!();
    expect(lookedUp).to.deep.equal(['help-course']);
    expect(targets[0].query).to.deep.equal({ scope: 'course_member', course_member_id: 'own-member' });
  });

  it('preserves the Help document and enables only its question command, then disables commands for authored material', async () => {
    await handlers.get('computor.student.help')!({ contextValue: 'studentCourseRoot', courseId: 'help-course' });
    const panel = webviewPanels[0]!;
    expect(panel.title).to.equal('Computor Help');
    expect(panel.webview.html).to.contain('command:computor.student.askCourseQuestion');
    expect(panel.webview.options.enableCommandUris).to.deep.equal(['computor.student.askCourseQuestion']);
    await showMarkdownTextPreview(context, '# Authored task', 'Task');
    expect(panel.webview.options.enableCommandUris).to.equal(false);
    await showMarkdownTextPreview(context, '# Authored Welcome', 'Welcome', { welcomeContentId: 'welcome' });
    expect(webviewPanels[1]!.webview.options.enableCommandUris).to.equal(false);
  });

  it('enables the course question again after following Help links away and back', async () => {
    await handlers.get('computor.student.help')!({ contextValue: 'studentCourseRoot', courseId: 'help-course' });
    const panel = webviewPanels[0]!;
    panel.fireMessage({ command: 'openRelativeDocument', href: 'student-unit.md' });
    await new Promise(resolve => setImmediate(resolve));
    expect(panel.webview.options.enableCommandUris).to.equal(false);
    panel.fireMessage({ command: 'openRelativeDocument', href: 'student-course.md' });
    await new Promise(resolve => setImmediate(resolve));
    expect(panel.webview.options.enableCommandUris).to.deep.equal(['computor.student.askCourseQuestion']);
    expect(panel.webview.html).to.contain('command:computor.student.askCourseQuestion');
    await handlers.get('computor.student.askCourseQuestion')!();
    expect(lookedUp).to.deep.equal(['help-course']);
  });

  it('rebinds relative course Help to a later assignment Help entry instead of the previous course', async () => {
    await handlers.get('computor.student.help')!({ contextValue: 'studentCourseRoot', courseId: 'previous-course' });
    await handlers.get('computor.student.help')!({
      contextValue: 'studentCourseContent.assignment', courseContent: { course_id: 'assignment-course' }
    });
    const panel = webviewPanels[0]!;
    expect(panel.webview.options.enableCommandUris).to.equal(false);
    panel.fireMessage({ command: 'openRelativeDocument', href: 'student-course.md' });
    await new Promise(resolve => setImmediate(resolve));
    expect(panel.webview.options.enableCommandUris).to.deep.equal(['computor.student.askCourseQuestion']);
    await handlers.get('computor.student.askCourseQuestion')!();
    expect(lookedUp).to.deep.equal(['assignment-course']);
  });

  it('keeps assignment Help as documentation with command links disabled', async () => {
    await handlers.get('computor.student.help')!({ contextValue: 'studentCourseContent.assignment' });
    expect(webviewPanels[0]!.webview.options.enableCommandUris).to.equal(false);
    expect(webviewPanels[0]!.webview.html).to.contain('Assignments');
    expect(targets).to.be.empty;
  });

  it('does not open a conversation without a current course', async () => {
    courseId = undefined;
    await handlers.get('computor.student.askCourseQuestion')!();
    expect(lookedUp).to.be.empty;
    expect(targets).to.be.empty;
    expect(notices).to.deep.equal(['Open a course before asking a course question.']);
  });

  it('does not open a conversation without membership and localizes the recovery hint', async () => {
    setUiProfileLanguage('de');
    membership = undefined;
    await handlers.get('computor.student.askCourseQuestion')!();
    expect(targets).to.be.empty;
    expect(notices).to.deep.equal(['Deine Kursteilnahme wurde nicht gefunden. Aktualisiere die Kursansicht und versuche es noch einmal.']);
  });

  it('shows a localized recovery message when membership lookup fails', async () => {
    student.apiService.getOwnCourseMember = async () => { throw new Error('internal host'); };
    await handlers.get('computor.student.askCourseQuestion')!();
    expect(targets).to.be.empty;
    expect(notices).to.deep.equal(['Could not open course questions. Try again after refreshing the course view.']);
  });
});
