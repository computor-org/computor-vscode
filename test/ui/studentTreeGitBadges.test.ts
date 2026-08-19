import { expect } from 'chai';
import * as vscode from 'vscode';

import { StudentCourseContentTreeProvider } from '../../src/ui/tree/student/StudentCourseContentTreeProvider';

/**
 * Pins the wiring between a course repo's git state and the rendered rows
 * (issue #332): assignments whose files show up dirty/unpushed get the ● / ↑
 * prefix in their description, everything else stays untouched. Uses the
 * provider's private createTreeItems/assignmentBadges directly — the git
 * reading itself is covered by test/git/repoWorkState.test.ts.
 */
describe('student tree git badges', () => {
  const REPO = '/ws/student/repo-x';

  function makeProvider(): any {
    return new StudentCourseContentTreeProvider(
      {} as any,
      { getCurrentCourseId: () => undefined } as any
    );
  }

  function leaf(id: string, dir: string | undefined, kind: string = 'assignment') {
    return {
      children: new Map(),
      isUnit: false,
      courseContent: { id, title: id, path: id, position: 1, directory: dir },
      contentType: { id: `type-${id}`, course_content_kind_id: kind, slug: kind, title: kind },
    };
  }

  function ctx(dirtyPaths: string[], unpushedPaths: string[] = [], pushFailing = false) {
    return { repoRoot: REPO, state: { dirtyPaths, unpushedPaths, aheadCount: unpushedPaths.length ? 1 : 0 }, pushFailing };
  }

  let originalFolders: any;
  beforeEach(() => {
    originalFolders = (vscode.workspace as any).workspaceFolders;
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/ws' } }];
  });
  afterEach(() => {
    (vscode.workspace as any).workspaceFolders = originalFolders;
  });

  it('prefixes dirty assignments with ● and unpushed ones with ↑', () => {
    const provider = makeProvider();
    const node = {
      children: new Map([
        ['a1', leaf('a1', `${REPO}/a1`)],
        ['a2', leaf('a2', `${REPO}/a2`)],
        ['a3', leaf('a3', `${REPO}/a3`)],
      ]),
      isUnit: false,
    };

    const items = provider.createTreeItems(node, ctx([`a1/main.m`], [`a2/x.m`]));
    const byId = new Map(items.map((i: any) => [i.id, i]));

    expect(String((byId.get('a1') as any).description)).to.match(/^● /);
    expect(String((byId.get('a2') as any).description)).to.match(/^↑ /);
    expect(String((byId.get('a3') as any).description ?? '')).to.not.match(/[●↑⚠]/);
  });

  it('adds ⚠ only when pushes fail AND the assignment has pending work', () => {
    const provider = makeProvider();
    const node = {
      children: new Map([
        ['a1', leaf('a1', `${REPO}/a1`)],
        ['a2', leaf('a2', `${REPO}/a2`)],
      ]),
      isUnit: false,
    };

    const items = provider.createTreeItems(node, ctx([], [`a1/x.m`], true));
    const byId = new Map(items.map((i: any) => [i.id, i]));

    expect(String((byId.get('a1') as any).description)).to.match(/^⚠ ↑ /);
    expect(String((byId.get('a2') as any).description ?? '')).to.not.match(/[●↑⚠]/);
  });

  it('propagates badges to unit rows, including nested units', () => {
    const provider = makeProvider();
    const innerUnit = {
      children: new Map([['a1', leaf('a1', `${REPO}/w1/a1`)]]),
      isUnit: true,
      name: 'Chapter 1',
      courseContent: { id: 'u-inner', title: 'Chapter 1', path: 'w1.c1', position: 1 },
    };
    const outerUnit = {
      children: new Map([['c1', innerUnit]]),
      isUnit: true,
      name: 'Week 1',
      courseContent: { id: 'u-outer', title: 'Week 1', path: 'w1', position: 1 },
    };
    const node = { children: new Map([['w1', outerUnit]]), isUnit: false };

    const items = provider.createTreeItems(node, ctx([`w1/a1/main.m`]));
    expect(items).to.have.lengthOf(1);
    const unitRow: any = items[0];
    expect(String(unitRow.description)).to.match(/^● /);
    expect(String(unitRow.description)).to.include('item');
    expect(String(unitRow.tooltip)).to.include('● Uncommitted changes');

    const cleanItems = provider.createTreeItems(node, ctx([`elsewhere/x.m`]));
    expect(String((cleanItems[0] as any).description)).to.not.match(/[●↑⚠]/);
  });

  it('renders no badges without a git context', () => {
    const provider = makeProvider();
    const node = { children: new Map([['a1', leaf('a1', `${REPO}/a1`)]]), isUnit: false };

    const items = provider.createTreeItems(node, undefined);
    expect(String((items[0] as any).description ?? '')).to.not.match(/[●↑⚠]/);
  });

  it('recovers the content type from course_content_type when contentType is missing', () => {
    const provider = makeProvider();
    const child = leaf('a1', `${REPO}/a1`) as any;
    child.contentType = undefined;
    child.courseContent.course_content_type = { course_content_kind_id: 'assignment' };

    const badges = provider.assignmentBadges(child, ctx(['a1/main.m']));
    expect(badges).to.deep.equal({ dirty: true, unpushed: false, pushFailing: false });
  });

  it('treats a repo-root assignment (legacy layout) as the whole repo', () => {
    const provider = makeProvider();
    const badges = provider.assignmentBadges(leaf('a1', REPO), ctx(['anything.m']));
    expect(badges).to.deep.equal({ dirty: true, unpushed: false, pushFailing: false });
  });

  it('ignores non-assignments and directories outside the repo', () => {
    const provider = makeProvider();
    expect(provider.assignmentBadges(leaf('r1', `${REPO}/r1`, 'reading'), ctx(['r1/x.m']))).to.be.undefined;
    expect(provider.assignmentBadges(leaf('a1', '/elsewhere/a1'), ctx(['a1/x.m']))).to.be.undefined;
  });
});
