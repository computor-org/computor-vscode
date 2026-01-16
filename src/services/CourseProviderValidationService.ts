import * as vscode from 'vscode';
import { ComputorApiService } from './ComputorApiService';
import { GitLabTokenManager } from './GitLabTokenManager';

interface CourseProviderInfo {
  courseId: string;
  courseTitle: string;
  providerUrl: string;
}

/**
 * Service to validate and register user accounts with course Git providers
 * This ensures users have proper GitLab access before attempting to clone repositories
 */
export class CourseProviderValidationService {
  private validatedProviders: Set<string> = new Set();

  constructor(
    private context: vscode.ExtensionContext,
    private api: ComputorApiService
  ) {}

  /**
   * Extract unique provider URLs from courses across all roles
   */
  async extractUniqueProviderUrls(): Promise<Map<string, CourseProviderInfo[]>> {
    const providerMap = new Map<string, CourseProviderInfo[]>();
    const seenCourses = new Set<string>(); // Track course IDs to avoid duplicates

    try {
      // Fetch courses from all available views
      const [studentCourses, tutorCourses, lecturerCourses] = await Promise.allSettled([
        this.api.getStudentCourses().catch(() => []),
        this.api.getTutorCourses(false).catch(() => []),
        this.api.getLecturerCourses().catch(() => [])
      ]);

      const allCourses = [
        ...(studentCourses.status === 'fulfilled' ? studentCourses.value || [] : []),
        ...(tutorCourses.status === 'fulfilled' ? tutorCourses.value || [] : []),
        ...(lecturerCourses.status === 'fulfilled' ? lecturerCourses.value || [] : [])
      ];

      // Extract provider URLs from courses (deduplicate by course ID)
      for (const course of allCourses) {
        // Skip if we've already processed this course
        if (seenCourses.has(course.id)) {
          continue;
        }
        seenCourses.add(course.id);

        const providerUrl = this.extractProviderUrl(course);
        if (providerUrl) {
          const courseInfo: CourseProviderInfo = {
            courseId: course.id,
            courseTitle: course.title || course.name || course.id,
            providerUrl
          };

          if (!providerMap.has(providerUrl)) {
            providerMap.set(providerUrl, []);
          }
          providerMap.get(providerUrl)!.push(courseInfo);
        }
      }
    } catch (error) {
      console.error('[CourseProviderValidationService] Failed to extract provider URLs:', error);
    }

    return providerMap;
  }

  /**
   * Extract provider URL from a course object
   */
  private extractProviderUrl(course: any): string | null {
    // Try different possible locations for provider URL
    if (course.repository?.provider_url) {
      return this.normalizeUrl(course.repository.provider_url);
    }
    if (course.provider_url) {
      return this.normalizeUrl(course.provider_url);
    }
    if (course.gitlab_url) {
      return this.normalizeUrl(course.gitlab_url);
    }
    if (course.properties?.gitlab?.url) {
      return this.normalizeUrl(course.properties.gitlab.url);
    }
    return null;
  }

