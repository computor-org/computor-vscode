import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';
import { GitEnvironmentService } from '../services/GitEnvironmentService';

export function createSimpleGit(options: Partial<SimpleGitOptions> = {}): SimpleGit {
  const gitService = GitEnvironmentService.getInstance();
  const binary = gitService.getGitBinaryHint();
  void gitService.getGitBinaryPath().catch(() => undefined);
  return simpleGit({ binary, ...options });
}
