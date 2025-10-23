import * as vscode from 'vscode';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import { GitLabTokenManager } from '../services/GitLabTokenManager';
import { ComputorApiService } from '../services/ComputorApiService';

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
        // Step 1: Validate token with GitLab API
        const gitlabTestResult = await validateGitLabToken(url, token, gitLabTokenManager);

        if (!gitlabTestResult.valid) {
          vscode.window.showErrorMessage(
            `❌ GitLab token validation failed: ${gitlabTestResult.error}\nToken was not saved.`
          );
          return;
        }

        // Step 2: Validate with Computor backend courses
        const backendResult = await validateTokenWithCourses(context, url, token);

        if (!backendResult.valid) {
          vscode.window.showErrorMessage(
            `❌ Backend validation failed: ${backendResult.error}\nToken was not saved.`
          );
          return;
        }

        // Step 3: Both validations passed - store the token
        await gitLabTokenManager.storeToken(url, token);
        vscode.window.showInformationMessage(
          `✅ Token added successfully for ${url}\nAuthenticated as: ${gitlabTestResult.name} (${gitlabTestResult.username})\nValidated ${backendResult.coursesValidated} course(s)`
        );
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
      // Step 1: Validate token with GitLab API
      const gitlabTestResult = await validateGitLabToken(selected.label, newToken, gitLabTokenManager);

      if (!gitlabTestResult.valid) {
        vscode.window.showErrorMessage(
          `❌ GitLab token validation failed: ${gitlabTestResult.error}\nToken was not updated.`
        );
        return;
      }

      // Step 2: Validate with Computor backend courses
      const backendResult = await validateTokenWithCourses(context, selected.label, newToken);

      if (!backendResult.valid) {
        vscode.window.showErrorMessage(
          `❌ Backend validation failed: ${backendResult.error}\nToken was not updated.`
        );
        return;
      }

      // Step 3: Both validations passed - update the token
      await gitLabTokenManager.storeToken(selected.label, newToken);
      vscode.window.showInformationMessage(
        `✅ Token updated successfully for ${selected.label}\nAuthenticated as: ${gitlabTestResult.name} (${gitlabTestResult.username})\nValidated ${backendResult.coursesValidated} course(s)`
      );
    }
  } else if (action === 'Remove Token') {
    await gitLabTokenManager.removeToken(selected.label);
    vscode.window.showInformationMessage('Token removed successfully');
  } else if (action === 'Test Token') {
    const token = await gitLabTokenManager.getToken(selected.label);

    if (!token) {
      vscode.window.showErrorMessage(`No token found for ${selected.label}`);
      return;
    }

    // Step 1: Test with GitLab API
    const gitlabResult = await validateGitLabToken(selected.label, token, gitLabTokenManager);

    if (!gitlabResult.valid) {
      vscode.window.showErrorMessage(`❌ GitLab validation failed: ${gitlabResult.error}`);
      return;
    }

    // Step 2: Test with Computor backend courses
    const backendResult = await validateTokenWithCourses(context, selected.label, token);

    if (backendResult.valid) {
      vscode.window.showInformationMessage(
        `✅ Token valid for ${selected.label}\nAuthenticated as: ${gitlabResult.name} (${gitlabResult.username})\nValidated ${backendResult.coursesValidated} course(s)`
      );
    } else {
      vscode.window.showWarningMessage(
        `⚠️ GitLab token is valid but backend validation failed: ${backendResult.error}\nAuthenticated as: ${gitlabResult.name} (${gitlabResult.username})`
      );
    }
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

/**
 * Validate token with Computor backend courses
 * This registers the token with all courses that use this provider
 * Returns true if validation succeeded for at least one course, false otherwise
 */
async function validateTokenWithCourses(
  context: vscode.ExtensionContext,
  gitlabUrl: string,
  token: string
): Promise<{ valid: boolean; error?: string; coursesValidated?: number }> {
  try {
    // Get API service singleton instance
    const api = ComputorApiService.getInstance();
    if (!api) {
      console.log('[manageGitLabTokens] API service not available (user may not be logged in), skipping course validation');
      return { valid: false, error: 'Not logged in to Computor backend' };
    }

    const { CourseProviderValidationService } = await import('../services/CourseProviderValidationService');
    const validationService = new CourseProviderValidationService(context, api);

    // Extract courses for this specific provider
    const providerMap = await validationService.extractUniqueProviderUrls();
    const courses = providerMap.get(gitlabUrl);

    if (!courses || courses.length === 0) {
      console.log(`[manageGitLabTokens] No courses found for provider ${gitlabUrl}`);
      return { valid: false, error: 'No courses found for this provider' };
    }

    // Validate with backend
    let successCount = 0;
    let failureCount = 0;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Validating course access for ${gitlabUrl}`,
      cancellable: false
    }, async (progress) => {
      for (let i = 0; i < courses.length; i++) {
        const course = courses[i];
        if (!course) {
          continue;
        }

        progress.report({
          message: `Course ${i + 1}/${courses.length}: ${course.courseTitle}`,
          increment: (100 / courses.length)
        });

        try {
          // Validate token (backend handles registration automatically)
          const readiness = await api.validateCourseReadiness(course.courseId, token);

          if (readiness.is_ready) {
            successCount++;
          } else {
            failureCount++;
          }
        } catch (error) {
          console.warn(`[manageGitLabTokens] Failed to validate course ${course.courseId}:`, error);
          failureCount++;
        }
      }
    });

    console.log(`[manageGitLabTokens] Course validation complete for ${gitlabUrl}: ${successCount} succeeded, ${failureCount} failed`);

    if (successCount > 0) {
      return { valid: true, coursesValidated: successCount };
    } else {
      return { valid: false, error: `Failed to validate ${failureCount} course(s)` };
    }
  } catch (error) {
    console.error('[manageGitLabTokens] Failed to validate with courses:', error);
    return { valid: false, error: String(error) };
  }
}
