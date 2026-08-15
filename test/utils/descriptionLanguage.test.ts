import { expect } from 'chai';

import {
  availableDescriptionLanguages,
  listDescriptionFiles,
  pickDescriptionFile
} from '../../src/utils/descriptionLanguage';

/**
 * An assignment ships one description file per language, and picking between
 * them used to end at "whatever the directory listing returned first". That is
 * alphabetical, so a student whose language was missing was shown German for
 * no better reason than `_de` sorting before `_en`
 * (computor-org/issues#328).
 */
describe('description language', () => {
  describe('pickDescriptionFile', () => {
    it('prefers the reader\'s own language', () => {
      const files = ['README.md', 'README_de.md', 'README_en.md'];
      expect(pickDescriptionFile(files, 'de')).to.equal('README_de.md');
    });

    it('falls back to English rather than the alphabetically first language', () => {
      const files = ['README_de.md', 'README_en.md', 'README_fr.md'];
      expect(pickDescriptionFile(files, 'it')).to.equal('README_en.md');
    });

    it('falls back to English when the reader has no preference at all', () => {
      expect(pickDescriptionFile(['README_de.md', 'README_en.md'], null)).to.equal('README_en.md');
      expect(pickDescriptionFile(['README_de.md', 'README_en.md'])).to.equal('README_en.md');
    });

    it('uses the unlabelled default when there is no English variant', () => {
      const files = ['README.md', 'README_de.md'];
      expect(pickDescriptionFile(files, 'fr')).to.equal('README.md');
    });

    it('takes the only translation there is rather than showing nothing', () => {
      expect(pickDescriptionFile(['README_de.md'], 'fr')).to.equal('README_de.md');
    });

    it('reads the index.md spelling examples use before release renames them', () => {
      const files = ['index.md', 'index_de.md', 'index_en.md'];
      expect(pickDescriptionFile(files, 'de')).to.equal('index_de.md');
      expect(pickDescriptionFile(files, 'fr')).to.equal('index_en.md');
    });

    it('keeps full paths intact', () => {
      const files = ['/tmp/a/content/index_de.md', '/tmp/a/content/index_en.md'];
      expect(pickDescriptionFile(files, 'de')).to.equal('/tmp/a/content/index_de.md');
    });

    it('ignores files that are not descriptions', () => {
      const files = ['notes.md', 'CHANGELOG.md', 'main.py', 'README_en.md'];
      expect(pickDescriptionFile(files, 'fr')).to.equal('README_en.md');
    });

    it('returns nothing when the assignment has no description', () => {
      expect(pickDescriptionFile(['main.py', 'test.yaml'], 'en')).to.equal(undefined);
      expect(pickDescriptionFile([], 'en')).to.equal(undefined);
    });

    it('is not confused by a preference in a different case or with padding', () => {
      expect(pickDescriptionFile(['README_de.md', 'README_en.md'], ' DE ')).to.equal('README_de.md');
    });
  });

  describe('availableDescriptionLanguages', () => {
    it('lists the translations, English first', () => {
      const files = ['README.md', 'README_fr.md', 'README_de.md', 'README_en.md'];
      expect(availableDescriptionLanguages(files)).to.deep.equal(['en', 'de', 'fr']);
    });

    it('does not invent a language for the unlabelled default', () => {
      expect(availableDescriptionLanguages(['README.md'])).to.deep.equal([]);
    });
  });

  describe('listDescriptionFiles', () => {
    it('separates the default document from the translations', () => {
      expect(listDescriptionFiles(['README.md', 'README_de.md', 'main.py'])).to.deep.equal([
        { file: 'README.md' },
        { file: 'README_de.md', language: 'de' }
      ]);
    });
  });
});
