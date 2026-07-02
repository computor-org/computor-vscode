import * as vscode from 'vscode';
import { showErrorWithSeverity } from '../utils/errorDisplay';

export type CommandHandler = (...args: any[]) => any;

/**
 * Returns a function that registers a VS Code command and pushes the
 * resulting disposable onto `context.subscriptions`. Intended for
 * `*Commands` classes so each call site is `register(id, handler)`
 * instead of `this.context.subscriptions.push(vscode.commands.registerCommand(id, handler))`.
 *
 * Every handler is wrapped in a safety net: uncaught errors are logged and
 * surfaced via the error catalog (showErrorWithSeverity) instead of
 * disappearing into the extension host log. Handlers may still catch their
 * own errors for command-specific messaging.
 */
export function commandRegistrar(context: vscode.ExtensionContext): (id: string, handler: CommandHandler) => void {
  return (id, handler) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, async (...args: any[]) => {
      try {
        return await handler(...args);
      } catch (error) {
        console.error(`[command:${id}] Unhandled error:`, error);
        showErrorWithSeverity(error instanceof Error ? error : new Error(String(error)));
      }
    }));
  };
}
