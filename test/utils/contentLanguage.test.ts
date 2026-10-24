import { expect } from 'chai';
import {
  descriptionHeading,
  descriptionInLanguage,
  localizedUnitTitle,
  resolveContentLanguage,
  withoutLeadingHeading
} from '../../src/utils/contentLanguage';
import { landingSection } from '../../src/services/WorkspaceCourseLanding';

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

  describe('resolveContentLanguage', () => {
    it('uses the language the learner chose', () => {
      expect(resolveContentLanguage('en', 'de')).to.equal('en');
    });

    it('uses the course language when the learner chose none', () => {
      expect(resolveContentLanguage(null, 'de')).to.equal('de');
      expect(resolveContentLanguage('  ', 'DE')).to.equal('de');
    });

    it('falls back to English when neither is known', () => {
      expect(resolveContentLanguage(undefined, null)).to.equal('en');
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

  describe('landingSection', () => {
    it('shows the description heading once, in place of the stored title', () => {
      const section = landingSection('Math Constants', '# Mathematische Konstanten\n\nDies ist die erste Aufgabe.', 'de', 'fallback');
      expect(section).to.equal('---\n\n*Erste Aufgabe*\n\n## Mathematische Konstanten\n\nDies ist die erste Aufgabe.');
      expect(section).not.to.contain('Math Constants');
    });

    it('keeps the stored title when the description has no heading', () => {
      expect(landingSection('Week 1', undefined, 'de', 'Wähle diese Aufgabe.')).to.equal('---\n\n*Erste Aufgabe*\n\n## Woche 1\n\nWähle diese Aufgabe.');
    });

    it('separates the exercise from the course description and labels it in English', () => {
      const markdown = `# Course\n\nCourse description\n\n${landingSection('Week 1', '# Types\n\nBody', 'en', 'x')}`;
      expect(markdown).to.equal('# Course\n\nCourse description\n\n---\n\n*First exercise*\n\n## Types\n\nBody');
    });
  });
});
