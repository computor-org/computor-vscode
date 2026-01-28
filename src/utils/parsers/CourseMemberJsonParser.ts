import { ICourseMemberParser, CourseMemberImportRow } from './ICourseMemberParser';

/**
 * Parser for JSON format.
 *
 * Supports two formats:
 * 1. Array of objects: [{ "email": "...", "given_name": "..." }, ...]
 * 2. Object with array property: { "members": [...] } or { "data": [...] }
 *
 * Field names are normalized to handle various naming conventions.
 */
export class CourseMemberJsonParser implements ICourseMemberParser {

  parse(fileContent: string): CourseMemberImportRow[] {
    try {
      const parsed = JSON.parse(fileContent);
      const dataArray = this.extractDataArray(parsed);

      if (!Array.isArray(dataArray) || dataArray.length === 0) {
        throw new Error('Invalid JSON: No member data array found');
      }

      const members: CourseMemberImportRow[] = [];
      for (const item of dataArray) {
        if (typeof item !== 'object' || item === null) {
          continue;
        }

        const member = this.parseDataRow(item);
        if (member && member.email) {
          members.push(member);
        }
      }

      return members;
    } catch (error) {
      console.error('Failed to parse JSON:', error);
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON syntax: ${error.message}`);
      }
      throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : error}`);
    }
  }

  private extractDataArray(parsed: unknown): unknown[] {
    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      const possibleArrayKeys = ['members', 'data', 'students', 'users', 'items', 'records'];

      for (const key of possibleArrayKeys) {
        if (Array.isArray(obj[key])) {
          return obj[key] as unknown[];
        }
      }

      for (const key of Object.keys(obj)) {
        if (Array.isArray(obj[key])) {
          return obj[key] as unknown[];
        }
      }
    }

    return [];
  }

  private parseDataRow(row: Record<string, unknown>): CourseMemberImportRow | null {
    const normalizedRow = this.normalizeKeys(row);

    const email = this.getStringValue(normalizedRow, 'email');
    if (!email) {
      return null;
    }

    const member: CourseMemberImportRow = {
      email,
      given_name: this.getStringValue(normalizedRow, 'given_name'),
      family_name: this.getStringValue(normalizedRow, 'family_name'),
      student_id: this.getStringValue(normalizedRow, 'student_id'),
      course_group_title: this.getStringValue(normalizedRow, 'course_group_title'),
      course_role_id: this.getStringValue(normalizedRow, 'course_role_id'),
      incoming: this.getStringValue(normalizedRow, 'incoming'),
      study_id: this.getStringValue(normalizedRow, 'study_id'),
      study_name: this.getStringValue(normalizedRow, 'study_name'),
      registration_date: this.getStringValue(normalizedRow, 'registration_date'),
      notes: this.getStringValue(normalizedRow, 'notes')
    };

    const semesterValue = normalizedRow['semester'];
    if (semesterValue !== undefined && semesterValue !== null) {
      const semester = typeof semesterValue === 'number'
        ? semesterValue
        : parseInt(String(semesterValue), 10);
      if (!isNaN(semester)) {
        member.semester = semester;
      }
    }

    return member;
  }

  private normalizeKeys(row: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = this.normalizeFieldName(key);
      normalized[normalizedKey] = value;
    }

    return normalized;
  }

  private normalizeFieldName(fieldName: string): string {
    const normalized = fieldName.toLowerCase().trim().replace(/[-\s]+/g, '_');

    const mappings: { [key: string]: string } = {
      'email': 'email',
      'e_mail': 'email',
      'mail': 'email',
      'vorname': 'given_name',
      'given_name': 'given_name',
      'givenname': 'given_name',
      'firstname': 'given_name',
      'first_name': 'given_name',
      'familienname': 'family_name',
      'family_name': 'family_name',
      'familyname': 'family_name',
      'lastname': 'family_name',
      'last_name': 'family_name',
      'nachname': 'family_name',
      'matrikelnummer': 'student_id',
      'student_id': 'student_id',
      'studentid': 'student_id',
      'matr._nr.': 'student_id',
      'gruppe': 'course_group_title',
      'group': 'course_group_title',
      'course_group': 'course_group_title',
      'course_group_title': 'course_group_title',
      'role': 'course_role_id',
      'course_role': 'course_role_id',
      'course_role_id': 'course_role_id',
      'incoming': 'incoming',
      'kennzahl': 'study_id',
      'study_id': 'study_id',
      'studyid': 'study_id',
      'studien_id': 'study_id',
      'studium': 'study_name',
      'study': 'study_name',
      'study_name': 'study_name',
      'semester': 'semester',
      'semester_im_studium': 'semester',
      'anmeldedatum': 'registration_date',
      'registration_date': 'registration_date',
      'anmerkung': 'notes',
      'notes': 'notes',
      'note': 'notes',
      'bemerkung': 'notes'
    };

    return mappings[normalized] || normalized;
  }

  private getStringValue(row: Record<string, unknown>, fieldName: string): string | undefined {
    const value = row[fieldName];
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    const strValue = String(value).trim();
    return strValue !== '' ? strValue : undefined;
  }

  canParse(fileContent: string): boolean {
    const trimmed = fileContent.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return false;
    }

    try {
      JSON.parse(fileContent);
      return true;
    } catch {
      return false;
    }
  }

  getSupportedExtensions(): string[] {
    return ['json'];
  }

  getName(): string {
    return 'JSON Parser';
  }
}
