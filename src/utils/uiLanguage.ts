import * as vscode from 'vscode';

/**
 * The reading language of everything the extension writes or picks: tree
 * rows, the Results panel, the status bar, notifications, the welcome page and
 * which language section of a course text is shown. One rule, as on the web:
 * the learner's profile language, else the language the backend resolved for
 * this client (`effective_language`), else the VS Code display language. A
 * course's own language is never the reading language; it only matters as a
 * fallback for a text that has no version in the reading language.
 *
 * Command titles and view names are static (package.nls*.json) and follow
 * only the VS Code display language.
 */

export type UiLanguage = 'de' | 'en';

let profileLanguage: string | undefined;
let effectiveLanguage: string | undefined;
let launchLanguage: UiLanguage | undefined;
const listeners = new Set<(language: UiLanguage) => void>();

function supported(code: string | null | undefined): UiLanguage | undefined {
  const language = code?.trim().toLowerCase().split(/[-_]/)[0];
  return language === 'de' || language === 'en' ? language : undefined;
}

/** The VS Code display language as a reading language: German stays German, anything else reads English. */
export function displayLanguage(display: string | null | undefined = vscode.env?.language): UiLanguage {
  return supported(display) === 'de' ? 'de' : 'en';
}

export function pickUiLanguage(
  profile?: string | null, effective?: string | null, display?: string | null
): UiLanguage {
  return supported(profile) ?? supported(effective) ?? displayLanguage(display);
}

/** What GET /user says about the reading language. */
export interface LanguageAccount {
  profile?: { language_code?: string | null } | null;
  effective_language?: string | null;
}

/**
 * The reading language for an account just fetched, or the current one when
 * the account could not be read. A hosted workspace's launch carries the web
 * app's resolved language for the browser, which outranks the one the
 * backend derived from the workspace's own display language.
 */
export function accountLanguage(account: LanguageAccount | null | undefined): UiLanguage {
  if (!account) return uiLanguage();
  return pickUiLanguage(account.profile?.language_code, launchLanguage ?? account.effective_language, vscode.env?.language);
}

/**
 * The language this client stands for when the profile is Automatic: the
 * hosted launch's browser language, else the VS Code display language. Sent
 * as Accept-Language; the backend puts the profile language first itself.
 * The resolved language would feed an earlier profile choice back as the
 * browser's after a switch to Automatic.
 */
export function automaticLanguage(): UiLanguage {
  return launchLanguage ?? displayLanguage();
}

export function uiLanguage(): UiLanguage {
  return pickUiLanguage(profileLanguage, launchLanguage ?? effectiveLanguage, vscode.env?.language);
}

function update(change: () => void): void {
  const before = uiLanguage();
  change();
  const after = uiLanguage();
  if (after === before) return;
  for (const listener of [...listeners]) {
    try {
      listener(after);
    } catch (error) {
      console.warn('[uiLanguage] A language listener failed:', error);
    }
  }
}

export function setUiProfileLanguage(code: string | null | undefined): void {
  update(() => { profileLanguage = code?.trim() || undefined; });
}

/** Profile and backend-resolved language together, so one change notifies once. */
export function setUiAccount(account: LanguageAccount | null | undefined): void {
  if (!account) return;
  update(() => {
    profileLanguage = account.profile?.language_code?.trim() || undefined;
    effectiveLanguage = account.effective_language?.trim() || undefined;
  });
}

/** Set only by the managed workspace locale service, for this activation. */
export function setWorkspaceLaunchLanguage(language: UiLanguage | undefined): void {
  update(() => { launchLanguage = language; });
}

/** Called with the new language whenever {@link uiLanguage} changes. */
export function onDidChangeUiLanguage(listener: (language: UiLanguage) => void): { dispose(): void } {
  listeners.add(listener);
  return { dispose: () => { listeners.delete(listener); } };
}

/** The English or the German text, by {@link uiLanguage}. */
export function say(en: string, de: string): string {
  return uiLanguage() === 'de' ? de : en;
}

/**
 * A failure message whose raw cause (often an English server or Git text) is
 * kept apart: "Failed to save: <cause>" in English, "<German lead>. Details:
 * <cause>" in German, so the German reader gets a whole sentence first.
 * Both leads are given without a closing full stop.
 */
export function sayFailed(en: string, de: string, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : cause === null || cause === undefined ? '' : String(cause);
  if (!detail.trim()) return say(`${en}.`, `${de}.`);
  return say(`${en}: ${detail}`, `${de}. Details: ${detail}`);
}

/**
 * The locale for dates and numbers in the extension's own text: the VS Code
 * display locale when it is in the UI language (so "en-GB" keeps its order),
 * otherwise the UI language itself. `toLocaleString()` without a locale used
 * the host's, which put "10/26/2026, 12:32:09 AM" beside German text.
 */
export function uiLocale(): string {
  const language = uiLanguage();
  const display = vscode.env?.language?.trim();
  return display && display.toLowerCase().split(/[-_]/)[0] === language ? display : language;
}

/** A date and time in {@link uiLocale}, e.g. "26.10.2026, 00:32:09". */
export function formatUiDateTime(date: Date): string {
  return date.toLocaleString(uiLocale());
}
