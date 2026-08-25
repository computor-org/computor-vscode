/**
 * Glyphs for the student tree's git state (issue #332). Tree descriptions are
 * plain dimmed text — no colors, no codicons — so the glyphs carry the meaning:
 *   ● uncommitted changes    ↑ committed but not pushed    ⚠ pushes are failing
 * Same vocabulary as the offline tree's `● ↑n ↓n`.
 */

export interface AssignmentGitBadges {
  dirty: boolean;
  unpushed: boolean;
  pushFailing: boolean;
  /**
   * Fetch or pull failed, so what is on screen may be out of date. Unlike
   * pushFailing this is NOT gated on local changes: a repository can be
   * perfectly clean and still be stale, and that is exactly the case worth
   * warning about — it is the one the student cannot otherwise notice.
   */
  syncFailing?: boolean;
}

/** Description prefix for an assignment row, '' when there is nothing to show. */
export function assignmentGitIndicator(badges: AssignmentGitBadges): string {
  const glyphs: string[] = [];
  if (badges.syncFailing || (badges.pushFailing && (badges.dirty || badges.unpushed))) {
    glyphs.push('⚠');
  }
  if (badges.dirty) {
    glyphs.push('●');
  }
  if (badges.unpushed) {
    glyphs.push('↑');
  }
  return glyphs.join(' ');
}

/** Tooltip lines naming the shown glyphs — deliberately terse, no how-to. */
export function assignmentGitTooltipLines(badges: AssignmentGitBadges): string[] {
  const lines: string[] = [];
  if (badges.dirty) {
    lines.push('● Uncommitted changes');
  }
  if (badges.unpushed) {
    lines.push('↑ Unpushed changes');
  }
  if (badges.pushFailing && (badges.dirty || badges.unpushed)) {
    lines.push('⚠ Push failing');
  }
  if (badges.syncFailing) {
    lines.push('⚠ Not up to date — could not fetch from the server');
  }
  return lines;
}

/** Tooltip lines for a course row, matching the order of its description glyphs. */
export function courseGitTooltipLines(dirty: boolean, aheadCount: number, pushFailing: boolean): string[] {
  const lines: string[] = [];
  if (pushFailing) {
    lines.push('⚠ Push failing');
  }
  if (dirty) {
    lines.push('● Uncommitted changes');
  }
  if (aheadCount > 0) {
    lines.push(`↑ ${aheadCount} unpushed commit${aheadCount === 1 ? '' : 's'}`);
  }
  return lines;
}

/** Description for a course row, undefined when everything is clean and pushed. */
export function courseGitIndicator(dirty: boolean, aheadCount: number, pushFailing: boolean): string | undefined {
  const parts: string[] = [];
  if (pushFailing) {
    parts.push('⚠ push failing');
  }
  if (dirty) {
    parts.push('●');
  }
  if (aheadCount > 0) {
    parts.push(`↑${aheadCount}`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}
