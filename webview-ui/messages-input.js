(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();
  const { createButton, createInput } = window.UIComponents || {};

  const state = {
    target: undefined,
    replyTo: undefined,
    editingMessage: undefined,
    loading: false,
    activeTab: 'write', // 'write' or 'preview'
    messageContent: '',
    typingUsers: [] // { userId, userName }
  };

  const root = () => document.getElementById('app');

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  function escapeHtml(value) {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.className) {
      el.className = options.className;
    }
    if (options.textContent !== undefined) {
      el.textContent = options.textContent;
    }
    if (options.innerHTML !== undefined) {
      el.innerHTML = options.innerHTML;
    }
    if (options.attributes) {
      Object.entries(options.attributes).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          el.setAttribute(key, value);
        }
      });
    }
    if (options.children) {
      options.children.forEach((child) => {
        if (!child) return;
        if (typeof child === 'string') {
          el.appendChild(document.createTextNode(child));
        } else {
          el.appendChild(child);
        }
      });
    }
    return el;
  }

  function renderMarkdown(text) {
    if (typeof window.marked !== 'undefined' && window.marked.parse) {
      try {
        return window.marked.parse(text || '');
      } catch (e) {
        return escapeHtml(text);
      }
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  // ---- @-mention support ----
  const MENTION_TOKEN_RE = /@\[([^\]]*)\]\(([0-9a-fA-F-]{36})\)/g;

  function formatMentionName(u) {
    const n = [u.given_name, u.family_name].filter(Boolean).join(' ').trim();
    return n || 'user';
  }

  // Render content to HTML with @[name](uuid) tokens shown as highlighted chips
  // (the bracketed name is markdown-link syntax, so swap it out around marked()).
  function renderContentWithMentions(text) {
    const placeholders = [];
    const replaced = String(text || '').replace(MENTION_TOKEN_RE, (m, name, uuid) => {
      const idx = placeholders.length;
      placeholders.push(
        '<span class="mention-chip" title="' + escapeHtml(uuid.toLowerCase()) + '">@' +
        escapeHtml(name || 'user') + '</span>'
      );
      return '@@CTMENTION' + idx + '@@';
    });
    let html = renderMarkdown(replaced);
    placeholders.forEach((chip, idx) => {
      html = html.split('@@CTMENTION' + idx + '@@').join(chip);
    });
    return html;
  }

  // Imperative autocomplete state — kept out of `state`/render() so typing
  // doesn't rebuild the DOM and lose the caret.
  const mention = {
    users: [],     // candidate pool (prefetched audience + server search)
    open: false,
    query: '',
    start: -1,     // index of the triggering '@' in the textarea value
    items: [],     // filtered candidates currently displayed
    active: 0,
    dropdown: null,
    debounce: null
  };

  function mentionMatches(u, q) {
    if (!q) return true;
    const ql = q.toLowerCase();
    return formatMentionName(u).toLowerCase().includes(ql) ||
      String(u.given_name || '').toLowerCase().startsWith(ql) ||
      String(u.family_name || '').toLowerCase().startsWith(ql);
  }

  function closeMentionDropdown() {
    mention.open = false;
    mention.query = '';
    mention.start = -1;
    mention.items = [];
    mention.active = 0;
    if (mention.dropdown) { mention.dropdown.style.display = 'none'; }
  }

  function detectMentionQuery(textarea) {
    const caret = textarea.selectionStart;
    const before = textarea.value.slice(0, caret);
    // '@' at start or after whitespace, followed by name-ish chars (no spaces
    // so the query end is unambiguous — we match against name parts).
    const m = /(^|\s)@([\w.\-]*)$/.exec(before);
    if (!m) { return null; }
    return { query: m[2], start: caret - m[2].length - 1 };
  }

  function renderMentionDropdown() {
    const dd = mention.dropdown;
    if (!dd) { return; }
    dd.innerHTML = '';
    if (!mention.open || mention.items.length === 0) {
      dd.style.display = 'none';
      return;
    }
    mention.items.forEach((u, i) => {
      const item = createElement('div', {
        className: 'mention-item' + (i === mention.active ? ' active' : ''),
        textContent: formatMentionName(u)
      });
      item.addEventListener('mousedown', (e) => {
        // mousedown (not click) so the textarea keeps focus through selection
        e.preventDefault();
        selectMention(u);
      });
      dd.appendChild(item);
    });
    dd.style.display = 'block';
  }

  function updateMentionFilter() {
    mention.items = mention.users.filter((u) => mentionMatches(u, mention.query)).slice(0, 8);
    if (mention.active >= mention.items.length) { mention.active = 0; }
    renderMentionDropdown();
  }

  function onMentionInput(textarea) {
    const detected = detectMentionQuery(textarea);
    if (!detected) { closeMentionDropdown(); return; }
    mention.open = true;
    mention.query = detected.query;
    mention.start = detected.start;
    updateMentionFilter();
    // Refresh candidates from the server for large audiences (debounced).
    if (mention.debounce) { clearTimeout(mention.debounce); }
    const q = detected.query;
    mention.debounce = setTimeout(() => {
      vscode.postMessage({ command: 'fetchMentionable', data: { search: q } });
    }, 200);
  }

  function selectMention(u) {
    const textarea = document.getElementById('message-body');
    if (!textarea || mention.start < 0) { return; }
    const caret = textarea.selectionStart;
    const token = '@[' + formatMentionName(u) + '](' + u.id + ') ';
    const value = textarea.value;
    const next = value.slice(0, mention.start) + token + value.slice(caret);
    textarea.value = next;
    const pos = mention.start + token.length;
    textarea.setSelectionRange(pos, pos);
    state.messageContent = next;
    closeMentionDropdown();
    textarea.focus();
  }

  function onMentionKeydown(e) {
    if (!mention.open || mention.items.length === 0) { return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mention.active = (mention.active + 1) % mention.items.length;
      renderMentionDropdown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mention.active = (mention.active - 1 + mention.items.length) % mention.items.length;
      renderMentionDropdown();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      selectMention(mention.items[mention.active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMentionDropdown();
    }
  }

  function renderTypingIndicator(users) {
    const container = createElement('div', { className: 'typing-indicator' });

    // Animated dots
    const dots = createElement('span', { className: 'typing-dots' });
    dots.appendChild(createElement('span'));
    dots.appendChild(createElement('span'));
    dots.appendChild(createElement('span'));
    container.appendChild(dots);

    // Text
    let text = '';
    if (users.length === 1) {
      text = `${users[0].userName} is typing`;
    } else if (users.length === 2) {
      text = `${users[0].userName} and ${users[1].userName} are typing`;
    } else if (users.length > 2) {
      text = `${users[0].userName} and ${users.length - 1} others are typing`;
    }

    const textSpan = createElement('span', {
      className: 'typing-text',
      textContent: text
    });
    container.appendChild(textSpan);

    return container;
  }

  function render() {
    const mount = root();
    if (!mount) {
      console.log('[messages-input] render: mount element not found');
      return;
    }

    console.log('[messages-input] render called, state.target:', state.target);
    mount.innerHTML = '';

    if (!state.target) {
      console.log('[messages-input] render: No target, showing placeholder');
      const placeholder = createElement('div', {
        className: 'placeholder-state'
      });
      const icon = createElement('span', {
        className: 'placeholder-icon',
        textContent: '💬'
      });
      const text = createElement('span', {
        className: 'placeholder-text',
        textContent: 'No message view selected'
      });
      const hint = createElement('span', {
        className: 'placeholder-hint',
        textContent: 'Open a messages view from the sidebar to compose a message.'
      });
      placeholder.appendChild(icon);
      placeholder.appendChild(text);
      placeholder.appendChild(hint);
      mount.appendChild(placeholder);
      return;
    }

    const container = createElement('div', { className: 'input-container' });

    // Context header - only show when replying/editing or show target context
    if (state.replyTo || state.editingMessage || state.target?.title) {
      const header = createElement('div', { className: 'input-header' });

      if (state.replyTo) {
        const contextRow = createElement('div', { className: 'input-context-row' });
        const contextLabel = createElement('span', {
          className: 'input-context reply-context',
          innerHTML: `Replying to <strong>${escapeHtml(state.replyTo.title || 'message')}</strong>`
        });
        contextRow.appendChild(contextLabel);

        // Add close button to dismiss reply
        const closeBtn = createElement('button', {
          className: 'context-close-btn',
          innerHTML: '&#10005;',
          attributes: {
            type: 'button',
            title: 'Cancel reply'
          }
        });
        closeBtn.addEventListener('click', () => {
          // Update local state immediately for responsive UI
          setState({
            replyTo: undefined,
            editingMessage: undefined,
            messageContent: '',
            activeTab: 'write'
          });
          // Notify extension to sync state
          vscode.postMessage({ command: 'cancel' });
        });
        contextRow.appendChild(closeBtn);
        header.appendChild(contextRow);
      } else if (state.editingMessage) {
        const contextRow = createElement('div', { className: 'input-context-row' });
        const contextLabel = createElement('span', {
          className: 'input-context edit-context',
          innerHTML: `Editing <strong>${escapeHtml(state.editingMessage.title || 'message')}</strong>`
        });
        contextRow.appendChild(contextLabel);

        // Add close button to dismiss edit
        const closeBtn = createElement('button', {
          className: 'context-close-btn',
          innerHTML: '&#10005;',
          attributes: {
            type: 'button',
            title: 'Cancel edit'
          }
        });
        closeBtn.addEventListener('click', () => {
          // Update local state immediately for responsive UI
          setState({
            replyTo: undefined,
            editingMessage: undefined,
            messageContent: '',
            activeTab: 'write'
          });
          // Notify extension to sync state
          vscode.postMessage({ command: 'cancel' });
        });
        contextRow.appendChild(closeBtn);
        header.appendChild(contextRow);
      } else if (state.target?.title) {
        const contextLabel = createElement('span', {
          className: 'input-context',
          textContent: state.target.title
        });
        header.appendChild(contextLabel);
      }

      container.appendChild(header);
    }

    if (state.target.readOnly) {
      const notice = createElement('div', { className: 'read-only-notice' });
      const icon = createElement('span', {
        className: 'read-only-icon',
        textContent: '🔒'
      });
      const text = createElement('span', {
        className: 'read-only-text',
        textContent: state.target.readOnlyReason || 'You can read but not post messages here.'
      });
      notice.appendChild(icon);
      notice.appendChild(text);
      container.appendChild(notice);
      mount.appendChild(container);
      return;
    }

    const form = createElement('div', { className: 'input-form' });

    // Title row: subject input + send button
    const titleRow = createElement('div', { className: 'title-row' });

    let titleInput = null;
    if (createInput) {
      titleInput = createInput({
        placeholder: 'Subject (optional)',
        value: state.editingMessage ? state.editingMessage.title || '' : '',
        disabled: state.loading
      });
      const titleEl = titleInput.render();
      titleEl.id = 'message-title';
      titleEl.classList.add('chat-title-input');
      titleRow.appendChild(titleEl);
    } else {
      const inputEl = createElement('input', {
        className: 'vscode-input chat-title-input',
        attributes: {
          type: 'text',
          id: 'message-title',
          placeholder: 'Subject (optional)'
        }
      });
      inputEl.value = state.editingMessage ? state.editingMessage.title || '' : '';
      if (state.loading) {
        inputEl.disabled = true;
      }
      titleRow.appendChild(inputEl);
    }

    // Cancel button in title row (when replying/editing)
    if (createButton && (state.replyTo || state.editingMessage)) {
      const cancelButton = createButton({
        text: 'Cancel',
        variant: 'tertiary',
        size: 'sm',
        onClick: () => {
          setState({
            replyTo: undefined,
            editingMessage: undefined,
            messageContent: '',
            activeTab: 'write'
          });
          vscode.postMessage({ command: 'cancel' });
        }
      });
      const cancelEl = cancelButton.render();
      cancelEl.classList.add('cancel-btn');
      titleRow.appendChild(cancelEl);
    }

    // Send/Save button in title row
    if (createButton) {
      const sendButton = createElement('button', {
        className: `send-button ${state.loading ? 'loading' : ''} ${state.editingMessage ? 'save-mode' : ''}`,
        attributes: {
          type: 'button',
          disabled: state.loading ? 'disabled' : null,
          title: state.editingMessage ? 'Save changes' : 'Send message'
        }
      });

      const buttonText = createElement('span', {
        className: 'send-button-text',
        textContent: state.editingMessage ? 'Save' : 'Send'
      });
      sendButton.appendChild(buttonText);

      const buttonIcon = createElement('span', {
        className: 'send-button-icon',
        innerHTML: state.editingMessage ? '&#10003;' : '&#10148;'
      });
      sendButton.appendChild(buttonIcon);

      sendButton.addEventListener('click', () => {
        if (state.loading) return;

        const titleValue = titleInput ? titleInput.getValue() : document.getElementById('message-title')?.value || '';
        const textarea = document.getElementById('message-body');
        const contentValue = (textarea ? textarea.value : state.messageContent).trim();

        if (!contentValue) {
          vscode.postMessage({ command: 'showWarning', data: 'Message body is required.' });
          return;
        }

        setState({ loading: true });

        if (state.editingMessage) {
          vscode.postMessage({
            command: 'updateMessage',
            data: {
              messageId: state.editingMessage.id,
              title: titleValue.trim(),
              content: contentValue
            }
          });
        } else {
          vscode.postMessage({
            command: 'createMessage',
            data: {
              title: titleValue.trim(),
              content: contentValue,
              parent_id: state.replyTo ? state.replyTo.id : undefined
            }
          });
        }

        state.messageContent = '';
        state.activeTab = 'write';
      });

      titleRow.appendChild(sendButton);
    }

    form.appendChild(titleRow);

    // Markdown editor container with tabs
    const editorContainer = createElement('div', { className: 'markdown-editor' });

    // Tab bar
    const tabBar = createElement('div', { className: 'editor-tabs' });

    const writeTab = createElement('button', {
      className: `editor-tab ${state.activeTab === 'write' ? 'active' : ''}`,
      textContent: 'Write'
    });
    writeTab.addEventListener('click', () => {
      if (state.activeTab !== 'write') {
        setState({ activeTab: 'write' });
      }
    });

    const previewTab = createElement('button', {
      className: `editor-tab ${state.activeTab === 'preview' ? 'active' : ''}`,
      textContent: 'Preview'
    });
    previewTab.addEventListener('click', () => {
      if (state.activeTab !== 'preview') {
        // Save current textarea value before switching
        const textarea = document.getElementById('message-body');
        if (textarea) {
          state.messageContent = textarea.value;
        }
        setState({ activeTab: 'preview' });
      }
    });

    tabBar.appendChild(writeTab);
    tabBar.appendChild(previewTab);
    editorContainer.appendChild(tabBar);

    // Content area (textarea or preview)
    const contentArea = createElement('div', { className: 'editor-content' });

    if (state.activeTab === 'write') {
      const textarea = createElement('textarea', {
        className: 'vscode-input chat-textarea',
        attributes: {
          id: 'message-body',
          rows: '3',
          placeholder: 'Write your message… (Markdown supported, @ to mention)'
        }
      });
      // Use saved content or editing message content
      const initialValue = state.messageContent || (state.editingMessage ? state.editingMessage.content || '' : '');
      textarea.value = initialValue;
      if (state.loading) {
        textarea.disabled = true;
      }
      // Dropdown for @-mention autocomplete (normal flow, below the textarea).
      const mentionDropdown = createElement('div', { className: 'mention-dropdown' });
      mentionDropdown.style.display = 'none';
      mention.dropdown = mentionDropdown;
      mention.open = false;
      // Save content on input, notify typing, and drive @-mention autocomplete.
      textarea.addEventListener('input', (e) => {
        state.messageContent = e.target.value;
        // Send typing indicator
        vscode.postMessage({ command: 'typing' });
        onMentionInput(e.target);
      });
      textarea.addEventListener('keydown', onMentionKeydown);
      textarea.addEventListener('blur', () => setTimeout(closeMentionDropdown, 120));
      contentArea.appendChild(textarea);
      contentArea.appendChild(mentionDropdown);
    } else {
      // Preview mode
      const preview = createElement('div', { className: 'markdown-preview' });
      const contentToPreview = state.messageContent || (state.editingMessage ? state.editingMessage.content || '' : '');
      if (contentToPreview.trim()) {
        preview.innerHTML = `<div class="markdown-body">${renderContentWithMentions(contentToPreview)}</div>`;
      } else {
        preview.innerHTML = '<p class="preview-empty">Nothing to preview</p>';
      }
      contentArea.appendChild(preview);
    }

    editorContainer.appendChild(contentArea);
    form.appendChild(editorContainer);

    container.appendChild(form);

    // Footer: typing indicator or markdown hint
    const footer = createElement('div', { className: 'actions-bar' });

    if (state.typingUsers && state.typingUsers.length > 0) {
      const typingIndicator = renderTypingIndicator(state.typingUsers);
      footer.appendChild(typingIndicator);
    } else {
      const mdHint = createElement('span', {
        className: 'markdown-hint',
        textContent: 'Markdown supported'
      });
      footer.appendChild(mdHint);
    }

    container.appendChild(footer);
    mount.appendChild(container);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;

    switch (message.command) {
      case 'updateState':
        // Full reset: clear all transient state, then apply incoming data
        state.replyTo = undefined;
        state.editingMessage = undefined;
        state.messageContent = message.data?.editingMessage?.content || '';
        state.activeTab = 'write';
        state.typingUsers = [];
        setState(message.data || {});
        break;
      case 'setLoading':
        setState({ loading: Boolean(message.data?.loading) });
        break;
      case 'typingUpdate':
        console.log('[messages-input] Received typingUpdate:', message.data?.typingUsers);
        setState({ typingUsers: message.data?.typingUsers || [] });
        break;
      case 'mentionableUsers':
        mention.users = (message.data && message.data.users) || [];
        if (mention.open) { updateMentionFilter(); }
        break;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    render();
    // Signal to extension that webview is ready to receive state
    vscode.postMessage({ command: 'ready' });
  });
})();
