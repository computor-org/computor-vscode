import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execAsync } from '../utils/exec';
import { execGitClone } from '../git/gitCloneHelpers';
import { addTokenToGitUrl, extractOriginFromGitUrl } from '../utils/gitUrlHelpers';
import { notify } from '../utils/notify';
import { say, sayFailed } from '../utils/uiLanguage';

/**
 * Repository configuration for offline mode
 */
interface OfflineRepositoryConfig {
  repositoryUrl: string;
  templateUrl: string;
  gitlabToken: string;
  gitlabOrigin: string;
}

/**
 * Manages offline repository operations
 * Provides functionality to add courses manually in offline mode
 * Does NOT use secret storage - always prompts for tokens
 */
export class OfflineRepositoryManager {
  constructor() {
    // No dependencies needed
  }

  /**
   * Add a new course repository to offline mode
   * Prompts for GitLab token, repository URL, and template URL
   * Always prompts for token - does NOT use secret storage
   */
  async addCourse(): Promise<void> {
    try {
      // Get repository URL
      const repositoryUrl = await this.promptRepositoryUrl();
      if (!repositoryUrl) {
        return; // User cancelled
      }

      // Get template URL (fork origin)
      const templateUrl = await this.promptTemplateUrl();
      if (!templateUrl) {
        return; // User cancelled
      }

      // Extract GitLab origin from repository URL
      const gitlabOrigin = extractOriginFromGitUrl(repositoryUrl);
      if (!gitlabOrigin) {
        notify.error(say('Invalid repository URL. Must be a valid HTTPS GitLab URL.', 'Ungültige Repository-URL. Gib eine gültige HTTPS-URL von GitLab an.'));
        return;
      }

      // Always prompt for GitLab token (no secret storage in offline mode)
      const gitlabToken = await this.promptGitLabToken(gitlabOrigin);
      if (!gitlabToken) {
        return; // User cancelled
      }

      const config: OfflineRepositoryConfig = {
        repositoryUrl,
        templateUrl,
        gitlabToken,
        gitlabOrigin
      };

      // Clone the repository
      await this.cloneRepository(config);

      notify.info(say('✓ Course repository added successfully', '✓ Das Kurs-Repository wurde hinzugefügt.'));
    } catch (error: any) {
      console.error('[OfflineRepositoryManager] Failed to add course:', error);
      notify.error(sayFailed('Failed to add course', 'Der Kurs konnte nicht hinzugefügt werden', error.message));
    }
  }

