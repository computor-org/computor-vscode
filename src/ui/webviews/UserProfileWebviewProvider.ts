import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { ComputorApiService } from '../../services/ComputorApiService';
import {
  ProfileGet,
  ProfileCreate,
  ProfileUpdate,
  LanguageList,
  StudentProfileGet,
  StudentProfileUpdate,
  UserGet,
  UserPassword,
  UserUpdate
} from '../../types/generated';

interface UserProfileViewState {
  user?: UserGet;
  profile?: ProfileGet | null;
  studentProfiles: StudentProfileGet[];
  languages: LanguageList[];
  organizations: any[];
  canChangePassword: boolean;
  username?: string;
}

type NoticeType = 'info' | 'success' | 'warning' | 'error';

interface NoticeMessage {
  type: NoticeType;
  message: string;
}

export class UserProfileWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService) {
    super(context, 'computor.user.profileView');
    this.apiService = apiService;
  }

  setApiService(apiService: ComputorApiService): void {
    this.apiService = apiService;
  }

  async open(): Promise<void> {
    try {
      const state = await this.loadState();
      await this.show('My Profile', state);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open profile: ${error?.message || error}`);
    }
  }

  protected async getWebviewContent(data?: UserProfileViewState): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Profile', '<p>Loading…</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data ?? {});
    const componentsCssUri = this.getWebviewUri(webview, 'webview-ui', 'components', 'components.css');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'user-profile.css');
    const componentsJsUri = this.getWebviewUri(webview, 'webview-ui', 'components.js');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'user-profile.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>My Profile</title>
      <link rel="stylesheet" href="${componentsCssUri}">
      <link rel="stylesheet" href="${stylesUri}">
    </head>
    <body>
      <div id="app" class="profile-root"></div>
      <script nonce="${nonce}">
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${nonce}" src="${componentsJsUri}"></script>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }

  protected async handleMessage(message: any): Promise<void> {
    if (!message) {
      return;
    }

    switch (message.command) {
      case 'refresh':
        await this.refreshState({ force: true });
        break;
      case 'saveUser':
        await this.handleSaveUser(message.data);
        break;
      case 'saveProfile':
        await this.handleSaveProfile(message.data);
        break;
      case 'saveStudentProfile':
        await this.handleSaveStudentProfile(message.data);
        break;
      case 'changePassword':
        await this.handleChangePassword(message.data);
        break;
      default:
        break;
    }
  }

  private async loadState(options?: { force?: boolean }): Promise<UserProfileViewState> {
    const [user, languages, organizations] = await Promise.all([
      this.apiService.getUserAccount(options),
      this.apiService.getLanguages(options),
      this.apiService.getOrganizations()
    ]);

    const studentProfiles = user?.id
      ? await this.apiService.getStudentProfiles({ user_id: user.id }, options)
      : [];

    let canChangePassword = false;
    let username: string | undefined;
    try {
      // Check if we have stored username (indicates password-based login)
      username = await this.context.secrets.get('computor.username');
      if (username) {
        canChangePassword = true;
      }
    } catch (error) {
      console.warn('[UserProfileWebview] Failed to inspect auth secrets:', error);
    }

    return {
      user: user ?? undefined,
      profile: user?.profile ?? null,
      studentProfiles: studentProfiles ?? [],
      languages: languages ?? [],
      organizations: organizations ?? [],
      canChangePassword,
      username
    };
  }

  private async refreshState(options?: { force?: boolean; notice?: NoticeMessage }): Promise<void> {
    if (!this.panel) {
      return;
    }
    try {
      const state = await this.loadState({ force: options?.force });
      this.currentData = state;
      this.panel.webview.postMessage({ command: 'updateState', data: state, notice: options?.notice });
    } catch (error: any) {
      this.handleError('Failed to refresh profile data', error);
    }
  }

  private async handleSaveUser(raw: any): Promise<void> {
    if (!raw || typeof raw !== 'object') {
      return;
    }

    const updates: UserUpdate = {
      given_name: raw.given_name ?? raw.givenName ?? undefined,
      family_name: raw.family_name ?? raw.familyName ?? undefined,
      email: raw.email ?? undefined,
      username: raw.username ?? undefined,
      properties: raw.properties ?? undefined
    };

    try {
      await this.apiService.updateUserAccount(updates);
      await this.refreshState({ force: true, notice: { type: 'success', message: 'Account details updated.' } });
    } catch (error: any) {
      this.handleError('Failed to update account details', error);
    }
  }

  private async handleSaveProfile(raw: any): Promise<void> {
    if (!raw || typeof raw !== 'object') {
      return;
    }

    const user = await this.apiService.getUserAccount();
    if (!user?.id) {
      this.handleError('Failed to save profile', new Error('User ID not found'));
      return;
    }

    const profile = user.profile;

    try {
      if (!profile?.id) {
        const payload: ProfileCreate = {
          user_id: user.id,
          nickname: raw.nickname ?? undefined,
          bio: raw.bio ?? undefined,
          url: raw.url ?? undefined,
          avatar_image: raw.avatar_image ?? raw.avatarImage ?? undefined,
          avatar_color: raw.avatar_color ?? raw.avatarColor ?? undefined,
          language_code: raw.language_code ?? undefined,
          properties: raw.properties ?? undefined
        };

        await this.apiService.createUserProfile(payload);
        await this.refreshState({ force: true, notice: { type: 'success', message: 'Profile created.' } });
      } else {
        const updates: ProfileUpdate = {
          nickname: raw.nickname ?? undefined,
          bio: raw.bio ?? undefined,
          url: raw.url ?? undefined,
          avatar_image: raw.avatar_image ?? raw.avatarImage ?? undefined,
          avatar_color: raw.avatar_color ?? raw.avatarColor ?? undefined,
          language_code: raw.language_code ?? undefined,
          properties: raw.properties ?? undefined
        };

        await this.apiService.updateUserProfile(profile.id, updates);
        await this.refreshState({ force: true, notice: { type: 'success', message: 'Profile updated.' } });
      }
    } catch (error: any) {
      this.handleError('Failed to save profile', error);
    }
  }

  private async handleSaveStudentProfile(raw: any): Promise<void> {
    if (!raw || typeof raw !== 'object') {
      return;
    }

    const updates: StudentProfileUpdate = {
      student_id: raw.student_id ?? raw.studentId ?? undefined,
      student_email: raw.student_email ?? raw.studentEmail ?? undefined,
      properties: raw.properties ?? undefined
    };

    try {
      if (raw.id) {
        await this.apiService.updateStudentProfile(String(raw.id), updates);
      } else {
        console.log(JSON.stringify(raw,null,2));
        const payload: any = {
          student_id: updates.student_id,
          student_email: updates.student_email,
          organization_id: raw.organization_id || undefined
        };
        await this.apiService.createStudentProfile(payload);
      }
      await this.refreshState({ force: true, notice: { type: 'success', message: 'Student profile saved.' } });
    } catch (error: any) {
      this.handleError('Failed to save student profile', error);
    }
  }

  private async handleChangePassword(raw: any): Promise<void> {
    if (!raw || typeof raw !== 'object') {
      return;
    }

    const currentPassword = typeof raw.currentPassword === 'string' ? raw.currentPassword : undefined;
    const newPassword = typeof raw.newPassword === 'string' ? raw.newPassword : undefined;
    const confirmPassword = typeof raw.confirmPassword === 'string' ? raw.confirmPassword : undefined;

    if (!currentPassword) {
      this.postNotice({ type: 'warning', message: 'Current password is required.' });
      return;
    }
    if (!newPassword) {
      this.postNotice({ type: 'warning', message: 'New password cannot be empty.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      this.postNotice({ type: 'warning', message: 'New password and confirmation do not match.' });
      return;
    }

    let username: string | undefined;
    try {
      username = await this.context.secrets.get('computor.username');
    } catch {
      username = undefined;
    }

    if (!username) {
      this.postNotice({ type: 'error', message: 'Password changes are only available for password-based authentication.' });
      return;
    }

    try {
      const payload: UserPassword = {
        password_old: currentPassword,
        password: newPassword
      };
      await this.apiService.updateUserPassword(payload);
      await this.updateStoredCredentials(username, newPassword);
      await this.refreshState({ notice: { type: 'success', message: 'Password updated successfully.' } });
    } catch (error: any) {
      this.handleError('Failed to update password', error);
    }
  }

  private async updateStoredCredentials(username: string, newPassword: string): Promise<void> {
    try {
      // Update stored username and password
      await this.context.secrets.store('computor.username', username);
      await this.context.secrets.store('computor.password', newPassword);

      // Note: We don't need to update the bearer token auth here
      // The user will need to re-login to get new tokens with the new password
      // The stored password is used for the login suggestion only
    } catch (error) {
      console.warn('Failed to persist updated credentials:', error);
    }
  }

  private handleError(prefix: string, error: any): void {
    const detail = error?.message || error?.response?.data?.detail || error?.response?.data?.message || String(error);
    console.error(`[UserProfileWebview] ${prefix}:`, error);
    vscode.window.showErrorMessage(`${prefix}: ${detail}`);
    this.postNotice({ type: 'error', message: `${prefix}: ${detail}` });
  }

  private postNotice(notice: NoticeMessage): void {
    if (this.panel) {
      this.panel.webview.postMessage({ command: 'notice', notice });
    }
  }
}
