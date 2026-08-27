/**
 * Which source "Run Test" packages for the tutor tree node it was invoked on.
 *
 * The one command hangs off five nodes, and until now its body only looked at
 * what was on disk: on References that quietly tested the student's downloaded
 * submission instead, and the reference was only ever reached through the
 * "no submission found" fallback prompt.
 */
export type TutorTestTarget = 'reference' | 'submission';

export function tutorTestTargetFor(item: any): TutorTestTarget {
  return item?.folderType === 'reference' ? 'reference' : 'submission';
}
