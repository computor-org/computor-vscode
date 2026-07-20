(function () {
  // Shared runtime (base.js).
  const { vscode, escapeHtml, el, createStore } = window.ComputorWebview;
  const { createButton, createInput } = window.UIComponents || {};

  const { state, setState } = createStore({
    target: undefined,
    replyTo: undefined,
    editingMessage: undefined,
    loading: false,
    activeTab: 'write', // 'write' or 'preview'
    messageContent: '',
    typingUsers: [], // { userId, userName }
    showSubject: true // false for conversational scopes (chat) and replies
  }, render);

  const root = () => document.getElementById('app');

  // ComputorWebview.el with the legacy options shape: children live in the
  // options object and null/undefined attribute values mean "omit" (el would
  // stringify them via setAttribute, e.g. disabled: null must not disable).
  function createElement(tag, options = {}) {
    const { children, attributes, ...props } = options;
    if (attributes) {
      props.attributes = Object.fromEntries(
        Object.entries(attributes).filter(([, value]) => value !== undefined && value !== null)
      );
    }
    return el(tag, props, children);
  }

  function renderMarkdown(text) {
    if (typeof window.marked !== 'undefined' && window.marked.parse) {
      try {
        return window.ComputorWebview.sanitizeHtml(window.marked.parse(text || ''));
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
      // Preview mirrors the rendered message: no '@' prefix and no tooltip
      // (the visible name is all the compose side knows).
      const display = name || 'user';
      const idx = placeholders.length;
      placeholders.push('<span class="mention-chip">' + escapeHtml(display) + '</span>');
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

  // --- contenteditable editor (#message-body) ---
  // The body is a contenteditable div (not a textarea) so mentions render as
  // atomic chips with the uuid hidden in data-id, while the serialized wire
  // format stays @[Given Family](uuid).

  function createMentionChip(u) {
    const chip = document.createElement('span');
    chip.className = 'mention-chip';
    chip.setAttribute('contenteditable', 'false');
    chip.dataset.id = u.id;
    chip.textContent = '@' + formatMentionName(u);
    return chip;
  }

  function serializeNode(node) {
    if (node.nodeType === 3) { return node.nodeValue || ''; }
    if (node.nodeType !== 1) { return ''; }
    if (node.classList && node.classList.contains('mention-chip') && node.dataset && node.dataset.id) {
      return '@[' + (node.textContent || '').replace(/^@/, '') + '](' + node.dataset.id + ')';
    }
    if (node.tagName === 'BR') { return '\n'; }
    let inner = '';
    node.childNodes.forEach((c) => { inner += serializeNode(c); });
    // Block wrappers the browser may inject on Enter become newlines.
    return (node.tagName === 'DIV' || node.tagName === 'P') ? '\n' + inner : inner;
  }

  function serializeEditor(el) {
    let out = '';
    el.childNodes.forEach((node) => { out += serializeNode(node); });
    return out.replace(/^\n/, '');
  }

  function getEditorContent() {
    const el = document.getElementById('message-body');
    return el ? serializeEditor(el) : (state.messageContent || '');
  }

  function syncEditorContent() {
    const el = document.getElementById('message-body');
    if (el) { state.messageContent = serializeEditor(el); }
  }

  // Build editor DOM from @[name](uuid) content (edit mode / tab switches).
  function setEditorContent(el, content) {
    el.innerHTML = '';
    const text = String(content || '');
    const re = /@\[([^\]]*)\]\(([0-9a-fA-F-]{36})\)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) { el.appendChild(document.createTextNode(text.slice(last, m.index))); }
      el.appendChild(createMentionChip({ id: m[2], given_name: m[1] }));
      last = re.lastIndex;
    }
    if (last < text.length) { el.appendChild(document.createTextNode(text.slice(last))); }
  }

  // The @query immediately before a collapsed caret, within one text node.
  function getMentionContext() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) { return null; }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (!node || node.nodeType !== 3) { return null; }
    const before = (node.nodeValue || '').slice(0, range.startOffset);
    const m = /(^|\s)@([\w.\-]*)$/.exec(before);
    if (!m) { return null; }
    return { node: node, query: m[2], start: range.startOffset - m[2].length - 1, end: range.startOffset };
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

  function onMentionInput() {
    const ctx = getMentionContext();
    if (!ctx) { closeMentionDropdown(); return; }
    mention.open = true;
    mention.query = ctx.query;
    updateMentionFilter();
    // Refresh candidates from the server for large audiences (debounced).
    if (mention.debounce) { clearTimeout(mention.debounce); }
    const q = ctx.query;
    mention.debounce = setTimeout(() => {
      vscode.postMessage({ command: 'fetchMentionable', data: { search: q } });
    }, 200);
  }

  function selectMention(u) {
    const ctx = getMentionContext();
    if (!ctx) { closeMentionDropdown(); return; }
    // Replace the "@query" text with an atomic chip + trailing space.
    const range = document.createRange();
    range.setStart(ctx.node, ctx.start);
    range.setEnd(ctx.node, ctx.end);
    range.deleteContents();
    const chip = createMentionChip(u);
    range.insertNode(chip);
    const space = document.createTextNode(' ');
    if (chip.nextSibling) { chip.parentNode.insertBefore(space, chip.nextSibling); }
    else { chip.parentNode.appendChild(space); }
    const after = document.createRange();
    after.setStart(space, 1);
    after.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(after);
    closeMentionDropdown();
    syncEditorContent();
  }

  // Insert a literal newline at the caret (Shift+Enter) without the browser
  // wrapping lines in <div>s — keeps the serialized model flat.
  function insertNewlineAtCaret() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { return; }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const nl = document.createTextNode('\n');
    range.insertNode(nl);
    const after = document.createRange();
    after.setStartAfter(nl);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }

  function onEditorKeydown(e) {
    // When the dropdown is open, arrows/enter/tab/escape drive it.
    if (mention.open && mention.items.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mention.active = (mention.active + 1) % mention.items.length; renderMentionDropdown(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); mention.active = (mention.active - 1 + mention.items.length) % mention.items.length; renderMentionDropdown(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mention.items[mention.active]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMentionDropdown(); return; }
    }
    // Enter sends (reuse the Send button); Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const btn = document.querySelector('.send-button');
      if (btn && !btn.hasAttribute('disabled')) { btn.click(); }
      return;
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      insertNewlineAtCaret();
      syncEditorContent();
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

  // Patch only the footer (typing indicator vs. markdown hint) in place.
  // A full render() rebuilds the whole form and recreates the contenteditable
  // #message-body, which destroys focus and the caret — so typing updates must
  // never go through setState()/render() or the user gets locked out of the
  // input after every keystroke (issue #268).
  function updateTypingIndicator() {
    const footer = root()?.querySelector('.actions-bar');
    if (!footer) return;
    footer.innerHTML = '';
    if (state.typingUsers && state.typingUsers.length > 0) {
      footer.appendChild(renderTypingIndicator(state.typingUsers));
    } else {
      footer.appendChild(createElement('span', {
        className: 'markdown-hint',
        textContent: 'Markdown supported'
      }));
    }
  }

  function render() {
    const mount = root();
    if (!mount) {
      return;
    }

    mount.innerHTML = '';

    if (!state.target) {
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
    if (state.showSubject === false) {
      // Conversational scope (chat / reply) — no subject. A spacer keeps the
      // Send button right-aligned in the flex row.
      titleRow.appendChild(createElement('div', { className: 'title-row-spacer' }));
    } else if (createInput) {
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
        const contentValue = getEditorContent().trim();

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
        // Serialize the editor (text + mention chips) before switching.
        state.messageContent = getEditorContent();
        setState({ activeTab: 'preview' });
      }
    });

    tabBar.appendChild(writeTab);
    tabBar.appendChild(previewTab);
    editorContainer.appendChild(tabBar);

    // Content area (textarea or preview)
    const contentArea = createElement('div', { className: 'editor-content' });

    if (state.activeTab === 'write') {
      const editor = createElement('div', {
        className: 'vscode-input chat-textarea mention-editor',
        attributes: {
          id: 'message-body',
          contenteditable: state.loading ? 'false' : 'true',
          role: 'textbox',
          'aria-multiline': 'true',
          'data-placeholder': 'Write your message… (Markdown supported, @ to mention)'
        }
      });
      // Use saved content or editing message content, rendered as text + chips.
      const initialValue = state.messageContent || (state.editingMessage ? state.editingMessage.content || '' : '');
      setEditorContent(editor, initialValue);

      // Dropdown for @-mention autocomplete (normal flow, below the editor).
      const mentionDropdown = createElement('div', { className: 'mention-dropdown' });
      mentionDropdown.style.display = 'none';
      mention.dropdown = mentionDropdown;
      mention.open = false;

      // Typing fires native input; programmatic edits call syncEditorContent.
      editor.addEventListener('input', () => {
        syncEditorContent();
        vscode.postMessage({ command: 'typing' });
        onMentionInput();
      });
      editor.addEventListener('keydown', onEditorKeydown);
      editor.addEventListener('blur', () => setTimeout(closeMentionDropdown, 120));
      // Paste as plain text so foreign HTML/styles never enter the editor.
      editor.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const tn = document.createTextNode(text);
          range.insertNode(tn);
          range.setStartAfter(tn);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        syncEditorContent();
        onMentionInput();
      });
      contentArea.appendChild(editor);
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
        // Patch the footer in place — do NOT setState()/render(), which would
        // recreate the editor and steal focus mid-typing (issue #268).
        state.typingUsers = message.data?.typingUsers || [];
        updateTypingIndicator();
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
