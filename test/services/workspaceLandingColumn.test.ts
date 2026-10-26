import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import { webviewPanels } from '../helpers/vscode-stub';
import { showWorkspaceCourseLanding } from '../../src/services/WorkspaceCourseLanding';
import type { ComputorApiService } from '../../src/services/ComputorApiService';
import type { CourseContentStudentList, CourseStudentList } from '../../src/types/generated';

/**
 * A course launch opens one document in the first group; the Computor welcome
 * page is a tab behind it, not a second column (integration round 1, N14).
 */
describe('workspace course landing column', () => {
  const context = { subscriptions: [], extensionUri: vscode.Uri.file(path.resolve(__dirname, '../..')) } as unknown as vscode.ExtensionContext;
  const course = { id: 'course-1', path: 'ds', title: 'Kurs', description: 'Beschreibung' } as CourseStudentList;
  const closePanels = () => {
    for (const panel of webviewPanels) panel.dispose();
    webviewPanels.length = 0;
  };
  beforeEach(closePanels);
  afterEach(closePanels);

  it('opens the course welcome in the first editor group', async () => {
    const welcome = {
      id: 'w', path: 'willkommen', title: 'Willkommen', course_id: 'course-1', position: 0,
      course_content_kind_id: 'unit', visible_effective: true, description: '# Willkommen\n\nHallo'
    } as CourseContentStudentList;
    const api = { getStudentCourseContents: async () => [welcome] } as unknown as ComputorApiService;

    await showWorkspaceCourseLanding(context, api, course);

    expect(webviewPanels.at(-1)!.viewColumn).to.equal(vscode.ViewColumn.One);
  });

  it('opens the fallback landing in the first editor group', async () => {
    const api = {
      getStudentCourseContents: async () => [],
      getUserAccount: async () => ({ profile: { language_code: 'de' } })
    } as unknown as ComputorApiService;

    await showWorkspaceCourseLanding(context, api, course);

    expect(webviewPanels.at(-1)!.viewColumn).to.equal(vscode.ViewColumn.One);
  });
});
