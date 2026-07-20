import * as vscode from 'vscode';
import { showErrorWithSeverity } from './errorDisplay';

/**
 * The single entry point for user-facing VS Code notifications.
 *
 * This wraps the native `vscode.window.show*Message` / `withProgress` APIs so
 * every notification in the extension goes through one place: consistent
 * behaviour, one spot to adjust wording, add logging/telemetry, or throttle.
 * Prefer `notify.*` over calling `vscode.window.show*Message` directly.
 *
 * This is deliberately a thin, unified layer over the built-in notifications —
 * not an in-webview toast/snackbar system. Notifications stay native to VS Code.
 */
export const notify = {
  /**
   * Transient informational message. Extra arguments become action buttons;
   * the chosen label (or `undefined` if dismissed) is returned.
   */
  info(message: string, ...actions: string[]): Thenable<string | undefined> {
    return vscode.window.showInformationMessage(message, ...actions);
  },

  /** Warning message; same action/return contract as {@link info}. */
  warning(message: string, ...actions: string[]): Thenable<string | undefined> {
    return vscode.window.showWarningMessage(message, ...actions);
  },

  /**
   * Error notification. Pass an `Error`/`HttpError` to route it through the
   * error-catalog severity and consent gate (see {@link showErrorWithSeverity});
   * pass a string for a plain message. Extra string arguments become action
   * buttons (string form only).
   */
  error(error: unknown, ...actions: string[]): Thenable<string | undefined> {
    if (error instanceof Error) {
      showErrorWithSeverity(error);
      return Promise.resolve(undefined);
    }
    return vscode.window.showErrorMessage(String(error), ...actions);
  },

  /**
   * Modal confirmation for a destructive or irreversible action. Returns `true`
   * only when the user picks `confirmLabel` (VS Code adds a Cancel button
   * automatically). Use for deletes/overwrites — not for routine choices.
   */
  async confirm(message: string, confirmLabel: string, detail?: string): Promise<boolean> {
    const options: vscode.MessageOptions = detail ? { modal: true, detail } : { modal: true };
    const picked = await vscode.window.showWarningMessage(message, options, confirmLabel);
    return picked === confirmLabel;
  },

  /**
   * Modal dialog with explicit action buttons (VS Code adds Cancel). Returns
   * the picked label, or `undefined` if dismissed. `severity` selects the icon.
   * Use {@link confirm} for the common single-action destructive case; use this
   * when a modal needs multiple choices or a detail body.
   */
  modal(
    severity: 'info' | 'warning' | 'error',
    message: string,
    options: { detail?: string; actions?: string[] } = {}
  ): Thenable<string | undefined> {
    const opts: vscode.MessageOptions = options.detail
      ? { modal: true, detail: options.detail }
      : { modal: true };
    const actions = options.actions ?? [];
    switch (severity) {
      case 'info':
        return vscode.window.showInformationMessage(message, opts, ...actions);
      case 'warning':
        return vscode.window.showWarningMessage(message, opts, ...actions);
      case 'error':
        return vscode.window.showErrorMessage(message, opts, ...actions);
    }
  },

  /** Run work under a titled progress notification in the notification area. */
  progress<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Thenable<T>
  ): Thenable<T> {
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task);
  }
};
