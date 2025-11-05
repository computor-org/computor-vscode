import * as vscode from 'vscode';
import { HttpError } from '../http/errors/HttpError';

/**
 * Display an error message with appropriate severity level
 * Uses the error catalog's severity to determine notification type
 * Uses title and message from the error catalog when available
 */
export function showErrorWithSeverity(error: Error | HttpError, fallbackMessage?: string): void {
  let message = fallbackMessage || error.message;
  let severity: string | undefined;

  console.log('[errorDisplay] Processing error:', error);
  console.log('[errorDisplay] Error type:', error?.constructor?.name);
  console.log('[errorDisplay] Is HttpError?', error instanceof HttpError);
  console.log('[errorDisplay] Error prototype chain:', Object.getPrototypeOf(error)?.constructor?.name);

  if (error instanceof HttpError) {
    console.log('[errorDisplay] HttpError details:', {
      hasBackendError: error.hasBackendError(),
      errorCode: error.errorCode,
      backendError: error.backendError,
      severity: error.getSeverity(),
      status: error.status,
      response: error.response
    });

    if (error.hasBackendError()) {
      severity = error.getSeverity();

      const backendError = error.backendError;
      if (backendError) {
        const title = backendError.title;
        // Use plain message to avoid redundancy (markdown often includes the title again)
        const body = backendError.message.plain;
        message = `${title}: ${body}`;
        console.log('[errorDisplay] Using backend error message:', message);
      }
    } else {
      console.warn('[errorDisplay] HttpError does not have backend error. Response:', error.response);
    }
  } else {
    console.warn('[errorDisplay] Error is not an HttpError instance');
  }

  console.log(`[errorDisplay] Showing notification - severity: ${severity}, message: ${message}`);

  switch (severity) {
    case 'info':
      vscode.window.showInformationMessage(message);
      break;
    case 'warning':
      vscode.window.showWarningMessage(message);
      break;
    case 'error':
    case 'critical':
      vscode.window.showErrorMessage(message);
      break;
    default:
      console.log('[errorDisplay] Using default (error) notification');
      vscode.window.showErrorMessage(message);
      break;
  }
}

/**
 * Display a notification based on severity string
 */
export function showNotificationBySeverity(
  message: string,
  severity: 'info' | 'warning' | 'error' | 'critical' = 'error'
): void {
  switch (severity) {
    case 'info':
      vscode.window.showInformationMessage(message);
      break;
    case 'warning':
      vscode.window.showWarningMessage(message);
      break;
    case 'error':
    case 'critical':
      vscode.window.showErrorMessage(message);
      break;
  }
}
