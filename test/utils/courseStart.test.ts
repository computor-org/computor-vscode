import { expect } from 'chai';
import type { CourseContentStudentList } from '../../src/types/generated';
import { courseStartPointer } from '../../src/utils/courseStart';

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
});
