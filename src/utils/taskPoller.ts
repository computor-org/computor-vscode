import * as vscode from 'vscode';
import type { ComputorApiService } from '../services/ComputorApiService';
import type { TaskInfo, TaskStatus } from '../types/generated/tasks';

export interface TaskPollerOptions {
  title: string;
  pollInterval?: number;
  maxDuration?: number;
  cancellable?: boolean;
}

export interface TaskPollerResult {
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'CANCELLED' | 'ERROR';
  taskInfo?: TaskInfo;
  error?: string;
}

const TERMINAL_STATUSES: TaskStatus[] = ['finished', 'failed', 'cancelled'];

/**
 * Poll a Temporal task until it reaches a terminal state (finished/failed/cancelled).
 * Shows a VS Code progress notification during polling.
 */
export async function pollTaskUntilComplete(
  apiService: ComputorApiService,
  taskId: string,
  options: TaskPollerOptions
): Promise<TaskPollerResult> {
  const pollInterval = options.pollInterval ?? 4000;
  const maxDuration = options.maxDuration ?? 300_000;

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.title,
      cancellable: options.cancellable ?? false
    },
    async (progress, token) => {
      return new Promise<TaskPollerResult>((resolve) => {
        const startTime = Date.now();

        const intervalHandle = setInterval(async () => {
          if (token.isCancellationRequested) {
            clearInterval(intervalHandle);
            resolve({ status: 'CANCELLED' });
            return;
          }

          if (Date.now() - startTime > maxDuration) {
            clearInterval(intervalHandle);
            resolve({ status: 'TIMEOUT', error: 'Operation timed out' });
            return;
          }

          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          progress.report({ message: `Waiting for completion... (${elapsed}s)` });

          try {
            const taskInfo = await apiService.getTaskInfo(taskId);
            if (!taskInfo) { return; }

            if (TERMINAL_STATUSES.includes(taskInfo.status)) {
              clearInterval(intervalHandle);

              if (taskInfo.status === 'finished') {
                resolve({ status: 'SUCCESS', taskInfo });
              } else if (taskInfo.status === 'cancelled') {
                resolve({ status: 'CANCELLED', taskInfo, error: taskInfo.error || undefined });
              } else {
                resolve({ status: 'FAILED', taskInfo, error: taskInfo.error || undefined });
              }
            }
          } catch (error: any) {
            console.error(`[taskPoller] Error polling task ${taskId}:`, error);
          }
        }, pollInterval);
      });
    }
  );
}
