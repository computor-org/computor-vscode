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
import { onDidChangeUiLanguage, say, sayFailed } from '../../utils/uiLanguage';

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
    // The language is often changed right here; the panel follows it at once.
    context.subscriptions?.push(onDidChangeUiLanguage(() => { void this.refreshLanguage(); }));
  }

  private async refreshLanguage(): Promise<void> {
    if (!this.panel) {
      return;
    }
    this.panel.title = say('My Profile', 'Mein Profil');
    this.panel.webview.html = await this.getWebviewContent(this.currentData);
  }

  setApiService(apiService: ComputorApiService): void {
    this.apiService = apiService;
  }

  async open(): Promise<void> {
    try {
      const state = await this.loadState();
      await this.show(say('My Profile', 'Mein Profil'), state);
    } catch (error: any) {
      notify.error(sayFailed(`Failed to open profile`, `Das Profil konnte nicht geöffnet werden`, error?.message || error));
    }
  }

  protected async getWebviewContent(data?: UserProfileViewState): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml(say('Profile', 'Profil'), `<p>${say('Loading…', 'Wird geladen …')}</p>`);
    }

    return this.renderPage({
      title: say('My Profile', 'Mein Profil'),
      bodyHtml: '<div id="app" class="page-root"></div>',
      cssFiles: ['admin/user-profile.css'],
      scriptFiles: ['admin/user-profile.js'],
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
      this.handleError(say('Failed to refresh profile data', 'Die Profildaten konnten nicht aktualisiert werden'), error);
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
      await this.refreshState({ force: true, notice: { type: 'success', message: say('Account details updated.', 'Die Kontodaten wurden aktualisiert.') } });
    } catch (error: any) {
      this.handleError(say('Failed to update account details', 'Die Kontodaten konnten nicht aktualisiert werden'), error);
    }
  }

  private async handleSaveProfile(raw: any): Promise<void> {
    if (!raw || typeof raw !== 'object') {
      return;
    }

    const user = await this.apiService.getUserAccount();
    if (!user?.id) {
      this.handleError(say('Failed to save profile', 'Das Profil konnte nicht gespeichert werden'), new Error('User ID not found'));
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
        await this.refreshState({ force: true, notice: { type: 'success', message: say('Profile created.', 'Das Profil wurde angelegt.') } });
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
        await this.refreshState({ force: true, notice: { type: 'success', message: say('Profile updated.', 'Das Profil wurde aktualisiert.') } });
      }
    } catch (error: any) {
      this.handleError(say('Failed to save profile', 'Das Profil konnte nicht gespeichert werden'), error);
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
      await this.refreshState({ force: true, notice: { type: 'success', message: say('Student profile saved.', 'Das Studierendenprofil wurde gespeichert.') } });
    } catch (error: any) {
      this.handleError(say('Failed to save student profile', 'Das Studierendenprofil konnte nicht gespeichert werden'), error);
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
