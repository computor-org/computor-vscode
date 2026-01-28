import * as XLSX from 'xlsx';
import { ICourseMemberParser, CourseMemberImportRow } from './ICourseMemberParser';

/**
 * Parser for Excel XLSX format (modern Excel files).
 *
 * Supports:
 * - .xlsx files (Excel 2007+)
 * - .xls files (legacy Excel)
 * - First sheet is used for import
 * - First row contains headers
 */
export class CourseMemberXlsxParser implements ICourseMemberParser {

  parse(fileContent: string): CourseMemberImportRow[] {
    try {
      const workbook = XLSX.read(fileContent, { type: 'binary' });

      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('Invalid Excel file: No worksheets found');
      }

      const worksheet = workbook.Sheets[firstSheetName];
      if (!worksheet) {
        throw new Error('Invalid Excel file: Could not read worksheet');
      }

      const jsonData = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: ''
      });

      if (jsonData.length < 2) {
        throw new Error('Invalid Excel file: No data rows found (need at least header + 1 data row)');
      }

      const headerRow = jsonData[0] as string[];
      const columnMapping = this.parseHeader(headerRow);

      const members: CourseMemberImportRow[] = [];
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i] as string[];
        if (!row || row.every(cell => !cell || String(cell).trim() === '')) {
          continue;
        }

        const member = this.parseDataRow(row, columnMapping);
        if (member && member.email) {
          members.push(member);
        }
      }

      return members;
    } catch (error) {
      console.error('Failed to parse Excel file:', error);
      throw new Error(`Failed to parse Excel file: ${error instanceof Error ? error.message : error}`);
    }
  }

  private parseHeader(headerRow: string[]): Map<string, number> {
    const mapping = new Map<string, number>();

    headerRow.forEach((header, index) => {
      if (header) {
        const normalized = this.normalizeHeaderName(String(header));
        mapping.set(normalized, index);
      }
    });

    return mapping;
  }

  private parseDataRow(values: string[], columnMapping: Map<string, number>): CourseMemberImportRow | null {
    const email = this.getFieldValue(values, columnMapping, 'email');
    if (!email) {
      return null;
    }

    const member: CourseMemberImportRow = {
      email,
      given_name: this.getFieldValue(values, columnMapping, 'given_name'),
      family_name: this.getFieldValue(values, columnMapping, 'family_name'),
      student_id: this.getFieldValue(values, columnMapping, 'student_id'),
      course_group_title: this.getFieldValue(values, columnMapping, 'course_group_title'),
      course_role_id: this.getFieldValue(values, columnMapping, 'course_role_id'),
      incoming: this.getFieldValue(values, columnMapping, 'incoming'),
      study_id: this.getFieldValue(values, columnMapping, 'study_id'),
      study_name: this.getFieldValue(values, columnMapping, 'study_name'),
      registration_date: this.getFieldValue(values, columnMapping, 'registration_date'),
      notes: this.getFieldValue(values, columnMapping, 'notes')
    };

    const semesterStr = this.getFieldValue(values, columnMapping, 'semester');
    if (semesterStr) {
      const semester = parseInt(semesterStr, 10);
      if (!isNaN(semester)) {
        member.semester = semester;
      }
    }

    return member;
  }

  private normalizeHeaderName(header: string): string {
    const normalized = header.toLowerCase().trim();

    const mappings: { [key: string]: string } = {
      'email': 'email',
      'e-mail': 'email',
      'mail': 'email',
      'vorname': 'given_name',
      'given name': 'given_name',
      'given_name': 'given_name',
      'firstname': 'given_name',
      'first name': 'given_name',
      'first_name': 'given_name',
      'familienname': 'family_name',
      'family name': 'family_name',
      'family_name': 'family_name',
      'lastname': 'family_name',
      'last name': 'last_name',
      'last_name': 'family_name',
      'nachname': 'family_name',
      'matrikelnummer': 'student_id',
      'student id': 'student_id',
      'student_id': 'student_id',
      'studentid': 'student_id',
      'matr.-nr.': 'student_id',
      'gruppe': 'course_group_title',
      'group': 'course_group_title',
      'course group': 'course_group_title',
      'course_group_title': 'course_group_title',
      'role': 'course_role_id',
      'course role': 'course_role_id',
      'course_role_id': 'course_role_id',
      'incoming': 'incoming',
      'kennzahl': 'study_id',
      'study id': 'study_id',
      'study_id': 'study_id',
      'studyid': 'study_id',
      'studien-id': 'study_id',
      'studium': 'study_name',
      'study': 'study_name',
      'study name': 'study_name',
      'study_name': 'study_name',
      'semester': 'semester',
      'semester im studium': 'semester',
      'anmeldedatum': 'registration_date',
      'registration date': 'registration_date',
      'registration_date': 'registration_date',
      'anmerkung': 'notes',
      'notes': 'notes',
      'note': 'notes',
      'bemerkung': 'notes'
    };

    return mappings[normalized] || normalized;
  }

  private getFieldValue(
    values: string[],
    columnMapping: Map<string, number>,
    fieldName: string
  ): string | undefined {
    const columnIndex = columnMapping.get(fieldName);
    if (columnIndex !== undefined && columnIndex < values.length) {
      const value = values[columnIndex];
      if (value === undefined || value === null) {
        return undefined;
      }
      const strValue = String(value).trim();
      return strValue !== '' ? strValue : undefined;
    }
    return undefined;
  }

  canParse(fileContent: string): boolean {
    try {
      const firstBytes = fileContent.substring(0, 4);
      const isZip = firstBytes.charCodeAt(0) === 0x50 &&
                    firstBytes.charCodeAt(1) === 0x4B &&
                    firstBytes.charCodeAt(2) === 0x03 &&
                    firstBytes.charCodeAt(3) === 0x04;

      const isOle = firstBytes.charCodeAt(0) === 0xD0 &&
                    firstBytes.charCodeAt(1) === 0xCF &&
                    firstBytes.charCodeAt(2) === 0x11 &&
                    firstBytes.charCodeAt(3) === 0xE0;

      return isZip || isOle;
    } catch {
      return false;
    }
  }

  getSupportedExtensions(): string[] {
    return ['xlsx', 'xls'];
  }

  getName(): string {
    return 'Excel XLSX Parser';
  }
}
