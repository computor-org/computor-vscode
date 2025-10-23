import * as vscode from 'vscode';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { GitLabTokenManager } from '../services/GitLabTokenManager';

export async function manageGitLabTokens(context: vscode.ExtensionContext): Promise<void> {
  const settingsManager = new ComputorSettingsManager(context);
  const gitLabTokenManager = GitLabTokenManager.getInstance(context);

  const urls = await settingsManager.getGitLabUrls();

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
      const token = await vscode.window.showInputBox({
        title: `Add Token for ${url}`,
        prompt: 'Enter your GitLab Personal Access Token',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'glpat-xxxxxxxxxxxxxxxxxxxx'
      });

      if (token) {
        // Validate token before storing
        const testResult = await validateGitLabToken(url, token, gitLabTokenManager);

        if (testResult.valid) {
          await gitLabTokenManager.storeToken(url, token);
          vscode.window.showInformationMessage(
            `✅ Token added successfully for ${url}\nAuthenticated as: ${testResult.name} (${testResult.username})`
          );
        } else {
          vscode.window.showErrorMessage(
            `❌ Token validation failed: ${testResult.error}\nToken was not saved.`
          );
        }
      }
    }

    return;
  }

  const action = await vscode.window.showQuickPick(
    ['Update Token', 'Remove Token', 'Test Token'],
    { placeHolder: `Manage token for ${selected.label}` }
  );

  if (action === 'Update Token') {
    const newToken = await vscode.window.showInputBox({
      title: `Update Token for ${selected.label}`,
      prompt: 'Enter your GitLab Personal Access Token',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'glpat-xxxxxxxxxxxxxxxxxxxx'
    });

    if (newToken) {
      // Validate token before storing
      const testResult = await validateGitLabToken(selected.label, newToken, gitLabTokenManager);

      if (testResult.valid) {
        await gitLabTokenManager.storeToken(selected.label, newToken);
        vscode.window.showInformationMessage(
          `✅ Token updated successfully for ${selected.label}\nAuthenticated as: ${testResult.name} (${testResult.username})`
        );
      } else {
        vscode.window.showErrorMessage(
          `❌ Token validation failed: ${testResult.error}\nToken was not saved.`
        );
      }
    }
  } else if (action === 'Remove Token') {
    await gitLabTokenManager.removeToken(selected.label);
    vscode.window.showInformationMessage('Token removed successfully');
  } else if (action === 'Test Token') {
    await testGitLabToken(selected.label, gitLabTokenManager);
  }
}

async function validateGitLabToken(gitlabUrl: string, token: string, tokenManager: GitLabTokenManager): Promise<{ valid: boolean; name?: string; username?: string; error?: string }> {
  return await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Validating token for ${gitlabUrl}...`,
    cancellable: false
  }, async (progress) => {
    progress.report({ message: 'Connecting to GitLab...' });
    return await tokenManager.validateToken(gitlabUrl, token);
  });
}

async function testGitLabToken(gitlabUrl: string, tokenManager: GitLabTokenManager): Promise<void> {
  const token = await tokenManager.getToken(gitlabUrl);

  if (!token) {
    vscode.window.showErrorMessage(`No token found for ${gitlabUrl}`);
    return;
  }

  const result = await validateGitLabToken(gitlabUrl, token, tokenManager);

  if (result.valid) {
    vscode.window.showInformationMessage(
      `✅ Token valid for ${gitlabUrl}\nAuthenticated as: ${result.name} (${result.username})`
    );
  } else {
    vscode.window.showErrorMessage(`❌ Token test failed: ${result.error}`);
  }
}
