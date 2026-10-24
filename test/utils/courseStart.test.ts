import { expect } from 'chai';
import type { CourseContentStudentList } from '../../src/types/generated';
import { courseStartPointer, hasStartedCourse, isCourseItemDone, nextOpenCourseItem } from '../../src/utils/courseStart';

/** Where the welcome page tells a learner to begin (computor-org/issues#527). */
describe('courseStartPointer', () => {
  function item(path: string, title: string, overrides: Partial<CourseContentStudentList> = {}): CourseContentStudentList {
    return {
      id: path, path, title, position: 1, course_content_kind_id: 'assignment', visible_effective: true,
      deployment: { deployment_status: 'deployed' }, ...overrides
    } as CourseContentStudentList;
  }
  const unit = (path: string, title: string, position = 1) =>
    item(path, title, { course_content_kind_id: 'unit', deployment: null, position });

  it('names the first released assignment under its unit, in the reading language', () => {
    const contents = [
      unit('week_2', 'Week 2', 2), item('week_2.loops', 'Schleifen'),
      unit('week_1', 'Week 1', 1), item('week_1.constants', 'Mathematische Konstanten')
    ];

    expect(courseStartPointer(contents, 'de')).to.equal('Woche 1 → Mathematische Konstanten');
    expect(courseStartPointer(contents, 'en')).to.equal('Week 1 → Mathematische Konstanten');
  });

  it('names the course welcome when there is one', () => {
    const contents = [
      unit('week_1', 'Woche 1'), item('week_1.constants', 'Mathematische Konstanten'),
      item('willkommen', 'Willkommen', { course_content_kind_id: 'unit', description: '# Willkommen', deployment: null })
    ];

    expect(courseStartPointer(contents, 'de')).to.equal('Willkommen');
  });

  it('names nothing when nothing is released', () => {
    expect(courseStartPointer([unit('week_1', 'Woche 1')], 'de')).to.equal(undefined);
  });

  it('points a returning learner at the next open assignment instead of the welcome, and at nothing once all are done', () => {
    const passed = { submitted: true, result: { id: 'r', result: 1 } };
    const contents = [
      unit('week_1', 'Woche 1', 1), item('week_1.constants', 'Mathematische Konstanten', passed),
      unit('week_3', 'Woche 3', 3), item('week_3.beta', 'Beta-Absorption', { result_count: 1, result: { id: 'r', result: 0 } }),
      item('willkommen', 'Willkommen', { course_content_kind_id: 'unit', description: '# Willkommen', deployment: null })
    ];

    expect(courseStartPointer(contents, 'de')).to.equal('Woche 3 → Beta-Absorption');
    expect(courseStartPointer(contents.slice(0, 2), 'de')).to.equal(undefined);
  });
});

/** Where a returning learner goes on (computor-org/issues#525). */
describe('nextOpenCourseItem', () => {
  function item(path: string, position: number, overrides: Partial<CourseContentStudentList> = {}): CourseContentStudentList {
    return {
      id: path, path, title: path, position, course_content_kind_id: 'assignment', visible_effective: true,
      result_count: 0, submission_count: 0, deployment: { deployment_status: 'deployed' }, ...overrides
    } as CourseContentStudentList;
  }
  const result = (value: number) => ({ id: 'r', result: value });

  it('skips handed-in assignments, whatever their test result, as the web course page does', () => {
    const contents = [
      item('c', 3),
      item('a', 1, { submitted: true, result: result(1) }),
      item('b', 2, { submitted: true, result: result(0.5) })
    ];
    expect(nextOpenCourseItem(contents)?.id).to.equal('c');
  });

  it('counts a passing test that was not handed in as open, and any submission as done', () => {
    expect(isCourseItemDone(item('a', 1, { result: result(1) }))).to.equal(false);
    expect(isCourseItemDone(item('a', 1, { submitted: true }))).to.equal(true);
    expect(isCourseItemDone(item('a', 1, { submitted: true, result: result(0) }))).to.equal(true);
  });

  it('ignores hidden and unreleased assignments', () => {
    const contents = [
      item('hidden', 1, { visible_effective: false }),
      item('unreleased', 2, { deployment: null }),
      item('open', 3)
    ];
    expect(nextOpenCourseItem(contents)?.id).to.equal('open');
  });

  it('treats a learner as started after the first test run or submission, not before', () => {
    expect(hasStartedCourse([item('a', 1), item('b', 2)])).to.equal(false);
    expect(hasStartedCourse([item('a', 1, { result_count: 1 })])).to.equal(true);
    expect(hasStartedCourse([item('a', 1, { submission_count: 1 })])).to.equal(true);
    expect(hasStartedCourse([item('unit', 1, { course_content_kind_id: 'unit', result_count: 1 })])).to.equal(false);
  });
});
