import { expect } from 'chai';
import {
  descriptionHeading,
  descriptionInLanguage,
  localizedUnitTitle,
  titleInLanguage,
  withoutLeadingHeading
} from '../../src/utils/contentLanguage';

describe('contentLanguage', () => {
  describe('descriptionInLanguage', () => {
    const both = 'Gemeinsam\n<!-- lang: de -->\nDeutsch **du**\n\n<!-- LANG: en -->\nEnglish\n';

    it('picks the section in the reading language after the common text', () => {
      expect(descriptionInLanguage(both, 'en')).to.equal('Gemeinsam\n\nEnglish');
      expect(descriptionInLanguage(both, 'de-AT')).to.equal('Gemeinsam\n\nDeutsch **du**');
    });

    it('falls back to the first section for another language', () => {
      expect(descriptionInLanguage(both, 'fr')).to.equal('Gemeinsam\n\nDeutsch **du**');
      expect(descriptionInLanguage(both, '')).to.equal('Gemeinsam\n\nDeutsch **du**');
    });

    it('leaves a description without markers unchanged', () => {
      expect(descriptionInLanguage('# Woche 1\n\n<!-- note -->', 'en')).to.equal('# Woche 1\n\n<!-- note -->');
    });
  });

  describe('descriptionHeading and withoutLeadingHeading', () => {
    const german = '[NumPy]: <https://numpy.org/doc/stable/>\n\n# Mathematische Konstanten\n\nDies ist die erste Aufgabe.\n\n## Einführung\n';

    it('reads the first level-one heading, after link definitions', () => {
      expect(descriptionHeading(german)).to.equal('Mathematische Konstanten');
      expect(descriptionHeading('## Only a subsection')).to.equal(undefined);
      expect(descriptionHeading(undefined)).to.equal(undefined);
    });

    it('drops the leading heading but keeps everything else', () => {
      const body = withoutLeadingHeading(german);
      expect(body).not.to.contain('# Mathematische Konstanten');
      expect(body).to.contain('[NumPy]: <https://numpy.org/doc/stable/>');
      expect(body).to.contain('## Einführung');
    });

    it('keeps a heading that follows visible text', () => {
      const markdown = 'Intro text\n\n# Later heading\n';
      expect(withoutLeadingHeading(markdown)).to.equal(markdown);
    });
  });

  describe('localizedUnitTitle', () => {
    it('translates week units in both directions', () => {
      expect(localizedUnitTitle('Week 3', 'de')).to.equal('Woche 3');
      expect(localizedUnitTitle('Woche 3', 'en')).to.equal('Week 3');
      expect(localizedUnitTitle('Mathematische Konstanten', 'en')).to.equal('Mathematische Konstanten');
    });
  });

  describe('titleInLanguage', () => {
    it('takes the reading language from the map and the stored title without one', () => {
      const type = { title: 'Übung', title_i18n: { en: 'Exercise', de: ' ' } };
      expect(titleInLanguage(type, 'en')).to.equal('Exercise');
      expect(titleInLanguage(type, 'de')).to.equal('Übung');
      expect(titleInLanguage({ title: 'Übung' }, 'en')).to.equal('Übung');
      expect(titleInLanguage({ title: null }, 'en')).to.equal(undefined);
    });
  });
});
