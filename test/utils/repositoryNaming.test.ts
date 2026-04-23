import { expect } from 'chai';
import * as path from 'path';
import {
  deriveRepositoryDirectoryName,
  buildStudentRepoRoot,
  buildReviewRepoRoot,
  buildReferenceRepoRoot,
  slugify
} from '../../src/utils/repositoryNaming';

describe('repositoryNaming', () => {
  describe('deriveRepositoryDirectoryName', () => {
    it('prefers submissionRepo.full_path with slashes converted to dots', () => {
      expect(deriveRepositoryDirectoryName({
        submissionRepo: { full_path: 'course/student-group-1' },
        submissionGroupId: 'ignored-id',
        courseId: 'ignored'
      })).to.equal('course.student-group-1');
    });

    it('falls back to submissionGroupId when full_path is missing', () => {
      expect(deriveRepositoryDirectoryName({
        submissionGroupId: 'abc-123',
        courseId: 'course-42'
      })).to.equal('abc-123');
    });

    it('falls back to memberId for tutor repositories', () => {
      expect(deriveRepositoryDirectoryName({
        memberId: 'member-7',
        courseId: 'course-42'
      })).to.equal('member-7');
    });

    it('falls back to courseId for lecturer repositories', () => {
      expect(deriveRepositoryDirectoryName({ courseId: 'course-42' })).to.equal('course-42');
    });

    it('slugifies the last path segment of remoteUrl when nothing else is known', () => {
      expect(deriveRepositoryDirectoryName({
        remoteUrl: 'https://gitlab.example/foo/My-Sample-Repo.git'
      })).to.equal('my-sample-repo');
    });

    it('uses the final non-empty submissionRepo.full_path segment when no other id is provided', () => {
      // full_path wins regardless of other hints, so strip it and rely on URL-derived fallback
      expect(deriveRepositoryDirectoryName({
        submissionRepo: { path: 'weekly-assignment' }
      })).to.equal('weekly-assignment');
    });

    it('returns the literal "repository" when no context yields a usable name', () => {
      expect(deriveRepositoryDirectoryName({})).to.equal('repository');
    });
  });

  describe('slugify', () => {
    it('strips a trailing .git, whitespace, lowercases, and replaces illegal chars', () => {
      expect(slugify('  My Repo.git  ')).to.equal('my-repo');
    });

    it('preserves letters, digits, underscore, and hyphen', () => {
      expect(slugify('Foo_Bar-123')).to.equal('foo_bar-123');
    });

    it('returns undefined for empty / undefined / all-illegal input', () => {
      expect(slugify(undefined)).to.be.undefined;
      expect(slugify('')).to.be.undefined;
      expect(slugify('***')).to.be.undefined;
    });
  });

  describe('path builders', () => {
    it('buildStudentRepoRoot → workspaceRoot/student/<name>', () => {
      expect(buildStudentRepoRoot('/ws', 'foo'))
        .to.equal(path.join('/ws', 'student', 'foo'));
    });

    it('buildReviewRepoRoot → workspaceRoot/review/repositories/<name>', () => {
      expect(buildReviewRepoRoot('/ws', 'foo'))
        .to.equal(path.join('/ws', 'review', 'repositories', 'foo'));
    });

    it('buildReferenceRepoRoot → workspaceRoot/reference/<name>', () => {
      expect(buildReferenceRepoRoot('/ws', 'foo'))
        .to.equal(path.join('/ws', 'reference', 'foo'));
    });
  });
});
