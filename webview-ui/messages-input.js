(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();
  const { createButton, createInput } = window.UIComponents || {};

  const state = {
    target: undefined,
    replyTo: undefined,
    editingMessage: undefined,
    loading: false,
    activeTab: 'write', // 'write' or 'preview'
    messageContent: ''
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

  function render() {
    const mount = root();
    if (!mount) {
      return;
    }

    mount.innerHTML = '';

    if (!state.target) {
      const placeholder = createElement('div', {
        className: 'placeholder-state',
        textContent: 'Open a messages view to compose a message.'
      });
      mount.appendChild(placeholder);
      return;
    }

    const container = createElement('div', { className: 'input-container' });

    // Context header - only show when replying/editing or show target context
    if (state.replyTo || state.editingMessage || state.target?.title) {
      const header = createElement('div', { className: 'input-header' });

      if (state.replyTo) {
        const contextLabel = createElement('span', {
          className: 'input-context reply-context',
          innerHTML: `Replying to <strong>${escapeHtml(state.replyTo.title || 'message')}</strong>`
        });
        header.appendChild(contextLabel);
      } else if (state.editingMessage) {
        const contextLabel = createElement('span', {
          className: 'input-context edit-context',
          innerHTML: `Editing <strong>${escapeHtml(state.editingMessage.title || 'message')}</strong>`
        });
        header.appendChild(contextLabel);
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

    // Actions at the bottom
    const actions = createElement('div', { className: 'form-actions' });

    if (createButton) {
      if (state.replyTo || state.editingMessage) {
        const cancelButton = createButton({
          text: 'Cancel',
          variant: 'secondary',
          onClick: () => {
            state.messageContent = '';
            state.activeTab = 'write';
            vscode.postMessage({ command: 'cancel' });
          }
        });
        actions.appendChild(cancelButton.render());
      }

      const submitButton = createButton({
        text: state.editingMessage ? 'Save' : 'Send',
        variant: 'primary',
        loading: state.loading,
        onClick: () => {
          const titleValue = titleInput ? titleInput.getValue() : document.getElementById('message-title')?.value || '';
          // Get content from state (for preview mode) or textarea (for write mode)
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

          // Clear content after sending
          state.messageContent = '';
          state.activeTab = 'write';
        }
      });
      actions.appendChild(submitButton.render());
    }

    container.appendChild(actions);
    mount.appendChild(container);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;

    switch (message.command) {
      case 'updateState':
        // Reset content and tab when context changes
        state.messageContent = message.data?.editingMessage?.content || '';
        state.activeTab = 'write';
        setState(message.data || {});
        break;
      case 'setLoading':
        setState({ loading: Boolean(message.data?.loading) });
        break;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    render();
    // Signal to extension that webview is ready to receive state
    vscode.postMessage({ command: 'ready' });
  });
})();
