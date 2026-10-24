import * as vscode from 'vscode';
import { AuthenticationError, HttpError } from '../exceptions/errors/HttpError';
import { say, uiLanguage } from './uiLanguage';
import { isConsentRequiredError, handleConsentError } from './consentGate';

/** Session failures must remain actionable even after the HTTP client trips its breaker. */
export function isSessionError(error: unknown): boolean {
  return error instanceof AuthenticationError || (error instanceof HttpError && error.status === 401);
}

// These codes describe learner actions precisely. Unknown codes retain the
// server's detail below, rather than guessing what failed from arbitrary text.
const germanSubmissionErrors: Record<string, string> = {
  SUBMIT_003: 'Ein Test läuft bereits. Warte, bis er abgeschlossen ist.',
  SUBMIT_004: 'Du hast alle Testläufe für diese Aufgabe aufgebraucht.',
  SUBMIT_008: 'Diese Version wurde bereits getestet. Ein erneuter Test ist nur möglich, wenn der vorige Test abgestürzt ist oder abgebrochen wurde.',
  SUBMIT_009: 'Du hast alle Abgaben für diese Aufgabe aufgebraucht.',
  SUBMIT_010: 'Du hast für diese Aufgabe keine Testläufe und keine Abgaben mehr übrig.',
  SUBMIT_014: 'Es gibt noch nichts abzugeben. Schreibe zuerst deine Lösung und gib sie dann ab.'
};

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

  if (isSessionError(error)) {
    vscode.window.showErrorMessage(say(
      'Your session has expired. Please sign in again.',
      'Deine Sitzung ist abgelaufen. Melde dich bitte erneut an.'
    ));
    return;
  }

  let message = fallbackMessage || error.message;
  let severity: string | undefined;

  if (error instanceof HttpError && error.hasBackendError()) {
    severity = error.getSeverity();

    const backendError = error.backendError;
    if (backendError) {
      const title = backendError.title;
      // The server's reason for THIS request first; the catalog's per-code text
      // only when it sent none. The catalog text describes the *code*, not the
      // failure, so it is wrong whenever a call site carries a coarse or plain
      // mistaken code — issue #121 was a backend config error tagged
      // CONTENT_001, which this line turned into "Course Content Not Found:
      // The requested course content was not found." and threw the real
      // reason away. Use plain, not markdown: markdown repeats the title.
      const body = error.serverDetail || backendError.message.plain;
      message = uiLanguage() === 'de' && error.errorCode && germanSubmissionErrors[error.errorCode]
        ? germanSubmissionErrors[error.errorCode]!
        : `${title}: ${body}`;
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
