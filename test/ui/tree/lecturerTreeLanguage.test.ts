import { expect } from 'chai';

import {
  CourseContentTreeItem,
  CourseFolderTreeItem,
  CourseTreeItem
} from '../../../src/ui/tree/lecturer/LecturerTreeItems';
import { TutorStudentTreeProvider } from '../../../src/ui/tree/tutor/TutorStudentTreeProvider';
import { setUiProfileLanguage } from '../../../src/utils/uiLanguage';

const course = { id: 'c', path: 'c', title: 'Grundlagen', archived_at: '2026-10-26T12:00:00', max_test_runs: 5 } as any;
const family = { id: 'f', path: 'f', title: 'Familie' } as any;
const organization = { id: 'o', path: 'o', title: 'Uni' } as any;
const assignmentType = { id: 't', slug: 'a', course_content_kind_id: 'assignment', title: 'Aufgabe' } as any;
const assignment = {
  id: 'p1', path: 'week1.p1', position: 1, course_id: 'c', course_content_type_id: 't', title: 'Plot',
  max_submissions: 3
} as any;

describe('lecturer tree rows follow the UI language', () => {
  afterEach(() => setUiProfileLanguage(undefined));

  it('writes the limit badge of an assignment in German', () => {
    setUiProfileLanguage('de');
    const item = new CourseContentTreeItem({
      courseContent: assignment, course, courseFamily: family, organization, hasChildren: false, contentType: assignmentType
    });
    expect(item.description).to.contain('∞T/3A');
  });

  it('keeps English for an English reading language', () => {
    setUiProfileLanguage('en');
    expect(new CourseFolderTreeItem('groups', course, family, organization).label).to.equal('Groups');
    expect(new CourseTreeItem(course, family, organization).description).to.equal('Course · Archived');
  });

  it('names the content type in a tutor unit tooltip in German', () => {
    setUiProfileLanguage('de');
    const tree = new TutorStudentTreeProvider({} as any, {
      getCurrentCourseId: () => 'c', getCurrentMemberId: () => 'm', getCurrentGroupId: () => null,
      onDidChangeSelection: () => ({ dispose() {} })
    } as any);
    const unit = {
      name: 'Woche 1', isUnit: true, children: new Map(),
      courseContent: {
        id: 'w1', path: 'week1', position: 1, title: 'Woche 1',
        course_content_type: { id: 'u', title: 'Unit', title_i18n: { en: 'Unit', de: 'Einheit' } }
      }
    };
    const [item] = (tree as any).createTreeItems({ children: new Map([['week1', unit]]) }, 'm');
    const tooltip = String((item.tooltip as any)?.value ?? item.tooltip);
    expect(tooltip).to.contain('Typ: Einheit');
    expect(tooltip).not.to.contain('Type:');
  });
});
