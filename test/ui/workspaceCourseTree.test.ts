import { expect } from 'chai';
import * as vscode from 'vscode';
import { StudentCourseContentTreeProvider } from '../../src/ui/tree/student/StudentCourseContentTreeProvider';

describe('workspace course tree', () => {
  function fixture() {
    const requested: string[] = [];
    let cloned = 0;
    const courses = [
      { id: 'launch', title: 'Launched course', path: 'launch', organization_id: 'org', course_family_id: 'family' },
      { id: 'other', title: 'Other course', path: 'other', organization_id: 'org', course_family_id: 'family' }
    ];
    const api = {
      getStudentCourses: async () => courses,
      getStudentCourseContents: async (id: string) => { requested.push(id); return []; },
      getCourseContentKinds: async () => [],
      getCourseGitDescriptor: async () => ({ configured: true, student_repo_modes: ['managed'] }),
      getCourseRepository: async () => null,
      getOrganization: async () => ({ id: 'org', title: 'Organization', path: 'org' })
    };
    const tree = new StudentCourseContentTreeProvider(api as any, { getCurrentCourseId: () => undefined } as any);
    (tree as any).provisioning = {};
    (tree as any).setupCourseGitWithProgress = async () => { cloned++; };
    return { tree, requested, cloned: () => cloned, courses };
  }

  it('shows the launch course directly without organization/family drilldown or unrelated content requests', async () => {
    const { tree, requested } = fixture();
    tree.setWorkspaceCourse('launch');
    const roots = await tree.getChildren();
    expect(roots.map(item => item.id)).to.deep.equal(['course-launch']);
    expect(requested).to.deep.equal(['launch']);
  });

  it('opens course instructions without cloning its managed repository', async () => {
    const { tree, cloned } = fixture();
    tree.setWorkspaceCourse('launch');
    const roots = await tree.getChildren();
    await tree.getChildren(roots[0]);
    expect(cloned()).to.equal(0);
  });

  it('retargets an existing tree to a different course', async () => {
    const { tree, requested } = fixture();
    tree.setWorkspaceCourse('launch');
    await tree.getChildren();
    tree.setWorkspaceCourse('other');
    const roots = await tree.getChildren();
    expect(roots.map(item => item.id)).to.deep.equal(['course-other']);
    expect(requested).to.deep.equal(['launch', 'other']);
  });

  it('does not restore expanded assignments while opening instructions after a failed setup', async () => {
    const { tree } = fixture();
    (tree as any).expandedStates = { assignment: true };
    tree.setWorkspaceCourse('launch');
    const node = { children: new Map([['exercise', {
      children: new Map(), isUnit: false,
      courseContent: { id: 'assignment', title: 'Exercise', course_id: 'launch', path: 'exercise', position: 1 },
      contentType: { course_content_kind_id: 'assignment' }
    }]]) };
    const rendered = (tree as any).createTreeItems(node);
    expect(rendered[0].collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
    await tree.setNodeExpanded('assignment', true);
    expect((tree as any).createTreeItems(node)[0].collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Expanded);
  });

  it('does not expose another course when the requested course becomes inaccessible', async () => {
    const { tree, requested, courses } = fixture();
    tree.setWorkspaceCourse('launch');
    courses.splice(0, 1);
    const roots = await tree.getChildren();
    expect(roots.map(item => item.label)).to.deep.equal(['This course is no longer available.']);
    expect(requested).to.deep.equal([]);
  });

  it('keeps ordinary desktop grouping without prefetching every course contents', async () => {
    const { tree, requested } = fixture();
    const roots = await tree.getChildren();
    expect(roots.map(item => item.id)).to.deep.equal(['org-org']);
    expect(requested).to.deep.equal([]);
  });
});
