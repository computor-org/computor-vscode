import { LanguageAccount, setUiAccount } from '../utils/uiLanguage';

interface UiLanguageSyncOptions {
  fetchAccount(options: { force: boolean }): Promise<LanguageAccount | undefined>;
  /** Least time between two reads on window focus. */
  focusIntervalMs?: number;
  now?: () => number;
}

/**
 * Keeps the reading language in step with the account. A profile change on
 * the web arrives as `user:profile_updated`; returning to the window reads the
 * account again in case that event was missed. Views follow through
 * onDidChangeUiLanguage, so no window reload is needed.
 */
export class UiLanguageSync {
  private pending?: Promise<void>;
  private again?: Promise<void>;
  private lastRead = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: UiLanguageSyncOptions) {}

  /** Read the account (bypassing the cache when `force`) and apply its language. */
  refresh(force = true): Promise<void> {
    if (this.pending) {
      // A read already under way may have started before the change.
      if (!force) return this.pending;
      this.again ??= this.pending.then(() => { this.again = undefined; return this.refresh(true); });
      return this.again;
    }
    this.lastRead = this.now();
    const pending = this.options.fetchAccount({ force })
      .then(account => setUiAccount(account))
      .catch(error => console.warn('[UiLanguageSync] Could not read the account language:', error))
      .finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  }

  /** On window focus, at most once per interval. */
  refreshOnFocus(): Promise<void> {
    if (this.now() - this.lastRead < (this.options.focusIntervalMs ?? 30000)) return this.pending ?? Promise.resolve();
    return this.refresh(true);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
