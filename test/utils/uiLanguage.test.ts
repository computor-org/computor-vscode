import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  accountLanguage,
  onDidChangeUiLanguage,
  setUiAccount,
  setUiProfileLanguage,
  setWorkspaceLaunchLanguage,
  uiLanguage
} from '../../src/utils/uiLanguage';
import { UiLanguageSync } from '../../src/services/UiLanguageSync';
import { ssoLoginUrl } from '../../src/authentication/SsoLoginService';

describe('reading language', () => {
  const env = vscode.env as { language: string };
  const display = env.language;

  afterEach(() => {
    setUiAccount({});
    setWorkspaceLaunchLanguage(undefined);
    env.language = display;
  });

  it('takes the profile, then the backend\'s effective language, then the VS Code display language', () => {
    env.language = 'de-AT';
    expect(uiLanguage()).to.equal('de');
    env.language = 'fr';
    expect(uiLanguage()).to.equal('en');
    setUiAccount({ effective_language: 'de' });
    expect(uiLanguage()).to.equal('de');
    setUiAccount({ profile: { language_code: 'en' }, effective_language: 'de' });
    expect(uiLanguage()).to.equal('en');
  });

  it('lets a hosted launch speak for the browser ahead of the backend\'s guess, never ahead of the profile', () => {
    setWorkspaceLaunchLanguage('de');
    expect(accountLanguage({ effective_language: 'en' })).to.equal('de');
    expect(accountLanguage({ profile: { language_code: 'en' }, effective_language: 'de' })).to.equal('en');
  });

  it('reads an account just fetched, and the current language when there is none', () => {
    setUiAccount({ profile: { language_code: 'de' } });
    expect(accountLanguage({ effective_language: 'en' })).to.equal('en');
    expect(accountLanguage(undefined)).to.equal('de');
  });

  it('tells listeners once per actual change', () => {
    const heard: string[] = [];
    const listener = onDidChangeUiLanguage(language => heard.push(language));
    try {
      setUiAccount({ profile: { language_code: 'de' }, effective_language: 'de' });
      setUiProfileLanguage('de');
      setUiAccount({ effective_language: 'en' });
    } finally {
      listener.dispose();
    }
    setUiProfileLanguage('de');
    expect(heard).to.deep.equal(['de', 'en']);
  });

  it('starts the sign-in in the reading language', () => {
    const url = new URL(ssoLoginUrl('https://computor.example/api/', 'http://127.0.0.1:4711/nonce', 'de'));
    expect(url.pathname).to.equal('/api/auth/keycloak/login');
    expect(url.searchParams.get('redirect_uri')).to.equal('http://127.0.0.1:4711/nonce');
    expect(url.searchParams.get('ui_locales')).to.equal('de');
  });
});

describe('UiLanguageSync', () => {
  afterEach(() => setUiAccount({}));

  it('re-reads the account past the cache and switches the language without a reload', async () => {
    let language: string | null = null;
    const reads: boolean[] = [];
    const sync = new UiLanguageSync({
      fetchAccount: async ({ force }) => { reads.push(force); return { profile: { language_code: language }, effective_language: 'en' }; }
    });
    const heard: string[] = [];
    const listener = onDidChangeUiLanguage(value => heard.push(value));
    try {
      await sync.refresh(false);
      language = 'de'; // changed on the web
      await sync.refresh(true);
    } finally {
      listener.dispose();
    }
    expect(reads).to.deep.equal([false, true]);
    expect(heard).to.deep.equal(['de']);
    expect(uiLanguage()).to.equal('de');
  });

  it('reads again after a read that was already under way when the profile changed', async () => {
    let language = 'en';
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    let reads = 0;
    const sync = new UiLanguageSync({
      fetchAccount: async () => {
        reads++;
        const seen = language;
        if (reads === 1) await gate;
        return { profile: { language_code: seen } };
      }
    });
    const first = sync.refresh(true);
    language = 'de';
    const second = sync.refresh(true);
    release();
    await Promise.all([first, second]);
    expect(reads).to.equal(2);
    expect(uiLanguage()).to.equal('de');
  });

  it('reads on window focus at most once per interval', async () => {
    let now = 0;
    let reads = 0;
    const sync = new UiLanguageSync({
      fetchAccount: async () => { reads++; return {}; },
      focusIntervalMs: 1000,
      now: () => now
    });
    await sync.refreshOnFocus();
    now = 500;
    await sync.refreshOnFocus();
    now = 1500;
    await sync.refreshOnFocus();
    expect(reads).to.equal(2);
  });
});
