import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  classifyRemoteRelation,
  createRepositoryBackup,
  isHistoryRewriteError
} from '../../src/utils/repositoryBackup';

/**
 * Guards the classification that decides whether a student's repository may be
 * deleted and re-cloned.
 *
 * The regression: `git pull --ff-only` prints "not possible to fast-forward"
 * for an ordinary diverged branch — local commits that were never pushed plus
 * an origin that moved on. That string used to count as a rewritten history,
 * so the recovery path backed up the working tree (excluding `.git`), deleted
 * the repository and re-cloned it, destroying every unpushed commit.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function identify(repoPath: string): void {
  git(repoPath, 'config', 'user.name', 'Computor Test');
  git(repoPath, 'config', 'user.email', 'test@computor.local');
}

function commitFile(repoPath: string, file: string, contents: string, message: string): void {
  fs.writeFileSync(path.join(repoPath, file), contents);
  git(repoPath, 'add', file);
  git(repoPath, 'commit', '-q', '-m', message);
}

interface Fixture {
  root: string;
  origin: string;
  clone: string;
}

/** A bare origin with one commit, and a tracking clone of it. */
function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-backup-'));

  const seed = path.join(root, 'seed');
  git(root, 'init', '-q', '-b', 'main', seed);
  identify(seed);
  commitFile(seed, 'README.md', 'base\n', 'Initial');

  const origin = path.join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(seed, 'push', '-q', origin, 'main');

  const clone = path.join(root, 'clone');
  git(root, 'clone', '-q', origin, clone);
  identify(clone);

  return { root, origin, clone };
}

describe('isHistoryRewriteError', () => {
  it('does not treat an ordinary non-fast-forward pull as a rewritten history', () => {
    const error = {
      stderr: 'fatal: Not possible to fast-forward, aborting.',
      message: 'Command failed: git pull --ff-only'
    };
    expect(isHistoryRewriteError(error)).to.equal(false);
  });

  it('still recognises unrelated histories', () => {
    expect(isHistoryRewriteError({
      stderr: 'fatal: refusing to merge unrelated histories'
    })).to.equal(true);

    expect(isHistoryRewriteError({
      message: 'fatal: unrelated histories'
    })).to.equal(true);
  });

  it('ignores unrelated failures', () => {
    expect(isHistoryRewriteError({
      stderr: 'fatal: could not read Username for https://git.example.org'
    })).to.equal(false);
    expect(isHistoryRewriteError(undefined)).to.equal(false);
  });
});

