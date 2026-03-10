import * as vscode from 'vscode';
import { SettingsWebviewProvider } from '../ui/webviews/SettingsWebviewProvider';
import { ComputorApiService } from '../services/ComputorApiService';

export class SettingsCommands {
  private settingsWebviewProvider: SettingsWebviewProvider;

  constructor(private context: vscode.ExtensionContext, apiService?: ComputorApiService) {
    this.settingsWebviewProvider = new SettingsWebviewProvider(context, apiService);
  }

  register(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.settingsView', () => this.openSettings())
    );
  }

  setApiService(apiService: ComputorApiService): void {
    this.settingsWebviewProvider.setApiService(apiService);
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
