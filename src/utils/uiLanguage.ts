import * as vscode from 'vscode';
import { resolveContentLanguage } from './contentLanguage';

/**
 * The language of the extension's own text at run time: tree rows, the
 * Results panel, the status bar, notifications. It follows the same order as
 * the welcome page — the learner's profile language, then the language of the
 * course the workspace was launched for — and falls back to the VS Code
 * display language, so a German page never sits beside English rows that
 * Computor wrote itself.
 *
 * Command titles and view names are static (package.nls*.json) and follow
 * only the VS Code display language.
 */

let profileLanguage: string | undefined;
let courseLanguage: string | undefined;

export function setUiProfileLanguage(code: string | null | undefined): void {
  profileLanguage = code?.trim() || undefined;
}

export function setUiCourseLanguage(code: string | null | undefined): void {
  courseLanguage = code?.trim() || undefined;
}

export function pickUiLanguage(profile?: string | null, course?: string | null, display?: string | null): 'de' | 'en' {
  const language = resolveContentLanguage(profile, course || display);
  return language.startsWith('de') ? 'de' : 'en';
}

export function uiLanguage(): 'de' | 'en' {
  return pickUiLanguage(profileLanguage, courseLanguage, vscode.env?.language);
}

/** The English or the German text, by {@link uiLanguage}. */
export function say(en: string, de: string): string {
  return uiLanguage() === 'de' ? de : en;
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
