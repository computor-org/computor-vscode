import * as vscode from 'vscode';
import { SettingsWebviewProvider } from '../ui/webviews/SettingsWebviewProvider';
import { commandRegistrar } from './commandHelpers';

export class SettingsCommands {
  private settingsWebviewProvider: SettingsWebviewProvider;

  constructor(private context: vscode.ExtensionContext) {
    this.settingsWebviewProvider = new SettingsWebviewProvider(context);
  }

  register(): void {

    const register = commandRegistrar(this.context);
    register('computor.settingsView', () => this.openSettings());
  }

  private async openSettings(): Promise<void> {
    try {
      await this.settingsWebviewProvider.open();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Settings failed: ${error?.message || error}`);
      console.error('[SettingsCommands] Settings error:', error);
    }
  }
}
