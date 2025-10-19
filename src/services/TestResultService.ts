import * as vscode from 'vscode';
import { ComputorApiService } from './ComputorApiService';
import { showErrorWithSeverity } from '../utils/errorDisplay';
//import { TestResultsPanelProvider, TestResultsTreeDataProvider } from '../ui/panels/TestResultsPanel';

/**
 * Service for managing test results polling and display
 */
export class TestResultService {
  private static instance: TestResultService;
  private apiService?: ComputorApiService;
  //private testResultsPanelProvider?: TestResultsPanelProvider;

  private pollingIntervals: Map<string, NodeJS.Timer> = new Map();
  private readonly POLL_INTERVAL = 2000; // 2 seconds
  private readonly MAX_POLL_DURATION = 300000; // 5 minutes

  private constructor() {
    // API service will be set via setApiService
  }

  static getInstance(): TestResultService {
    if (!TestResultService.instance) {
      TestResultService.instance = new TestResultService();
    }
    return TestResultService.instance;
  }

  /**
   * Set the API service to use
   */
  setApiService(apiService: ComputorApiService): void {
    this.apiService = apiService;
  }

  /**
   * Set the test results panel provider
   */
  // setTestResultsPanelProvider(provider: TestResultsPanelProvider): void {
  //   this.testResultsPanelProvider = provider;
  // }

  /**
   * Set the test results tree provider (for the tree view in panel)
   */
  // setTestResultsTreeProvider(provider: TestResultsTreeDataProvider): void {
  //   // Link tree provider to panel only (no local reference needed)
  //   if (this.testResultsPanelProvider) {
  //     this.testResultsPanelProvider.setTreeProvider(provider);
  //   }
  // }

