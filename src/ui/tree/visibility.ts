// Shared handling of student visibility across the three trees (issue #338).
//
// A lecturer stages content before students may work on it: prepare an exam
// unit invisibly, rehearse it as a student, reveal it, hide it again.
//
// The resolution itself is done server-side and arrives as `visible_effective`,
// already folded over the whole ancestor chain and the course. Nothing here
// re-derives it — a client walking the tree would get a different answer than
// the backend enforces the moment a parent is missing from the fetched set,
// and the two must never disagree. `visible` is the node's OWN setting, which
// only matters for deciding whether this row is where a lecturer can change
// something.
//
// The three trees differ only in what they do with the answer:
//   student   the rows never arrive; the API filters them out
//   lecturer  every row arrives, hidden ones marked and toggleable
//   tutor     every row arrives, hidden ones marked

/** Anything carrying resolved visibility from the API. */
export interface VisibilitySource {
    /** Resolved against ancestors and the course. Absent on older payloads. */
    visible_effective?: boolean | null;
    /** This node's own setting: null inherits, false hides, true is explicit. */
    visible?: boolean | null;
}

/**
 * Marker shown on every row students cannot see.
 *
 * One wording regardless of whether the row was hidden here or by a unit above
 * it: to the reader the fact that matters is "students do not see this", and
 * two variants only invited the question of what the difference meant. Where
 * the decision was made still drives behaviour — see `isHiddenHere` — it just
 * does not need its own label.
 */
export const INVISIBLE_BADGE = '👁 invisible';

/**
 * Whether students can currently see this content.
 *
 * Defaults to visible when the field is absent so an older backend, or a
 * payload that predates this feature, never blanks a tree.
 */
export function isVisibleToStudents(content: VisibilitySource | null | undefined): boolean {
    if (!content) { return true; }
    return content.visible_effective !== false;
}

/** Whether this row is hidden, whether by itself or by something above it. */
export function isHidden(content: VisibilitySource | null | undefined): boolean {
    return !isVisibleToStudents(content);
}

/**
 * Whether the hiding decision was made on this very row.
 *
 * Only these rows offer a "show again" action: flipping a row whose parent is
 * hidden changes nothing, because `false` above is a veto that a descendant's
 * `true` cannot undo. Offering an inert toggle there would be a lie.
 */
export function isHiddenHere(content: VisibilitySource | null | undefined): boolean {
    return content?.visible === false;
}

/** The badge for a hidden row, or undefined when it is visible. */
export function hiddenBadge(content: VisibilitySource | null | undefined): string | undefined {
    return isHidden(content) ? INVISIBLE_BADGE : undefined;
}

/**
 * Drop everything students must not see.
 *
 * A safety net only: the backend already filters these out of a student's
 * payload, so in practice this removes nothing. It exists because the same
 * endpoint serves lecturers and tutors rehearsing as a student, and because a
 * cached response can predate a lecturer hiding something.
 */
export function filterVisible<T extends VisibilitySource>(contents: T[]): T[] {
    return contents.filter((c) => isVisibleToStudents(c));
}
