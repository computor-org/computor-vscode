import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitEnvironmentService } from '../services/GitEnvironmentService';
import { notify } from '../utils/notify';
import { say, sayFailed } from '../utils/uiLanguage';

const execFileAsync = promisify(execFile);

export async function configureGit(): Promise<void> {
  const gitEnvService = GitEnvironmentService.getInstance();
  const gitBinary = await gitEnvService.getGitBinaryPath();

  if (!gitBinary) {
    void notify.error(say(
      'Git is required but was not found. Install Git and ensure it is available on your PATH.',
      'Git wird benötigt, wurde aber nicht gefunden. Installiere Git und sorge dafür, dass es über deinen PATH erreichbar ist.'
    ));
    return;
  }

  // Get current values
  const currentName = await getGitConfig(gitBinary, 'user.name');
  const currentEmail = await getGitConfig(gitBinary, 'user.email');

  // Prompt for name
  const name = await vscode.window.showInputBox({
    title: say('Git Configuration', 'Git-Einrichtung'),
    prompt: say('Enter your full name for git commits', 'Gib deinen vollständigen Namen für Git-Commits ein'),
    placeHolder: say('John Doe', 'Erika Mustermann'),
    value: currentName,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return say('Name cannot be empty', 'Der Name darf nicht leer sein');
      }
      if (trimmed.length < 2) {
        return say('Name must be at least 2 characters', 'Der Name muss mindestens 2 Zeichen lang sein');
      }
      return undefined;
    }
  });

  if (!name) {
    return;
  }

  // Prompt for email
  const email = await vscode.window.showInputBox({
    title: say('Git Configuration', 'Git-Einrichtung'),
    prompt: say('Enter your email address for git commits', 'Gib deine E-Mail-Adresse für Git-Commits ein'),
    placeHolder: say('you@example.com', 'du@example.com'),
    value: currentEmail,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return say('Email cannot be empty', 'Die E-Mail-Adresse darf nicht leer sein');
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) {
        return say('Please enter a valid email address', 'Gib bitte eine gültige E-Mail-Adresse ein');
      }
      return undefined;
    }
  });

  if (!email) {
    return;
  }

  // Set git config
  try {
    await execFileAsync(gitBinary, ['config', '--global', 'user.name', name.trim()]);
    await execFileAsync(gitBinary, ['config', '--global', 'user.email', email.trim()]);

    void notify.info(say('Git configuration updated successfully!', 'Git ist jetzt eingerichtet.'));
  } catch (error: any) {
    void notify.error(sayFailed(`Failed to configure git`, `Git konnte nicht eingerichtet werden`, error.message));
  }
}

async function getGitConfig(gitBinary: string, key: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(gitBinary, ['config', '--global', '--get', key]);
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch (error) {
    return undefined;
  }
}
