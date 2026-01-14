import * as path from 'path';
import * as fs from 'fs';

export class GitValidator {
  private static readonly INVALID_BRANCH_CHARS = /[\s~^:?*\[\]\\]/;
  private static readonly INVALID_TAG_CHARS = /[\s~^:?*\[\]\\@{]/;
  private static readonly RESERVED_BRANCH_NAMES = [
    'HEAD',
    'FETCH_HEAD',
    'ORIG_HEAD',
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD'
  ];
  
  static async isValidRepositoryPath(repositoryPath: string): Promise<boolean> {
    try {
      const normalizedPath = path.resolve(repositoryPath);
      const stats = await fs.promises.stat(normalizedPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
  
  static isValidBranchName(branchName: string): boolean {
    if (!branchName || branchName.length === 0) {
      return false;
    }
    
    if (this.RESERVED_BRANCH_NAMES.includes(branchName.toUpperCase())) {
      return false;
    }
    
    if (this.INVALID_BRANCH_CHARS.test(branchName)) {
      return false;
    }
    
    if (branchName.startsWith('.') || branchName.endsWith('.')) {
      return false;
    }
    
    if (branchName.startsWith('/') || branchName.endsWith('/')) {
      return false;
    }
    
    if (branchName.includes('..') || branchName.includes('.lock')) {
      return false;
    }
    
    return true;
  }
  
  static isValidTagName(tagName: string): boolean {
    if (!tagName || tagName.length === 0) {
      return false;
    }
    
    if (this.INVALID_TAG_CHARS.test(tagName)) {
      return false;
    }
    
    if (tagName.startsWith('.') || tagName.endsWith('.')) {
      return false;
    }
    
    if (tagName.startsWith('/') || tagName.endsWith('/')) {
      return false;
    }
    
    if (tagName.includes('..') || tagName.includes('.lock')) {
      return false;
    }
    
    return true;
  }
  
  static isValidRemoteName(remoteName: string): boolean {
    if (!remoteName || remoteName.length === 0) {
      return false;
    }
    
    if (!/^[a-zA-Z0-9._-]+$/.test(remoteName)) {
      return false;
    }
    
    return true;
  }
  
  static isValidGitUrl(url: string): boolean {
    if (!url || url.length === 0) {
      return false;
    }
    
    const sshPattern = /^(ssh:\/\/)?([a-zA-Z0-9._-]+@)?[a-zA-Z0-9.-]+:[a-zA-Z0-9.\/_-]+\.git$/;
    // Updated pattern to support authentication in HTTP(S) URLs
    const httpsPattern = /^https?:\/\/([a-zA-Z0-9._-]+:[^@]+@)?[a-zA-Z0-9.-]+(:[0-9]+)?\/[a-zA-Z0-9.\/_-]+\.git$/;
    const gitPattern = /^git:\/\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9.\/_-]+\.git$/;
    const filePattern = /^file:\/\/.+$/;
    
    return sshPattern.test(url) || httpsPattern.test(url) || gitPattern.test(url) || filePattern.test(url);
  }
  
  static isValidCommitMessage(message: string): boolean {
    if (!message || message.trim().length === 0) {
      return false;
    }
    return true;
  }
  
  static isValidStashMessage(message: string): boolean {
    if (!message) {
      return true;
    }
    
    if (message.includes('\n') || message.includes('\r')) {
      return false;
    }
    
    return true;
  }
  
  static sanitizeBranchName(branchName: string): string {
    let sanitized = branchName.trim();
    
    sanitized = sanitized.replace(this.INVALID_BRANCH_CHARS, '-');
    
    sanitized = sanitized.replace(/^\.+|\.+$/g, '');
    sanitized = sanitized.replace(/\/+/g, '/');
    sanitized = sanitized.replace(/^\/+|\/+$/g, '');
    
    sanitized = sanitized.replace(/\.lock/g, '-lock');
    sanitized = sanitized.replace(/\.{2,}/g, '-');
    
    if (this.RESERVED_BRANCH_NAMES.includes(sanitized.toUpperCase())) {
      sanitized = `branch-${sanitized}`;
    }
    
    return sanitized;
  }
  
  static validateFilePaths(paths: string | string[]): string[] {
    const pathArray = Array.isArray(paths) ? paths : [paths];
    const validPaths: string[] = [];
    
    for (const filePath of pathArray) {
      if (filePath && typeof filePath === 'string' && filePath.trim().length > 0) {
        const normalized = path.normalize(filePath.trim());
        if (!normalized.startsWith('..')) {
          validPaths.push(normalized);
        }
      }
    }
    
    return validPaths;
  }
  
  static getInvalidBranchNameReason(branchName: string): string | null {
    if (!branchName || branchName.length === 0) {
      return 'Branch name cannot be empty';
    }
    
    if (this.RESERVED_BRANCH_NAMES.includes(branchName.toUpperCase())) {
      return `"${branchName}" is a reserved Git name`;
    }
    
    if (this.INVALID_BRANCH_CHARS.test(branchName)) {
      return 'Branch name contains invalid characters (spaces, ~, ^, :, ?, *, [, ], \\)';
    }
    
    if (branchName.startsWith('.') || branchName.endsWith('.')) {
      return 'Branch name cannot start or end with a dot';
    }
    
    if (branchName.startsWith('/') || branchName.endsWith('/')) {
      return 'Branch name cannot start or end with a slash';
    }
    
    if (branchName.includes('..')) {
      return 'Branch name cannot contain consecutive dots';
    }
    
    if (branchName.includes('.lock')) {
      return 'Branch name cannot contain ".lock"';
    }
    
    return null;
  }
  
  static getInvalidTagNameReason(tagName: string): string | null {
    if (!tagName || tagName.length === 0) {
      return 'Tag name cannot be empty';
    }
    
    if (this.INVALID_TAG_CHARS.test(tagName)) {
      return 'Tag name contains invalid characters';
    }
    
    if (tagName.startsWith('.') || tagName.endsWith('.')) {
      return 'Tag name cannot start or end with a dot';
    }
    
    if (tagName.startsWith('/') || tagName.endsWith('/')) {
      return 'Tag name cannot start or end with a slash';
    }
    
    if (tagName.includes('..')) {
      return 'Tag name cannot contain consecutive dots';
    }
    
    if (tagName.includes('.lock')) {
      return 'Tag name cannot contain ".lock"';
    }
    
    return null;
  }
}