import { ICourseMemberParser, CourseMemberImportRow } from './ICourseMemberParser';
import { CourseMemberXmlParser } from './CourseMemberXmlParser';
import { CourseMemberCsvParser } from './CourseMemberCsvParser';
import { CourseMemberJsonParser } from './CourseMemberJsonParser';
import { CourseMemberXlsxParser } from './CourseMemberXlsxParser';

/**
 * Factory for creating appropriate course member file parsers.
 * Automatically detects file format and returns the correct parser.
 */
export class CourseMemberParserFactory {
  private static parsers: ICourseMemberParser[] = [
    new CourseMemberXmlParser(),
    new CourseMemberCsvParser(),
    new CourseMemberJsonParser(),
    new CourseMemberXlsxParser()
  ];

  /**
   * Parse course member data from file content.
   * Automatically detects format and uses appropriate parser.
   *
   * @param fileContent - Raw file content as string
   * @param fileExtension - Optional file extension hint (e.g., 'xml', 'csv')
   * @returns Parsed course member data
   * @throws Error if no suitable parser found or parsing fails
   */
  static parse(fileContent: string, fileExtension?: string): CourseMemberImportRow[] {
    // Try to find parser by extension first if provided
    if (fileExtension) {
      const normalizedExt = fileExtension.toLowerCase().replace(/^\./, '');
      const parserByExt = this.parsers.find(parser =>
        parser.getSupportedExtensions().includes(normalizedExt)
      );

      if (parserByExt) {
        try {
          return parserByExt.parse(fileContent);
        } catch (error) {
          console.warn(`Parser for extension '${fileExtension}' failed, trying content detection:`, error);
        }
      }
    }

    // Try each parser's canParse method
    for (const parser of this.parsers) {
      if (parser.canParse(fileContent)) {
        try {
          return parser.parse(fileContent);
        } catch (error) {
          console.error(`Parser '${parser.getName()}' failed:`, error);
          throw error;
        }
      }
    }

    throw new Error(
      'Unsupported file format. Supported formats: ' +
      this.getSupportedFormats().join(', ')
    );
  }

  /**
   * Get list of all supported file extensions
   */
  static getSupportedExtensions(): string[] {
    const extensions = new Set<string>();
    this.parsers.forEach(parser => {
      parser.getSupportedExtensions().forEach(ext => extensions.add(ext));
    });
    return Array.from(extensions);
  }

  /**
   * Get list of all supported formats with their parser names
   */
  static getSupportedFormats(): string[] {
    return this.parsers.map(parser =>
      `${parser.getName()} (${parser.getSupportedExtensions().join(', ')})`
    );
  }

  /**
   * Register a custom parser
   * @param parser - Custom parser implementation
   */
  static registerParser(parser: ICourseMemberParser): void {
    this.parsers.push(parser);
  }

  /**
   * Get all registered parsers
   */
  static getParsers(): ICourseMemberParser[] {
    return [...this.parsers];
  }
}
