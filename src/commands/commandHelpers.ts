import * as vscode from 'vscode';
import { CredentialRecoveryService } from '../services/CredentialRecoveryService';
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
 *
 * A dead credential is pulled out of that generic path first: it gets its own
 * message and a deep link to the token entry that fixes it, and this is the one
 * place that knows both the command id and its arguments, so it is where the
 * interrupted action is captured for retry (computor-org/issues#247).
 */
export function commandRegistrar(context: vscode.ExtensionContext): (id: string, handler: CommandHandler) => void {
  return (id, handler) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, async (...args: any[]) => {
      try {
        return await handler(...args);
      } catch (error) {
        console.error(`[command:${id}] Unhandled error:`, error);
        if (await CredentialRecoveryService.getInstance().handleCommandFailure(id, args, error)) {
          return;
        }
        showErrorWithSeverity(error instanceof Error ? error : new Error(String(error)));
      }
    }));
  };
}
