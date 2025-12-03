import { XMLParser } from 'fast-xml-parser';
import { CourseMemberImportRow } from '../../types/generated';
import { ICourseMemberParser } from './ICourseMemberParser';

/**
 * Parser for Excel XML format (exported from Excel as XML Spreadsheet 2003)
 *
 * Expected format:
 * - Workbook > Worksheet > Table > Row > Cell > Data
 * - First row contains headers
 * - Subsequent rows contain member data
 */
export class ExcelXmlParser implements ICourseMemberParser {
  private xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      ignoreDeclaration: true,
      parseAttributeValue: true,
      trimValues: true,
      removeNSPrefix: true  // Remove namespace prefixes (ss:, x:, etc.)
    });
  }

  parse(fileContent: string): CourseMemberImportRow[] {
    try {
      const parsed = this.xmlParser.parse(fileContent);

      // Navigate XML structure: Workbook > Worksheet > Table > Row
      const workbook = parsed.Workbook || parsed['ss:Workbook'];
      if (!workbook) {
        throw new Error('Invalid Excel XML: No Workbook element found');
      }

      const worksheet = Array.isArray(workbook.Worksheet)
        ? workbook.Worksheet[0]
        : workbook.Worksheet;

      if (!worksheet) {
        throw new Error('Invalid Excel XML: No Worksheet found');
      }

      const table = worksheet.Table;
      if (!table) {
        throw new Error('Invalid Excel XML: No Table found');
      }

      const rows = Array.isArray(table.Row) ? table.Row : [table.Row];
      if (rows.length < 2) {
        throw new Error('Invalid Excel XML: No data rows found (need at least header + 1 data row)');
      }

      // Parse header row to get column mapping
      const headerRow = rows[0];
      const columnMapping = this.parseHeader(headerRow);

      // Parse data rows
      const members: CourseMemberImportRow[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.Cell) {
          continue;
        }

        const member = this.parseDataRow(row, columnMapping);
        if (member && member.email) {
          members.push(member);
        }
      }

      return members;
    } catch (error) {
      console.error('Failed to parse Excel XML:', error);
      throw new Error(`Failed to parse Excel XML: ${error instanceof Error ? error.message : error}`);
    }
  }

  private parseHeader(headerRow: any): Map<string, number> {
    const mapping = new Map<string, number>();
    const cells = Array.isArray(headerRow.Cell) ? headerRow.Cell : [headerRow.Cell];

    cells.forEach((cell: any, index: number) => {
      const value = this.getCellValue(cell);
      if (value) {
        const normalized = this.normalizeHeaderName(value);
        mapping.set(normalized, index);
      }
    });

    return mapping;
  }

  private parseDataRow(row: any, columnMapping: Map<string, number>): CourseMemberImportRow | null {
    const cells = Array.isArray(row.Cell) ? row.Cell : [row.Cell];
    const cellValues: string[] = [];

    // Extract all cell values
    cells.forEach((cell: any) => {
      cellValues.push(this.getCellValue(cell) || '');
    });

    // Map values to fields based on header mapping
    const email = this.getFieldValue(cellValues, columnMapping, 'email');
    if (!email) {
      return null; // Skip rows without email
    }

    const member: CourseMemberImportRow = {
      email,
      given_name: this.getFieldValue(cellValues, columnMapping, 'given_name'),
      family_name: this.getFieldValue(cellValues, columnMapping, 'family_name'),
      student_id: this.getFieldValue(cellValues, columnMapping, 'student_id'),
      course_group_title: this.getFieldValue(cellValues, columnMapping, 'course_group_title'),
      course_role_id: this.getFieldValue(cellValues, columnMapping, 'course_role_id'),
      incoming: this.getFieldValue(cellValues, columnMapping, 'incoming'),
      study_id: this.getFieldValue(cellValues, columnMapping, 'study_id'),
      study_name: this.getFieldValue(cellValues, columnMapping, 'study_name'),
      registration_date: this.getFieldValue(cellValues, columnMapping, 'registration_date'),
      notes: this.getFieldValue(cellValues, columnMapping, 'notes')
    };

    // Parse semester as number
    const semesterStr = this.getFieldValue(cellValues, columnMapping, 'semester');
    if (semesterStr) {
      const semester = parseInt(semesterStr, 10);
      if (!isNaN(semester)) {
        member.semester = semester;
      }
    }

    return member;
  }

  private getCellValue(cell: any): string | undefined {
    if (!cell) {
      return undefined;
    }

    // Try Data element first
    const data = cell.Data;
    if (data) {
      if (typeof data === 'string') {
        return data;
      }
      if (data['#text']) {
        return String(data['#text']);
      }
      if (typeof data === 'object') {
        return String(data);
      }
    }

    // Try direct text content
    if (cell['#text']) {
      return String(cell['#text']);
    }

    return undefined;
  }

  private normalizeHeaderName(header: string): string {
    const normalized = header.toLowerCase().trim();

    // Map common header variations to standard field names
    const mappings: { [key: string]: string } = {
      'email': 'email',
      'e-mail': 'email',
      'mail': 'email',
      'vorname': 'given_name',
      'given name': 'given_name',
      'firstname': 'given_name',
      'first name': 'given_name',
      'familienname': 'family_name',
      'family name': 'family_name',
      'lastname': 'family_name',
      'last name': 'family_name',
      'nachname': 'family_name',
      'matrikelnummer': 'student_id',
      'student id': 'student_id',
      'studentid': 'student_id',
      'matr.-nr.': 'student_id',
      'gruppe': 'course_group_title',
      'group': 'course_group_title',
      'course group': 'course_group_title',
      'role': 'course_role_id',
      'course role': 'course_role_id',
      'incoming': 'incoming',
      'kennzahl': 'study_id',
      'study id': 'study_id',
      'studyid': 'study_id',
      'studium': 'study_name',
      'study': 'study_name',
      'study name': 'study_name',
      'semester': 'semester',
      'semester im studium': 'semester',
      'anmeldedatum': 'registration_date',
      'registration date': 'registration_date',
      'anmerkung': 'notes',
      'notes': 'notes',
      'note': 'notes',
      'bemerkung': 'notes',
      'studien-id': 'study_id'
    };

    return mappings[normalized] || normalized;
  }

  private getFieldValue(
    cellValues: string[],
    columnMapping: Map<string, number>,
    fieldName: string
  ): string | undefined {
    const columnIndex = columnMapping.get(fieldName);
    if (columnIndex !== undefined && columnIndex < cellValues.length) {
      const value = cellValues[columnIndex];
      return value && value.trim() !== '' ? value.trim() : undefined;
    }
    return undefined;
  }

  canParse(fileContent: string): boolean {
    return fileContent.includes('<?xml') &&
           (fileContent.includes('Workbook') || fileContent.includes('ss:Workbook'));
  }

  getSupportedExtensions(): string[] {
    return ['xml'];
  }

  getName(): string {
    return 'Excel XML Parser';
  }
}
