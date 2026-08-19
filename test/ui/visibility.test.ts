import * as assert from 'assert';

import {
    INVISIBLE_BADGE,
    filterVisible,
    hiddenBadge,
    isHidden,
    isHiddenHere,
    isVisibleToStudents,
} from '../../src/ui/tree/visibility';

/**
 * Student visibility in the trees (issue #338).
 *
 * The client deliberately does NOT re-derive visibility from the tree — the
 * backend sends `visible_effective` already folded over the ancestor chain, and
 * two implementations would eventually disagree with what enforcement does.
 * What is tested here is the reading of that flag, and the one genuinely
 * client-side judgement: whether this row is where a lecturer can act.
 */
describe('tree visibility', () => {
    describe('isVisibleToStudents', () => {
        it('treats a missing flag as visible', () => {
            // An older backend, or a payload predating the feature, must never
            // blank a student's tree.
            assert.strictEqual(isVisibleToStudents({}), true);
            assert.strictEqual(isVisibleToStudents(undefined), true);
            assert.strictEqual(isVisibleToStudents(null), true);
        });

        it('reads the resolved flag', () => {
            assert.strictEqual(isVisibleToStudents({ visible_effective: true }), true);
            assert.strictEqual(isVisibleToStudents({ visible_effective: false }), false);
        });

        it('ignores the local setting in favour of the resolved one', () => {
            // The row says visible, but something above it hides it. The server
            // has already folded that in; trusting `visible` here would show a
            // lecturer a row as live when their students cannot see it.
            assert.strictEqual(
                isVisibleToStudents({ visible: true, visible_effective: false }),
                false,
            );
        });
    });

    describe('isHiddenHere', () => {
        it('is true only when this row carries the decision', () => {
            assert.strictEqual(isHiddenHere({ visible: false }), true);
        });

        it('is false when an ancestor is what hides it', () => {
            // This is what stops the UI offering a "show again" action that
            // would change nothing: `false` above is a veto.
            assert.strictEqual(
                isHiddenHere({ visible: null, visible_effective: false }),
                false,
            );
            assert.strictEqual(
                isHiddenHere({ visible: true, visible_effective: false }),
                false,
            );
        });
    });

    describe('hiddenBadge', () => {
        it('gives no badge to a visible row', () => {
            assert.strictEqual(hiddenBadge({ visible_effective: true }), undefined);
        });

        it('uses one wording however the row came to be hidden', () => {
            // Hidden here and hidden by an ancestor read the same. The reader
            // only cares that students do not see it; where the decision was
            // made still drives behaviour via isHiddenHere, not the label.
            assert.strictEqual(
                hiddenBadge({ visible: false, visible_effective: false }),
                INVISIBLE_BADGE,
            );
            assert.strictEqual(
                hiddenBadge({ visible: null, visible_effective: false }),
                INVISIBLE_BADGE,
            );
            assert.strictEqual(INVISIBLE_BADGE, '\u{1F441} invisible');
        });
    });

    describe('filterVisible', () => {
        it('drops hidden rows and keeps the rest', () => {
            const rows = [
                { id: 'a', visible_effective: true },
                { id: 'b', visible_effective: false },
                { id: 'c' },
            ];
            assert.deepStrictEqual(
                filterVisible(rows).map((r) => r.id),
                ['a', 'c'],
            );
        });
    });

    describe('isHidden', () => {
        it('is the inverse of isVisibleToStudents', () => {
            for (const row of [{}, { visible_effective: true }, { visible_effective: false }]) {
                assert.strictEqual(isHidden(row), !isVisibleToStudents(row));
            }
        });
    });
});
