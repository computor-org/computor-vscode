import * as vscode from 'vscode';

export type CommandHandler = (...args: any[]) => any;

/**
 * Returns a function that registers a VS Code command and pushes the
 * resulting disposable onto `context.subscriptions`. Intended for
 * `*Commands` classes so each call site is `register(id, handler)`
 * instead of `this.context.subscriptions.push(vscode.commands.registerCommand(id, handler))`.
 */
export function commandRegistrar(context: vscode.ExtensionContext): (id: string, handler: CommandHandler) => void {
  return (id, handler) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };
}
