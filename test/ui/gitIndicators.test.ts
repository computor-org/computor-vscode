import { expect } from 'chai';
import {
  assignmentGitIndicator,
  assignmentGitTooltipLines,
  courseGitIndicator,
  courseGitTooltipLines
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
    it('names every shown glyph, tersely', () => {
      expect(assignmentGitTooltipLines({ dirty: true, unpushed: true, pushFailing: true })).to.deep.equal([
        '● Uncommitted changes',
        '↑ Unpushed changes',
        '⚠ Push failing'
      ]);
    });

    it('stays silent for a clean assignment', () => {
      expect(assignmentGitTooltipLines({ dirty: false, unpushed: false, pushFailing: true })).to.deep.equal([]);
    });
  });

  describe('courseGitIndicator', () => {
    it('is undefined when clean, pushed and healthy', () => {
      expect(courseGitIndicator(false, 0, false)).to.be.undefined;
    });

    it('shows uncommitted work', () => {
      expect(courseGitIndicator(true, 0, false)).to.equal('●');
    });

    it('shows the ahead count', () => {
      expect(courseGitIndicator(false, 3, false)).to.equal('↑3');
    });

    it('leads with the push failure', () => {
      expect(courseGitIndicator(true, 2, true)).to.equal('⚠ push failing ● ↑2');
      expect(courseGitIndicator(false, 0, true)).to.equal('⚠ push failing');
    });
  });

  describe('courseGitTooltipLines', () => {
    it('names each glyph in description order', () => {
      expect(courseGitTooltipLines(true, 2, true)).to.deep.equal([
        '⚠ Push failing',
        '● Uncommitted changes',
        '↑ 2 unpushed commits'
      ]);
      expect(courseGitTooltipLines(false, 1, false)).to.deep.equal(['↑ 1 unpushed commit']);
    });

    it('is empty when clean, pushed and healthy', () => {
      expect(courseGitTooltipLines(false, 0, false)).to.deep.equal([]);
    });
  });
});
