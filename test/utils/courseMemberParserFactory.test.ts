import { expect } from 'chai';
import * as XLSX from 'xlsx';
import { CourseMemberParserFactory } from '../../src/utils/parsers/CourseMemberParserFactory';

describe('CourseMemberParserFactory.decode', () => {
  const rows = [['E-Mail', 'Vorname', 'Familienname'], ['juergen.mueller@example.com', 'Jürgen', 'Müller']];

  for (const bookType of ['xlsx', 'xls'] as const) {
    it(`imports an ${bookType} file read from disk, umlauts included`, () => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Teilnehmer');
      const file: Buffer = XLSX.write(workbook, { type: 'buffer', bookType });
      for (const extension of [bookType, undefined]) {
        const members = CourseMemberParserFactory.parse(CourseMemberParserFactory.decode(file, extension), extension);
        expect(members).to.have.length(1);
        expect(members[0]).to.include({ email: 'juergen.mueller@example.com', given_name: 'Jürgen', family_name: 'Müller' });
      }
    });
  }

  it('keeps CSV text as UTF-8', () => {
    const file = Buffer.from('email,given_name,family_name\njuergen.mueller@example.com,Jürgen,Müller\n', 'utf-8');
    const members = CourseMemberParserFactory.parse(CourseMemberParserFactory.decode(file, 'csv'), 'csv');
    expect(members[0]).to.include({ given_name: 'Jürgen', family_name: 'Müller' });
  });
});
