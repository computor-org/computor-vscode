/*
 * Computor webview client runtime.
 *
 * Loaded before every per-view script. Exposes a single global,
 * `window.ComputorWebview`, that owns the VS Code API handle, the message
 * protocol and the helpers every view used to copy-paste.
 *
 * Message protocol (both directions): { command: string, data?: any }.
 * Views register inbound handlers with `onCommand` and send with `post`.
 */
(function () {
  'use strict';

  // acquireVsCodeApi() throws if called twice, so the handle is cached on
  // window for any legacy script that still acquires it directly.
  const vscode = window.vscodeApi || acquireVsCodeApi();
  window.vscodeApi = vscode;

  /** Send a message to the extension host. */
  function post(command, data) {
    vscode.postMessage({ command: command, data: data });
  }

  const commandHandlers = new Map();

  /** Register a handler for an inbound { command, data } message. */
  function onCommand(command, handler) {
    commandHandlers.set(command, handler);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message.command !== 'string') {
      return;
    }
    const handler = commandHandlers.get(message.command);
    if (handler) {
      handler(message.data, message);
    }
  });

  const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  /** Escape a value for safe interpolation into HTML. */
  function escapeHtml(value) {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    return String(value).replace(/[&<>"']/g, (m) => HTML_ESCAPE_MAP[m]);
  }

  // Allow-list sanitizer for HTML produced by a markdown renderer over
  // untrusted text (chat/comment bodies). The webview CSP already blocks script
  // execution and inline handlers, but raw HTML embedded in the source can still
  // inject styled/phishing markup and image beacons, so drop anything outside
  // this list. Tags not listed are removed entirely; unlisted attributes are
  // stripped; javascript:/vbscript:/data: URLs are rejected.
  const SANITIZE_ALLOWED_TAGS = {
    A: 1, ABBR: 1, B: 1, BLOCKQUOTE: 1, BR: 1, CODE: 1, DD: 1, DEL: 1, DIV: 1,
    DL: 1, DT: 1, EM: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, HR: 1, I: 1,
    IMG: 1, LI: 1, OL: 1, P: 1, PRE: 1, S: 1, SPAN: 1, STRONG: 1, SUB: 1, SUP: 1,
    TABLE: 1, TBODY: 1, TD: 1, TH: 1, THEAD: 1, TR: 1, UL: 1
  };
  const SANITIZE_GLOBAL_ATTRS = { class: 1, title: 1 };
  const SANITIZE_TAG_ATTRS = {
    A: { href: 1 },
    IMG: { src: 1, alt: 1 },
    OL: { start: 1 },
    TD: { align: 1 },
    TH: { align: 1 },
    SPAN: { 'data-tooltip': 1 }
  };

  function isSafeUrl(value) {
    // Strip control chars / whitespace before testing the scheme so tricks like
    // "java\tscript:" can't slip through.
    const v = String(value == null ? '' : value).replace(/[\u0000-\u0020]+/g, '').toLowerCase();
    return !/^(javascript|vbscript|data):/.test(v);
  }

  function sanitizeHtml(html) {
    // A <template>'s content is parsed into an inert document: scripts don't run
    // and images don't load while we scrub it.
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html == null ? '' : html);
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT, null);
    const doomed = [];
    let node = walker.nextNode();
    while (node) {
      const tag = node.tagName;
      if (!SANITIZE_ALLOWED_TAGS[tag]) {
        doomed.push(node);
      } else {
        const tagAttrs = SANITIZE_TAG_ATTRS[tag] || {};
        // Slice: removeAttribute mutates the live attributes collection.
        Array.prototype.slice.call(node.attributes).forEach((attr) => {
          const name = attr.name.toLowerCase();
          const allowed = SANITIZE_GLOBAL_ATTRS[name] || tagAttrs[name];
          if (!allowed) {
            node.removeAttribute(attr.name);
          } else if ((name === 'href' || name === 'src') && !isSafeUrl(attr.value)) {
            node.removeAttribute(attr.name);
          }
        });
      }
      node = walker.nextNode();
    }
    // Parent precedes child in document order, so removing a parent first
    // detaches its children; remove() on an already-detached node is a no-op.
    doomed.forEach((el) => el.remove());
    return tpl.innerHTML;
  }

  /** Format an ISO date string as a local date, or '' if absent/invalid. */
  function formatDate(value, options) {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString(undefined, options);
  }

  /** Format an ISO date string as local date + time, or '' if absent/invalid. */
  function formatDateTime(value) {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleString();
  }

  /** Human relative date: "today", "3 days ago", falls back to formatDate. */
  function formatRelativeDate(value) {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return '';
    }
    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (days <= 0) {
      return 'today';
    }
    if (days === 1) {
      return 'yesterday';
    }
    if (days < 30) {
      return days + ' days ago';
    }
    return date.toLocaleDateString();
  }

  /**
   * Create a DOM element.
   * el('div', { className: 'row', dataset: { id: '1' }, onclick: fn }, [child, 'text'])
   */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const key of Object.keys(props)) {
        const value = props[key];
        if (value === null || value === undefined) {
          continue;
        }
        if (key === 'dataset') {
          Object.assign(node.dataset, value);
        } else if (key === 'attributes') {
          for (const attr of Object.keys(value)) {
            if (value[attr] !== null && value[attr] !== undefined) {
              node.setAttribute(attr, value[attr]);
            }
          }
        } else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key in node) {
          node[key] = value;
        } else {
          node.setAttribute(key, value);
        }
      }
    }
    if (children !== null && children !== undefined) {
      const list = Array.isArray(children) ? children : [children];
      for (const child of list) {
        if (child === null || child === undefined) {
          continue;
        }
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      }
    }
    return node;
  }

  /**
   * Minimal reactive store: createStore(initial, render) returns
   * { state, setState }. setState patches the state and re-renders.
   * `initial` defaults to window.__INITIAL_STATE__ when omitted.
   */
  function createStore(initial, render) {
    const state = Object.assign({}, initial !== undefined ? initial : window.__INITIAL_STATE__ || {});
    function setState(patch) {
      Object.assign(state, patch);
      render(state);
    }
    return { state: state, setState: setState };
  }

  /** Toggle the shared full-page loading overlay (element id "loadingOverlay"). */
  function setLoading(loading) {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.classList.toggle('hidden', !loading);
      overlay.classList.toggle('loading-overlay--hidden', !loading);
    }
  }

  /**
   * Wire generic tabs: buttons with [data-tab] inside `container` toggle
   * .active on themselves and on matching [data-tab-panel] elements.
   */
  function initTabs(container, onChange) {
    const root = container || document;
    const tabs = Array.from(root.querySelectorAll('[data-tab]'));
    function activate(name) {
      for (const tab of tabs) {
        tab.classList.toggle('active', tab.dataset.tab === name);
      }
      for (const panel of root.querySelectorAll('[data-tab-panel]')) {
        panel.classList.toggle('active', panel.dataset.tabPanel === name);
      }
      if (onChange) {
        onChange(name);
      }
    }
    for (const tab of tabs) {
      tab.addEventListener('click', () => activate(tab.dataset.tab));
    }
    return activate;
  }

  /*
   * Generic button wiring. The CSP forbids inline onclick= handlers, so
   * pages mark buttons with data-action="name" and register handlers via
   * registerActions({ name: (dataset, element) => ... }).
   */
  const actions = Object.create(null);

  function registerActions(map) {
    Object.assign(actions, map);
  }

  document.addEventListener('click', (event) => {
    const target = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!target) {
      return;
    }
    const handler = actions[target.dataset.action];
    if (handler) {
      handler(target.dataset, target);
    }
  });

  /** Debounce a function; trailing edge, default 200ms. */
  function debounce(fn, waitMs) {
    let timer;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), waitMs || 200);
    };
  }

  window.ComputorWebview = {
    vscode: vscode,
    post: post,
    onCommand: onCommand,
    registerActions: registerActions,
    escapeHtml: escapeHtml,
    sanitizeHtml: sanitizeHtml,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    formatRelativeDate: formatRelativeDate,
    el: el,
    createStore: createStore,
    setLoading: setLoading,
    initTabs: initTabs,
    debounce: debounce
  };
})();
