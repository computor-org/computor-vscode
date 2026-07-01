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
            node.setAttribute(attr, value[attr]);
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
    escapeHtml: escapeHtml,
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
