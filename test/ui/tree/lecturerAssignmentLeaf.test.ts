import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';
import * as vscode from 'vscode';

import {
  courseContentCollapsibleState,
  CourseContentTreeItem
} from '../../../src/ui/tree/lecturer/LecturerTreeItems';

/**
 * Whether a lecturer course-content row is collapsible has flipped three times.
 * c58dc3e forced every submittable content to None, which also killed the arrow
 * on units. 713de01 over-corrected to `hasChildren || isSubmittable`, so
 * assignments grew an arrow that expanded into a single "Assignment directory
 * not available locally" placeholder — and could kick off a git clone on the
 * way. This change makes it `hasChildren` alone, in one shared helper, and these
 * tests exist so the fourth flip has to argue with a red suite first.
 */
describe('lecturer course content collapsible state', () => {
  describe('courseContentCollapsibleState', () => {
    it('gives an assignment no arrow — it has no child contents', () => {
      expect(courseContentCollapsibleState({ hasChildren: false }))
        .to.equal(vscode.TreeItemCollapsibleState.None);
    });

    it('ignores a stale persisted expansion on a childless row', () => {
      // UiStateService still holds `content-<id>: true` for assignments that
      // were expandable under 713de01; that must not resurrect the arrow.
      expect(courseContentCollapsibleState({ hasChildren: false, expanded: true }))
        .to.equal(vscode.TreeItemCollapsibleState.None);
    });

    it('collapses a unit with children, and expands a remembered one', () => {
      expect(courseContentCollapsibleState({ hasChildren: true }))
        .to.equal(vscode.TreeItemCollapsibleState.Collapsed);
      expect(courseContentCollapsibleState({ hasChildren: true, expanded: true }))
        .to.equal(vscode.TreeItemCollapsibleState.Expanded);
    });
  });

  describe('CourseContentTreeItem', () => {
    function makeItem(overrides: any = {}): CourseContentTreeItem {
      return new CourseContentTreeItem({
        courseContent: { id: 'cc-1', title: 'Assignment 1', path: 'unit1.a1' } as any,
        course: { id: 'course-1' } as any,
        courseFamily: { id: 'family-1' } as any,
        organization: { id: 'org-1' } as any,
        hasChildren: false,
        ...overrides
      });
    }

    it('renders a submittable assignment as a leaf but keeps its context value', () => {
      const item = makeItem({
        isSubmittable: true,
        contentType: { id: 'ct-1', slug: 'assignment', course_content_kind_id: 'assignment' } as any
      });

      expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.None);
      // The menus key off these — `openAssignmentFolder` and friends must survive.
      expect(item.contextValue).to.contain('submittable');
      expect(item.contextValue).to.contain('assignment');
    });

    it('still expands a submittable content that genuinely has child contents', () => {
      const item = makeItem({ hasChildren: true, isSubmittable: true });
      expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
    });

    it('honours an explicit collapsibleState in both directions', () => {
      expect(makeItem({ collapsibleState: vscode.TreeItemCollapsibleState.Expanded }).collapsibleState)
        .to.equal(vscode.TreeItemCollapsibleState.Expanded);
      // None is 0, so a `||` default would silently discard this override.
      expect(makeItem({ hasChildren: true, collapsibleState: vscode.TreeItemCollapsibleState.None }).collapsibleState)
        .to.equal(vscode.TreeItemCollapsibleState.None);
    });
  });

  describe('the provider decides it in exactly one place', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../src/ui/tree/lecturer/LecturerTreeDataProvider.ts'),
      'utf8'
    );

    it('routes both the render and reveal paths through the shared helper', () => {
      const calls = source.split('courseContentCollapsibleState(').length - 1;
      expect(calls, 'buildContentTreeItem and getParent must both call the helper')
        .to.be.at.least(2);
    });

    it('never lets isSubmittable reach a collapsible state again', () => {
      const offenders = source.split('\n').filter(line =>
        /isSubmittable.*CollapsibleState|CollapsibleState.*isSubmittable/.test(line)
      );
      expect(offenders, 'submittability must not decide the expand arrow').to.deep.equal([]);
    });
  });
});
