import { expect } from 'chai';
import {
  formatBudgetCompact,
  formatBudgetLong,
  submissionBudget,
  testBudget,
} from '../../../src/ui/tree/limitFormatting';

/**
 * The counters in the student and tutor trees used to render only when a
 * *count* was present, so a capped assignment showed "(0)" until the first
 * run and the student learned about the limit from the run that got refused
 * (computor-org/issues#337). These tests pin the opposite rule: a limit is
 * always visible, from zero usage onward.
 */
describe('limitFormatting', () => {
  describe('testBudget', () => {
    it('reports the limit before anything has been run', () => {
      const budget = testBudget({ result_count: 0, max_test_runs: 2 });
      expect(budget).to.deep.equal({ used: 0, max: 2, exhausted: false });
      expect(formatBudgetCompact(budget)).to.equal('(0/2)');
      expect(formatBudgetLong(budget)).to.equal('0 of 2');
    });

    it('treats a missing count as zero rather than hiding the limit', () => {
      expect(testBudget({ max_test_runs: 2 }).used).to.equal(0);
      expect(formatBudgetCompact(testBudget({ max_test_runs: 2 }))).to.equal('(0/2)');
    });

    it('omits the denominator when no limit is configured', () => {
      const budget = testBudget({ result_count: 3 });
      expect(budget.max).to.equal(null);
      expect(budget.exhausted).to.equal(false);
      expect(formatBudgetCompact(budget)).to.equal('(3)');
      expect(formatBudgetLong(budget)).to.equal('3');
    });

    it('marks the budget exhausted once the count reaches the limit', () => {
      expect(testBudget({ result_count: 1, max_test_runs: 2 }).exhausted).to.equal(false);
      expect(testBudget({ result_count: 2, max_test_runs: 2 }).exhausted).to.equal(true);
      // Over-limit data exists on groups that ran before enforcement worked.
      expect(testBudget({ result_count: 5, max_test_runs: 2 }).exhausted).to.equal(true);
    });

    it('lets a per-group override win over the assignment limit', () => {
      const budget = testBudget({ result_count: 3, max_test_runs: 2 }, { max_test_runs: 5 });
      expect(budget.max).to.equal(5);
      expect(budget.exhausted).to.equal(false);
    });
  });

  describe('submissionBudget', () => {
    it('shows the submission limit, which students never saw before', () => {
      const budget = submissionBudget({ submission_count: 0, max_submissions: 1 });
      expect(formatBudgetCompact(budget)).to.equal('(0/1)');
    });

    it('prefers the submission group count when one exists', () => {
      const budget = submissionBudget(
        { submission_count: 0, max_submissions: 1 },
        { count: 1 }
      );
      expect(budget.used).to.equal(1);
      expect(budget.exhausted).to.equal(true);
    });

    it('falls back to the course content when there is no group yet', () => {
      const budget = submissionBudget({ submission_count: 2, max_submissions: 3 }, null);
      expect(budget.used).to.equal(2);
      expect(budget.max).to.equal(3);
    });

    it('stays unlimited when nothing sets a limit', () => {
      expect(submissionBudget({ submission_count: 9 }).exhausted).to.equal(false);
    });
  });
});
