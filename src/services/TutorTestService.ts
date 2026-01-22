import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ComputorApiService } from './ComputorApiService';
import { TutorTestGet, ResultArtifactInfo, TutorTestArtifactInfo } from '../types/generated';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
import { showErrorWithSeverity } from '../utils/errorDisplay';

/**
 * Service for managing tutor test execution and results
 */
export class TutorTestService {
  private static instance: TutorTestService;
  private apiService: ComputorApiService;
  private workspaceStructure: WorkspaceStructureManager;

  private pollingIntervals: Map<string, NodeJS.Timer> = new Map();
  private readonly POLL_INTERVAL = 4000; // 4 seconds as requested
  private readonly MAX_POLL_DURATION = 300000; // 5 minutes

  private constructor(apiService: ComputorApiService) {
    this.apiService = apiService;
    this.workspaceStructure = WorkspaceStructureManager.getInstance();
  }

  static getInstance(apiService: ComputorApiService): TutorTestService {
    if (!TutorTestService.instance) {
      TutorTestService.instance = new TutorTestService(apiService);
    }
    return TutorTestService.instance;
  }

  /**
   * Create a ZIP file from a directory
   */
  private async createZipFromDirectory(directoryPath: string): Promise<Buffer> {
    const JSZip = require('jszip');
    const zip = new JSZip();

    const addToZip = async (currentPath: string, zipPath: string) => {
      const items = await fs.promises.readdir(currentPath, { withFileTypes: true });

      for (const item of items) {
        const itemPath = path.join(currentPath, item.name);
        const itemZipPath = zipPath ? `${zipPath}/${item.name}` : item.name;

        if (item.isDirectory()) {
          // Skip .git directories
          if (item.name === '.git') continue;
          await addToZip(itemPath, itemZipPath);
        } else {
          const content = await fs.promises.readFile(itemPath);
          zip.file(itemZipPath, content);
        }
      }
    };

    await addToZip(directoryPath, '');
    return await zip.generateAsync({ type: 'nodebuffer' });
  }

