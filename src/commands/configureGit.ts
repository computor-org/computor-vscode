import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitEnvironmentService } from '../services/GitEnvironmentService';

const execFileAsync = promisify(execFile);

export async function configureGit(): Promise<void> {
  const gitEnvService = GitEnvironmentService.getInstance();
  const gitBinary = await gitEnvService.getGitBinaryPath();

  if (!gitBinary) {
    void vscode.window.showErrorMessage('Git is required but was not found. Install Git and ensure it is available on your PATH.');
    return;
  }

  // Get current values
  const currentName = await getGitConfig(gitBinary, 'user.name');
  const currentEmail = await getGitConfig(gitBinary, 'user.email');

  // Prompt for name
  const name = await vscode.window.showInputBox({
    title: 'Git Configuration',
    prompt: 'Enter your full name for git commits',
    placeHolder: 'John Doe',
    value: currentName,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return 'Name cannot be empty';
      }
      if (trimmed.length < 2) {
        return 'Name must be at least 2 characters';
      }
      return undefined;
    }
  });

  if (!name) {
    return;
  }

  // Prompt for email
  const email = await vscode.window.showInputBox({
    title: 'Git Configuration',
    prompt: 'Enter your email address for git commits',
    placeHolder: 'you@example.com',
    value: currentEmail,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return 'Email cannot be empty';
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) {
        return 'Please enter a valid email address';
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

    void vscode.window.showInformationMessage('Git configuration updated successfully!');
  } catch (error: any) {
    void vscode.window.showErrorMessage(`Failed to configure git: ${error.message}`);
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
