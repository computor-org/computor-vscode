import { expect } from 'chai';
import * as vscode from 'vscode';

import { focusViewContainer } from '../../src/ui/focusViewContainer';
import { clearTreeHandles, registerTreeHandle } from '../../src/ui/treeRegistry';
import { containerById, viewsForContainer } from '../../src/ui/viewContainers';

/**
 * Switching into a Computor view after login stopped happening.
 *
 * Every container is `when`-gated on a `computor.*.show` context key, and
 * setContext resolving does not mean the workbench has re-evaluated the `when`
 * clauses — so `workbench.view.extension.*`, fired on the very next line, hit a
 * container that was not registered yet and did nothing. The failure was
 * console.warn'd and swallowed. It had only ever worked because
 * validateGitEnvironment() happened to sit between the two until 5524ab9 moved
 * it earlier.
 *
 * So the focus retries now, and confirms with the one authoritative signal
 * available: a tree view in the container reporting itself visible.
 */
describe('focusViewContainer', () => {
  const student = containerById('computor-student')!;
  const fast = { attempts: 4, delayMs: 0 };

  let executed: string[] = [];
  const realExecuteCommand = vscode.commands.executeCommand;

  /** Stand a tree view up in the registry whose visibility we control. */
  function stubView(viewId: string, visible: () => boolean): void {
    registerTreeHandle(viewId, {
      view: { get visible() { return visible(); } } as any,
      tracked: {} as any
    });
  }

  beforeEach(() => {
    executed = [];
    clearTreeHandles();
  });

  afterEach(() => {
    (vscode.commands as any).executeCommand = realExecuteCommand;
    clearTreeHandles();
  });

  it('reports success as soon as a view in the container is visible', async () => {
    stubView('computor.student.courses', () => true);
    (vscode.commands as any).executeCommand = async (cmd: string) => { executed.push(cmd); };

    expect(await focusViewContainer(student, fast)).to.equal(true);
    expect(executed).to.deep.equal(['workbench.view.extension.computor-student']);
  });

  it('keeps trying while the container is still registering', async () => {
    // The real failure: the command does not exist yet on the first attempt.
    let attempts = 0;
    (vscode.commands as any).executeCommand = async (cmd: string) => {
      executed.push(cmd);
      if (++attempts < 3) {
        throw new Error(`command '${cmd}' not found`);
      }
    };
    stubView('computor.student.courses', () => attempts >= 3);

    expect(await focusViewContainer(student, fast)).to.equal(true);
    expect(executed).to.have.length(3);
  });

  it('gives up after its budget instead of hanging the login', async () => {
    stubView('computor.student.courses', () => false);
    (vscode.commands as any).executeCommand = async (cmd: string) => { executed.push(cmd); };

    expect(await focusViewContainer(student, fast)).to.equal(false);
    expect(executed).to.have.length(4);
  });

  it('does not report success off a sibling container that happens to be open', async () => {
    stubView('computor.lecturer.courses', () => true);
    (vscode.commands as any).executeCommand = async (cmd: string) => { executed.push(cmd); };

    expect(await focusViewContainer(student, fast)).to.equal(false);
  });

  it('accepts any of a multi-view container as proof it opened', () => {
    // computor-tutor contributes two views; either becoming visible means the
    // container is on screen.
    expect(viewsForContainer('computor-tutor')).to.deep.equal([
      'computor.tutor.filters',
      'computor.tutor.courses'
    ]);
  });

  it('knows the views of every container it can be asked to focus', () => {
    for (const id of [
      'computor-student',
      'computor-student-offline',
      'computor-tutor',
      'computor-lecturer',
      'computor-user-manager',
      'computor-chat'
    ]) {
      expect(viewsForContainer(id), `${id} has no views to observe`).to.not.be.empty;
    }
  });
});