  /**
   * Run a tutor test on a submission
   * @param courseContentId The course content ID
   * @param submissionPath The path to the submission directory
   * @param assignmentTitle The title of the assignment for display
   * @returns Test result with status and artifacts path
   */
  async runTutorTest(
    courseContentId: string,
    submissionPath: string,
    assignmentTitle: string
  ): Promise<{ status: 'SUCCESS' | 'FAILED' | 'ERROR' | 'CANCELLED' | 'TIMEOUT'; testId?: string; artifactsPath?: string; testDetails?: TutorTestGet; artifacts?: ResultArtifactInfo[] } | undefined> {
    try {
      // Check if submission path exists
      if (!await this.workspaceStructure.directoryExists(submissionPath)) {
        vscode.window.showErrorMessage('Submission directory not found. Please checkout the submission first.');
        return undefined;
      }

      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running test for ${assignmentTitle}`,
          cancellable: true
        },
        async (progress, token) => {
          try {
            // Create ZIP from submission directory
            progress.report({ message: 'Packaging submission...' });
            const zipBuffer = await this.createZipFromDirectory(submissionPath);

            // Create tutor test
            progress.report({ message: 'Submitting test...' });
            const testResponse = await this.apiService.createTutorTest(
              courseContentId,
              zipBuffer,
              { store_graphics_artifacts: true }
            );

            if (!testResponse || !testResponse.test_id) {
              throw new Error('Failed to create test - no test ID returned');
            }

            const testId = testResponse.test_id;
            console.log(`[TutorTestService] Test created with ID: ${testId}`);

            // Poll for test completion
            progress.report({ message: 'Waiting for test results...' });
            const result = await this.pollTestStatus(testId, progress, token);

            if (result.status === 'CANCELLED') {
              return { status: 'CANCELLED' };
            }

            // Download artifacts and get full results if test completed
            if (result.status === 'SUCCESS' || result.status === 'FAILED') {
              // Get full test results
              progress.report({ message: 'Fetching test results...' });
              const testDetails = await this.apiService.getTutorTest(testId);

              // Get artifact list for display in results panel
              progress.report({ message: 'Fetching artifact list...' });
              const artifactList = await this.apiService.listTutorTestArtifacts(testId);
              const artifacts = this.mapArtifactsToResultFormat(testId, artifactList?.artifacts);

              // Download artifacts to local storage
              progress.report({ message: 'Downloading test artifacts...' });
              const artifactsPath = await this.downloadAndExtractArtifacts(testId);

              return {
                status: result.status,
                testId,
                artifactsPath,
                testDetails,
                artifacts
              };
            }

            return { status: result.status, testId };

          } catch (error: any) {
            console.error('[TutorTestService] Error running test:', error);
            showErrorWithSeverity(error, 'Failed to run tutor test');
            return { status: 'ERROR' };
          }
        }
      );
    } catch (error: any) {
      console.error('[TutorTestService] Error in runTutorTest:', error);
      showErrorWithSeverity(error, 'Failed to run tutor test');
      return undefined;
    }
  }

  /**
   * Poll test status until completion
   */
  private async pollTestStatus(
    testId: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
  ): Promise<{ status: 'SUCCESS' | 'FAILED' | 'ERROR' | 'CANCELLED' | 'TIMEOUT' }> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let pollCount = 0;

      // Clear any existing polling for this test
      this.stopPolling(testId);

      const interval = setInterval(async () => {
        pollCount++;

        // Check for cancellation
        if (token.isCancellationRequested) {
          this.stopPolling(testId);
          resolve({ status: 'CANCELLED' });
          return;
        }

        // Check for timeout
        if (Date.now() - startTime > this.MAX_POLL_DURATION) {
          this.stopPolling(testId);
          vscode.window.showWarningMessage(`Test timed out after 5 minutes`);
          resolve({ status: 'TIMEOUT' });
          return;
        }

        try {
          const testStatus = await this.apiService.getTutorTestStatus(testId);

          if (!testStatus) {
            console.log(`[TutorTestService] Poll ${pollCount}: No status returned`);
            return;
          }

          console.log(`[TutorTestService] Poll ${pollCount}: Test status = ${testStatus.status}`);

          // Update progress message
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          progress.report({ message: `Running test... (${elapsed}s)` });

          // Check if test is complete
          if (testStatus.status === 'completed') {
            this.stopPolling(testId);
            vscode.window.showInformationMessage('Test completed');
            resolve({ status: 'SUCCESS' });
          } else if (testStatus.status === 'failed') {
            this.stopPolling(testId);
            vscode.window.showWarningMessage('Test failed');
            resolve({ status: 'FAILED' });
          } else if (testStatus.status === 'timeout') {
            this.stopPolling(testId);
            vscode.window.showWarningMessage('Test timed out on the server');
            resolve({ status: 'TIMEOUT' });
          }
          // Continue polling if status is 'pending' or 'running'

        } catch (error: any) {
          console.error(`[TutorTestService] Error polling test ${testId}:`, error);
          // Continue polling on error
        }
      }, this.POLL_INTERVAL);

      this.pollingIntervals.set(testId, interval);
    });
  }

  /**
   * Stop polling for a specific test
   */
  private stopPolling(testId: string): void {
    const interval = this.pollingIntervals.get(testId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(testId);
      console.log(`[TutorTestService] Stopped polling for test ${testId}`);
    }
  }

  /**
   * Download and extract test artifacts
   */
  private async downloadAndExtractArtifacts(testId: string): Promise<string | undefined> {
    try {
      // Download artifacts ZIP
      const artifactsBuffer = await this.apiService.downloadTutorTestArtifacts(testId);
      if (!artifactsBuffer) {
        console.log('[TutorTestService] No artifacts to download');
        return undefined;
      }

      // Create artifacts directory
      const artifactsPath = this.workspaceStructure.getResultArtifactsPath(testId);
      await fs.promises.mkdir(artifactsPath, { recursive: true });

      // Extract ZIP to artifacts directory
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(artifactsBuffer);

      for (const [filename, file] of Object.entries(zip.files)) {
        const fileData = file as any;
        if (!fileData.dir) {
          const fileContent = await fileData.async('nodebuffer');
          const filePath = path.join(artifactsPath, filename);
          await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
          await fs.promises.writeFile(filePath, fileContent);
        }
      }

      console.log(`[TutorTestService] Artifacts extracted to ${artifactsPath}`);
      return artifactsPath;

    } catch (error: any) {
      console.error('[TutorTestService] Error downloading artifacts:', error);
      return undefined;
    }
  }

  /**
   * Open test results in the results panel
   */
  async openTestResults(testId: string, artifactsPath?: string, testDetails?: TutorTestGet, artifacts?: ResultArtifactInfo[]): Promise<void> {
    try {
      const artifactsToPass = artifacts || [];

      // First, try to use testDetails.result_dict if available
      if (testDetails?.result_dict) {
        await vscode.commands.executeCommand('computor.results.open', testDetails.result_dict, testId, artifactsToPass);
        await vscode.commands.executeCommand('computor.testResultsPanel.focus');
        return;
      }

      // Fallback: try to read test results from artifacts
      if (artifactsPath) {
        const resultsFile = path.join(artifactsPath, 'results.json');
        if (await this.fileExists(resultsFile)) {
          const resultsContent = await fs.promises.readFile(resultsFile, 'utf8');
          const resultsJson = JSON.parse(resultsContent);

          await vscode.commands.executeCommand('computor.results.open', resultsJson, testId, artifactsToPass);
          await vscode.commands.executeCommand('computor.testResultsPanel.focus');
          return;
        }
      }

      // If no results available, just show the artifacts directory
      if (artifactsPath) {
        const uri = vscode.Uri.file(artifactsPath);
        await vscode.commands.executeCommand('revealInExplorer', uri);
      } else {
        vscode.window.showInformationMessage('No test results available');
      }

    } catch (error: any) {
      console.error('[TutorTestService] Error opening test results:', error);
      vscode.window.showErrorMessage('Failed to open test results');
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Map TutorTestArtifactInfo to ResultArtifactInfo format for the results panel
   */
  private mapArtifactsToResultFormat(testId: string, artifacts?: TutorTestArtifactInfo[]): ResultArtifactInfo[] {
    if (!artifacts || artifacts.length === 0) {
      return [];
    }

    return artifacts.map((artifact, index) => ({
      id: `${testId}-artifact-${index}`,
      filename: artifact.filename,
      content_type: this.guessContentType(artifact.filename),
      file_size: artifact.size,
      created_at: artifact.last_modified
    }));
  }

  /**
   * Guess content type from filename extension
   */
  private guessContentType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.json': 'application/json',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.xml': 'application/xml',
      '.zip': 'application/zip'
    };
    return contentTypes[ext] || 'application/octet-stream';
  }

  /**
   * Clean up old test artifacts
   */
  async cleanupOldArtifacts(daysOld: number = 7): Promise<void> {
    try {
      const dirs = this.workspaceStructure.getDirectories();
      const artifactsDir = dirs.tmpArtifacts;

      if (!await this.workspaceStructure.directoryExists(artifactsDir)) {
        return;
      }

      const entries = await fs.promises.readdir(artifactsDir, { withFileTypes: true });
      const now = Date.now();
      const maxAge = daysOld * 24 * 60 * 60 * 1000; // Convert days to milliseconds

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(artifactsDir, entry.name);
          const stats = await fs.promises.stat(dirPath);
          const age = now - stats.mtimeMs;

          if (age > maxAge) {
            await fs.promises.rm(dirPath, { recursive: true, force: true });
            console.log(`[TutorTestService] Cleaned up old artifacts: ${entry.name}`);
          }
        }
      }
    } catch (error: any) {
      console.error('[TutorTestService] Error cleaning up artifacts:', error);
    }
  }
}