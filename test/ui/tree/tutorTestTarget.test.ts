import { expect } from 'chai';
import { TutorVirtualFolderItem } from '../../../src/ui/tree/tutor/TutorStudentTreeProvider';
import { tutorTestTargetFor } from '../../../src/ui/tree/tutor/tutorTestTarget';

// "Run Test" is one command shared by five tutor tree nodes. Its body used to
// branch on what was on disk alone, so on References it packaged the student's
// downloaded submission and the reference was only ever tested through the
// "no submission found" fallback prompt. These build the real tree nodes, so a
// change to how a node is shaped cannot silently take the routing with it.

const content = { id: 'content-1' } as any;

describe('what Run Test packages, per tutor tree node', () => {
  it('tests the reference from the References folder', () => {
    const references = new TutorVirtualFolderItem('References', 'reference', content, 'course-1', 'member-1', {
      referenceExists: true
    });

    expect(references.contextValue).to.equal('tutorVirtualFolder.reference');
    expect(tutorTestTargetFor(references)).to.equal('reference');
  });

  it('tests a submission from every other node', () => {
    const submissions = new TutorVirtualFolderItem('Submissions', 'submissions', content, 'course-1', 'member-1', {
      latestArtifactId: 'artifact-1',
      submissionGroupId: 'group-1'
    });
    const history = new TutorVirtualFolderItem('History', 'history', content, 'course-1', 'member-1', {
      artifacts: []
    });
    const assignment = { content, memberId: 'member-1', contextValue: 'tutorStudentContent.assignment.hasRepo' };

    expect(tutorTestTargetFor(submissions)).to.equal('submission');
    expect(tutorTestTargetFor(history)).to.equal('submission');
    expect(tutorTestTargetFor(assignment)).to.equal('submission');
  });
});
