import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CTGit } from '../../src/git/CTGit';

/**
 * What the unattended template sync does to a student's work when the merge
 * conflicts. Real repositories on disk, local paths as remotes, no network.
 *
 * Two regressions are guarded here. The resolver used to fall back to
 * `checkout --theirs` on its own, replacing the student's committed content
 * with upstream; and when even that failed it ran `git add --all` "to ensure
 * clean state", which marks an unmerged path resolved while the file still
 * holds `<<<<<<<`. `hasUnmergedPaths()` reads `status().conflicted`, so it then
 * reported nothing wrong and the markers were committed and pushed to the
 * repository the student is graded on.
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
  template: string;
  origin: string;
  student: string;
}

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctgit-conflict-'));

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

/** Both sides edit the same line — a genuine content conflict. */
function createConflict(fixture: Fixture): void {
  commitFile(fixture.template, 'week_1.md', 'Assignment 1 (revised by staff)\n', 'Revise week 1');
  commitFile(fixture.student, 'week_1.md', 'my own solution\n', 'Student work');
}

function fileHasConflictMarkers(repoPath: string, file: string): boolean {
  const contents = fs.readFileSync(path.join(repoPath, file), 'utf-8');
  return /^<{7} /m.test(contents) || /^>{7} /m.test(contents);
}

describe('CTGit.forkUpdate on conflict', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  it('keeps the student\'s content instead of taking upstream', async function () {
    this.timeout(30_000);
    createConflict(fixture);

    await new CTGit(fixture.student).forkUpdate(fixture.template, { autoResolveConflicts: true });

    expect(fs.readFileSync(path.join(fixture.student, 'week_1.md'), 'utf-8'))
      .to.equal('my own solution\n');
  });

  it('never leaves conflict markers in the working tree', async function () {
    this.timeout(30_000);
    createConflict(fixture);

    await new CTGit(fixture.student).forkUpdate(fixture.template, { autoResolveConflicts: true });

    expect(fileHasConflictMarkers(fixture.student, 'week_1.md')).to.equal(false);
  });

  it('never commits conflict markers to the student\'s repository', async function () {
    this.timeout(30_000);
    createConflict(fixture);

    await new CTGit(fixture.student).forkUpdate(fixture.template, { autoResolveConflicts: true });

    // Whatever the merge decided, what landed in history must be clean — this is
    // the artifact the student is graded on.
    const committed = git(fixture.student, 'show', 'HEAD:week_1.md');
    expect(committed).to.not.match(/^<{7} /m);
    expect(committed).to.not.match(/^>{7} /m);
  });

  it('leaves no merge in progress afterwards', async function () {
    this.timeout(30_000);
    createConflict(fixture);

    await new CTGit(fixture.student).forkUpdate(fixture.template, { autoResolveConflicts: true });

    expect(fs.existsSync(path.join(fixture.student, '.git', 'MERGE_HEAD'))).to.equal(false);
    expect(git(fixture.student, 'status', '--porcelain', '--untracked-files=no')).to.equal('');
  });

  it('still merges a non-conflicting release cleanly', async function () {
    this.timeout(30_000);
    // Guards against over-correcting: an ordinary update must not be affected.
    commitFile(fixture.template, 'week_2.md', 'Assignment 2\n', 'Release week 2');
    commitFile(fixture.student, 'notes.md', 'my notes\n', 'Student notes');

    const result = await new CTGit(fixture.student).forkUpdate(fixture.template, { autoResolveConflicts: true });

    expect(result.updated).to.equal(true);
    expect(fs.existsSync(path.join(fixture.student, 'week_2.md'))).to.equal(true);
    expect(fs.readFileSync(path.join(fixture.student, 'notes.md'), 'utf-8')).to.equal('my notes\n');
  });

  it('restores uncommitted work after the update', async function () {
    this.timeout(30_000);
    commitFile(fixture.template, 'week_2.md', 'Assignment 2\n', 'Release week 2');
    // In progress, never committed — the case where a swallowed stash failure
    // used to make the edits vanish from the working tree.
    fs.writeFileSync(path.join(fixture.student, 'scratch.md'), 'half-finished\n');

    await new CTGit(fixture.student).forkUpdate(fixture.template, { autoResolveConflicts: true });

    expect(fs.readFileSync(path.join(fixture.student, 'scratch.md'), 'utf-8'))
      .to.equal('half-finished\n');
    // And the stash entry was dropped rather than accumulating.
    expect(git(fixture.student, 'stash', 'list')).to.equal('');
  });
});
