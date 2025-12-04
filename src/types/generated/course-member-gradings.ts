/**
 * Auto-generated TypeScript interfaces from Pydantic models
 * Category: Course Member Gradings
 */

/**
 * Statistics for a specific content type within a student's progress.
 */
export interface ContentTypeGradingStats {
  course_content_type_id: string;
  course_content_type_slug: string;
  course_content_type_title?: string | null;
  course_content_type_color?: string | null;
  max_assignments: number;
  submitted_assignments: number;
  progress_percentage: number;
  latest_submission_at?: string | null;
}

/**
 * List view of course member grading progress.
 * Returned by GET /course-member-gradings?course_id={uuid}
 */
export interface CourseMemberGradingsList {
  course_member_id: string;
  course_id: string;
  user_id?: string | null;
  username?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  total_max_assignments: number;
  total_submitted_assignments: number;
  overall_progress_percentage: number;
  latest_submission_at?: string | null;
  by_content_type: ContentTypeGradingStats[];
}

/**
 * A node in the hierarchical course content structure for detailed progress view.
 */
export interface CourseMemberGradingNode {
  course_content_id: string;
  path: string;
  position: number;
  title?: string | null;
  course_content_type_id: string;
  course_content_type_slug: string;
  course_content_type_title?: string | null;
  course_content_type_color?: string | null;
  course_content_kind_id: string;
  submittable: boolean;
  max_assignments: number;
  submitted_assignments: number;
  progress_percentage: number;
  latest_submission_at?: string | null;
  by_content_type?: ContentTypeGradingStats[];
}

/**
 * Detailed view of a single course member's grading progress.
 * Returned by GET /course-member-gradings/{course_member_id}
 */
export interface CourseMemberGradingsGet {
  course_member_id: string;
  course_id: string;
  user_id?: string | null;
  username?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  total_max_assignments: number;
  total_submitted_assignments: number;
  overall_progress_percentage: number;
  latest_submission_at?: string | null;
  by_content_type: ContentTypeGradingStats[];
  nodes: CourseMemberGradingNode[];
}

/**
 * Query parameters for course member gradings.
 */
export interface CourseMemberGradingsQuery {
  skip?: number | null;
  limit?: number | null;
  course_id?: string | null;
  course_member_id?: string | null;
  course_group_id?: string | null;
}
