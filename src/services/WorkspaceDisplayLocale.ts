import * as fs from 'fs/promises';
import * as path from 'path';
import { applyEdits, modify, parse, ParseError } from 'jsonc-parser';
import type * as vscode from 'vscode';
import { validWorkspaceLaunchContext, WorkspaceLaunchContext } from './WorkspaceLaunchContextService';
import { setWorkspaceLaunchLanguage } from '../utils/contentLanguage';

const attemptKey = 'computor.workspaceDisplayLocale.reloadAttempt';
const launchLanguageKey = 'computor.workspaceDisplayLocale.launchLanguage';

/** Only the managed browser workspace owns this code-server display setting. */
export function workspaceLocaleFile(
  managed: string | undefined, browser: boolean, storage: { scheme: string; fsPath: string }
): string | undefined {
  if (managed !== 'true' || !browser || storage.scheme !== 'file') return undefined;
  const globalStorage = path.dirname(storage.fsPath);
  const user = path.dirname(globalStorage);
  if (path.basename(globalStorage) !== 'globalStorage' || path.basename(user) !== 'User') return undefined;
  return path.join(user, 'argv.json');
}

function supportedLocale(value: string | null | undefined): 'de' | 'en' | undefined {
  const language = value?.trim().toLowerCase().split(/[-_]/)[0];
  return language === 'de' || language === 'en' ? language : undefined;
}

/** Edit JSONC without losing unrelated settings, comments or trailing commas. */
export function withDisplayLocale(text: string, locale: 'de' | 'en'): string {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The code-server display settings are not a JSONC object.');
  }
  return applyEdits(text, modify(text, ['locale'], locale, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' }
  }));
}

interface LocaleOptions {
  argvFile: string;
  fetchLanguage(): Promise<string | null | undefined>;
  fetchLaunchContext?(): Promise<WorkspaceLaunchContext | null>;
  displayLanguage: string;
  state: Pick<vscode.Memento, 'get' | 'update'>;
  reload(): PromiseLike<unknown>;
  onLanguage?(language: string | null | undefined): void;
  intervalMs?: number;
}

/**
 * code-server 4.139.1 reads User/argv.json on each browser root request, before
 * cookies and Accept-Language. The workspace image supplies the German pack
 * and must not pass --locale (which would override this file).
 * See coder/code-server patches/display-language.diff at v4.139.1.
 */
export class WorkspaceDisplayLocale implements vscode.Disposable {
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private disposed = false;

  constructor(private readonly options: LocaleOptions) {}

  start(): void {
    if (this.timer || this.disposed) return;
    // Profile changes in the web app have no websocket event. Bypass the
    // account cache periodically, and let window focus request an earlier poll.
    this.timer = setInterval(() => { void this.poll(); }, this.options.intervalMs ?? 30000);
    void this.poll();
  }

  poll(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.pending) {
      this.pending = this.apply().finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }

  private async apply(): Promise<void> {
    try {
      const [language, launch] = await Promise.all([
        this.options.fetchLanguage(),
        this.options.fetchLaunchContext?.()
      ]);
      if (this.disposed) return;
      // A launch carries the web app's resolved UI language, without turning
      // Automatic into an explicit profile preference. Keep it beyond the
      // short-lived context so reloads and later profile changes use it too.
      if (launch && validWorkspaceLaunchContext(launch) && launch.ui_language
        && this.options.state.get(launchLanguageKey) !== launch.ui_language) {
        await this.options.state.update(launchLanguageKey, launch.ui_language);
      }
      if (this.disposed) return;
      const launchLanguage = supportedLocale(this.options.state.get<string>(launchLanguageKey));
      setWorkspaceLaunchLanguage(launchLanguage);
      const locale = supportedLocale(language) ?? launchLanguage;
      this.options.onLanguage?.(locale ?? language);
      // With no supported profile or launch language, retain the editor setting.
      if (!locale) return;
      let text: string;
      try {
        text = await fs.readFile(this.options.argvFile, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        text = '{}\n';
      }
      if (this.disposed) return;
      const updated = withDisplayLocale(text, locale);
      if (updated !== text) await fs.writeFile(this.options.argvFile, updated, 'utf8');
      if (this.disposed) return;
      if (supportedLocale(this.options.displayLanguage) === locale) {
        if (this.options.state.get(attemptKey) !== undefined) await this.options.state.update(attemptKey, undefined);
        return;
      }
      // Persist before reload: a missing pack or an overriding CLI flag must
      // not reload again on activation. A different preference can try again.
      if (this.options.state.get<string>(attemptKey) === locale) return;
      await this.options.state.update(attemptKey, locale);
      if (!this.disposed) await this.options.reload();
    } catch (error) {
      console.warn('[WorkspaceDisplayLocale] Could not apply display language:', error);
    }
  }

  dispose(): void {
    this.disposed = true;
    setWorkspaceLaunchLanguage(undefined);
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
