import { expect } from 'chai';
import * as vscode from 'vscode';
import { ComputorApiService } from '../../src/services/ComputorApiService';
import { CourseSelectionService } from '../../src/services/CourseSelectionService';
import { StudentCourseContentTreeProvider } from '../../src/ui/tree/student/StudentCourseContentTreeProvider';
import { TutorStudentTreeProvider } from '../../src/ui/tree/tutor/TutorStudentTreeProvider';
import { CourseContentTreeItem, CourseContentTypeTreeItem, CourseTreeItem } from '../../src/ui/tree/lecturer/LecturerTreeItems';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';

const assignmentType = {
  id: 'type', slug: 'assignment', course_content_kind_id: 'assignment', color: '#000', course_id: 'c',
  title: 'Aufgabe', title_i18n: { de: 'Aufgabe', en: 'Assignment' }
};
const unitType = {
  id: 'unit-type', slug: 'unit', course_content_kind_id: 'unit', color: '#000', course_id: 'c',
  title: 'Einheit', title_i18n: { de: 'Einheit', en: 'Unit' }
};
const content = {
  id: 'p1', path: 'week1.p1', position: 1, course_id: 'c', course_content_type_id: 'type',
  title: 'Einfacher Plot von Vektoren', title_i18n: { de: 'Einfacher Plot von Vektoren', en: 'Simple Plot of Vectors' }
};
const tooltipText = (item: vscode.TreeItem) => String((item.tooltip as any)?.value ?? item.tooltip ?? '');

