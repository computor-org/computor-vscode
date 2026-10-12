import { expect } from 'chai';
import * as vscode from 'vscode';
import { CourseSelectionService } from '../../src/services/CourseSelectionService';

describe('course selection after reauthentication', () => {
  it('uses the new authenticated API instance instead of the disposed previous session', async () => {
    const previousInstance = (CourseSelectionService as any).instance;
    const previousFolders = vscode.workspace.workspaceFolders;
    const previousExecute = vscode.commands.executeCommand;
    let previousCalls = 0;
    let newCalls = 0;
    try {
      (CourseSelectionService as any).instance = undefined;
      (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file('/workspace') }];
      (vscode.commands as any).executeCommand = async () => undefined;
      const context = { globalState: { update: async () => undefined } } as any;
      const statusBar = { updateCourse: () => undefined } as any;
      const first = CourseSelectionService.initialize(context, {
        getStudentCourses: async () => { previousCalls++; return [{ id: 'first', title: 'First', path: 'first' }]; }
      } as any, statusBar);
      await first.selectCourse('first', { throwOnError: true });
      const second = CourseSelectionService.initialize(context, {
        getStudentCourses: async () => { newCalls++; return [{ id: 'second', title: 'Second', path: 'second' }]; }
      } as any, statusBar);
      expect(second).to.equal(first);
      expect((await second.selectCourse('second', { throwOnError: true }))?.id).to.equal('second');
      expect(previousCalls).to.equal(1);
      expect(newCalls).to.equal(1);
    } finally {
      (CourseSelectionService as any).instance = previousInstance;
      (vscode.workspace as any).workspaceFolders = previousFolders;
      (vscode.commands as any).executeCommand = previousExecute;
    }
  });
});