describe('classifyRemoteRelation', () => {
  const fixtures: string[] = [];

  function fixture(): Fixture {
    const f = createFixture();
    fixtures.push(f.root);
    return f;
  }

  after(() => {
    for (const root of fixtures) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports up-to-date for a fresh clone', async () => {
    const { clone } = fixture();
    expect(await classifyRemoteRelation(clone)).to.equal('up-to-date');
  });

  it('reports ahead when the student has unpushed commits', async () => {
    const { clone } = fixture();
    commitFile(clone, 'work.md', 'mine\n', 'Student work');
    expect(await classifyRemoteRelation(clone)).to.equal('ahead');
  });

  it('reports behind when only the remote moved', async () => {
    const { root, origin, clone } = fixture();
    const other = path.join(root, 'other');
    git(root, 'clone', '-q', origin, other);
    identify(other);
    commitFile(other, 'release.md', 'new\n', 'System Release');
    git(other, 'push', '-q', 'origin', 'main');

    git(clone, 'fetch', '-q', 'origin');
    expect(await classifyRemoteRelation(clone)).to.equal('behind');
  });

  it('reports diverged — not unrelated — when both sides moved', async () => {
    const { root, origin, clone } = fixture();
    const other = path.join(root, 'other');
    git(root, 'clone', '-q', origin, other);
    identify(other);
    commitFile(other, 'release.md', 'new\n', 'System Release');
    git(other, 'push', '-q', 'origin', 'main');

    // The student commits locally without pushing — the exact state that used
    // to be misread as a rewritten history and cost them the commit.
    commitFile(clone, 'work.md', 'mine\n', 'Student work');
    git(clone, 'fetch', '-q', 'origin');

    expect(await classifyRemoteRelation(clone)).to.equal('diverged');
  });

  it('reports diverged after a force-push, because the local commits still exist', async () => {
    const { root, origin, clone } = fixture();
    commitFile(clone, 'work.md', 'mine\n', 'Student work');

    // A realistic rewrite: a commit on top of the shared base is amended and
    // force-pushed, so the base is still a common ancestor. Neither side
    // contains the other, and the student's commit is still reachable locally —
    // so this must never be resolved by deleting the clone.
    const other = path.join(root, 'other');
    git(root, 'clone', '-q', origin, other);
    identify(other);
    commitFile(other, 'release.md', 'v1\n', 'System Release');
    git(other, 'push', '-q', 'origin', 'main');
    fs.writeFileSync(path.join(other, 'release.md'), 'v2\n');
    git(other, 'add', 'release.md');
    git(other, 'commit', '-q', '--amend', '-m', 'System Release (rewritten)');
    git(other, 'push', '-q', '--force', 'origin', 'main');

    git(clone, 'fetch', '-q', 'origin');
    expect(await classifyRemoteRelation(clone)).to.equal('diverged');
  });

  it('reports unrelated when the shared root commit itself was rewritten', async () => {
    // Amending the root commit leaves no common ancestor at all, so this is
    // genuinely indistinguishable from a different repository. The reset path
    // still gates on a verified backup and an explicit confirmation.
    const { root, origin, clone } = fixture();
    commitFile(clone, 'work.md', 'mine\n', 'Student work');

    const other = path.join(root, 'other');
    git(root, 'clone', '-q', origin, other);
    identify(other);
    git(other, 'commit', '-q', '--amend', '-m', 'Rewritten root');
    git(other, 'push', '-q', '--force', 'origin', 'main');

    git(clone, 'fetch', '-q', 'origin');
    expect(await classifyRemoteRelation(clone)).to.equal('unrelated');
  });

  it('reports unrelated when the remote is a different repository', async () => {
    const { root, clone } = fixture();

    const stranger = path.join(root, 'stranger');
    git(root, 'init', '-q', '-b', 'main', stranger);
    identify(stranger);
    commitFile(stranger, 'other.md', 'different\n', 'Unrelated root');

    const strangerBare = path.join(root, 'stranger.git');
    git(root, 'init', '-q', '--bare', '-b', 'main', strangerBare);
    git(stranger, 'push', '-q', strangerBare, 'main');

    git(clone, 'remote', 'set-url', 'origin', strangerBare);
    git(clone, 'fetch', '-q', 'origin');

    expect(await classifyRemoteRelation(clone)).to.equal('unrelated');
  });

  it('reports unknown instead of throwing when the path is not a repository', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-backup-empty-'));
    fixtures.push(empty);
    expect(await classifyRemoteRelation(empty)).to.equal('unknown');
  });
});

/**
 * The reset path deletes a repository only after this returns a path, so which
 * failures are silent (undefined) and which throw is a safety contract, not an
 * implementation detail.
 */
describe('createRepositoryBackup', () => {
  const roots: string[] = [];

  after(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function tmp(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-backup-create-'));
    roots.push(root);
    return root;
  }

  it('copies the working tree and leaves Git metadata behind', async () => {
    const root = tmp();
    const repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'week_1'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'week_1', 'solution.py'), 'print(1)\n');
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    const backupPath = await createRepositoryBackup(repo, path.join(root, 'ws'), {
      repoName: 'course-repo',
      timestamp: new Date('2026-08-24T10:00:00Z')
    });

    expect(backupPath).to.be.a('string');
    expect(fs.readFileSync(path.join(backupPath!, 'week_1', 'solution.py'), 'utf-8')).to.equal('print(1)\n');
    expect(fs.existsSync(path.join(backupPath!, '.git'))).to.equal(false);
  });

  it('returns undefined — without throwing — when the repository is gone', async () => {
    const root = tmp();
    const backupPath = await createRepositoryBackup(
      path.join(root, 'missing'),
      path.join(root, 'ws')
    );
    // This is the silent path: the caller's try/catch never fires, so the reset
    // must test the returned value rather than trusting that it caught something.
    expect(backupPath).to.equal(undefined);
  });

  it('returns undefined when the path is a file rather than a directory', async () => {
    const root = tmp();
    const file = path.join(root, 'not-a-repo');
    fs.writeFileSync(file, 'x');
    expect(await createRepositoryBackup(file, path.join(root, 'ws'))).to.equal(undefined);
  });
});
