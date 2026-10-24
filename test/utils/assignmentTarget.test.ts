import { expect } from 'chai';
import * as path from 'path';
import { assignmentForFile, assignmentFromSelection, confirmationPrompt, submittedMessage } from '../../src/utils/assignmentTarget';

// The Command Palette passes no tree element, so Test and Submit have to find
// the assignment themselves (computor-org/issues#470).

const content = (id: string, directory: string, withGroup = true) => ({
  id,
  title: id,
  directory,
  submission_group: withGroup ? { id: `g-${id}` } : undefined
});

describe('assignmentFromSelection', () => {
  it('returns the highlighted assignment row', () => {
    const row = { contextValue: 'studentCourseContent.assignment.withRepository.cloned', courseContent: content('a', '/ws/a') };
    expect(assignmentFromSelection([row])).to.equal(row);
  });

  it('ignores units and folders, and an empty selection', () => {
    expect(assignmentFromSelection([{ contextValue: 'studentCourseUnit' }])).to.equal(undefined);
    expect(assignmentFromSelection([])).to.equal(undefined);
    expect(assignmentFromSelection(undefined)).to.equal(undefined);
  });
});

describe('assignmentForFile', () => {
  const root = path.resolve('/ws/student/course');
  const contents = [
    content('math', path.join(root, 'math_constants')),
    content('vec', path.join(root, 'vector_compute')),
    content('unit', path.join(root, 'week1'), false)
  ];

  it('maps a file in an assignment directory to that assignment', () => {
    const found = assignmentForFile(contents, path.join(root, 'math_constants', 'mathc.py'));
    expect(found?.courseContent.id).to.equal('math');
    expect(found?.submissionGroup.id).to.equal('g-math');
  });

  it('does not match a sibling directory with a common name prefix', () => {
    expect(assignmentForFile(contents, path.join(root, 'math_constants_extra', 'x.py'))).to.equal(undefined);
  });

  it('ignores contents without a submission group and files outside every directory', () => {
    expect(assignmentForFile(contents, path.join(root, 'week1', 'README.md'))).to.equal(undefined);
    expect(assignmentForFile(contents, '/elsewhere/file.py')).to.equal(undefined);
    expect(assignmentForFile(contents, undefined)).to.equal(undefined);
  });

  it('prefers the deepest directory and resolves relative ones against the base', () => {
    const nested = [content('outer', 'a'), content('inner', 'a/b')];
    const found = assignmentForFile(nested, path.join(root, 'a', 'b', 'f.py'), root);
    expect(found?.courseContent.id).to.equal('inner');
  });
});

describe('palette wording', () => {
  it('preserves the exact English confirmation by default and explicitly', () => {
    for (const language of [undefined, 'en'] as const) {
      expect(confirmationPrompt('test', 'Math Constants', language)).to.deep.equal({
        verb: 'Test',
        message: 'Test "Math Constants"?',
        detail: 'Your saved changes are committed, uploaded and run against the tests. Nothing is submitted for grading.'
      });
      expect(confirmationPrompt('submit', 'Math Constants', language)).to.deep.equal({
        verb: 'Submit',
        message: 'Submit "Math Constants"?',
        detail: 'Your work is sent for grading. The last tested version is submitted and counts against your submission limit.'
      });
    }
  });

  it('explains testing in German without submitting for grading', () => {
    expect(confirmationPrompt('test', 'Mathematische Konstanten', 'de')).to.deep.equal({
      verb: 'Aufgabe testen',
      message: '„Mathematische Konstanten“ testen?',
      detail: 'Deine gespeicherten Änderungen werden als Commit gesichert, hochgeladen und mit den Tests geprüft. Dabei gibst du nichts zur Bewertung ab.'
    });
  });

  it('explains the tested version and submission limit in German', () => {
    expect(confirmationPrompt('submit', 'Mathematische Konstanten', 'de')).to.deep.equal({
      verb: 'Abgeben',
      message: '„Mathematische Konstanten“ abgeben?',
      detail: 'Du gibst die zuletzt getestete Version deiner Arbeit zur Bewertung ab. Dafür wird eine deiner erlaubten Abgaben verwendet.'
    });
  });

  it('confirms an English submission with the short revision', () => {
    expect(submittedMessage('Vector Compute', '0123456789abcdef', 'en')).to.equal('Submitted "Vector Compute" (revision 01234567).');
    expect(submittedMessage('Vector Compute', undefined, 'en')).to.equal('Submitted "Vector Compute".');
  });

  it('confirms a German submission with its original title and short revision', () => {
    expect(submittedMessage('Mathematische Konstanten', '0123456789abcdef', 'de'))
      .to.equal('„Mathematische Konstanten“ wurde abgegeben (Revision 01234567).');
    expect(submittedMessage('Mathematische Konstanten', undefined, 'de'))
      .to.equal('„Mathematische Konstanten“ wurde abgegeben.');
  });
});
