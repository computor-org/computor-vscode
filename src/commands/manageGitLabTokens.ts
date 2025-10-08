import * as vscode from 'vscode';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { GitLabTokenManager } from '../services/GitLabTokenManager';

export async function manageGitLabTokens(context: vscode.ExtensionContext): Promise<void> {
  const settingsManager = new ComputorSettingsManager(context);
  const gitLabTokenManager = GitLabTokenManager.getInstance(context);

  const settings = await settingsManager.getSettings();
  const urls = Object.keys(settings.workspace?.gitlabTokens || {});

  if (urls.length === 0) {
    vscode.window.showInformationMessage('No GitLab tokens configured yet. Tokens will be requested when needed.');
    return;
  }

  const items: vscode.QuickPickItem[] = urls.map((url) => ({
    label: url,
    description: 'GitLab Instance',
    detail: 'Click to manage token'
  }));

  items.push({
    label: '$(add) Add New GitLab Instance',
    description: 'Manually add a GitLab token',
    detail: ''
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select GitLab instance to manage'
  });

  if (!selected) {
    return;
  }

  if (selected.label.startsWith('$(add)')) {
    const url = await vscode.window.showInputBox({
      prompt: 'Enter GitLab instance URL',
      placeHolder: 'https://gitlab.example.com'
    });

    if (url) {
      const token = await gitLabTokenManager.ensureTokenForUrl(url);
      if (token) {
        vscode.window.showInformationMessage(`Token added for ${url}`);
      }
    }

    return;
  }

  const action = await vscode.window.showQuickPick(
    ['Update Token', 'Remove Token', 'Test Token'],
    { placeHolder: `Manage token for ${selected.label}` }
  );

  if (action === 'Update Token') {
    const token = await gitLabTokenManager.ensureTokenForUrl(selected.label);
    if (token) {
      vscode.window.showInformationMessage('Token updated successfully');
    }
  } else if (action === 'Remove Token') {
    await gitLabTokenManager.removeToken(selected.label);
    vscode.window.showInformationMessage('Token removed successfully');
  } else if (action === 'Test Token') {
    await testGitLabToken(selected.label, gitLabTokenManager);
  }
}

async function testGitLabToken(gitlabUrl: string, tokenManager: GitLabTokenManager): Promise<void> {
  try {
    const token = await tokenManager.getToken(gitlabUrl);

    if (!token) {
      vscode.window.showErrorMessage(`No token found for ${gitlabUrl}`);
      return;
    }

    // Show progress while testing
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Testing token for ${gitlabUrl}...`,
      cancellable: false
    }, async (progress) => {
      progress.report({ message: 'Connecting to GitLab...' });

      // Normalize URL and construct API endpoint
      const baseUrl = gitlabUrl.endsWith('/') ? gitlabUrl.slice(0, -1) : gitlabUrl;
      const apiUrl = `${baseUrl}/api/v4/user`;

      const response = await fetch(apiUrl, {
        headers: {
          'PRIVATE-TOKEN': token
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      const userData = await response.json();
      const name = userData.name || 'Unknown';
      const username = userData.username || 'unknown';

      vscode.window.showInformationMessage(
        `✅ Token valid for ${gitlabUrl}\nAuthenticated as: ${name} (${username})`
      );
    });
  } catch (error: any) {
    console.error('[manageGitLabTokens] Token test failed:', error);
    const message = error?.message || String(error);
    vscode.window.showErrorMessage(`❌ Token test failed: ${message}`);
  }
}
