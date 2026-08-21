import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CTGit } from '../../src/git/CTGit';

/**
 * `restoreMissingFromTemplate` against real repositories on disk (local paths
 * as remotes, no network).
 *
 * What these pin down is why the feature cannot be a merge. A student deletes
 * a template file and commits; the merge base has it, their side dropped it,
 * upstream never touched it — git resolves that cleanly to "still deleted".
 * And when the template has no new commits at all, `forkUpdate` returns before
 * it even looks at the working tree. So the restore has to be its own pass, and
 * it has to work when the repository is not behind (computor-org/issues#352).
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function identify(repoPath: string): void {
  git(repoPath, 'config', 'user.name', 'Computor Test');
  git(repoPath, 'config', 'user.email', 'test@computor.local');
}

function commitFile(repoPath: string, file: string, contents: string, message: string): void {
  const target = path.join(repoPath, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  git(repoPath, 'add', file);
  git(repoPath, 'commit', '-m', message);
}

interface Fixture {
  root: string;
  template: string;
  origin: string;
  student: string;
}

/** A template with two assignment files, the student's bare repo, and a clone. */
function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctgit-restore-'));

  const template = path.join(root, 'template');
  git(root, 'init', '-q', '-b', 'main', template);
  identify(template);
  commitFile(template, 'week_1/README.md', 'Read me first\n', 'System Release');
  commitFile(template, 'week_1/solution.py', '# your code here\n', 'Add submission file');

  const origin = path.join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(template, 'push', '-q', origin, 'main');

  const student = path.join(root, 'student');
  git(root, 'clone', '-q', origin, student);
  identify(student);

  return { root, template, origin, student };
}

describe('CTGit.restoreMissingFromTemplate', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  it('restores a file the student deleted and committed, when the template has no new commits', async function () {
    this.timeout(20_000);
    const readme = path.join(fixture.student, 'week_1', 'README.md');
    git(fixture.student, 'rm', '-q', 'week_1/README.md');
    git(fixture.student, 'commit', '-m', 'Delete the readme');
    expect(fs.existsSync(readme)).to.equal(false);

    const result = await new CTGit(fixture.student).restoreMissingFromTemplate(fixture.template);

    expect(result.restored).to.deep.equal(['week_1/README.md']);
    expect(fs.readFileSync(readme, 'utf-8')).to.equal('Read me first\n');
  });

  it('restores a file deleted but never committed', async function () {
    this.timeout(20_000);
    const readme = path.join(fixture.student, 'week_1', 'README.md');
    fs.rmSync(readme);

    const result = await new CTGit(fixture.student).restoreMissingFromTemplate(fixture.template);

    expect(result.restored).to.deep.equal(['week_1/README.md']);
    expect(fs.existsSync(readme)).to.equal(true);
  });

  it('leaves the student\'s own work in surviving files untouched', async function () {
    this.timeout(20_000);
    const solution = path.join(fixture.student, 'week_1', 'solution.py');
    fs.writeFileSync(solution, 'print("my answer")\n');
    git(fixture.student, 'rm', '-q', 'week_1/README.md');
    git(fixture.student, 'commit', '-m', 'Delete the readme');

    await new CTGit(fixture.student).restoreMissingFromTemplate(fixture.template);

    expect(fs.readFileSync(solution, 'utf-8')).to.equal('print("my answer")\n');
  });

  it('keeps files the student added', async function () {
    this.timeout(20_000);
    const scratch = path.join(fixture.student, 'week_1', 'notes.txt');
    fs.writeFileSync(scratch, 'my notes\n');
    fs.rmSync(path.join(fixture.student, 'week_1', 'README.md'));

    await new CTGit(fixture.student).restoreMissingFromTemplate(fixture.template);

    expect(fs.readFileSync(scratch, 'utf-8')).to.equal('my notes\n');
  });

  it('does nothing when no template file is missing', async function () {
    this.timeout(20_000);
    const result = await new CTGit(fixture.student).restoreMissingFromTemplate(fixture.template);

    expect(result.restored).to.deep.equal([]);
    expect(result.pushed).to.equal(false);
  });

  it('pushes the restored files to origin', async function () {
    this.timeout(20_000);
    git(fixture.student, 'rm', '-q', 'week_1/README.md');
    git(fixture.student, 'commit', '-m', 'Delete the readme');

    const result = await new CTGit(fixture.student).restoreMissingFromTemplate(fixture.template);

    expect(result.pushed).to.equal(true);
    expect(git(fixture.origin, 'ls-tree', '-r', '--name-only', 'main')).to.contain('week_1/README.md');
  });

  it('does not leave the credential-carrying upstream remote behind', async function () {
    this.timeout(20_000);
    fs.rmSync(path.join(fixture.student, 'week_1', 'README.md'));

    await new CTGit(fixture.student).restoreMissingFromTemplate(fixture.template);

    expect(git(fixture.student, 'remote')).to.not.contain('upstream');
  });

  it('restores a file the template still has after the template moved on', async function () {
    this.timeout(20_000);
    commitFile(fixture.template, 'week_2/README.md', 'Week 2\n', 'Release week 2');
    fs.rmSync(path.join(fixture.student, 'week_1', 'README.md'));

    const result = await new CTGit(fixture.student).restoreMissingFromTemplate(fixture.template);

    // week_2 is not "missing" work the student lost — it was never merged in —
    // but it is a template path with nothing on disk, so it comes along.
    expect(result.restored).to.have.members(['week_1/README.md', 'week_2/README.md']);
  });
});
