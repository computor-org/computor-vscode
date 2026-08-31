import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { StudentCourseContentTreeProvider } from '../../src/ui/tree/student/StudentCourseContentTreeProvider';

/**
 * A hidden row is a staff affordance (#338), not a different kind of row: the
 * lecturer rehearsing as a student keeps every icon and menu action. The
 * `hidden` marker used to lead the contextValue, which silently failed every
 * `^studentCourseContent\.assignment…` menu clause and left hidden rows with
 * no context menu at all (#353). These tests pin the fix from both ends: the
 * marker is a suffix, and the real package.json clauses match a hidden row
 * exactly as they match its visible twin.
 */

const pkg = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
);

interface MenuEntry { command: string; when?: string; group?: string }

const studentEntries: MenuEntry[] = (
  pkg.contributes.menus['view/item/context'] as MenuEntry[]
).filter(entry => (entry.when || '').includes('view == computor.student.courses'));

/**
 * Would this entry's `viewItem` conditions accept `contextValue`?
 * Context keys and the view check are ignored — they do not depend on the row.
 */
function viewItemAccepts(when: string, contextValue: string): boolean {
  const conditions = when.matchAll(
    /(!?)\(?viewItem\s*(=~|==)\s*(?:\/((?:[^/\\]|\\.)*)\/|([\w.$-]+))\)?/g
  );
  for (const match of conditions) {
    const [, negated, op, regexBody, literal] = match;
    const holds =
      op === '=~'
        ? new RegExp(regexBody as string).test(contextValue)
        : literal === contextValue;
    if (negated ? holds : !holds) {
      return false;
    }
  }
  return true;
}

function matchingEntries(contextValue: string): string[] {
  return studentEntries
    .filter(entry => viewItemAccepts(entry.when || '', contextValue))
    .map(entry => `${entry.command}@${entry.group ?? ''}`)
    .sort();
}

function makeProvider(): any {
  return new StudentCourseContentTreeProvider(
    {} as any,
    { getCurrentCourseId: () => undefined } as any
  );
}

function assignmentLeaf(id: string, hidden: boolean) {
  return {
    children: new Map(),
    isUnit: false,
    courseContent: {
      id,
      title: id,
      path: id,
      position: 1,
      directory: `/ws/student/repo/${id}`,
      ...(hidden ? { visible_effective: false } : {}),
    },
    contentType: { id: `type-${id}`, course_content_kind_id: 'assignment', slug: 'assignment', title: 'Assignment' },
  };
}

function unitLeaf(id: string, hidden: boolean) {
  return {
    children: new Map(),
    isUnit: true,
    name: id,
    courseContent: {
      id,
      title: id,
      path: id,
      position: 1,
      description: 'What this unit is about.',
      ...(hidden ? { visible_effective: false } : {}),
    },
  };
}

describe('student tree: hidden rows keep their context menus (#353)', () => {
  let originalFolders: any;
  beforeEach(() => {
    originalFolders = (vscode.workspace as any).workspaceFolders;
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/ws' } }];
  });
  afterEach(() => {
    (vscode.workspace as any).workspaceFolders = originalFolders;
  });

  function contextValueOf(leaf: any): string {
    const provider = makeProvider();
    const node = { children: new Map([[leaf.courseContent.id, leaf]]), isUnit: false };
    const items = provider.createTreeItems(node, undefined);
    const item = items.find((i: any) => i.id === leaf.courseContent.id);
    expect(item, 'tree item was not built').to.exist;
    return String(item.contextValue);
  }

  it('marks a hidden assignment with a trailing .hidden segment', () => {
    const cv = contextValueOf(assignmentLeaf('a1', true));
    expect(cv).to.match(/^studentCourseContent\.assignment/);
    expect(cv).to.match(/\.hidden$/);
  });

  it('marks a hidden unit after its hasDescription segment', () => {
    const cv = contextValueOf(unitLeaf('u1', true));
    expect(cv).to.equal('studentCourseUnit.hasDescription.hidden');
  });

  it('gives a hidden assignment exactly the menus of its visible twin', () => {
    const visible = matchingEntries(contextValueOf(assignmentLeaf('a1', false)));
    const hidden = matchingEntries(contextValueOf(assignmentLeaf('a1', true)));
    expect(visible.length, 'the visible assignment matched no menu entries').to.be.greaterThan(0);
    expect(hidden).to.deep.equal(visible);
  });

  it('gives a hidden unit exactly the menus of its visible twin', () => {
    const visible = matchingEntries(contextValueOf(unitLeaf('u1', false)));
    const hidden = matchingEntries(contextValueOf(unitLeaf('u1', true)));
    expect(visible.length, 'the visible unit matched no menu entries').to.be.greaterThan(0);
    expect(hidden).to.deep.equal(visible);
  });
});
