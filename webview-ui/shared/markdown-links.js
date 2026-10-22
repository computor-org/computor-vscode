/*
 * Link clicks inside the markdown preview webview.
 *
 * Loaded after base.js by the markdown preview. Exposes
 * `window.ComputorWebview.handleMarkdownLinkClick` and
 * `window.ComputorWebview.scrollToFragment`.
 *
 * A link to another document (the help pages link to each other) must open
 * in the preview, through the extension host. Calling preventDefault() is not
 * enough for that: VS Code's own webview host listens for clicks on the
 * frame's window, ignores defaultPrevented, and posts every anchor's resolved
 * href as 'did-click-link'. A relative href resolves against the webview's
 * own origin, which on code-server is an https URL, so VS Code opened it in a
 * new browser tab that shows "Not found" (computor-org/issues#325). Links we
 * handle therefore stop propagating before they reach that listener; real
 * URLs are left to VS Code, which opens them externally.
 *
 * Also consumed by the unit tests via CommonJS (no DOM required).
 */
(function (global, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.ComputorWebview = global.ComputorWebview || {};
    global.ComputorWebview.handleMarkdownLinkClick = api.handleMarkdownLinkClick;
    global.ComputorWebview.scrollToFragment = api.scrollToFragment;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function isExternal(href) {
    const lower = href.toLowerCase();
    return lower.indexOf('http:') === 0 || lower.indexOf('https:') === 0
      || lower.indexOf('mailto:') === 0 || lower.indexOf('command:') === 0
      || lower.indexOf('data:') === 0 || href.indexOf('//') === 0 || href.indexOf('vscode-') === 0;
  }

  /** Scrolls to the heading a `#fragment` names; true when one was found. */
  function scrollToFragment(doc, fragment) {
    let id = String(fragment || '');
    if (id.charAt(0) === '#') id = id.slice(1);
    if (!id) return false;
    let decoded = id;
    try { decoded = decodeURIComponent(id); } catch (e) { /* keep the raw id */ }
    const heading = doc.getElementById(decoded) || doc.getElementById(id);
    if (heading && heading.scrollIntoView) {
      heading.scrollIntoView({ block: 'start' });
      return true;
    }
    return false;
  }

  /**
   * Click handler for the rendered markdown. `postMessage` sends to the
   * extension host. Returns what it did, for the tests: 'anchor', 'document',
   * or undefined when the click is left to VS Code.
   */
  function handleMarkdownLinkClick(event, doc, postMessage) {
    const start = event && event.target;
    const anchor = start && start.closest ? start.closest('a[href]') : null;
    if (!anchor) return undefined;
    const href = anchor.getAttribute('href') || '';
    if (!href || isExternal(href)) return undefined;

    event.preventDefault();
    event.stopPropagation();

    // Table-of-contents links: the webview has no navigable location, so
    // scroll to the heading ourselves.
    if (href.charAt(0) === '#') {
      scrollToFragment(doc, href);
      return 'anchor';
    }

    postMessage({ command: 'openRelativeDocument', href: href });
    return 'document';
  }

  return { handleMarkdownLinkClick, scrollToFragment, isExternal };
});
