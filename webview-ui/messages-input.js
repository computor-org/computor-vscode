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

    const form = createElement('div', { className: 'input-form' });

    // Title input (inline style, no label)
    let titleInput = null;
    if (createInput) {
      titleInput = createInput({
        placeholder: 'Subject',
        value: state.editingMessage ? state.editingMessage.title || '' : '',
        disabled: state.loading
      });
      const titleEl = titleInput.render();
      titleEl.id = 'message-title';
      titleEl.classList.add('chat-title-input');
      form.appendChild(titleEl);
    } else {
      const inputEl = createElement('input', {
        className: 'vscode-input chat-title-input',
        attributes: {
          type: 'text',
          id: 'message-title',
          placeholder: 'Subject'
        }
      });
      inputEl.value = state.editingMessage ? state.editingMessage.title || '' : '';
      if (state.loading) {
        inputEl.disabled = true;
      }
      form.appendChild(inputEl);
    }

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
          placeholder: 'Write your message… (Markdown supported)'
        }
      });
      // Use saved content or editing message content
      const initialValue = state.messageContent || (state.editingMessage ? state.editingMessage.content || '' : '');
      textarea.value = initialValue;
      if (state.loading) {
        textarea.disabled = true;
      }
      // Save content on input and notify typing
      textarea.addEventListener('input', (e) => {
        state.messageContent = e.target.value;
        // Send typing indicator
        vscode.postMessage({ command: 'typing' });
      });
      contentArea.appendChild(textarea);
    } else {
      // Preview mode
      const preview = createElement('div', { className: 'markdown-preview' });
      const contentToPreview = state.messageContent || (state.editingMessage ? state.editingMessage.content || '' : '');
      if (contentToPreview.trim()) {
        preview.innerHTML = `<div class="markdown-body">${renderMarkdown(contentToPreview)}</div>`;
      } else {
        preview.innerHTML = '<p class="preview-empty">Nothing to preview</p>';
      }
      contentArea.appendChild(preview);
    }

    editorContainer.appendChild(contentArea);
    form.appendChild(editorContainer);

    container.appendChild(form);

    // Actions bar at the bottom
    const actionsBar = createElement('div', { className: 'actions-bar' });

    // Left section: typing indicator or markdown hint
    const actionsLeft = createElement('div', { className: 'actions-left' });

    if (state.typingUsers && state.typingUsers.length > 0) {
      // Show typing indicator
      const typingIndicator = renderTypingIndicator(state.typingUsers);
      actionsLeft.appendChild(typingIndicator);
    } else {
      // Show markdown hint when not typing
      const mdHint = createElement('span', {
        className: 'markdown-hint',
        textContent: 'Markdown supported'
      });
      actionsLeft.appendChild(mdHint);
    }

    actionsBar.appendChild(actionsLeft);

    // Right section: buttons
    const actionsRight = createElement('div', { className: 'actions-right' });

    if (createButton) {
      if (state.replyTo || state.editingMessage) {
        const cancelButton = createButton({
          text: 'Cancel',
          variant: 'tertiary',
          size: 'sm',
          onClick: () => {
            // Update local state immediately for responsive UI
            setState({
              replyTo: undefined,
              editingMessage: undefined,
              messageContent: '',
              activeTab: 'write'
            });
            // Notify extension to sync state
            vscode.postMessage({ command: 'cancel' });
          }
        });
        const cancelEl = cancelButton.render();
        cancelEl.classList.add('cancel-btn');
        actionsRight.appendChild(cancelEl);
      }

      // Modern send button with arrow
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

      // Arrow icon (using unicode)
      const buttonIcon = createElement('span', {
        className: 'send-button-icon',
        innerHTML: state.editingMessage ? '&#10003;' : '&#10148;' // checkmark or arrow
      });
      sendButton.appendChild(buttonIcon);

      sendButton.addEventListener('click', () => {
        if (state.loading) return;

        const titleValue = titleInput ? titleInput.getValue() : document.getElementById('message-title')?.value || '';
        const textarea = document.getElementById('message-body');
        const contentValue = (textarea ? textarea.value : state.messageContent).trim();

        if (!titleValue.trim()) {
          vscode.postMessage({ command: 'showWarning', data: 'Message title is required.' });
          return;
        }
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

      actionsRight.appendChild(sendButton);
    }

    actionsBar.appendChild(actionsRight);
    container.appendChild(actionsBar);
    mount.appendChild(container);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;

    switch (message.command) {
      case 'updateState':
        console.log('[messages-input] Received updateState:', message.data);
        console.log('[messages-input] Target is:', message.data?.target);
        // Reset content and tab when context changes
        state.messageContent = message.data?.editingMessage?.content || '';
        state.activeTab = 'write';
        setState(message.data || {});
        console.log('[messages-input] State after update, target:', state.target);
        break;
      case 'setLoading':
        setState({ loading: Boolean(message.data?.loading) });
        break;
      case 'typingUpdate':
        console.log('[messages-input] Received typingUpdate:', message.data?.typingUsers);
        setState({ typingUsers: message.data?.typingUsers || [] });
        break;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    render();
    // Signal to extension that webview is ready to receive state
    vscode.postMessage({ command: 'ready' });
  });
})();
