/**
 * Where a course content lands when a lecturer moves it.
 *
 * Contents are ordered by a floating-point `position` among the siblings that
 * share a parent path, so a move is an arithmetic question — pick a number
 * between the two neighbours you are landing between — and never a renumbering
 * of the whole unit. Cross-unit moves change the path as well, which only the
 * `/move` endpoint may do, because the descendants have to come along.
 *
 * The lecturer tree could only be rearranged by dragging; these are the same
 * sums behind the Move commands (computor-org/issues#323).
 */

export interface OrderedContent {
  path: string;
  position: number;
}

export type Placement = 'top' | 'up' | 'down' | 'bottom';

/** The path of `path`'s parent, or `''` for a content at the course root. */
export function getParentPath(path: string): string {
  const lastDot = path.lastIndexOf('.');
  return lastDot === -1 ? '' : path.substring(0, lastDot);
}

/** The last segment of `path` — the content's own slug. */
export function getSlug(path: string): string {
  const lastDot = path.lastIndexOf('.');
  return lastDot === -1 ? path : path.substring(lastDot + 1);
}

/**
 * The direct children of `parentPath`, in the order the tree shows them.
 *
 * Only direct children: a unit's assignments, not the assignments of the units
 * below it.
 */
export function sortedSiblings<T extends OrderedContent>(contents: T[], parentPath: string): T[] {
  const depth = parentPath === '' ? 1 : parentPath.split('.').length + 1;
  return contents
    .filter((content) => {
      if (content.path.split('.').length !== depth) {
        return false;
      }
      return parentPath === '' ? true : content.path.startsWith(parentPath + '.');
    })
    .sort((a, b) => a.position - b.position);
}

/**
 * The position that puts `siblings[index]` where `placement` says, or
 * undefined when it is already there — moving the first item up is not an
 * error, it is a no-op.
 *
 * Landing between two neighbours takes the midpoint of their positions, which
 * leaves every other content untouched. Landing at either end steps one past
 * the current extreme.
 */
export function computeReorderPosition(
  siblings: OrderedContent[],
  index: number,
  placement: Placement
): number | undefined {
  const last = siblings.length - 1;
  if (index < 0 || index > last) {
    return undefined;
  }

  const positionOf = (at: number): number | undefined => siblings[at]?.position;

  switch (placement) {
    case 'top': {
      if (index === 0) { return undefined; }
      const first = positionOf(0);
      return first === undefined ? undefined : first - 1;
    }
    case 'bottom': {
      if (index === last) { return undefined; }
      const lastPosition = positionOf(last);
      return lastPosition === undefined ? undefined : lastPosition + 1;
    }
    case 'up': {
      if (index === 0) { return undefined; }
      // Between the two contents above, or one before the first.
      const above = positionOf(index - 1);
      if (above === undefined) { return undefined; }
      if (index - 1 === 0) { return above - 1; }
      const aboveThat = positionOf(index - 2);
      return aboveThat === undefined ? undefined : (aboveThat + above) / 2;
    }
    case 'down': {
      if (index === last) { return undefined; }
      // Between the two contents below, or one past the last.
      const below = positionOf(index + 1);
      if (below === undefined) { return undefined; }
      if (index + 1 === last) { return below + 1; }
      const belowThat = positionOf(index + 2);
      return belowThat === undefined ? undefined : (below + belowThat) / 2;
    }
    default:
      return undefined;
  }
}

/**
 * The position for a content arriving at the start or the end of `children`.
 * An empty unit starts its numbering at 1.
 */
export function computeInsertPosition(
  children: OrderedContent[],
  mode: 'prepend' | 'append'
): number {
  if (children.length === 0) {
    return 1;
  }
  const ordered = [...children].sort((a, b) => a.position - b.position);
  return mode === 'prepend'
    ? ordered[0]!.position - 1
    : ordered[ordered.length - 1]!.position + 1;
}
