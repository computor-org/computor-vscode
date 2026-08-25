import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CTGit } from '../../src/git/CTGit';

/**
 * `forkUpdate` against real repositories on disk (local paths as remotes, no
 * network). The regression these guard is that the operation silently did
 * nothing: `simpleGit.fetch('upstream')` runs a bare `git fetch` — simple-git
 * only forwards the remote when a branch is passed with it — so
 * `refs/remotes/upstream/*` was never written and every student repository
 * stayed on the template revision it was seeded from.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

/** Committer identity, so the tests do not depend on the machine's git config. */
function identify(repoPath: string): void {
  git(repoPath, 'config', 'user.name', 'Computor Test');
  git(repoPath, 'config', 'user.email', 'test@computor.local');
}

function commitFile(repoPath: string, file: string, contents: string, message: string): void {
  fs.writeFileSync(path.join(repoPath, file), contents);
  git(repoPath, 'add', file);
  git(repoPath, 'commit', '-m', message);
}

interface Fixture {
  root: string;
  /** The course's student-template. */
  template: string;
  /** The student's own (bare) repository — what `origin` points at. */
  origin: string;
  /** The student's working clone. */
  student: string;
}

/**
 * A course template, a student repository seeded from it (shared ancestry, as
 * Forgejo self-migration produces), and the student's local clone.
 */
function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctgit-fork-update-'));

  const template = path.join(root, 'template');
  git(root, 'init', '-q', '-b', 'main', template);
  identify(template);
  commitFile(template, 'week_1.md', 'Assignment 1\n', 'System Release');

  const origin = path.join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(template, 'push', '-q', origin, 'main');

  const student = path.join(root, 'student');
  git(root, 'clone', '-q', origin, student);
  identify(student);

  return { root, template, origin, student };
}

/** A new assignment released into the template after the student cloned. */
function releaseNewAssignment(fixture: Fixture): void {
  commitFile(fixture.template, 'week_2.md', 'Assignment 2\n', 'Release week 2');
}

