import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

import { HELP_PAGES, helpPageFor } from '../../src/utils/studentHelpPages';

/**
 * The student help: which page a row leads to, and whether the pages hold up.
 *
 * Both ways this can break are silent. A context value gains a segment and the
 * routing quietly falls through to the wrong page; a page is renamed and Help
 * shows a warning instead of an answer. Neither shows up in a type check, and
 * nobody clicks Help on every row before a release.
 */

const HELP_DIR = path.join(__dirname, '..', '..', 'docs', 'help');

describe('student help', () => {
  describe('helpPageFor', () => {
    it('sends the course row to the course page', () => {
      expect(helpPageFor('studentCourseRoot')).to.equal(HELP_PAGES.course);
    });

    it('sends a unit to the unit page', () => {
      expect(helpPageFor('studentCourseUnit')).to.equal(HELP_PAGES.unit);
    });

    it('sends an assignment to the assignment page', () => {
      expect(helpPageFor('studentCourseContent.assignment.withRepository.cloned'))
        .to.equal(HELP_PAGES.assignment);
    });

    /**
     * The bug this routing was written for: a reading shares the row type with
     * an assignment, and used to be handed a page about repositories, test runs
     * and submission limits — none of which it has.
     */
    it('sends a reading to the unit page, not the assignment page', () => {
      expect(helpPageFor('studentCourseContent.reading')).to.equal(HELP_PAGES.unit);
    });

    it('is not confused by extra segments on a context value', () => {
      expect(helpPageFor('studentCourseUnit.hasDescription')).to.equal(HELP_PAGES.unit);
      expect(helpPageFor('studentCourseContent.assignment.team.graded.hasDescription'))
        .to.equal(HELP_PAGES.assignment);
      expect(helpPageFor('studentCourseContent.reading.hasDescription'))
        .to.equal(HELP_PAGES.unit);
    });

    it('does not mistake a substring for the assignment segment', () => {
      // 'reading' contains no 'assignment', but a naive `includes` on the whole
      // string would match a title-derived segment that happens to contain it.
      expect(helpPageFor('studentCourseContent.reading.assignments-overview'))
        .to.equal(HELP_PAGES.unit);
    });

    it('sends files and folders to the assignment page, where files are covered', () => {
      expect(helpPageFor('studentFile')).to.equal(HELP_PAGES.assignment);
      expect(helpPageFor('studentFolder')).to.equal(HELP_PAGES.assignment);
    });

    it('falls back to the course page when there is no row', () => {
      expect(helpPageFor(undefined)).to.equal(HELP_PAGES.course);
      expect(helpPageFor('')).to.equal(HELP_PAGES.course);
      expect(helpPageFor(42)).to.equal(HELP_PAGES.course);
      expect(helpPageFor('somethingElseEntirely')).to.equal(HELP_PAGES.course);
    });
  });

  describe('the pages themselves', () => {
    it('every page the routing can name exists', () => {
      for (const page of Object.values(HELP_PAGES)) {
        expect(fs.existsSync(path.join(HELP_DIR, page)), `missing help page: ${page}`).to.be.true;
      }
    });

    it('every link between help pages resolves', () => {
      const pages = fs.readdirSync(HELP_DIR).filter(name => name.endsWith('.md'));
      const broken: string[] = [];

      for (const page of pages) {
        const text = fs.readFileSync(path.join(HELP_DIR, page), 'utf8');
        const links = text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);

        for (const [, targetRaw] of links) {
          const target = targetRaw ?? '';
          if (/^(https?:|mailto:|#)/.test(target)) {
            continue;
          }
          const [file, anchor] = target.split('#');
          if (!file) {
            continue;
          }
          if (!pages.includes(file)) {
            broken.push(`${page} → ${target} (no such page)`);
            continue;
          }
          if (anchor) {
            // Headings render to anchors as GitHub does: lowercase, spaces to
            // dashes, punctuation dropped.
            const targetText = fs.readFileSync(path.join(HELP_DIR, file), 'utf8');
            const anchors = Array.from(targetText.matchAll(/^#{1,6}\s+(.+)$/gm)).map(([, heading]) =>
              (heading ?? '')
                .trim()
                .toLowerCase()
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, '-')
            );
            if (!anchors.includes(anchor)) {
              broken.push(`${page} → ${target} (no such heading)`);
            }
          }
        }
      }

      expect(broken, `broken help links:\n  ${broken.join('\n  ')}`).to.be.empty;
    });

    it('no page is left empty', () => {
      for (const page of Object.values(HELP_PAGES)) {
        const text = fs.readFileSync(path.join(HELP_DIR, page), 'utf8');
        expect(text.trim().length, `empty help page: ${page}`).to.be.greaterThan(200);
      }
    });
  });
});
