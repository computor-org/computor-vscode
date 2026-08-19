import { expect } from 'chai';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  parsePorcelainStatus,
  parseUnpushedLog,
  pathsTouchDirectory,
  readRepoWorkState
} from '../../src/git/repoWorkState';

describe('repoWorkState', () => {
  describe('parsePorcelainStatus', () => {
    it('extracts paths for modified, added, deleted and untracked entries', () => {
      const out = [
        ' M assignment1/main.m',
        'A  assignment1/helper.m',
        ' D assignment2/old.m',
        '?? assignment2/new.m'
      ].join('\n');
      expect(parsePorcelainStatus(out)).to.deep.equal([
        'assignment1/main.m',
        'assignment1/helper.m',
        'assignment2/old.m',
        'assignment2/new.m'
      ]);
    });

    it('uses the new name for renames', () => {
      expect(parsePorcelainStatus('R  a/old.m -> a/new.m')).to.deep.equal(['a/new.m']);
    });

    it('unquotes paths with special characters', () => {
      expect(parsePorcelainStatus(' M "a/file with \\"quotes\\".m"')).to.deep.equal(['a/file with "quotes".m']);
    });

    it('returns nothing for empty output', () => {
      expect(parsePorcelainStatus('')).to.deep.equal([]);
    });
  });

  describe('parseUnpushedLog', () => {
    it('counts commit hashes and collects deduplicated paths', () => {
      const out = [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'assignment1/main.m',
        'assignment2/x.m',
        '',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'assignment1/main.m'
      ].join('\n');
      const parsed = parseUnpushedLog(out);
      expect(parsed.aheadCount).to.equal(2);
      expect(parsed.paths).to.deep.equal(['assignment1/main.m', 'assignment2/x.m']);
    });

    it('handles empty output', () => {
      expect(parseUnpushedLog('')).to.deep.equal({ paths: [], aheadCount: 0 });
    });
  });

  describe('pathsTouchDirectory', () => {
    const paths = ['assignment1/main.m', 'assignment10/deep/nested.m'];

    it('matches files under the directory', () => {
      expect(pathsTouchDirectory('assignment1', paths)).to.be.true;
      expect(pathsTouchDirectory('assignment10/deep', paths)).to.be.true;
    });

    it('does not match a sibling directory sharing the prefix', () => {
      expect(pathsTouchDirectory('assignment1', ['assignment10/deep/nested.m'])).to.be.false;
    });

    it('does not match unrelated directories', () => {
      expect(pathsTouchDirectory('assignment2', paths)).to.be.false;
    });
  });

  describe('readRepoWorkState (real git)', () => {
    let root: string;
    let originPath: string;
    let repoPath: string;

    const git = (cwd: string, cmd: string) =>
      execSync(`git ${cmd}`, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-workstate-'));
      originPath = path.join(root, 'origin.git');
      repoPath = path.join(root, 'clone');
      execSync(`git init -q --bare "${originPath}"`);
      execSync(`git clone -q "${originPath}" "${repoPath}"`);
      fs.mkdirSync(path.join(repoPath, 'assignment1'));
      fs.mkdirSync(path.join(repoPath, 'assignment2'));
      fs.writeFileSync(path.join(repoPath, 'assignment1', 'main.m'), 'x = 1;\n');
      fs.writeFileSync(path.join(repoPath, 'assignment2', 'main.m'), 'y = 2;\n');
      git(repoPath, 'add .');
      git(repoPath, 'commit -qm initial');
      git(repoPath, 'push -q -u origin HEAD');
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('reports a fully pushed, clean repo as empty', async () => {
      const state = await readRepoWorkState(repoPath);
      expect(state.dirtyPaths).to.deep.equal([]);
      expect(state.unpushedPaths).to.deep.equal([]);
      expect(state.aheadCount).to.equal(0);
    });

    it('reports uncommitted edits and untracked files as dirty', async () => {
      fs.writeFileSync(path.join(repoPath, 'assignment1', 'main.m'), 'x = 42;\n');
      fs.writeFileSync(path.join(repoPath, 'assignment2', 'extra.m'), 'z = 3;\n');

      const state = await readRepoWorkState(repoPath);
      expect(state.dirtyPaths).to.have.members(['assignment1/main.m', 'assignment2/extra.m']);
      expect(state.aheadCount).to.equal(0);
    });

    it('reports committed-but-unpushed files with the ahead count', async () => {
      fs.writeFileSync(path.join(repoPath, 'assignment1', 'main.m'), 'x = 42;\n');
      git(repoPath, 'add .');
      git(repoPath, 'commit -qm "work on assignment1"');

      const state = await readRepoWorkState(repoPath);
      expect(state.dirtyPaths).to.deep.equal([]);
      expect(state.unpushedPaths).to.deep.equal(['assignment1/main.m']);
      expect(state.aheadCount).to.equal(1);

      git(repoPath, 'push -q origin HEAD');
      const pushed = await readRepoWorkState(repoPath);
      expect(pushed.unpushedPaths).to.deep.equal([]);
      expect(pushed.aheadCount).to.equal(0);
    });

    it('degrades to empty unpushed state without an upstream', async () => {
      git(repoPath, 'branch --unset-upstream');
      fs.writeFileSync(path.join(repoPath, 'assignment1', 'main.m'), 'x = 42;\n');
      git(repoPath, 'add .');
      git(repoPath, 'commit -qm local');

      const state = await readRepoWorkState(repoPath);
      expect(state.unpushedPaths).to.deep.equal([]);
      expect(state.aheadCount).to.equal(0);
    });

    it('degrades to the empty state for a non-repo directory', async () => {
      const plain = path.join(root, 'plain');
      fs.mkdirSync(plain);
      const state = await readRepoWorkState(plain);
      expect(state).to.deep.equal({ dirtyPaths: [], unpushedPaths: [], aheadCount: 0 });
    });
  });
});
