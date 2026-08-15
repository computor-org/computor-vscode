import { expect } from 'chai';

import {
  computeInsertPosition,
  computeReorderPosition,
  getParentPath,
  getSlug,
  sortedSiblings
} from '../../src/utils/contentOrdering';

/**
 * Rearranging a course was drag-only; the Move commands do the same sums
 * (computor-org/issues#323). A move must land the content exactly where the
 * lecturer aimed and leave every other position untouched, so the arithmetic
 * is worth pinning down.
 */

const contents = [
  { path: 'unit_1', position: 10 },
  { path: 'unit_1.task_a', position: 10 },
  { path: 'unit_1.task_b', position: 20 },
  { path: 'unit_1.task_c', position: 30 },
  { path: 'unit_2', position: 20 },
  { path: 'unit_2.task_d', position: 10 },
  { path: 'unit_2.sub', position: 20 },
  { path: 'unit_2.sub.task_e', position: 10 }
];

/** Re-sort by position to read back the order a move produces. */
function orderAfter(
  siblings: Array<{ path: string; position: number }>,
  path: string,
  position: number
): string[] {
  return siblings
    .map((s) => (s.path === path ? { ...s, position } : s))
    .sort((a, b) => a.position - b.position)
    .map((s) => s.path);
}

describe('content ordering', () => {
  describe('paths', () => {
    it('reads the parent of a nested content', () => {
      expect(getParentPath('unit_1.task_a')).to.equal('unit_1');
      expect(getParentPath('unit_2.sub.task_e')).to.equal('unit_2.sub');
    });

    it('gives a root content no parent', () => {
      expect(getParentPath('unit_1')).to.equal('');
    });

    it('reads the slug', () => {
      expect(getSlug('unit_1.task_a')).to.equal('task_a');
      expect(getSlug('unit_1')).to.equal('unit_1');
    });
  });

  describe('sortedSiblings', () => {
    it('takes the direct children of a unit, in tree order', () => {
      expect(sortedSiblings(contents, 'unit_1').map((c) => c.path)).to.deep.equal([
        'unit_1.task_a',
        'unit_1.task_b',
        'unit_1.task_c'
      ]);
    });

    it('takes the units at the course root', () => {
      expect(sortedSiblings(contents, '').map((c) => c.path)).to.deep.equal(['unit_1', 'unit_2']);
    });

    it('does not reach past the direct children', () => {
      expect(sortedSiblings(contents, 'unit_2').map((c) => c.path)).to.deep.equal([
        'unit_2.task_d',
        'unit_2.sub'
      ]);
    });
  });

  describe('computeReorderPosition', () => {
    const siblings = sortedSiblings(contents, 'unit_1');

    it('moves the last content to the top', () => {
      const position = computeReorderPosition(siblings, 2, 'top')!;
      expect(orderAfter(siblings, 'unit_1.task_c', position)).to.deep.equal([
        'unit_1.task_c',
        'unit_1.task_a',
        'unit_1.task_b'
      ]);
    });

    it('moves the first content to the bottom', () => {
      const position = computeReorderPosition(siblings, 0, 'bottom')!;
      expect(orderAfter(siblings, 'unit_1.task_a', position)).to.deep.equal([
        'unit_1.task_b',
        'unit_1.task_c',
        'unit_1.task_a'
      ]);
    });

    it('swaps a content with the one above it', () => {
      const position = computeReorderPosition(siblings, 1, 'up')!;
      expect(orderAfter(siblings, 'unit_1.task_b', position)).to.deep.equal([
        'unit_1.task_b',
        'unit_1.task_a',
        'unit_1.task_c'
      ]);
    });

    it('swaps a content with the one below it', () => {
      const position = computeReorderPosition(siblings, 1, 'down')!;
      expect(orderAfter(siblings, 'unit_1.task_b', position)).to.deep.equal([
        'unit_1.task_a',
        'unit_1.task_c',
        'unit_1.task_b'
      ]);
    });

    it('lands between the right pair when moving up through a longer list', () => {
      const four = [
        { path: 'a', position: 10 },
        { path: 'b', position: 20 },
        { path: 'c', position: 30 },
        { path: 'd', position: 40 }
      ];
      const position = computeReorderPosition(four, 3, 'up')!;
      expect(position).to.be.greaterThan(20).and.lessThan(30);
      expect(orderAfter(four, 'd', position)).to.deep.equal(['a', 'b', 'd', 'c']);
    });

    it('lands between the right pair when moving down through a longer list', () => {
      const four = [
        { path: 'a', position: 10 },
        { path: 'b', position: 20 },
        { path: 'c', position: 30 },
        { path: 'd', position: 40 }
      ];
      const position = computeReorderPosition(four, 0, 'down')!;
      expect(position).to.be.greaterThan(20).and.lessThan(30);
      expect(orderAfter(four, 'a', position)).to.deep.equal(['b', 'a', 'c', 'd']);
    });

    it('does nothing at the ends', () => {
      expect(computeReorderPosition(siblings, 0, 'up')).to.equal(undefined);
      expect(computeReorderPosition(siblings, 0, 'top')).to.equal(undefined);
      expect(computeReorderPosition(siblings, 2, 'down')).to.equal(undefined);
      expect(computeReorderPosition(siblings, 2, 'bottom')).to.equal(undefined);
    });

    it('does nothing when the content is not among the siblings', () => {
      expect(computeReorderPosition(siblings, -1, 'up')).to.equal(undefined);
      expect(computeReorderPosition([], 0, 'top')).to.equal(undefined);
    });

    it('still separates two contents that share a position', () => {
      const tied = [
        { path: 'a', position: 5 },
        { path: 'b', position: 5 }
      ];
      const position = computeReorderPosition(tied, 1, 'top')!;
      expect(position).to.be.lessThan(5);
    });
  });

  describe('computeInsertPosition', () => {
    it('puts a content before everything in the unit', () => {
      const children = sortedSiblings(contents, 'unit_1');
      expect(computeInsertPosition(children, 'prepend')).to.be.lessThan(10);
    });

    it('puts a content after everything in the unit', () => {
      const children = sortedSiblings(contents, 'unit_1');
      expect(computeInsertPosition(children, 'append')).to.be.greaterThan(30);
    });

    it('starts an empty unit at one', () => {
      expect(computeInsertPosition([], 'prepend')).to.equal(1);
      expect(computeInsertPosition([], 'append')).to.equal(1);
    });
  });
});
