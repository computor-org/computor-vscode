import { ICourseMemberParser, CourseMemberImportRow } from './ICourseMemberParser';

/**
 * Parser for CSV (Comma-Separated Values) format.
 *
 * Supports:
 * - Comma, semicolon, or tab delimiters (auto-detected)
 * - Quoted fields (handles commas within quotes)
 * - UTF-8 encoding
 * - First row as headers
 */
export class CourseMemberCsvParser implements ICourseMemberParser {

  parse(fileContent: string): CourseMemberImportRow[] {
    try {
      const lines = this.parseLines(fileContent);
      if (lines.length < 2) {
        throw new Error('Invalid CSV: No data rows found (need at least header + 1 data row)');
      }

      const delimiter = this.detectDelimiter(fileContent);
      const firstLine = lines[0];
      if (!firstLine) {
        throw new Error('Invalid CSV: Header row is empty');
      }
      const headerRow = this.parseCsvLine(firstLine, delimiter);
      const columnMapping = this.parseHeader(headerRow);

      const members: CourseMemberImportRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.trim()) {
          continue;
        }

        const values = this.parseCsvLine(line, delimiter);
        const member = this.parseDataRow(values, columnMapping);
        if (member && member.email) {
          members.push(member);
        }
      }

      return members;
    } catch (error) {
      console.error('Failed to parse CSV:', error);
      throw new Error(`Failed to parse CSV: ${error instanceof Error ? error.message : error}`);
    }
  }

  private parseLines(content: string): string[] {
    const lines: string[] = [];
    let currentLine = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentLine += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
          currentLine += char;
        }
      } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
        if (currentLine.trim()) {
          lines.push(currentLine);
        }
        currentLine = '';
        if (char === '\r') {
          i++;
        }
      } else if (char === '\r' && !inQuotes) {
        if (currentLine.trim()) {
          lines.push(currentLine);
        }
        currentLine = '';
      } else {
        currentLine += char;
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine);
    }

    return lines;
  }

  private detectDelimiter(content: string): string {
    const firstLine = content.split(/\r?\n/)[0] || '';

    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;

    if (semicolonCount > commaCount && semicolonCount > tabCount) {
      return ';';
    }
    if (tabCount > commaCount && tabCount > semicolonCount) {
      return '\t';
    }
    return ',';
  }

  private parseCsvLine(line: string, delimiter: string): string[] {
    const values: string[] = [];
    let currentValue = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (!inQuotes) {
          inQuotes = true;
        } else if (nextChar === '"') {
          currentValue += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (char === delimiter && !inQuotes) {
        values.push(currentValue.trim());
        currentValue = '';
      } else {
        currentValue += char;
      }
    }

    values.push(currentValue.trim());
    return values;
  }

  private parseHeader(headerRow: string[]): Map<string, number> {
    const mapping = new Map<string, number>();

    headerRow.forEach((header, index) => {
      if (header) {
        const normalized = this.normalizeHeaderName(header);
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
      'last name': 'family_name',
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
      return value && value.trim() !== '' ? value.trim() : undefined;
    }
    return undefined;
  }

  canParse(fileContent: string): boolean {
    const lines = fileContent.split(/\r?\n/).filter(line => line.trim());
    const firstLine = lines[0];
    const secondLine = lines[1];
    if (!firstLine || !secondLine) {
      return false;
    }

    const delimiter = this.detectDelimiter(fileContent);
    const firstLineFields = this.parseCsvLine(firstLine, delimiter);
    const secondLineFields = this.parseCsvLine(secondLine, delimiter);

    return firstLineFields.length > 1 &&
           firstLineFields.length === secondLineFields.length &&
           !fileContent.includes('<?xml') &&
           !fileContent.trim().startsWith('{') &&
           !fileContent.trim().startsWith('[');
  }

  getSupportedExtensions(): string[] {
    return ['csv', 'tsv', 'txt'];
  }

  getName(): string {
    return 'CSV Parser';
  }
}
