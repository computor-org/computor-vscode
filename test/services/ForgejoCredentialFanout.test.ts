import { expect } from 'chai';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  listStudentRepositories,
  propagateForgejoCloneCredential,
  shouldRewriteOriginForForgejo
} from '../../src/services/ForgejoCredentialFanout';

const SERVER = 'http://computor-git';

describe('ForgejoCredentialFanout', () => {
  describe('shouldRewriteOriginForForgejo', () => {
    it('accepts a same-host origin with a basic (Forgejo) credential', () => {
      expect(shouldRewriteOriginForForgejo(`http://stud:old@computor-git/bpti-2027/a.git`, SERVER)).to.be.true;
    });

    it('rejects the oauth2 shape (GitLab managed / external repos)', () => {
      expect(shouldRewriteOriginForForgejo(`http://oauth2:pat@computor-git/bpti-2027/a.git`, SERVER)).to.be.false;
    });

    it('rejects credential-less origins', () => {
      expect(shouldRewriteOriginForForgejo(`http://computor-git/bpti-2027/a.git`, SERVER)).to.be.false;
    });

    it('rejects other hosts even with a basic credential', () => {
      expect(shouldRewriteOriginForForgejo('http://stud:old@other-git/x.git', SERVER)).to.be.false;
    });

    it('rejects ssh remotes and malformed server URLs', () => {
      expect(shouldRewriteOriginForForgejo('git@computor-git:x.git', SERVER)).to.be.false;
      expect(shouldRewriteOriginForForgejo(`http://stud:old@computor-git/x.git`, 'not a url')).to.be.false;
    });
  });

  describe('propagateForgejoCloneCredential', () => {
    let studentRoot: string;

    function initRepo(name: string, originUrl?: string): string {
      const repoPath = path.join(studentRoot, name);
      fs.mkdirSync(repoPath, { recursive: true });
      execSync('git init -q', { cwd: repoPath });
      if (originUrl) {
        execSync(`git remote add origin "${originUrl}"`, { cwd: repoPath });
      }
      return repoPath;
    }

    function originOf(repoPath: string): string {
      return execSync('git remote get-url origin', { cwd: repoPath }).toString().trim();
    }

    beforeEach(() => {
      studentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-fanout-'));
    });

    afterEach(() => {
      fs.rmSync(studentRoot, { recursive: true, force: true });
    });

    it('rewrites only same-host basic-credential origins, preserving each repo path', async () => {
      const forgejoA = initRepo('aaaa', `${SERVER.replace('http://', 'http://stud:oldtok@')}/bpti-2027/aaaa.git`);
      const forgejoB = initRepo('bbbb', `${SERVER.replace('http://', 'http://stud:oldtok@')}/other-course/bbbb.git`);
      const gitlab = initRepo('cccc', 'http://oauth2:glpat@computor-git/bpti-2027/cccc.git');
      const otherHost = initRepo('dddd', 'http://stud:oldtok@elsewhere/x.git');

      const updated = await propagateForgejoCloneCredential({
        serverUrl: SERVER,
        username: 'stud',
        token: 'freshtok',
        studentRoot
      });

      expect(updated).to.equal(2);
      expect(originOf(forgejoA)).to.equal('http://stud:freshtok@computor-git/bpti-2027/aaaa.git');
      expect(originOf(forgejoB)).to.equal('http://stud:freshtok@computor-git/other-course/bbbb.git');
      expect(originOf(gitlab)).to.equal('http://oauth2:glpat@computor-git/bpti-2027/cccc.git');
      expect(originOf(otherHost)).to.equal('http://stud:oldtok@elsewhere/x.git');
    });

    it('skips the excluded repo (the one the caller already updated)', async () => {
      const excluded = initRepo('aaaa', `http://stud:oldtok@computor-git/bpti-2027/aaaa.git`);
      const sibling = initRepo('bbbb', `http://stud:oldtok@computor-git/bpti-2027/bbbb.git`);

      const updated = await propagateForgejoCloneCredential({
        serverUrl: SERVER,
        username: 'stud',
        token: 'freshtok',
        excludeRepoPath: excluded,
        studentRoot
      });

      expect(updated).to.equal(1);
      expect(originOf(excluded)).to.equal('http://stud:oldtok@computor-git/bpti-2027/aaaa.git');
      expect(originOf(sibling)).to.equal('http://stud:freshtok@computor-git/bpti-2027/bbbb.git');
    });

    it('percent-encodes the injected credentials', async () => {
      const repo = initRepo('aaaa', 'http://old:old@computor-git/c/aaaa.git');

      await propagateForgejoCloneCredential({
        serverUrl: SERVER,
        username: 'max@tugraz.at',
        token: 'a:b/c',
        studentRoot
      });

      expect(originOf(repo)).to.equal('http://max%40tugraz.at:a%3Ab%2Fc@computor-git/c/aaaa.git');
    });

    it('survives repos without an origin remote and non-repo directories', async () => {
      initRepo('no-origin');
      fs.mkdirSync(path.join(studentRoot, 'not-a-repo'));
      const repo = initRepo('aaaa', 'http://stud:oldtok@computor-git/c/aaaa.git');

      const updated = await propagateForgejoCloneCredential({
        serverUrl: SERVER,
        username: 'stud',
        token: 'freshtok',
        studentRoot
      });

      expect(updated).to.equal(1);
      expect(originOf(repo)).to.equal('http://stud:freshtok@computor-git/c/aaaa.git');
    });
  });

  describe('listStudentRepositories', () => {
    it('returns only subdirectories containing a .git directory', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-list-'));
      try {
        fs.mkdirSync(path.join(root, 'repo', '.git'), { recursive: true });
        fs.mkdirSync(path.join(root, 'plain-dir'));
        fs.writeFileSync(path.join(root, 'file.txt'), '');

        expect(await listStudentRepositories(root)).to.deep.equal([path.join(root, 'repo')]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('returns an empty list for a missing root', async () => {
      expect(await listStudentRepositories('/nonexistent/student-root')).to.deep.equal([]);
    });
  });
});
