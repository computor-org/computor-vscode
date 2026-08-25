import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  checkSubmitted,
  clearSubmittedCache,
  submittedWarning
} from '../../src/utils/submittedFiles';
import type { ComputorApiService } from '../../src/services/ComputorApiService';

/**
 * "Was this file already handed in?" against a real repository on disk.
 *
 * A student may delete anything they own, but doing it to a file that is part
 * of a submission deserves a question first (computor-org/issues#352). The
 * question is decided by the commit the submission recorded, not by "this file
 * was saved once" — so a file written after the submission must not trigger it,
 * and a file that was in the submission must, even after it was later changed.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

interface Fixture {
  root: string;
  repo: string;
  /** Commit of the "submission". */
  submitted: string;
}

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'submitted-files-'));
  const repo = path.join(root, 'student');
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.name', 'Computor Test');
  git(repo, 'config', 'user.email', 'test@computor.local');

  const write = (file: string, contents: string) => {
    const target = path.join(repo, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  };

  write('week_1/solution.py', 'print(1)\n');
  write('week_1/data/values.csv', 'a,b\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'submission');
  const submitted = git(repo, 'rev-parse', 'HEAD');

  // Written afterwards: never part of the submission.
  write('week_1/scratch.py', 'print(2)\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'later work');

  return { root, repo, submitted };
}

/** An API service that reports exactly these submission commits. */
function apiReturning(commits: Array<string | null>): ComputorApiService {
  return {
    listSubmissionArtifacts: async () =>
      commits.map((commit, index) => ({
        id: `artifact-${index}`,
        submission_group_id: 'group-1',
        file_size: 1,
        bucket_name: 'b',
        object_key: 'k',
        uploaded_at: '2026-01-01T00:00:00Z',
        version_identifier: commit,
        submit: true
      }))
  } as unknown as ComputorApiService;
}

describe('submittedFiles', () => {
  let fixture: Fixture;

  beforeEach(() => {
    clearSubmittedCache();
    fixture = createFixture();
  });

  afterEach(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  describe('checkSubmitted', () => {
    it('recognises a file that was part of the submission', async () => {
      const check = await checkSubmitted(
        fixture.repo,
        path.join(fixture.repo, 'week_1/solution.py'),
        'group-1',
        apiReturning([fixture.submitted])
      );
      expect(check.submitted).to.be.true;
      expect(check.paths).to.deep.equal(['week_1/solution.py']);
    });

    it('leaves a file written after the submission alone', async () => {
      const check = await checkSubmitted(
        fixture.repo,
        path.join(fixture.repo, 'week_1/scratch.py'),
        'group-1',
        apiReturning([fixture.submitted])
      );
      expect(check.submitted).to.be.false;
    });

    it('counts a folder as submitted when anything inside it was', async () => {
      const check = await checkSubmitted(
        fixture.repo,
        path.join(fixture.repo, 'week_1/data'),
        'group-1',
        apiReturning([fixture.submitted]),
        { isDirectory: true }
      );
      expect(check.submitted).to.be.true;
      expect(check.paths).to.deep.equal(['week_1/data/values.csv']);
    });

    it('says no when the assignment has no submission at all', async () => {
      const check = await checkSubmitted(
        fixture.repo,
        path.join(fixture.repo, 'week_1/solution.py'),
        'group-1',
        apiReturning([])
      );
      expect(check.submitted).to.be.false;
    });

    it('says no without a submission group, rather than asking the server', async () => {
      const api = {
        listSubmissionArtifacts: async () => {
          throw new Error('should not be called');
        }
      } as unknown as ComputorApiService;

      const check = await checkSubmitted(
        fixture.repo,
        path.join(fixture.repo, 'week_1/solution.py'),
        undefined,
        api
      );
      expect(check.submitted).to.be.false;
    });

    /**
     * The guard must never block the action it guards: a submission made from
     * another machine references a commit this clone has never seen, and that
     * is a reason to stay quiet, not to fail the delete.
     */
    it('stays quiet about a commit this clone does not have', async () => {
      const check = await checkSubmitted(
        fixture.repo,
        path.join(fixture.repo, 'week_1/solution.py'),
        'group-1',
        apiReturning(['0000000000000000000000000000000000000000'])
      );
      expect(check.submitted).to.be.false;
    });

    it('ignores artifacts that recorded no commit', async () => {
      const check = await checkSubmitted(
        fixture.repo,
        path.join(fixture.repo, 'week_1/solution.py'),
        'group-1',
        apiReturning([null])
      );
      expect(check.submitted).to.be.false;
    });

    it('has nothing to say about a path outside the repository', async () => {
      const check = await checkSubmitted(
        fixture.repo,
        path.join(fixture.root, 'elsewhere.py'),
        'group-1',
        apiReturning([fixture.submitted])
      );
      expect(check.submitted).to.be.false;
    });

    it('survives an API that is unavailable', async () => {
      const api = {
        listSubmissionArtifacts: async () => undefined
      } as unknown as ComputorApiService;

      const check = await checkSubmitted(
        fixture.repo,
        path.join(fixture.repo, 'week_1/solution.py'),
        'group-1',
        api
      );
      expect(check.submitted).to.be.false;
    });
  });

  describe('submittedWarning', () => {
    it('has nothing to add when nothing was submitted', () => {
      expect(submittedWarning({ submitted: false, paths: [] }, false)).to.be.undefined;
    });

    it('names the file for a single file', () => {
      const warning = submittedWarning({ submitted: true, paths: ['a.py'] }, false);
      expect(warning).to.contain('part of a submission');
    });

    it('names the one file inside a folder', () => {
      const warning = submittedWarning({ submitted: true, paths: ['week_1/a.py'] }, true);
      expect(warning).to.contain('week_1/a.py');
    });

    it('counts them when a folder holds several', () => {
      const warning = submittedWarning({ submitted: true, paths: ['a.py', 'b.py'] }, true);
      expect(warning).to.contain('2 files');
    });
  });
});
