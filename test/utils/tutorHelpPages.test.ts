import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

import { TUTOR_HELP_PAGES, tutorHelpPageFor } from '../../src/utils/tutorHelpPages';

/**
 * The tutor help: which page a row leads to, and whether the pages hold up.
 *
 * Same silent failure modes as the student help — a context value gains a
 * segment and the routing quietly falls through to the wrong page, or a page
 * is renamed and Help shows a warning instead of an answer. The link check
 * lives in studentHelpPages.test.ts, which sweeps every page in docs/help.
 */

const HELP_DIR = path.join(__dirname, '..', '..', 'docs', 'help');

describe('tutor help', () => {
  describe('tutorHelpPageFor', () => {
    it('sends an assignment to the assignment page, hidden or not', () => {
      expect(tutorHelpPageFor('tutorStudentContent.assignment.hasRepo'))
        .to.equal(TUTOR_HELP_PAGES.assignment);
      expect(tutorHelpPageFor('tutorStudentContent.assignment.noRepo.hidden'))
        .to.equal(TUTOR_HELP_PAGES.assignment);
    });

    it('sends everything inside an assignment to the assignment page', () => {
      expect(tutorHelpPageFor('tutorVirtualFolder.submissions')).to.equal(TUTOR_HELP_PAGES.assignment);
      expect(tutorHelpPageFor('tutorVirtualFolder.repository.hasRepo')).to.equal(TUTOR_HELP_PAGES.assignment);
      expect(tutorHelpPageFor('tutorFsFolder.submission')).to.equal(TUTOR_HELP_PAGES.assignment);
      expect(tutorHelpPageFor('tutorFsFile.reference')).to.equal(TUTOR_HELP_PAGES.assignment);
      expect(tutorHelpPageFor('tutorSubmissionArtifact')).to.equal(TUTOR_HELP_PAGES.assignment);
    });

    it('sends a reading to the course page, which has no grading to explain', () => {
      expect(tutorHelpPageFor('tutorStudentContent.reading')).to.equal(TUTOR_HELP_PAGES.course);
      expect(tutorHelpPageFor('tutorStudentContent.reading.hidden')).to.equal(TUTOR_HELP_PAGES.course);
    });

    it('sends units, members and filter rows to the course page', () => {
      expect(tutorHelpPageFor('tutorUnit')).to.equal(TUTOR_HELP_PAGES.course);
      expect(tutorHelpPageFor('tutorUnit.hidden')).to.equal(TUTOR_HELP_PAGES.course);
      expect(tutorHelpPageFor('tutorMember.selected')).to.equal(TUTOR_HELP_PAGES.course);
      expect(tutorHelpPageFor('tutorFilterCourse.selected')).to.equal(TUTOR_HELP_PAGES.course);
      expect(tutorHelpPageFor('tutorGroupOption')).to.equal(TUTOR_HELP_PAGES.course);
    });

    it('falls back to the course page when there is no row', () => {
      expect(tutorHelpPageFor(undefined)).to.equal(TUTOR_HELP_PAGES.course);
      expect(tutorHelpPageFor('')).to.equal(TUTOR_HELP_PAGES.course);
      expect(tutorHelpPageFor(42)).to.equal(TUTOR_HELP_PAGES.course);
      expect(tutorHelpPageFor('somethingElseEntirely')).to.equal(TUTOR_HELP_PAGES.course);
    });
  });

  describe('the pages themselves', () => {
    it('every page the routing can name exists', () => {
      for (const page of Object.values(TUTOR_HELP_PAGES)) {
        expect(fs.existsSync(path.join(HELP_DIR, page)), `missing help page: ${page}`).to.be.true;
      }
    });

    it('no page is left empty', () => {
      for (const page of Object.values(TUTOR_HELP_PAGES)) {
        const text = fs.readFileSync(path.join(HELP_DIR, page), 'utf8');
        expect(text.trim().length, `empty help page: ${page}`).to.be.greaterThan(200);
      }
    });
  });
});
