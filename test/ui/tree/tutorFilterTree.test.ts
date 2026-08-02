import { expect } from 'chai';
import { TutorFilterTreeProvider } from '../../../src/ui/tree/tutor/tutor-filter-tree-provider';
import {
  TutorCourseFilterItem,
  TutorMemberFilterItem
} from '../../../src/ui/tree/tutor/tutor-filter-tree-items';

/**
 * Switching course in tutor mode left the tree on the course you had just
 * left, until you hit Refresh (computor-org/issues#287).
 *
 * Expansion is persisted, so the old course's node is still expanded and still
 * resolves its children. Resolving them called autoSelectFirstMember
 * unconditionally, which — finding no member of the newly selected course in
 * the old course's roster — re-elected the old course's first member. A render
 * path was writing the global selection, and whichever expanded course
 * resolved last won.
 */
describe('TutorFilterTreeProvider course scoping', () => {
  const PYTHON = 'course-python';
  const MATLAB = 'course-matlab';

  function makeMember(id: string, courseId: string, groupId: string | null) {
    return {
      id,
      course_group_id: groupId,
      user: { given_name: id, family_name: courseId, email: `${id}@example.org` }
    };
  }

  function makeApi() {
    return {
      getTutorCourses: async () => [
        { id: PYTHON, title: 'Python', organization_id: 'org', course_family_id: 'fam' },
        { id: MATLAB, title: 'MATLAB', organization_id: 'org', course_family_id: 'fam' }
      ],
      getOrganization: async () => ({ id: 'org', title: 'Org' }),
      getCourseFamily: async () => ({ id: 'fam', title: 'Fam' }),
      getTutorCourseGroups: async (courseId: string) => [
        { id: `${courseId}-groupA`, title: 'Group A' }
      ],
      getTutorCourseMembers: async (courseId: string) =>
        courseId === PYTHON
          ? [makeMember('py-alice', PYTHON, `${PYTHON}-groupA`)]
          : [makeMember('ml-bob', MATLAB, `${MATLAB}-groupA`)]
    } as any;
  }

  /** A selection service that records every write, like the real one. */
  function makeSelection(courseId: string, memberId: string | null) {
    const writes: string[] = [];
    return {
      writes,
      getCurrentCourseId: () => courseId,
      getCurrentGroupId: () => null,
      getCurrentMemberId: () => memberId,
      getMemberEmail: () => 'set@example.org',
      selectMember: async (id: string) => {
        writes.push(id);
      }
    } as any;
  }

  async function childrenOfCourse(
    provider: TutorFilterTreeProvider,
    courseId: string
  ): Promise<any[]> {
    const item = new TutorCourseFilterItem({ id: courseId, title: courseId }, false, true);
    return provider.getChildren(item) as Promise<any[]>;
  }

  it('does not let a non-selected course re-elect the selected member', async () => {
    // MATLAB is selected; the Python node is still expanded from before.
    const selection = makeSelection(MATLAB, 'ml-bob');
    const provider = new TutorFilterTreeProvider(makeApi(), selection);

    await childrenOfCourse(provider, PYTHON);

    expect(selection.writes, 'the Python node wrote to the selection').to.deep.equal([]);
  });

  it('still auto-selects a member for the selected course', async () => {
    // Nothing chosen yet in MATLAB — that is what auto-select is for.
    const selection = makeSelection(MATLAB, null);
    const provider = new TutorFilterTreeProvider(makeApi(), selection);

    await childrenOfCourse(provider, MATLAB);

    expect(selection.writes).to.deep.equal(['ml-bob']);
  });

  it('marks no member as selected under a course that is not the selected one', async () => {
    const selection = makeSelection(PYTHON, 'py-alice');
    const provider = new TutorFilterTreeProvider(makeApi(), selection);

    const children = await childrenOfCourse(provider, MATLAB);
    const members = children.filter((c) => c instanceof TutorMemberFilterItem);

    expect(members).to.have.length(1);
    expect(members[0].isSelected).to.equal(false);
  });

  it('renders both courses when they resolve at the same time', async () => {
    // The in-flight guards used to be single slots, so the second course to
    // start a fetch cancelled the first and rendered it empty.
    const selection = makeSelection(MATLAB, 'ml-bob');
    const provider = new TutorFilterTreeProvider(makeApi(), selection);

    const [python, matlab] = await Promise.all([
      childrenOfCourse(provider, PYTHON),
      childrenOfCourse(provider, MATLAB)
    ]);

    expect(python.filter((c) => c instanceof TutorMemberFilterItem)).to.have.length(1);
    expect(matlab.filter((c) => c instanceof TutorMemberFilterItem)).to.have.length(1);
  });

  it('asks the API once per course even when two nodes resolve together', async () => {
    const api = makeApi();
    let memberCalls = 0;
    const inner = api.getTutorCourseMembers;
    api.getTutorCourseMembers = async (courseId: string, groupId?: string) => {
      memberCalls += 1;
      return inner(courseId, groupId);
    };
    const provider = new TutorFilterTreeProvider(api, makeSelection(MATLAB, 'ml-bob'));

    await Promise.all([
      childrenOfCourse(provider, MATLAB),
      childrenOfCourse(provider, MATLAB)
    ]);

    expect(memberCalls).to.equal(1);
  });
});
