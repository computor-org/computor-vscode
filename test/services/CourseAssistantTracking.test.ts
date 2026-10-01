import { expect } from 'chai';
import { contentForFile, registerCourseAssistantTracking, refreshCourseAssistantSelection } from '../../src/services/CourseAssistantTracking';
import { courseAssistantBridge } from '../../src/services/CourseAssistantBridge';
import * as vscode from 'vscode';

describe('course assistant file context', () => {
  const course = { id: 'unit', course_id: 'synthetic-course', directory: 'week1' };
  const nested = { ...course, id: 'task', directory: 'week1/task' };
  it('uses the closest assignment rather than a parent or sibling directory', () => {
    expect(contentForFile('/repo/week1/task/main.py', '/repo', [course, nested])?.id).to.equal('task');
    expect(contentForFile('/repo/week1/readme.md', '/repo', [course, nested])?.id).to.equal('unit');
    expect(contentForFile('/repo/week10/main.py', '/repo', [course, nested])).to.equal(undefined);
  });
  it('does not attach outside-workspace files or traversal-bearing metadata', () => {
    expect(contentForFile('/other/week1/main.py', '/repo', [course])).to.equal(undefined);
    expect(contentForFile('/repo/main.py', '/repo', [{ ...course, directory: '../' }])).to.equal(undefined);
    expect(contentForFile('/repo/main.py', '/repo', [{ ...course, directory: '/other' }])).to.equal(undefined);
  });
});

describe('course assistant selection lifecycle', () => {
  let subscriptions: any[], calls: any[], editorChanged: (editor?: any) => void;
  let current = 'first';
  let saved: any;
  const editor = { document: { uri: { scheme: 'file', fsPath: '/repo/task/main.py' } } };
  beforeEach(() => {
    subscriptions = []; calls = []; current = 'first';
    saved = { apply: courseAssistantBridge.apply, clear: courseAssistantBridge.clear,
      editor: (vscode.window as any).activeTextEditor, event: (vscode.window as any).onDidChangeActiveTextEditor };
    (vscode.window as any).activeTextEditor = editor;
    (vscode.window as any).onDidChangeActiveTextEditor = (handler: any) => { editorChanged = handler; return { dispose() {} }; };
    courseAssistantBridge.apply = async content => { calls.push(content); await saved.apply.call(courseAssistantBridge, content); };
  });
  afterEach(() => {
    subscriptions.forEach(s => s.dispose());
    courseAssistantBridge.apply = saved.apply;
    (vscode.window as any).activeTextEditor = saved.editor;
    (vscode.window as any).onDidChangeActiveTextEditor = saved.event;
  });
  function register(overrides: any = {}) {
    registerCourseAssistantTracking({ subscriptions } as any, { courseId: () => current,
      repositoryRoot: async () => '/repo', contents: async () => [{ id: 'task', course_id: current, directory: 'task' }],
      detail: async () => ({ id: 'task', course_id: current, title: current }), ...overrides });
  }
  it('refreshes an unchanged editor on course selection and clears on course exit', async () => {
    register();
    await refreshCourseAssistantSelection();
    expect(calls[calls.length - 1].id).to.equal('task');
    current = 'second';
    await refreshCourseAssistantSelection();
    expect(calls[calls.length - 1].course_id).to.equal('second');
    expect(calls[calls.length - 2].assistant_policy.independent_check).to.equal(true);
    const previous = courseAssistantBridge.epoch;
    current = '';
    await refreshCourseAssistantSelection();
    expect(courseAssistantBridge.epoch).to.be.greaterThan(previous);
  });
  it('logout cancels a pending detail request instead of restoring its policy', async () => {
    let release!: (value: any) => void;
    register({ detail: () => new Promise(resolve => { release = resolve; }) });
    const pending = refreshCourseAssistantSelection();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    courseAssistantBridge.clear();
    release({ id: 'task', course_id: current });
    await pending;
    expect(calls.every(c => c.id === 'loading')).to.equal(true);
  });
  it('unavailable, outside-repository and non-file contexts keep generation disabled', async () => {
    register({ detail: async () => { throw new Error('synthetic failure'); } });
    await refreshCourseAssistantSelection();
    expect(calls[calls.length - 1].assistant_policy.independent_check).to.equal(true);
    (vscode.window as any).activeTextEditor = { document: { uri: { scheme: 'file', fsPath: '/other/secret' } } };
    await refreshCourseAssistantSelection();
    expect(calls[calls.length - 1].id).to.equal('loading');
    (vscode.window as any).activeTextEditor = undefined;
    await refreshCourseAssistantSelection();
    expect(calls[calls.length - 1].id).to.equal('loading');
    editorChanged({ document: { uri: { scheme: 'untitled' } } });
  });
});