describe('CTGit.forkUpdate', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  it('merges new template commits into the student repository and pushes them to origin', async function () {
    this.timeout(20_000);
    releaseNewAssignment(fixture);

    const result = await new CTGit(fixture.student).forkUpdate(fixture.template, { autoResolveConflicts: true });

    expect(result.updated).to.equal(true);
    expect(result.behindCount).to.equal(1);
    expect(result.defaultBranch).to.equal('main');
    expect(fs.existsSync(path.join(fixture.student, 'week_2.md'))).to.equal(true);
    // The student's server-side repository has to carry the update too, or the
    // next clone (a second machine, a rebuilt workspace) loses it again.
    expect(git(fixture.origin, 'show', 'main:week_2.md')).to.equal('Assignment 2');
  });

  it('writes the upstream remote-tracking refs it compares against', async function () {
    this.timeout(20_000);
    releaseNewAssignment(fixture);

    await new CTGit(fixture.student).forkUpdate(fixture.template, {
      autoResolveConflicts: true,
      removeRemote: false
    });

    expect(git(fixture.student, 'for-each-ref', '--format=%(refname)').split('\n'))
      .to.include('refs/remotes/upstream/main');
  });

  it('reports no update, and drops the remote it added, when the template has nothing new', async function () {
    this.timeout(20_000);

    const result = await new CTGit(fixture.student).forkUpdate(fixture.template, { autoResolveConflicts: true });

    expect(result.updated).to.equal(false);
    expect(result.behindCount).to.equal(0);
    expect(git(fixture.student, 'remote').split('\n')).to.not.include('upstream');
  });

  it('throws instead of reporting "up to date" when the template cannot be compared against', async function () {
    this.timeout(20_000);
    releaseNewAssignment(fixture);

    let error: unknown;
    try {
      await new CTGit(fixture.student).forkUpdate(fixture.template, {
        autoResolveConflicts: true,
        defaultBranch: 'a-branch-the-template-does-not-have'
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.match(/Failed to compare this repository against upstream\//);
  });

  it('keeps an upstream remote the repository already had, restoring its URL', async function () {
    this.timeout(20_000);
    // External-mode repos are seeded by cloning the template and keep it
    // linked as `upstream`; deleting that remote would also delete its
    // remote-tracking refs.
    git(fixture.student, 'remote', 'add', 'upstream', fixture.template);
    releaseNewAssignment(fixture);

    // A different spelling of the same location stands in for the
    // credential-carrying URL the sync flow passes in.
    const result = await new CTGit(fixture.student).forkUpdate(`file://${fixture.template}`, {
      autoResolveConflicts: true
    });

    expect(result.updated).to.equal(true);
    expect(git(fixture.student, 'remote').split('\n')).to.include('upstream');
    expect(git(fixture.student, 'remote', 'get-url', 'upstream')).to.equal(fixture.template);
  });

  it('syncs again on a later run, with the repository-owned remote still in place', async function () {
    this.timeout(30_000);
    // The offline/legacy-GitLab shape: OfflineRepositoryManager links the
    // template as a persistent authenticated `upstream`, and
    // StudentOfflineCommands only syncs when it finds that remote. Deleting it
    // after the first run left every later pull with nothing to sync.
    git(fixture.student, 'remote', 'add', 'upstream', fixture.template);

    releaseNewAssignment(fixture);
    const first = await new CTGit(fixture.student).forkUpdate(fixture.template, { autoResolveConflicts: true });

    commitFile(fixture.template, 'week_3.md', 'Assignment 3\n', 'Release week 3');
    const second = await new CTGit(fixture.student).forkUpdate(fixture.template, { autoResolveConflicts: true });

    expect([first.updated, second.updated]).to.deep.equal([true, true]);
    expect(git(fixture.student, 'remote').split('\n')).to.include('upstream');
    expect(fs.existsSync(path.join(fixture.student, 'week_3.md'))).to.equal(true);
    expect(git(fixture.origin, 'show', 'main:week_3.md')).to.equal('Assignment 3');
  });

  /**
   * The credential the sync injects into `upstream` must never outlive the
   * call. The backend rotates the Forgejo clone token on every provision, so
   * one left behind is dead by the next run — and `git fetch --all` fails
   * whenever a single remote fails, which took the student's own origin fetch
   * down with it (computor-org/issues#332).
   */
  it('leaves no credential-carrying remote behind when the upstream fetch fails', async function () {
    this.timeout(20_000);
    // Port 1 refuses immediately, standing in for an expired token or an
    // unreachable git server. Nothing may be prompted for.
    const unreachable = 'http://oauth2:dead-token@127.0.0.1:1/itpcp-2027/template.git';

    let threw = false;
    try {
      await new CTGit(fixture.student).forkUpdate(unreachable, { autoResolveConflicts: true });
    } catch {
      threw = true;
    }

    expect(threw, 'an unreachable upstream must surface as an error').to.equal(true);
    expect(git(fixture.student, 'remote').split('\n').filter(Boolean)).to.not.include('upstream');
  });

  it('strips the embedded credential from a repository-owned upstream it restores', async function () {
    this.timeout(20_000);
    // Seeded by an older build, which baked the clone token into the remote.
    // Restoring it verbatim re-armed a token the server had already rotated.
    git(fixture.student, 'remote', 'add', 'upstream', 'http://oauth2:rotated-token@git.invalid/itpcp-2027/template.git');
    releaseNewAssignment(fixture);

    const result = await new CTGit(fixture.student).forkUpdate(fixture.template, { autoResolveConflicts: true });

    expect(result.updated).to.equal(true);
    expect(git(fixture.student, 'remote').split('\n')).to.include('upstream');
    expect(git(fixture.student, 'remote', 'get-url', 'upstream'))
      .to.equal('http://git.invalid/itpcp-2027/template.git');
  });
});
