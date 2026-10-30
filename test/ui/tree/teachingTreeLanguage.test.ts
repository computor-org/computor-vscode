import { expect } from 'chai';
import { TutorStudentTreeProvider } from '../../../src/ui/tree/tutor/TutorStudentTreeProvider';
import { TutorFilterTreeProvider } from '../../../src/ui/tree/tutor/tutor-filter-tree-provider';
import { TutorGroupFilterItem } from '../../../src/ui/tree/tutor/tutor-filter-tree-items';
import { CourseFolderTreeItem, NoGroupTreeItem } from '../../../src/ui/tree/lecturer/LecturerTreeItems';
import { ChatScopeItem } from '../../../src/ui/tree/chat/ChatInboxTreeItems';
import { DocumentsLoadingItem } from '../../../src/ui/tree/lecturer-documents/DocumentsTreeItems';
import { setUiProfileLanguage } from '../../../src/utils/uiLanguage';
import { WorkspaceStructureManager } from '../../../src/utils/workspaceStructure';

// The tutor and lecturer trees named their rows in English for every reader,
// so a German tutor read "Submissions", "References" and "No Group" while the
// German help called them by those English names.

const labels = (items: any[]) => items.map(item => String(item.label));

function tutorTree() {
  const selection = {
    getCurrentCourseId: () => 'course-1',
    getCurrentMemberId: () => 'member-1',
    getCurrentGroupId: () => null,
    onDidChangeSelection: () => ({ dispose() {} })
  } as any;
  const api = {
    listSubmissionArtifacts: async () => [
      { id: 'a2', created_at: '2026-10-02T10:00:00Z' },
      { id: 'a1', created_at: '2026-10-01T10:00:00Z' }
    ]
  } as any;
  return new TutorStudentTreeProvider(api, selection);
}

const assignment = {
  isAssignment: true,
  content: {
    id: 'content-1',
    submission_group: { id: 'group-1' },
    deployment: { example_version_id: 'version-1', version_tag: 'v1' }
  }
};

describe('tutor and lecturer tree labels follow the reading language', () => {
  const getInstance = WorkspaceStructureManager.getInstance;
  beforeEach(() => {
    (WorkspaceStructureManager as any).getInstance = () => ({ referenceExists: async () => false });
  });
  afterEach(() => {
    (WorkspaceStructureManager as any).getInstance = getInstance;
    setUiProfileLanguage(undefined);
  });

  it('names the folders under a tutor assignment in German', async () => {
    setUiProfileLanguage('de');
    const items = await (tutorTree() as any).getAssignmentDirectoryChildren(assignment, 'course-1', 'member-1');
    expect(labels(items)).to.deep.equal(['Abgaben', 'Musterlösung (v1)', 'Verlauf']);
  });

  it('keeps the English folder names for an English reader', async () => {
    setUiProfileLanguage('en');
    const items = await (tutorTree() as any).getAssignmentDirectoryChildren(assignment, 'course-1', 'member-1');
    expect(labels(items)).to.deep.equal(['Submissions', 'References (v1)', 'History']);
  });

  it('labels the tutor group filter and its options in German', async () => {
    setUiProfileLanguage('de');
    const api = { getTutorCourseGroups: async () => [{ id: 'g1', title: 'Gruppe A' }] } as any;
    const selection = { getCurrentCourseId: () => 'course-1', getCurrentGroupId: () => null } as any;
    const provider = new TutorFilterTreeProvider(api, selection, {} as any);
    const filter = new TutorGroupFilterItem('course-1', provider.resolveGroupLabel('course-1', null));
    expect(filter.label).to.equal('Kursgruppen: Alle');
    const options = await (provider as any).getGroupOptions(filter);
    expect(labels(options)).to.deep.equal(['Alle Gruppen', 'Gruppe A', 'Ohne Gruppe']);
  });

  it('names the lecturer course folders and the ungrouped members in German', () => {
    setUiProfileLanguage('de');
    const course = { id: 'c1', title: 'Kurs', path: 'kurs' } as any;
    const folders = (['contents', 'contentTypes', 'groups'] as const)
      .map(kind => new CourseFolderTreeItem(kind, course, {} as any, {} as any));
    expect(labels(folders)).to.deep.equal(['Inhalte', 'Inhaltstypen', 'Gruppen']);
    const noGroup = new NoGroupTreeItem(course, {} as any, {} as any, 2);
    expect([noGroup.label, noGroup.description]).to.deep.equal(['Ohne Gruppe', '2 Mitglieder']);
  });

  it('names message scopes and the documents loading row in German', () => {
    setUiProfileLanguage('de');
    const scope = new ChatScopeItem('user', [], 0, false);
    expect(scope.label).to.equal('Direktnachrichten');
    expect(new DocumentsLoadingItem().label).to.equal('Wird geladen …');
  });
});
