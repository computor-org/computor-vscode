import { CourseMemberImportRow } from '../../types/generated';

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
