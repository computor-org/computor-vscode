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
  UserUpdate
} from '../../types/generated';
import { notify } from '../../utils/notify';

interface UserProfileViewState {
  user?: UserGet;
  profile?: ProfileGet | null;
  studentProfiles: StudentProfileGet[];
  languages: LanguageList[];
  organizations: any[];
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
      notify.error(`Failed to open profile: ${error?.message || error}`);
    }
  }

  protected async getWebviewContent(data?: UserProfileViewState): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Profile', '<p>Loading…</p>');
    }

    return this.renderPage({
      title: 'My Profile',
      bodyHtml: '<div id="app" class="profile-root"></div>',
      cssFiles: ['user-profile.css'],
      scriptFiles: ['user-profile.js'],
      initialState: data ?? {}
    });
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

    return {
      user: user ?? undefined,
      profile: user?.profile ?? null,
      studentProfiles: studentProfiles ?? [],
      languages: languages ?? [],
      organizations: organizations ?? []
    };
  }

  private async refreshState(options?: { force?: boolean; notice?: NoticeMessage }): Promise<void> {
    if (!this.panel) {
      return;
    }
    try {
      const state = await this.loadState({ force: options?.force });
      this.currentData = state;
      this.panel.webview.postMessage({ command: 'updateState', data: state });
      if (options?.notice) { this.postNotice(options.notice); }
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

  private handleError(prefix: string, error: any): void {
    const detail = error?.message || error?.response?.data?.detail || error?.response?.data?.message || String(error);
    console.error(`[UserProfileWebview] ${prefix}:`, error);
    notify.error(`${prefix}: ${detail}`);
    this.postNotice({ type: 'error', message: `${prefix}: ${detail}` });
  }

  // Route in-page feedback through the unified native-notification helper
  // instead of an in-webview banner. Client-side inline validation remains in
  // the webview.
  private postNotice(notice: NoticeMessage): void {
    if (notice.type === 'error') { notify.error(notice.message); }
    else if (notice.type === 'warning') { notify.warning(notice.message); }
    else { notify.info(notice.message); }
  }
}