describe('titles in the reading language', () => {
  afterEach(() => setUiProfileLanguage(undefined));

  describe('student API', () => {
    it('asks for course and content titles in the reading language and keeps one cache per language', async () => {
      const urls: string[] = [];
      const api = new ComputorApiService({} as any, {
        get: async (url: string) => { urls.push(url); return { data: [] }; }
      } as any);
      setUiProfileLanguage('en');
      await api.getStudentCourseContents('course-a');
      await api.getStudentCourses();
      await api.getStudentCourseContents('course-a');
      setUiProfileLanguage('de');
      await api.getStudentCourseContents('course-a');
      expect(urls).to.deep.equal([
        '/students/course-contents?course_id=course-a&localize=en',
        '/students/courses?localize=en',
        '/students/course-contents?course_id=course-a&localize=de'
      ]);
      api.clearStudentCourseContentsCache('course-a');
      await api.getStudentCourseContents('course-a');
      expect(urls.at(-1)).to.equal('/students/course-contents?course_id=course-a&localize=de');
      expect(urls).to.have.length(4);
    });
  });

  describe('student tree', () => {
    function rows(): any[] {
      const provider: any = new StudentCourseContentTreeProvider({} as any, { getCurrentCourseId: () => undefined } as any);
      const node = {
        children: new Map<string, any>([
          ['week1', {
            name: 'Week 1', children: new Map(), isUnit: true,
            courseContent: { id: 'w1', path: 'week1', position: 1, title: 'Week 1' }, contentType: unitType
          }],
          ['p1', {
            name: content.title, children: new Map(), isUnit: false,
            courseContent: content, contentType: assignmentType
          }]
        ]),
        isUnit: false
      };
      return provider.createTreeItems(node);
    }

    it('names the content type in the reading language', () => {
      setUiProfileLanguage('en');
      const [unit, assignment] = rows();
      expect(tooltipText(unit)).to.contain('Type: Unit');
      expect(tooltipText(assignment)).to.contain('Type: Assignment');
      expect(assignment.accessibilityInformation.label).to.contain('Assignment');
      setUiProfileLanguage('de');
      expect(tooltipText(rows()[1])).to.contain('Typ: Aufgabe');
    });
  });

  describe('tutor tree', () => {
    it('resolves content and type titles from their maps on every render', () => {
      const provider: any = new TutorStudentTreeProvider({} as any, { onDidChangeSelection: () => ({ dispose() {} }) } as any);
      const week = { id: 'w1', path: 'week1', position: 1, title: 'Woche 1', title_i18n: { en: 'Week 1' }, course_content_type: unitType };
      const reading = { ...content, course_content_type: { ...assignmentType, course_content_kind_id: 'reading' } };
      const render = () => {
        const tree = provider.buildContentTree([week, reading], [
          { id: 'unit', has_descendants: true, submittable: false },
          { id: 'reading', has_descendants: false, submittable: false }
        ]);
        const [unit] = provider.createTreeItems(tree, 'member');
        return { unit, leaf: provider.createTreeItems(unit.node, 'member')[0] };
      };
      setUiProfileLanguage('en');
      let { unit, leaf } = render();
      expect(String(unit.label)).to.contain('Week 1');
      expect(tooltipText(unit)).to.contain('Type: Unit');
      expect(String(leaf.label)).to.contain('Simple Plot of Vectors');
      setUiProfileLanguage('de');
      ({ unit, leaf } = render());
      expect(String(unit.label)).to.contain('Woche 1');
      expect(String(leaf.label)).to.contain('Einfacher Plot von Vektoren');
    });
  });

  describe('lecturer tree', () => {
    const course = { id: 'c', path: 'c', title: 'Grundlagen', title_i18n: { en: 'Foundations', de: ' ' } };
    const family = { id: 'f', path: 'f', title: 'Family' } as any;
    const organization = { id: 'o', path: 'o', title: 'Org' } as any;

    it('labels courses, contents and content types in the reading language', () => {
      setUiProfileLanguage('en');
      expect(new CourseTreeItem(course as any, family, organization).label).to.equal('Foundations');
      expect(new CourseContentTypeTreeItem(assignmentType as any, course as any, family, organization).label).to.equal('Assignment');
      expect(new CourseContentTreeItem({
        courseContent: content as any, course: course as any, courseFamily: family, organization, hasChildren: false
      }).label).to.equal('Simple Plot of Vectors');
    });

    it('keeps the source text for a blank entry and leaves the data for edit forms untouched', () => {
      setUiProfileLanguage('de');
      const item = new CourseTreeItem(course as any, family, organization);
      expect(item.label).to.equal('Grundlagen');
      setUiProfileLanguage('en');
      const contentItem = new CourseContentTreeItem({
        courseContent: content as any, course: course as any, courseFamily: family, organization, hasChildren: false
      });
      expect(contentItem.courseContent.title).to.equal('Einfacher Plot von Vektoren');
    });
  });

  describe('selected course', () => {
    it('shows the course title again in the new language', async () => {
      const previousInstance = (CourseSelectionService as any).instance;
      const previousFolders = vscode.workspace.workspaceFolders;
      const previousExecute = vscode.commands.executeCommand;
      try {
        (CourseSelectionService as any).instance = undefined;
        (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file('/workspace') }];
        (vscode.commands as any).executeCommand = async () => undefined;
        const shown: string[] = [];
        let language = 'de';
        const titles: Record<string, string> = { de: 'Grundlagen', en: 'Foundations' };
        const service = CourseSelectionService.initialize(
          { globalState: { update: async () => undefined } } as any,
          { getStudentCourses: async () => [{ id: 'c', path: 'c', title: titles[language] }] } as any,
          { updateCourse: (name: string) => shown.push(name) } as any
        );
        await service.selectCourse('c');
        language = 'en';
        await service.refreshLanguage();
        expect(shown).to.deep.equal(['Grundlagen', 'Foundations']);
        expect(service.getCurrentCourseInfo()?.title).to.equal('Foundations');
      } finally {
        (CourseSelectionService as any).instance = previousInstance;
        (vscode.workspace as any).workspaceFolders = previousFolders;
        (vscode.commands as any).executeCommand = previousExecute;
      }
    });
  });
});
