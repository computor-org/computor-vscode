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


describe('course-level visibility on the Contents folder', () => {
    // The course toggle deliberately sits on the virtual "Contents" folder, not
    // on the course row: it hides the course's content tree, not the course.
    function folder(visible: boolean | null) {
        const { CourseFolderTreeItem } = require('../../src/ui/tree/lecturer/LecturerTreeItems');
        return new CourseFolderTreeItem(
            'contents',
            { id: 'c1', title: 'Course', path: 'c1', visible },
            { id: 'f1', path: 'f1' },
            { id: 'o1', path: 'o1' },
        );
    }

    it('marks the folder when the whole course is hidden', () => {
        const item = folder(false);
        assert.strictEqual(item.description, INVISIBLE_BADGE);
        assert.strictEqual(item.contextValue, 'course.contents.hidden');
    });

    it('leaves the base contextValue intact when visible', () => {
        // Existing menus match `course.contents`; a replacement rather than a
        // suffix would silently drop them.
        for (const v of [null, true] as (boolean | null)[]) {
            const item = folder(v);
            assert.strictEqual(item.contextValue, 'course.contents');
            assert.strictEqual(item.description, undefined);
        }
    });

    it('still starts with course.contents when hidden, so prefix menus match', () => {
        assert.ok(folder(false).contextValue.startsWith('course.contents'));
    });

    it('does not touch the other two folders', () => {
        const { CourseFolderTreeItem } = require('../../src/ui/tree/lecturer/LecturerTreeItems');
        for (const kind of ['contentTypes', 'groups']) {
            const item = new CourseFolderTreeItem(
                kind as any,
                { id: 'c1', title: 'Course', path: 'c1', visible: false },
                { id: 'f1', path: 'f1' },
                { id: 'o1', path: 'o1' },
            );
            assert.strictEqual(item.contextValue, `course.${kind}`);
            assert.strictEqual(item.description, undefined);
        }
    });
});
