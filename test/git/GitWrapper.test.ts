import * as chai from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GitWrapper } from '../../src/git/GitWrapper';
// import { GitRepositoryInfo } from '../../src/types/GitTypes';

const expect = chai.expect;

describe('GitWrapper', () => {
  let gitWrapper: GitWrapper;
  let testRepoPath: string;

  beforeEach(async () => {
    gitWrapper = new GitWrapper();
    
    // Create a temporary directory for testing
    const tempDir = os.tmpdir();
    testRepoPath = path.join(tempDir, `git-test-${Date.now()}`);
    await fs.promises.mkdir(testRepoPath, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    gitWrapper.dispose();
    
    // Remove test directory
    if (fs.existsSync(testRepoPath)) {
      await fs.promises.rm(testRepoPath, { recursive: true, force: true });
    }
  });

  describe('isRepository', () => {
    it('should return false for non-git directory', async () => {
      const result = await gitWrapper.isRepository(testRepoPath);
      expect(result).to.be.false;
    });

    it('should return true for git repository', async () => {
      await gitWrapper.init(testRepoPath);
      const result = await gitWrapper.isRepository(testRepoPath);
      expect(result).to.be.true;
    });
  });

  describe('init', () => {
    it('should initialize a new repository', async () => {
      await gitWrapper.init(testRepoPath);
      
      const gitDir = path.join(testRepoPath, '.git');
      const exists = fs.existsSync(gitDir);
      expect(exists).to.be.true;
    });

    it('should initialize a bare repository', async () => {
      await gitWrapper.init(testRepoPath, true);
      
      const headFile = path.join(testRepoPath, 'HEAD');
      const exists = fs.existsSync(headFile);
      expect(exists).to.be.true;
    });
  });

  describe('getRepositoryInfo', () => {
    it('should return info for non-repository', async () => {
      const info = await gitWrapper.getRepositoryInfo(testRepoPath);
      
      expect(info.path).to.equal(testRepoPath);
      expect(info.isRepo).to.be.false;
      expect(info.currentBranch).to.be.undefined;
    });

    it('should return info for repository', async () => {
      await gitWrapper.init(testRepoPath);
      const info = await gitWrapper.getRepositoryInfo(testRepoPath);
      
      expect(info.path).to.equal(testRepoPath);
      expect(info.isRepo).to.be.true;
      expect(info.currentBranch).to.exist;
      expect(info.isClean).to.be.true;
    });
  });

  describe('status', () => {
    beforeEach(async () => {
      await gitWrapper.init(testRepoPath);
    });

    it('should return clean status for new repository', async () => {
      const status = await gitWrapper.status(testRepoPath);
      
      expect(status.isClean).to.be.true;
      expect(status.files).to.be.empty;
      expect(status.modified).to.be.empty;
      expect(status.created).to.be.empty;
    });

    it('should detect new files', async () => {
      const testFile = path.join(testRepoPath, 'test.txt');
      await fs.promises.writeFile(testFile, 'test content');

      const status = await gitWrapper.status(testRepoPath);

      expect(status.isClean).to.be.false;
      // simple-git distinguishes staged additions (`created`) from untracked
      // files; the latter surface in `files` with a '?' working_dir marker.
      expect(status.files.some(f => f.path === 'test.txt')).to.be.true;
    });
  });

  describe('commit operations', () => {
    beforeEach(async () => {
      await gitWrapper.init(testRepoPath);
      
      // Configure git user
      const git = await gitWrapper.getRepository(testRepoPath);
      await git.addConfig('user.name', 'Test User');
      await git.addConfig('user.email', 'test@example.com');
    });

    it('should add and commit files', async () => {
      const testFile = path.join(testRepoPath, 'test.txt');
      await fs.promises.writeFile(testFile, 'test content');
      
      await gitWrapper.add(testRepoPath, 'test.txt');
      await gitWrapper.commit(testRepoPath, 'Initial commit');
      
      const status = await gitWrapper.status(testRepoPath);
      expect(status.isClean).to.be.true;
    });

    it('should get commit history', async () => {
      const testFile = path.join(testRepoPath, 'test.txt');
      await fs.promises.writeFile(testFile, 'test content');
      
      await gitWrapper.add(testRepoPath, '.');
      await gitWrapper.commit(testRepoPath, 'First commit');
      
      const log = await gitWrapper.getLog(testRepoPath, { maxCount: 10 });
      
      expect(log).to.have.lengthOf(1);
      expect(log[0]?.message).to.equal('First commit');
      expect(log[0]?.author).to.equal('Test User');
    });
  });

  describe('branch operations', () => {
    beforeEach(async () => {
      await gitWrapper.init(testRepoPath);
      
      // Configure git user and create initial commit
      const git = await gitWrapper.getRepository(testRepoPath);
      await git.addConfig('user.name', 'Test User');
      await git.addConfig('user.email', 'test@example.com');
      
      const testFile = path.join(testRepoPath, 'test.txt');
      await fs.promises.writeFile(testFile, 'test content');
      await gitWrapper.add(testRepoPath, '.');
      await gitWrapper.commit(testRepoPath, 'Initial commit');
    });

    it('should get current branch', async () => {
      const branch = await gitWrapper.getCurrentBranch(testRepoPath);
      expect(branch).to.be.oneOf(['main', 'master']);
    });

    it('should create and switch branches', async () => {
      await gitWrapper.createBranch(testRepoPath, 'feature-branch');
      
      const currentBranch = await gitWrapper.getCurrentBranch(testRepoPath);
      expect(currentBranch).to.equal('feature-branch');
    });

    it('should list branches', async () => {
      await gitWrapper.createBranch(testRepoPath, 'feature-1');
      await gitWrapper.createBranch(testRepoPath, 'feature-2');
      
      const branches = await gitWrapper.getBranches(testRepoPath);
      const branchNames = branches.map(b => b.name);
      
      expect(branchNames).to.include('feature-1');
      expect(branchNames).to.include('feature-2');
    });
  });

  describe('tag operations', () => {
    beforeEach(async () => {
      await gitWrapper.init(testRepoPath);
      
      // Configure git user and create initial commit
      const git = await gitWrapper.getRepository(testRepoPath);
      await git.addConfig('user.name', 'Test User');
      await git.addConfig('user.email', 'test@example.com');
      
      const testFile = path.join(testRepoPath, 'test.txt');
      await fs.promises.writeFile(testFile, 'test content');
      await gitWrapper.add(testRepoPath, '.');
      await gitWrapper.commit(testRepoPath, 'Initial commit');
    });

    it('should create and list tags', async () => {
      await gitWrapper.createTag(testRepoPath, 'v1.0.0');
      await gitWrapper.createTag(testRepoPath, 'v1.0.1', 'Release version 1.0.1');
      
      const tags = await gitWrapper.getTags(testRepoPath);
      
      expect(tags).to.include('v1.0.0');
      expect(tags).to.include('v1.0.1');
    });

    it('should delete tags', async () => {
      await gitWrapper.createTag(testRepoPath, 'v1.0.0');
      await gitWrapper.deleteTag(testRepoPath, 'v1.0.0');
      
      const tags = await gitWrapper.getTags(testRepoPath);
      expect(tags).to.not.include('v1.0.0');
    });
  });
});