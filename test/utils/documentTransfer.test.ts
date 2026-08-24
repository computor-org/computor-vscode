import { expect } from 'chai';

import {
  buildPublicDocumentUrl,
  mimeTypeFor,
  normalizeUploadPath
} from '../../src/utils/documentTransfer';

/**
 * Moving documents between the lecturer's machine and the published store
 * (issue #361).
 */
describe('document transfer helpers', () => {
  describe('normalizeUploadPath', () => {
    it('keeps the folder structure the browser reported', () => {
      // `webkitRelativePath` is how a folder upload preserves its shape.
      expect(normalizeUploadPath('slides/week1/intro.pdf')).to.equal('slides/week1/intro.pdf');
    });

    it('accepts a bare filename', () => {
      expect(normalizeUploadPath('intro.pdf')).to.equal('intro.pdf');
    });

    it('normalises Windows separators', () => {
      expect(normalizeUploadPath('slides\\week1\\intro.pdf')).to.equal('slides/week1/intro.pdf');
    });

    it('drops empty and "." segments rather than writing them out', () => {
      expect(normalizeUploadPath('slides//./week1/intro.pdf')).to.equal('slides/week1/intro.pdf');
    });

    it('refuses anything that climbs out of the target directory', () => {
      // Rewriting these into something "safe" would publish a document into a
      // scope the lecturer never picked; refusing the file is the honest answer.
      expect(normalizeUploadPath('../secrets.pdf')).to.equal(undefined);
      expect(normalizeUploadPath('slides/../../secrets.pdf')).to.equal(undefined);
      expect(normalizeUploadPath('..')).to.equal(undefined);
    });

    it('refuses a path with nothing left in it', () => {
      expect(normalizeUploadPath('')).to.equal(undefined);
      expect(normalizeUploadPath('///')).to.equal(undefined);
      expect(normalizeUploadPath('.')).to.equal(undefined);
    });
  });

  describe('mimeTypeFor', () => {
    it('names the two formats the issue asked to view', () => {
      expect(mimeTypeFor('lecture.pdf')).to.equal('application/pdf');
      expect(mimeTypeFor('notes.html')).to.equal('text/html');
    });

    it('ignores case in the extension', () => {
      expect(mimeTypeFor('LECTURE.PDF')).to.equal('application/pdf');
    });

    it('falls back to a byte stream, so the browser saves rather than guesses', () => {
      expect(mimeTypeFor('archive.keynote')).to.equal('application/octet-stream');
      expect(mimeTypeFor('noextension')).to.equal('application/octet-stream');
    });
  });

  describe('buildPublicDocumentUrl', () => {
    it('follows the entity path the store is laid out along', () => {
      expect(buildPublicDocumentUrl('https://computor.example', ['tugraz', 'physics', 'mech'], 'slides/w1.pdf'))
        .to.equal('https://computor.example/docs/tugraz/physics/mech/slides/w1.pdf');
    });

    it('serves system-scope documents from the store root', () => {
      expect(buildPublicDocumentUrl('https://computor.example', [], 'policy.pdf'))
        .to.equal('https://computor.example/docs/policy.pdf');
    });

    it('does not double the slash when the origin carries one', () => {
      expect(buildPublicDocumentUrl('https://computor.example/', ['tugraz'], 'a.pdf'))
        .to.equal('https://computor.example/docs/tugraz/a.pdf');
    });

    it('escapes what a URL cannot carry literally', () => {
      // Document names come from lecturers, so spaces and accents are normal.
      expect(buildPublicDocumentUrl('https://computor.example', ['tugraz'], 'Übung 1.pdf'))
        .to.equal('https://computor.example/docs/tugraz/%C3%9Cbung%201.pdf');
    });
  });
});