  /**
   * Prompt for repository URL
   */
  private async promptRepositoryUrl(): Promise<string | undefined> {
    const url = await vscode.window.showInputBox({
      title: say('Add Course - Repository URL', 'Kurs hinzufügen – Repository-URL'),
      prompt: say('Enter the HTTPS or git@ URL of your student repository', 'Gib die HTTPS- oder git@-URL deines Repositorys ein'),
      placeHolder: say('https://gitlab.com/user/repo.git or git@gitlab.com:user/repo.git', 'https://gitlab.com/user/repo.git oder git@gitlab.com:user/repo.git'),
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) {
          return say('Repository URL is required', 'Die Repository-URL fehlt');
        }

        // Normalize git@ URLs to https://
        let normalizedUrl = value.trim();
        if (normalizedUrl.startsWith('git@')) {
          // Convert git@gitlab.com:user/repo.git to https://gitlab.com/user/repo.git
          const match = normalizedUrl.match(/^git@([^:]+):(.+)$/);
          if (!match) {
            return say('Invalid git@ URL format', 'Ungültiges Format der git@-URL');
          }
          normalizedUrl = `https://${match[1]}/${match[2]}`;
        }

        // Validate as URL
        try {
          const urlObj = new URL(normalizedUrl);
          if (!['http:', 'https:'].includes(urlObj.protocol)) {
            return say('Only HTTP/HTTPS URLs are supported', 'Nur HTTP- und HTTPS-URLs werden unterstützt');
          }
        } catch {
          return say('Enter a valid repository URL', 'Gib eine gültige Repository-URL ein');
        }

        return undefined;
      }
    });

    if (!url) {
      return undefined;
    }

    // Normalize git@ URLs to https://
    let normalizedUrl = url.trim();
    if (normalizedUrl.startsWith('git@')) {
      const match = normalizedUrl.match(/^git@([^:]+):(.+)$/);
      if (match) {
        normalizedUrl = `https://${match[1]}/${match[2]}`;
      }
    }

    // Ensure .git extension
    if (!normalizedUrl.endsWith('.git')) {
      normalizedUrl += '.git';
    }

    return normalizedUrl;
  }

  /**
   * Prompt for template URL (fork origin)
   */
  private async promptTemplateUrl(): Promise<string | undefined> {
    const url = await vscode.window.showInputBox({
      title: say('Add Course - Template Repository URL', 'Kurs hinzufügen – URL des Vorlagen-Repositorys'),
      prompt: say('Enter the HTTPS URL of the student-template repository (fork origin)', 'Gib die HTTPS-URL des Vorlagen-Repositorys ein, von dem dein Repository abgeleitet ist'),
      placeHolder: 'https://gitlab.com/course/student-template.git',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) {
          return say('Template URL is required', 'Die URL der Vorlage fehlt');
        }

        // Normalize git@ URLs to https://
        let normalizedUrl = value.trim();
        if (normalizedUrl.startsWith('git@')) {
          const match = normalizedUrl.match(/^git@([^:]+):(.+)$/);
          if (!match) {
            return say('Invalid git@ URL format', 'Ungültiges Format der git@-URL');
          }
          normalizedUrl = `https://${match[1]}/${match[2]}`;
        }

        // Validate as URL
        try {
          const urlObj = new URL(normalizedUrl);
          if (!['http:', 'https:'].includes(urlObj.protocol)) {
            return say('Only HTTP/HTTPS URLs are supported', 'Nur HTTP- und HTTPS-URLs werden unterstützt');
          }
        } catch {
          return say('Enter a valid template URL', 'Gib eine gültige URL der Vorlage ein');
        }

        return undefined;
      }
    });

    if (!url) {
      return undefined;
    }

    // Normalize git@ URLs to https://
    let normalizedUrl = url.trim();
    if (normalizedUrl.startsWith('git@')) {
      const match = normalizedUrl.match(/^git@([^:]+):(.+)$/);
      if (match) {
        normalizedUrl = `https://${match[1]}/${match[2]}`;
      }
    }

    // Ensure .git extension
    if (!normalizedUrl.endsWith('.git')) {
      normalizedUrl += '.git';
    }

    return normalizedUrl;
  }

  /**
   * Prompt for GitLab personal access token
   */
  private async promptGitLabToken(gitlabOrigin: string): Promise<string | undefined> {
    const token = await vscode.window.showInputBox({
      title: say(`Add Course - GitLab Token for ${gitlabOrigin}`, `Kurs hinzufügen – GitLab-Token für ${gitlabOrigin}`),
      prompt: say(`Enter your GitLab Personal Access Token for ${gitlabOrigin}`, `Gib dein persönliches GitLab-Zugriffstoken für ${gitlabOrigin} ein`),
      placeHolder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) {
          return say('GitLab token is required', 'Das GitLab-Token fehlt');
        }
        if (value.length < 10) {
          return say('Token seems too short', 'Das Token scheint zu kurz zu sein');
        }
        return undefined;
      }
    });

    return token;
  }

  /**
   * Clone the repository with authentication
   */
  private async cloneRepository(config: OfflineRepositoryConfig): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error(say('No workspace folder open', 'Kein Arbeitsbereichsordner geöffnet'));
    }

    // Ensure student/ directory exists
    const studentDir = path.join(workspaceRoot, 'student');
    await fs.promises.mkdir(studentDir, { recursive: true });

    // Extract repository name from URL
    // Example: https://gitlab.com/user/repo.git -> repo
    // Remove .git suffix and get last path segment
    const repoName = this.extractRepoName(config.repositoryUrl);
    const targetPath = path.join(studentDir, repoName);

    // Check if directory already exists
    if (fs.existsSync(targetPath)) {
      const overwrite = say('Overwrite', 'Überschreiben');
      const action = await notify.warning(
        say(`Directory "${repoName}" already exists. Do you want to overwrite it?`, `Den Ordner „${repoName}“ gibt es schon. Möchtest du ihn überschreiben?`),
        overwrite,
        say('Cancel', 'Abbrechen')
      );

      if (action !== overwrite) {
        return;
      }

      // Remove existing directory
      await fs.promises.rm(targetPath, { recursive: true, force: true });
    }

    // Clone with progress
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: say(`Cloning ${repoName}…`, `${repoName} wird geklont …`),
      cancellable: true
    }, async (progress) => {
      progress.report({ increment: 0, message: say('Preparing…', 'Vorbereitung …') });

      // Add token to URL for authentication
      const authenticatedUrl = addTokenToGitUrl(config.repositoryUrl, config.gitlabToken);

      progress.report({ increment: 30, message: say('Cloning repository…', 'Repository wird geklont …') });

      try {
        // Clone the repository
        await execGitClone(authenticatedUrl, repoName, { cwd: studentDir });

        progress.report({ increment: 60, message: say('Setting up remote…', 'Remote wird eingerichtet …') });

        // Add upstream remote (template repository) with authentication
        const authenticatedTemplateUrl = addTokenToGitUrl(config.templateUrl, config.gitlabToken);
        await execAsync(`git remote add upstream "${authenticatedTemplateUrl}"`, {
          cwd: targetPath
        });

        progress.report({ increment: 100, message: say('Done!', 'Fertig.') });

        // Deliberately NOT setting `credential.helper store`: that writes every
        // credential git subsequently handles into plaintext ~/.git-credentials,
        // which is the least secure place available and outlives this repository.
        // The token is already embedded in the remotes this flow configured, so
        // it is not needed for the clone to keep working.
        void notify.warning(
          say('This repository was set up in offline mode, so your access token is stored ' +
            'in its .git/config in plain text. Remove the folder when you are done with it.',
          'Dieses Repository wurde im Offline-Modus eingerichtet, daher steht dein Zugriffstoken ' +
            'im Klartext in seiner .git/config. Lösche den Ordner, sobald du ihn nicht mehr brauchst.')
        );
      } catch (error: any) {
        // Clean up on failure
        if (fs.existsSync(targetPath)) {
          await fs.promises.rm(targetPath, { recursive: true, force: true });
        }
        throw new Error(`Failed to clone repository: ${error.message}`);
      }
    });
  }

  /**
   * Extract repository name from URL
   * Example: https://gitlab.com/user/repo.git -> user.repo
   * Example: https://gitlab.com/namespace/group/subgroup/repo.git -> namespace.group.subgroup.repo
   */
  private extractRepoName(url: string): string {
    try {
      // Remove .git suffix
      let cleanUrl = url.replace(/\.git$/, '');

      // Parse URL to get pathname
      const urlObj = new URL(cleanUrl);
      const pathname = urlObj.pathname;

      // Get the full path after the host (e.g., /user/repo or /namespace/group/repo)
      // Remove leading slash
      const fullPath = pathname.replace(/^\//, '');

      // Replace all slashes with dots to create a flat directory name
      // This matches the pattern used in normal student view
      const repoName = fullPath.replace(/\//g, '.');

      return repoName;
    } catch (error) {
      // Fallback: just get the last segment
      const segments = url.replace(/\.git$/, '').split('/');
      const lastSegment = segments[segments.length - 1];
      return lastSegment || 'repository';
    }
  }

  /**
   * Get workspace root directory
   */
  private getWorkspaceRoot(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }
    return workspaceFolders[0]!.uri.fsPath;
  }
}
