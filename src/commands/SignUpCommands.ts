import * as vscode from 'vscode';
import { SignUpWebviewProvider } from '../ui/webviews/SignUpWebviewProvider';

export class SignUpCommands {
  private signUpWebviewProvider: SignUpWebviewProvider;

  constructor(private context: vscode.ExtensionContext) {
    this.signUpWebviewProvider = new SignUpWebviewProvider(context);
  }

  register(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.signUp', () => this.signUp())
    );
  }

  private async signUp(): Promise<void> {
    try {
      await this.signUpWebviewProvider.open();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Sign-up failed: ${error?.message || error}`);
      console.error('[SignUpCommands] Sign-up error:', error);
    }
  }
}
