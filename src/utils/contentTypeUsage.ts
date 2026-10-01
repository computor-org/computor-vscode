import { CourseContentList } from '../types/generated/courses';

/**
 * How many blocking contents to name before collapsing the rest into
 * "…and N more". Mirrors the backend's CONTENT_010 sample size so both
 * messages read the same way.
 */
const SAMPLE_SIZE = 5;

/**
 * Course contents that still refer to a content type.
 *
 * A content type cannot be deleted while anything uses it: both
 * `course_content.course_content_type_id` and `result.course_content_type_id`
 * are NOT NULL with `ondelete=RESTRICT`. The backend refuses such a delete with
 * `CONTENT_010`; checking here first lets the tree say *which* contents are in
 * the way without a round trip (computor-org/issues#387).
 */
export function findContentsUsingType(
  contents: CourseContentList[],
  typeId: string
): CourseContentList[] {
  return contents.filter(content => content.course_content_type_id === typeId);
}

/** Display name for a content in the blocking list: its title, else its path. */
function contentLabel(content: CourseContentList): string {
  return content.title || content.path;
}

/**
 * The body of the "cannot delete" dialog: how many contents block the delete,
 * a bulleted sample of them, and what to do about it. Returns the detail text
 * only — the caller supplies the headline.
 */
export function formatContentTypeInUseDetail(
  typeLabel: string,
  blocking: CourseContentList[]
): string {
  const sample = blocking.slice(0, SAMPLE_SIZE).map(contentLabel);
  const remaining = blocking.length - sample.length;

  const lines = sample.map(name => `  • ${name}`);
  if (remaining > 0) {
    lines.push(`  • …and ${remaining} more`);
  }

  const countPhrase = blocking.length === 1
    ? '1 course content still uses it'
    : `${blocking.length} course contents still use it`;

  return [
    `"${typeLabel}" cannot be deleted because ${countPhrase}:`,
    '',
    lines.join('\n'),
    '',
    'Change those contents to another content type of the same kind, or delete them first.'
  ].join('\n');
}
