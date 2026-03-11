import { GitError } from '../types/GitTypes';

export enum GitErrorCode {
  REPOSITORY_NOT_FOUND = 'REPOSITORY_NOT_FOUND',
  NOT_A_REPOSITORY = 'NOT_A_REPOSITORY',
  BRANCH_EXISTS = 'BRANCH_EXISTS',
  BRANCH_NOT_FOUND = 'BRANCH_NOT_FOUND',
  UNCOMMITTED_CHANGES = 'UNCOMMITTED_CHANGES',
  MERGE_CONFLICT = 'MERGE_CONFLICT',
  REMOTE_NOT_FOUND = 'REMOTE_NOT_FOUND',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INDEX_CORRUPT = 'INDEX_CORRUPT',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export class GitErrorHandler {
  static parseError(error: any): GitError {
    const message = error.message || error.toString();
    const code = this.determineErrorCode(message);
    
    const gitError: GitError = new Error(message) as GitError;
    gitError.code = code;
    gitError.name = 'GitError';
    
    if (error.exitCode !== undefined) {
      gitError.exitCode = error.exitCode;
    }
    
    if (error.signal !== undefined) {
      gitError.signal = error.signal;
    }
    
    return gitError;
  }

  private static determineErrorCode(message: string): string {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('not a git repository')) {
      return GitErrorCode.NOT_A_REPOSITORY;
    }
    
    if (lowerMessage.includes('repository not found')) {
      return GitErrorCode.REPOSITORY_NOT_FOUND;
    }
    
    if (lowerMessage.includes('branch') && lowerMessage.includes('already exists')) {
      return GitErrorCode.BRANCH_EXISTS;
    }
    
    if (lowerMessage.includes('branch') && lowerMessage.includes('not found')) {
      return GitErrorCode.BRANCH_NOT_FOUND;
    }
    
    if (lowerMessage.includes('uncommitted changes') || lowerMessage.includes('changes not staged')) {
      return GitErrorCode.UNCOMMITTED_CHANGES;
    }
    
    if (lowerMessage.includes('merge conflict')) {
      return GitErrorCode.MERGE_CONFLICT;
    }
    
    if (lowerMessage.includes('remote') && lowerMessage.includes('not found')) {
      return GitErrorCode.REMOTE_NOT_FOUND;
    }
    
    if (lowerMessage.includes('authentication') || lowerMessage.includes('permission denied')) {
      return GitErrorCode.AUTHENTICATION_FAILED;
    }
    
    if (lowerMessage.includes('network') || lowerMessage.includes('connection')) {
      return GitErrorCode.NETWORK_ERROR;
    }
    
    if (lowerMessage.includes('permission denied')) {
      return GitErrorCode.PERMISSION_DENIED;
    }

    if (this.isCorruptIndex(lowerMessage)) {
      return GitErrorCode.INDEX_CORRUPT;
    }

    return GitErrorCode.UNKNOWN_ERROR;
  }

  static getUserFriendlyMessage(error: GitError): string {
    switch (error.code) {
      case GitErrorCode.NOT_A_REPOSITORY:
        return 'This folder is not a Git repository. Please initialize a repository first.';
      
      case GitErrorCode.REPOSITORY_NOT_FOUND:
        return 'Repository not found. Please check the path and try again.';
      
      case GitErrorCode.BRANCH_EXISTS:
        return 'A branch with this name already exists. Please choose a different name.';
      
      case GitErrorCode.BRANCH_NOT_FOUND:
        return 'Branch not found. Please check the branch name and try again.';
      
      case GitErrorCode.UNCOMMITTED_CHANGES:
        return 'You have uncommitted changes. Please commit or stash them before proceeding.';
      
      case GitErrorCode.MERGE_CONFLICT:
        return 'Merge conflict detected. Please resolve conflicts before continuing.';
      
      case GitErrorCode.REMOTE_NOT_FOUND:
        return 'Remote repository not found. Please check your remote configuration.';
      
      case GitErrorCode.AUTHENTICATION_FAILED:
        return 'Authentication failed. Please check your credentials and try again.';
      
      case GitErrorCode.NETWORK_ERROR:
        return 'Network error occurred. Please check your connection and try again.';
      
      case GitErrorCode.PERMISSION_DENIED:
        return 'Permission denied. Please check your access rights.';

      case GitErrorCode.INDEX_CORRUPT:
        return 'Your repository index is corrupted, likely due to cloud sync software interfering with Git files.';

      default:
        return error.message || 'An unknown error occurred.';
    }
  }

  static isCorruptIndex(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('index file corrupt')
      || lower.includes('index file smaller than expected')
      || lower.includes('bad signature')
      || (lower.includes('.git/index') && (
        lower.includes('corrupt') || lower.includes('invalid') || lower.includes('malformed')
        || lower.includes('unexpected') || lower.includes('cannot read') || lower.includes('failed to read')
      ));
  }

  static isRecoverable(error: GitError): boolean {
    switch (error.code) {
      case GitErrorCode.NETWORK_ERROR:
      case GitErrorCode.AUTHENTICATION_FAILED:
      case GitErrorCode.INDEX_CORRUPT:
        return true;

      default:
        return false;
    }
  }
}