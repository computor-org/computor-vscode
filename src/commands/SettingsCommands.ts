import * as vscode from 'vscode';
import { SettingsFocus, SettingsWebviewProvider } from '../ui/webviews/SettingsWebviewProvider';
import { commandRegistrar } from './commandHelpers';
import { notify } from '../utils/notify';

export class SettingsCommands {
  private settingsWebviewProvider: SettingsWebviewProvider;

  constructor(private context: vscode.ExtensionContext) {
    this.settingsWebviewProvider = new SettingsWebviewProvider(context);
  }

  register(): void {

    const register = commandRegistrar(this.context);
    // The optional argument is a deep link: a credential notification passes the
    // realm whose token was rejected so the view opens on that entry rather than
    // its root (computor-org/issues#247). Menu/palette invocations pass nothing.
    register('computor.settingsView', (focus?: SettingsFocus) => this.openSettings(focus));
  }

  private async openSettings(focus?: SettingsFocus): Promise<void> {
    try {
      await this.settingsWebviewProvider.open(focus);
    } catch (error: any) {
      notify.error(`Settings failed: ${error?.message || error}`);
      console.error('[SettingsCommands] Settings error:', error);
    }
  }
}