  /**
   * Normalize URL to origin (protocol + host)
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.origin;
    } catch {
      return url;
    }
  }

  /**
   * Validate and register user for all course providers
   * This is called once after login to ensure user has access to all course repositories
   * @param onProgress Optional callback for progress reporting (used during startup to avoid multiple popups)
   */
  async validateAllCourseProviders(onProgress?: (message: string) => void): Promise<void> {
    const providerMap = await this.extractUniqueProviderUrls();

    if (providerMap.size === 0) {
      console.log('[CourseProviderValidationService] No course providers found');
      return;
    }

    const tokenManager = GitLabTokenManager.getInstance(this.context);

    for (const [providerUrl, courses] of providerMap.entries()) {
      // Skip if already validated this session
      if (this.validatedProviders.has(providerUrl)) {
        continue;
      }

      try {
        // Check if we have a token for this provider
        let token = await tokenManager.getToken(providerUrl);

        if (!token) {
          // No token - prompt user
          const shouldPrompt = await this.askToConfigureProvider(providerUrl, courses);
          if (!shouldPrompt) {
            console.log(`[CourseProviderValidationService] User skipped configuration for ${providerUrl}`);
            continue;
          }

          token = await tokenManager.ensureTokenForUrl(providerUrl);
          if (!token) {
            console.log(`[CourseProviderValidationService] No token provided for ${providerUrl}`);
            continue;
          }
        }

        // Validate token for each course and register if needed
        await this.validateAndRegisterCourses(providerUrl, token, courses, onProgress);

        // Mark as validated
        this.validatedProviders.add(providerUrl);
      } catch (error) {
        console.error(`[CourseProviderValidationService] Failed to validate provider ${providerUrl}:`, error);
        vscode.window.showWarningMessage(
          `Failed to validate GitLab access for ${providerUrl}. You may need to configure this manually later.`
        );
      }
    }
  }

  /**
   * Ask user if they want to configure access for a provider
   */
  private async askToConfigureProvider(providerUrl: string, courses: CourseProviderInfo[]): Promise<boolean> {
    const courseNames = courses.slice(0, 3).map(c => c.courseTitle).join(', ');
    const moreText = courses.length > 3 ? ` and ${courses.length - 3} more` : '';

    const message = `Configure GitLab access for ${providerUrl}?\n\nRequired for courses: ${courseNames}${moreText}`;

    const choice = await vscode.window.showInformationMessage(
      message,
      { modal: false },
      'Configure Now',
      'Skip'
    );

    return choice === 'Configure Now';
  }

  /**
   * Validate and register user for multiple courses on the same provider
   * @param onProgress Optional external progress callback. If provided, uses it instead of showing a separate popup.
   */
  private async validateAndRegisterCourses(
    providerUrl: string,
    token: string,
    courses: CourseProviderInfo[],
    onProgress?: (message: string) => void
  ): Promise<void> {
    const validateCourses = async (report: (message: string) => void) => {
      let failureCount = 0;

      for (let i = 0; i < courses.length; i++) {
        const course = courses[i];
        if (!course) {
          continue;
        }

        report(`Validating ${course.courseTitle} (${i + 1}/${courses.length})`);

        try {
          // Validate the token for this course (backend handles registration automatically)
          const readiness = await this.api.validateCourseReadiness(course.courseId, token);

          if (readiness.is_ready) {
            console.log(`[CourseProviderValidationService] ✓ Validated: ${course.courseTitle}`);
          } else {
            failureCount++;
            console.warn(`[CourseProviderValidationService] ✗ Not ready: ${course.courseTitle}`, readiness);
          }
        } catch (error: any) {
          failureCount++;
          console.error(`[CourseProviderValidationService] Error validating ${course.courseTitle}:`, error);
          // Don't show error for each course - we'll show summary at the end
        }
      }

      // Show summary only if there were failures (success is implicit)
      if (failureCount > 0) {
        vscode.window.showWarningMessage(
          `Could not validate ${failureCount} course${failureCount > 1 ? 's' : ''} on ${providerUrl}. You may need to configure access manually.`
        );
      }
    };

    // If external progress callback provided, use it (no separate popup)
    if (onProgress) {
      await validateCourses(onProgress);
    } else {
      // Standalone call - show its own progress popup
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Validating GitLab access for ${providerUrl}`,
        cancellable: false
      }, async (progress) => {
        await validateCourses((msg) => progress.report({ message: msg }));
      });
    }
  }

  /**
   * Reset validation state (useful for re-validating)
   */
  resetValidationState(): void {
    this.validatedProviders.clear();
  }

  /**
   * Check if a provider has been validated this session
   */
  isProviderValidated(providerUrl: string): boolean {
    return this.validatedProviders.has(providerUrl);
  }
}
