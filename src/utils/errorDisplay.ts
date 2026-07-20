import * as vscode from 'vscode';
import { HttpError } from '../http/errors/HttpError';
import { isConsentRequiredError, handleConsentError } from './consentGate';

/**
 * Display an error message with appropriate severity level
 * Uses the error catalog's severity to determine notification type
 * Uses title and message from the error catalog when available
 */
export function showErrorWithSeverity(error: Error | HttpError, fallbackMessage?: string): void {
  // Consent gate: the same 403 blocks every action until the user accepts the
  // privacy policy. Surface one actionable, throttled prompt (with a deep-link
  // to the web app) instead of an opaque "HTTP 403: Forbidden".
  if (isConsentRequiredError(error)) {
    void handleConsentError(error);
    return;
  }

  let message = fallbackMessage || error.message;
  let severity: string | undefined;

  if (error instanceof HttpError && error.hasBackendError()) {
    severity = error.getSeverity();

    const backendError = error.backendError;
    if (backendError) {
      const title = backendError.title;
      // Use plain message to avoid redundancy (markdown often includes the title again)
      const body = backendError.message.plain;
      message = `${title}: ${body}`;
    }
  }

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
