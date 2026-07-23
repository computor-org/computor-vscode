/*
 * @-mention autocomplete helpers for the message composer.
 *
 * Loaded after base.js and before messages-input.js; exposes
 * `window.ComputorWebview.mention`. The functions here are pure (no DOM) so
 * they can be unit-tested via CommonJS.
 *
 * Why this exists as its own module: the original trigger regex was `\w`-based
 * (`/(^|\s)@([\w.\-]*)$/`). `\w` is ASCII-only, so the moment a user typed a
 * non-ASCII letter — an umlaut or accent, ubiquitous in German/Austrian names
 * like Müller, Grün, Schäfer, Weiß — the regex stopped matching, getMentionContext
 * returned null, and the autocomplete dropdown silently closed (issue #278).
 * The trigger and the name matcher are now Unicode- and diacritic-aware.
 */
(function (global, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.ComputorWebview = global.ComputorWebview || {};
    global.ComputorWebview.mention = api;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Word characters allowed inside a mention query: any Unicode letter or
  // number, plus '.', '_' and '-' (which appear in usernames). Unicode-aware
  // via \p{L}/\p{N} and the `u` flag — the ASCII `\w` this replaced dropped
  // the dropdown on the first umlaut (issue #278).
  const TRIGGER_RE = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u;

  /**
   * Given the text immediately before the caret, decide whether the caret sits
   * in an active "@query" mention context. Returns `{ query }` (query may be an
   * empty string, right after typing '@') or null when there is no trigger.
   *
   * The '@' must start the string or follow whitespace, so email-like
   * "foo@bar" never triggers.
   */
  function matchMentionTrigger(before) {
    const m = TRIGGER_RE.exec(String(before || ''));
    if (!m) {
      return null;
    }
    return { query: m[1] };
  }

  /** Display name for a mention candidate: "Given Family", or 'user'. */
  function formatMentionName(u) {
    if (!u) {
      return 'user';
    }
    const n = [u.given_name, u.family_name].filter(Boolean).join(' ').trim();
    return n || 'user';
  }

  // Lower-case and strip diacritics so "muller" matches "Müller" and vice
  // versa. NFD splits an accented letter into base + combining mark, which the
  // U+0300–U+036F (combining diacritical marks) range then removes. German ß
  // has no NFD decomposition, so fold it to "ss" explicitly (Weiß ↔ weiss).
  function foldName(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ß/g, 'ss')
      .toLowerCase();
  }

  /**
   * Whether candidate `u` matches the typed query `q`. Empty query matches
   * everything. Matching is diacritic-insensitive on both sides: a substring
   * match on the full name, or a prefix match on either name part.
   */
  function mentionMatches(u, q) {
    if (!q) {
      return true;
    }
    const needle = foldName(q);
    if (!needle) {
      return true;
    }
    const full = foldName(formatMentionName(u));
    return (
      full.includes(needle) ||
      foldName(u && u.given_name).startsWith(needle) ||
      foldName(u && u.family_name).startsWith(needle)
    );
  }

  return {
    matchMentionTrigger: matchMentionTrigger,
    formatMentionName: formatMentionName,
    mentionMatches: mentionMatches,
    foldName: foldName
  };
});