  /**
   * Submit a test using artifact ID and display results
   */
  async submitTestByArtifactAndAwaitResults(
    artifactId: string,
    assignmentTitle: string,
    submit?: boolean,
    options?: { progress?: vscode.Progress<{ message?: string; increment?: number }>; token?: vscode.CancellationToken; showProgress?: boolean; courseContentId?: string }
  ): Promise<void> {
    if (!this.apiService) {
      vscode.window.showErrorMessage('Test service not properly initialized');
      return;
    }

    try {
      const runWithProgress = async (
        testResult: any,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token?: vscode.CancellationToken
      ) => {
        progress.report({ message: 'Submitting test request...' });

        const resultId = testResult.id;
        console.log(`[TestResultService] Test submitted with result ID: ${resultId}, starting polling...`);

        progress.report({ message: 'Waiting for test results...' });

        await (async () => {
          return new Promise<void>((resolve) => {
            const startTime = Date.now();
            let pollCount = 0;

            this.stopPolling(resultId);

            const interval = setInterval(async () => {
              pollCount++;

              if (token && token.isCancellationRequested) {
                this.stopPolling(resultId);
                resolve();
                return;
              }

              if (Date.now() - startTime > this.MAX_POLL_DURATION) {
                this.stopPolling(resultId);
                vscode.window.showWarningMessage(`Test for ${assignmentTitle} timed out after 5 minutes`);
                resolve();
                return;
              }

              const elapsed = Math.floor((Date.now() - startTime) / 1000);
              progress.report({ message: `Running tests... (${elapsed}s)` });

              const status = await this.apiService!.getResultStatus(resultId) as unknown as number | string;
              console.log(`[TestResultService] Poll ${pollCount}: Status = ${status}`);

              if (status === undefined) {
                return;
              }

              if (status === 0 || status === 1 || status === 6 || status === "finished" || status === "failed" || status === "cancelled") {
                this.stopPolling(resultId);

                const fullResult = await this.apiService!.getResult(resultId);

                if (fullResult) {
                  console.log('[TestResultService] Test complete, full result:', fullResult);

                  await this.displayTestResults(fullResult, assignmentTitle);

                  if (status === 0 || status === "finished") {
                    vscode.window.showInformationMessage(
                      `✅ Tests completed for ${assignmentTitle}`
                    );
                  } else {
                    vscode.window.showErrorMessage(
                      `❌ Tests failed for ${assignmentTitle}`
                    );
                  }
                }

                resolve();
              }
            }, this.POLL_INTERVAL);

            this.pollingIntervals.set(resultId, interval);
          });
        })();
      };

      let testResult: any;
      try {
        testResult = await this.apiService!.submitTest({
          artifact_id: artifactId,
          submit,
        });
      } catch (error: any) {
        // If POST /tests returns 400 (test already running or exists), try to fetch existing result
        const is400Error = error?.response?.status === 400 || error?.message?.includes('400');
        if (is400Error && options?.courseContentId) {
          console.log('[TestResultService] Test POST returned 400, fetching existing result from course content...');
          const courseContent = await this.apiService!.getStudentCourseContent(options.courseContentId, { force: true });
          if (courseContent?.result) {
            testResult = courseContent.result;
            console.log('[TestResultService] Retrieved existing result:', testResult);
          } else {
            throw error; // Re-throw if we can't get the result
          }
        } else {
          throw error; // Re-throw other errors
        }
      }

      console.log("[Debug] " + JSON.stringify(testResult,null,2));

      // Check if we have the full result already
      if (testResult.result_json) {
        const statusValue = testResult.status;
        const statusString = typeof statusValue === 'string' ? statusValue.toLowerCase() : undefined;
        console.log(`[TestResultService] Test completed immediately with status: ${statusValue}`);

        // Display the results
        await this.displayTestResults(testResult, assignmentTitle);

        const isSuccess = statusValue === 0 || statusString === 'finished';
        const isFailure = statusValue === 1 || statusString === 'failed';
        const isCancelled = statusString === 'cancelled';
        const isTerminal = isSuccess || isFailure || isCancelled || statusString === 'deferred' || statusValue === 6;

        if (isTerminal) {
          if (isSuccess) {
            const score = typeof testResult.result === 'number' ? testResult.result : 0;
            const percentage = (score * 100).toFixed(1);
            vscode.window.showInformationMessage(
              `✅ Tests completed for ${assignmentTitle}: ${percentage}% passed`
            );
          } else if (isFailure) {
            vscode.window.showErrorMessage(`❌ Test execution failed for ${assignmentTitle}`);
          } else if (isCancelled) {
            vscode.window.showWarningMessage(`⚠️ Test execution cancelled for ${assignmentTitle}`);
          } else {
            vscode.window.showInformationMessage(`ℹ️ Test results available for ${assignmentTitle} (status: ${statusValue})`);
          }
          return;
        }
      }

      // Start polling if we have a result ID
      if (!testResult || !testResult.id) {
        vscode.window.showErrorMessage('Test submitted but no result ID received');
        return;
      }

      if (options?.progress) {
        await runWithProgress(testResult, options.progress, options.token);
      } else {
        const show = options?.showProgress !== false;
        if (show) {
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Testing ${assignmentTitle}...`,
            cancellable: true,
          }, async (progress, token) => {
            await runWithProgress(testResult, progress, token);
          });
        } else {
          const dummy: vscode.Progress<{ message?: string; increment?: number }> = { report: () => void 0 };
          await runWithProgress(testResult, dummy);
        }
      }
    } catch (error: any) {
      console.error('[TestResultService] Error in submitTestByArtifactAndAwaitResults:', error);
      showErrorWithSeverity(error);
      throw error;
    }
  }

  /**
   * Stop polling for a specific result
   */
  private stopPolling(resultId: string): void {
    const interval = this.pollingIntervals.get(resultId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(resultId);
      console.log(`[TestResultService] Stopped polling for ${resultId}`);
    }
  }

  /**
   * Stop all polling
   */
  stopAllPolling(): void {
    for (const [, interval] of this.pollingIntervals) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();
    console.log('[TestResultService] Stopped all polling');
  }

  /**
   * Display test results in the panel view
   */
  private async displayTestResults(result: any, assignmentTitle: string): Promise<void> {
    try {
      // Use legacy-style wiring: open results in tree, panel updates on selection
      const resultJson = result.result_json || result;
      await vscode.commands.executeCommand('computor.results.open', resultJson);
      await vscode.commands.executeCommand('computor.testResultsPanel.focus');
    } catch (error) {
      console.error('[TestResultService] Error displaying test results:', error);
      
      // Fallback: show raw result
      const outputChannel = vscode.window.createOutputChannel('Computor Test Results');
      outputChannel.clear();
      outputChannel.appendLine(`Test Results for ${assignmentTitle}`);
      outputChannel.appendLine('='.repeat(50));
      outputChannel.appendLine(JSON.stringify(result, null, 2));
      outputChannel.show();
    }
  }

  /**
   * Parse test results from backend format to tree provider format
   */
  // Parsing is not needed with legacy-style panel/tree; selection drives panel content


  // Mapping no longer used

}
