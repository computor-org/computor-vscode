import { CourseMemberImportRequest } from '../../types/generated';

/**
 * Extended import row type for parsing course member data from files.
 * Extends the backend's CourseMemberImportRequest with additional fields
 * that may be present in import files for informational purposes.
 */
export interface CourseMemberImportRow extends CourseMemberImportRequest {
  /** Student ID / Matriculation number (informational, stored in student profile) */
  student_id?: string | null;
  /** Current semester (informational, stored in student profile) */
  semester?: number | null;
  /** Study ID / Program code (informational) */
  study_id?: string | null;
  /** Study name / Program name (informational) */
  study_name?: string | null;
  /** Registration date (informational) */
  registration_date?: string | null;
  /** Notes/Comments (informational) */
  notes?: string | null;
  /** Incoming/Exchange student flag (informational) */
  incoming?: string | null;
}

/**
 * Interface for course member file parsers.
 * Implement this interface to support different file formats (XML, CSV, JSON, etc.)
 */
export interface ICourseMemberParser {
  /**
   * Parse file content and extract course member data
   * @param fileContent - The raw file content as string
   * @returns Array of parsed course member rows
   * @throws Error if parsing fails
   */
  parse(fileContent: string): CourseMemberImportRow[];

  /**
   * Check if this parser can handle the given file content
   * @param fileContent - The raw file content as string
   * @returns True if parser can handle this format
   */
  canParse(fileContent: string): boolean;

  /**
   * Get supported file extensions
   * @returns Array of file extensions (e.g., ['xml', 'xlsx'])
   */
  getSupportedExtensions(): string[];

  /**
   * Get parser name/description
   */
  getName(): string;
}
