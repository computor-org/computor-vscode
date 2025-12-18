import { SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';
import {
  IGitWrapper,
  GitRepositoryInfo,
  GitStatus,
  GitCommit,
  GitBranch,
  GitRemote,
  GitDiff,
  GitPushResult,
  GitCloneOptions,
  GitStashEntry
} from '../types/GitTypes';
import { GitValidator } from '../utils/GitValidator';
import { createSimpleGit } from './simpleGitFactory';

export class GitWrapper implements IGitWrapper {
  private gitInstances: Map<string, SimpleGit> = new Map();

  async getRepository(repositoryPath: string): Promise<SimpleGit> {
    const normalizedPath = path.resolve(repositoryPath);
    
    if (!this.gitInstances.has(normalizedPath)) {
      const git = createSimpleGit({
        baseDir: normalizedPath,
        maxConcurrentProcesses: 6,
        trimmed: false
      });
      this.gitInstances.set(normalizedPath, git);
    }
    
    return this.gitInstances.get(normalizedPath)!;
  }

  async isRepository(repositoryPath: string): Promise<boolean> {
    try {
      const normalizedPath = path.resolve(repositoryPath);
      const gitDir = path.join(normalizedPath, '.git');
      const exists = await fs.promises.access(gitDir).then(() => true).catch(() => false);
      
      if (!exists) {
        return false;
      }
      
      const git = await this.getRepository(normalizedPath);
      await git.status();
      return true;
    } catch (error) {
      return false;
    }
  }

  async getRepositoryInfo(repositoryPath: string): Promise<GitRepositoryInfo> {
    const isRepo = await this.isRepository(repositoryPath);
    
    if (!isRepo) {
      return {
        path: repositoryPath,
        isRepo: false
      };
    }
    
    const git = await this.getRepository(repositoryPath);
    const status = await git.status();
    const remotes = await this.getRemotes(repositoryPath);
    
    return {
      path: repositoryPath,
      isRepo: true,
      currentBranch: status.current || undefined,
      remotes: remotes,
      isClean: status.isClean()
    };
  }

  async init(repositoryPath: string, bare?: boolean): Promise<void> {
    if (!await GitValidator.isValidRepositoryPath(repositoryPath)) {
      throw new Error('Invalid repository path');
    }
    
    const git = await this.getRepository(repositoryPath);
    if (bare) {
      await git.init(true);
    } else {
      await git.init();
    }
  }

  async clone(url: string, localPath: string, options?: GitCloneOptions): Promise<void> {
    if (!GitValidator.isValidGitUrl(url)) {
      throw new Error('Invalid Git URL');
    }
    
    if (!await GitValidator.isValidRepositoryPath(path.dirname(localPath))) {
      throw new Error('Invalid local path');
    }
    
    const cloneOptions: string[] = [];
    
    if (options?.depth) {
      cloneOptions.push('--depth', options.depth.toString());
    }
    
    if (options?.branch) {
      cloneOptions.push('--branch', options.branch);
    }
    
    const git = createSimpleGit();
    await git.clone(url, localPath, cloneOptions);
  }

  async status(repositoryPath: string): Promise<GitStatus> {
    const git = await this.getRepository(repositoryPath);
    const status = await git.status();
    
    return {
      current: status.current,
      tracking: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
      files: status.files.map(file => ({
        path: file.path,
        index: file.index,
        working_dir: file.working_dir
      })),
      created: status.created,
      deleted: status.deleted,
      modified: status.modified,
      renamed: status.renamed.map(rename => ({
        from: rename.from,
        to: rename.to
      })),
      conflicted: status.conflicted,
      staged: status.staged,
      isClean: status.isClean()
    };
  }

  async diff(repositoryPath: string, options?: string[]): Promise<GitDiff> {
    const git = await this.getRepository(repositoryPath);
    const diffSummary = await git.diffSummary(options || []);
    
    return {
      files: diffSummary.files.map(file => ({
        file: file.file,
        changes: 'changes' in file ? file.changes : 0,
        insertions: 'insertions' in file ? file.insertions : 0,
        deletions: 'deletions' in file ? file.deletions : 0,
        binary: file.binary
      })),
      insertions: diffSummary.insertions,
      deletions: diffSummary.deletions,
      changes: diffSummary.changed
    };
  }

  async getBranches(repositoryPath: string): Promise<GitBranch[]> {
    const git = await this.getRepository(repositoryPath);
    const branches = await git.branchLocal();
    
    return branches.all.map(branchName => ({
      name: branchName,
      current: branchName === branches.current,
      commit: branches.branches[branchName]?.commit
    }));
  }

  async getCurrentBranch(repositoryPath: string): Promise<string | null> {
    const git = await this.getRepository(repositoryPath);
    const status = await git.status();
    return status.current;
  }

  async createBranch(repositoryPath: string, branchName: string): Promise<void> {
    if (!GitValidator.isValidBranchName(branchName)) {
      const reason = GitValidator.getInvalidBranchNameReason(branchName);
      throw new Error(`Invalid branch name: ${reason}`);
    }
    
    const git = await this.getRepository(repositoryPath);
    await git.checkoutLocalBranch(branchName);
  }

  async checkoutBranch(repositoryPath: string, branchName: string): Promise<void> {
    const git = await this.getRepository(repositoryPath);
    await git.checkout(branchName);
  }

  async deleteBranch(repositoryPath: string, branchName: string, force?: boolean): Promise<void> {
    const git = await this.getRepository(repositoryPath);
    if (force) {
      await git.deleteLocalBranch(branchName, true);
    } else {
      await git.deleteLocalBranch(branchName);
    }
  }

  async mergeBranch(repositoryPath: string, branchName: string): Promise<void> {
    const git = await this.getRepository(repositoryPath);
    await git.merge([branchName]);
  }

  async add(repositoryPath: string, files: string | string[]): Promise<void> {
    const validFiles = GitValidator.validateFilePaths(files);
    if (validFiles.length === 0) {
      throw new Error('No valid files to add');
    }
    
    const git = await this.getRepository(repositoryPath);
    await git.add(validFiles);
  }

  async commit(repositoryPath: string, message: string): Promise<void> {
    if (!message || message.trim().length === 0) {
      throw new Error('Invalid commit message: cannot be empty');
    }

    const git = await this.getRepository(repositoryPath);
    await git.commit(message);
  }

  async push(repositoryPath: string, remote?: string, branch?: string): Promise<GitPushResult> {
    const git = await this.getRepository(repositoryPath);
    const pushResult = await git.push(remote, branch);
    
    return {
      pushed: pushResult.pushed.map(item => ({
        local: item.local || '',
        remote: item.remote || '',
        success: true,
        alreadyUpdated: item.alreadyUpdated || false
      })),
      branch: pushResult.branch ? {
        local: pushResult.branch.local || '',
        remote: pushResult.branch.remote || '',
        remoteName: pushResult.branch.remoteName || ''
      } : {
        local: '',
        remote: '',
        remoteName: ''
      },
      ref: pushResult.ref ? {
        local: pushResult.ref.local || '',
        remote: ''
      } : {
        local: '',
        remote: ''
      },
      remoteMessages: {
        all: pushResult.remoteMessages.all || []
      }
    };
  }

  async pull(repositoryPath: string, remote?: string, branch?: string): Promise<void> {
    const git = await this.getRepository(repositoryPath);
    await git.pull(remote, branch);
  }

  async getRemotes(repositoryPath: string): Promise<GitRemote[]> {
    const git = await this.getRepository(repositoryPath);
    const remotes = await git.getRemotes(true);
    
    return remotes.map(remote => ({
      name: remote.name,
      url: remote.refs.fetch || remote.refs.push || ''
    }));
  }

  async addRemote(repositoryPath: string, name: string, url: string): Promise<void> {
    if (!GitValidator.isValidRemoteName(name)) {
      throw new Error('Invalid remote name');
    }
    
    if (!GitValidator.isValidGitUrl(url)) {
      throw new Error('Invalid remote URL');
    }
    
    const git = await this.getRepository(repositoryPath);
    await git.addRemote(name, url);
  }

  async removeRemote(repositoryPath: string, name: string): Promise<void> {
    const git = await this.getRepository(repositoryPath);
    await git.removeRemote(name);
  }

  async getLog(repositoryPath: string, options?: { maxCount?: number }): Promise<GitCommit[]> {
    const git = await this.getRepository(repositoryPath);
    const logOptions = options?.maxCount ? ['--max-count=' + options.maxCount] : [];
    const log = await git.log(logOptions);
    
    return log.all.map(commit => ({
      hash: commit.hash,
      date: new Date(commit.date),
      message: commit.message,
      author: commit.author_name,
      email: commit.author_email
    }));
  }

  async getTags(repositoryPath: string): Promise<string[]> {
    const git = await this.getRepository(repositoryPath);
    const tags = await git.tags();
    return tags.all;
  }

  async createTag(repositoryPath: string, tagName: string, message?: string): Promise<void> {
    if (!GitValidator.isValidTagName(tagName)) {
      const reason = GitValidator.getInvalidTagNameReason(tagName);
      throw new Error(`Invalid tag name: ${reason}`);
    }
    
    const git = await this.getRepository(repositoryPath);
    if (message) {
      await git.addAnnotatedTag(tagName, message);
    } else {
      await git.addTag(tagName);
    }
  }

  async deleteTag(repositoryPath: string, tagName: string): Promise<void> {
    const git = await this.getRepository(repositoryPath);
    await git.tag(['-d', tagName]);
  }

  async stash(repositoryPath: string, options?: string[]): Promise<string> {
    if (options?.includes('-m') || options?.includes('--message')) {
      const messageIndex = options.findIndex(opt => opt === '-m' || opt === '--message');
      if (messageIndex !== -1 && messageIndex + 1 < options.length) {
        const message = options[messageIndex + 1];
        if (message && !GitValidator.isValidStashMessage(message)) {
          throw new Error('Invalid stash message: cannot contain newlines');
        }
      }
    }
    
    const git = await this.getRepository(repositoryPath);
    
    if (options && options.length > 0) {
      return await git.stash(options);
    } else {
      // Default stash with include-untracked
      return await git.stash(['push', '--include-untracked']);
    }
  }

  async stashPop(repositoryPath: string, stashRef?: string): Promise<string> {
    const git = await this.getRepository(repositoryPath);
    const args = ['pop'];
    if (stashRef) {
      args.push(stashRef);
    }
    return await git.stash(args);
  }

  async stashApply(repositoryPath: string, stashRef?: string): Promise<string> {
    const git = await this.getRepository(repositoryPath);
    const args = ['apply'];
    if (stashRef) {
      args.push(stashRef);
    }
    return await git.stash(args);
  }

  async stashDrop(repositoryPath: string, stashRef?: string): Promise<string> {
    const git = await this.getRepository(repositoryPath);
    const args = ['drop'];
    if (stashRef) {
      args.push(stashRef);
    }
    return await git.stash(args);
  }

  async stashList(repositoryPath: string): Promise<GitStashEntry[]> {
    const git = await this.getRepository(repositoryPath);
    const stashList = await git.stashList();
    
    return stashList.all.map((stash, index) => {
      // Parse stash message format: stash@{0}: WIP on branch: hash message
      const match = stash.message.match(/^(.*?):\s*(.*)$/);
      const stashMessage = match ? match[2] : stash.message;
      
      // Extract branch name if present
      const branchMatch = stashMessage?.match(/WIP on (.+?):/);
      const branch = branchMatch ? branchMatch[1] : undefined;
      
      return {
        index: index,
        hash: stash.hash,
        message: stashMessage || stash.message,
        date: new Date(stash.date),
        branch: branch
      };
    });
  }

  async stashClear(repositoryPath: string): Promise<void> {
    const git = await this.getRepository(repositoryPath);
    await git.stash(['clear']);
  }

  dispose(): void {
    this.gitInstances.clear();
  }
}
