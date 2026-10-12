import { expect } from 'chai';
import JSZip from 'jszip';
import { firstReleasedCourseItem, readStudentDescription, studentDescriptionImages } from '../../src/services/WorkspaceCourseLanding';
import type { CourseContentStudentList } from '../../src/types/generated';

async function archive(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, contents] of Object.entries(files)) { zip.file(name, contents); }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('readStudentDescription', () => {
  it('opens the preferred description language from the released assignment archive', async () => {
    const zip = await archive({
      'README.md': 'Default description',
      'README_de.md': 'Deutsche Aufgabenstellung',
      'README_en.md': 'English assignment',
      'main.py': 'print(42)'
    });

    expect(await readStudentDescription(zip, 'de')).to.equal('Deutsche Aufgabenstellung');
    expect(await readStudentDescription(zip, 'fr')).to.equal('English assignment');
    expect(await readStudentDescription(zip, null)).to.equal('English assignment');
  });

  it('accepts index descriptions in a single canonical archive folder', async () => {
    const zip = await archive({
      'math-constants/index_de.md': 'Konstanten bestimmen',
      'math-constants/index_en.md': 'Find the constants',
      'math-constants/main.py': 'import math',
      'math-constants/tests/case.py': 'assert True'
    });

    expect(await readStudentDescription(zip, 'de')).to.equal('Konstanten bestimmen');
    expect(await readStudentDescription(zip, 'it')).to.equal('Find the constants');
  });

  it('uses the default description when the preferred and English translations are absent', async () => {
    const zip = await archive({ 'README.md': 'Default', 'README_de.md': 'Deutsch' });
    expect(await readStudentDescription(zip, 'fr')).to.equal('Default');
  });

  it('does not use a dependency README as the assignment description', async () => {
    const zip = await archive({
      'README_en.md': 'The actual assignment',
      'dependencies/tool/README_de.md': 'Unrelated package instructions'
    });
    expect(await readStudentDescription(zip, 'de')).to.equal('The actual assignment');
  });

  it('does not guess between unrelated folders when the archive has no canonical root', async () => {
    const zip = await archive({
      'library-a/README_de.md': 'First package',
      'library-b/README_en.md': 'Second package'
    });
    expect(await readStudentDescription(zip, 'de')).to.equal(undefined);
  });

  it('ignores path traversal entries even if the zip loader normalizes their names', async () => {
    const zip = await archive({
      '../README_de.md': 'Escaped description',
      'folder/../../index_de.md': 'Another escaped description',
      'README_en.md': 'Safe assignment'
    });
    expect(await readStudentDescription(zip, 'de')).to.equal('Safe assignment');
  });

  it('does not treat absolute paths, Windows paths or macOS metadata as assignment descriptions', async () => {
    const zip = await archive({
      '/README_de.md': 'Absolute path',
      '..\\README_de.md': 'Windows traversal',
      '__MACOSX/README_de.md': 'Metadata',
      'README_en.md': 'Safe assignment'
    });
    expect(await readStudentDescription(zip, 'de')).to.equal('Safe assignment');
  });

  it('returns no description for deeply nested readmes or an archive without description files', async () => {
    expect(await readStudentDescription(await archive({
      'example/assets/tool/README.md': 'A package readme',
      'example/main.py': 'pass'
    }))).to.equal(undefined);
    expect(await readStudentDescription(await archive({
      'main.py': 'pass',
      'CHANGELOG.md': 'Changes',
      'notes.md': 'Notes'
    }))).to.equal(undefined);
    expect(await readStudentDescription(await archive({}))).to.equal(undefined);
  });
});

describe('firstReleasedCourseItem', () => {
  function item(id: string, overrides: Partial<CourseContentStudentList> = {}): CourseContentStudentList {
    return {
      id,
      path: id,
      course_id: 'course-1',
      course_content_type_id: 'python',
      course_content_kind_id: 'assignment',
      position: 1,
      course_content_type: { id: 'python', title: 'Python' },
      result_count: 0,
      submission_count: 0,
      color: '#ffffff',
      visible_effective: true,
      deployment: {
        id: `deployment-${id}`,
        course_content_id: id,
        example_version_id: 'version-1',
        deployment_status: 'deployed',
        assigned_at: '2026-10-12T10:00:00Z',
        deployed_at: '2026-10-12T10:01:00Z',
        version_identifier: 'v1'
      },
      ...overrides
    } as CourseContentStudentList;
  }

  it('selects the first visible, released assignment rather than modules or hidden and unreleased exercises', () => {
    const expected = item('second', { position: 2 });
    const contents = [
      item('hidden', { visible_effective: false }),
      item('unreleased', { deployment: null }),
      item('module', { course_content_kind_id: 'unit' }),
      item('later', { position: 3 }),
      expected
    ];
    expect(firstReleasedCourseItem(contents)).to.equal(expected);
  });

  it('sorts a copy of the course contents without changing the visible tree order', () => {
    const later = item('later', { position: 3 });
    const earlier = item('earlier', { position: 1 });
    const contents = [later, earlier];
    expect(firstReleasedCourseItem(contents)).to.equal(earlier);
    expect(contents).to.deep.equal([later, earlier]);
  });

  it('returns no exercise when none are released', () => {
    expect(firstReleasedCourseItem([])).to.equal(undefined);
    expect(firstReleasedCourseItem([item('unreleased', { deployment: null })])).to.equal(undefined);
  });

  it('follows parent unit order before comparing assignment positions in different units', () => {
    const first = item('first', { path: 'intro.second', position: 2 });
    const contents = [
      item('later', { path: 'advanced.first', position: 1 }),
      item('advanced', { path: 'advanced', position: 2, course_content_kind_id: 'unit' }),
      first,
      item('intro', { path: 'intro', position: 1, course_content_kind_id: 'unit' })
    ];
    expect(firstReleasedCourseItem(contents)).to.equal(first);
  });
});

describe('studentDescriptionImages', () => {
  it('keeps relative instruction images readable without writing a repository', async () => {
    const images = await studentDescriptionImages(await archive({
      'mediaFiles/diagram.png': 'png data',
      'assets/figure.svg': '<svg/>',
      'README.md': 'Instructions',
      'solution.py': 'secret',
      '../images/escaped.png': 'outside'
    }));
    expect(images).to.deep.equal({
      'mediaFiles/diagram.png': `data:image/png;base64,${Buffer.from('png data').toString('base64')}`,
      'assets/figure.svg': `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`
    });
  });
});
