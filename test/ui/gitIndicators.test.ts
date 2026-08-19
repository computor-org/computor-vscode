import { expect } from 'chai';
import {
  assignmentGitIndicator,
  assignmentGitTooltipLines,
  courseGitIndicator
} from '../../src/ui/tree/gitIndicators';

describe('gitIndicators', () => {
  describe('assignmentGitIndicator', () => {
    it('shows ● for uncommitted changes', () => {
      expect(assignmentGitIndicator({ dirty: true, unpushed: false, pushFailing: false })).to.equal('●');
    });

    it('shows ↑ for committed-but-unpushed changes', () => {
      expect(assignmentGitIndicator({ dirty: false, unpushed: true, pushFailing: false })).to.equal('↑');
    });

    it('combines ● and ↑', () => {
      expect(assignmentGitIndicator({ dirty: true, unpushed: true, pushFailing: false })).to.equal('● ↑');
    });

    it('prepends ⚠ when pushes fail and there is pending work', () => {
      expect(assignmentGitIndicator({ dirty: false, unpushed: true, pushFailing: true })).to.equal('⚠ ↑');
    });

    it('shows nothing for a clean assignment even when pushes fail elsewhere', () => {
      expect(assignmentGitIndicator({ dirty: false, unpushed: false, pushFailing: true })).to.equal('');
    });
  });

  describe('assignmentGitTooltipLines', () => {
    it('explains every shown glyph', () => {
      const lines = assignmentGitTooltipLines({ dirty: true, unpushed: true, pushFailing: true });
      expect(lines).to.have.lengthOf(3);
      expect(lines[0]).to.include('Uncommitted');
      expect(lines[1]).to.include('not yet pushed');
      expect(lines[2]).to.include('Fix Repository Authentication');
    });

    it('stays silent for a clean assignment', () => {
      expect(assignmentGitTooltipLines({ dirty: false, unpushed: false, pushFailing: true })).to.deep.equal([]);
    });
  });

  describe('courseGitIndicator', () => {
    it('is undefined when pushed and healthy', () => {
      expect(courseGitIndicator(0, false)).to.be.undefined;
    });

    it('shows the ahead count', () => {
      expect(courseGitIndicator(3, false)).to.equal('↑3');
    });

    it('leads with the push failure', () => {
      expect(courseGitIndicator(2, true)).to.equal('⚠ push failing ↑2');
      expect(courseGitIndicator(0, true)).to.equal('⚠ push failing');
    });
  });
});
