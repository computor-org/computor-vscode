(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();
  const { createButton, createInput } = window.UIComponents || {};

  const state = {
    target: undefined,
    messages: [],
    loading: false,
    error: undefined,
    replyTo: undefined,
    editingMessage: undefined,
    identity: undefined,
    ...(window.__INITIAL_STATE__ || {})
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

  function formatDate(dateString) {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  }

  function buildThreads(messages) {
    const map = new Map();
    const roots = [];
    messages.forEach((msg) => {
      map.set(msg.id, { ...msg, children: [] });
    });
    map.forEach((node) => {
      if (node.parent_id && map.has(node.parent_id)) {
        map.get(node.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    });

    const sortFn = (a, b) => {
      const aTime = a.updated_at || a.created_at || '';
      const bTime = b.updated_at || b.created_at || '';
      return aTime.localeCompare(bTime);
    };

    function sortNode(node) {
      node.children.sort(sortFn).forEach(sortNode);
    }

    roots.sort(sortFn).forEach(sortNode);
    return roots;
  }

  function renderMarkdown(text) {
    if (!text) {
      return '';
    }
    if (typeof window.marked !== 'undefined') {
      return window.marked.parse(text);
    }
    return escapeHtml(text).replace(/\n/g, '<br/>');
  }

  function getAuthorDisplay(message) {
    const author = message.author || {};
    const authorNameFromParts = [author.given_name, author.family_name]
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .join(' ');

    const displayFromMessage =
      typeof message.author_display === 'string' && message.author_display.trim().length > 0
        ? message.author_display.trim()
        : '';
    const displayFromAuthorName =
      typeof message.author_name === 'string' && message.author_name.trim().length > 0
        ? message.author_name.trim()
        : '';

    return (
      displayFromMessage ||
      displayFromAuthorName ||
      authorNameFromParts ||
      message.author_id ||
      'Unknown'
    );
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

  function getScopeLabel(scope) {
    const labels = {
      'submission_group': 'Submission',
      'course_content': 'Content',
      'course': 'Course',
      'course_group': 'Group',
      'course_member': 'Member',
      'user': 'Direct'
    };
    return labels[scope] || scope;
  }

  function renderMessageNode(message, depth = 0) {
    const card = createElement('article', {
      className: `message-card level-${message.level ?? depth}`
    });

    const meta = createElement('div', { className: 'message-meta' });

    const metaLeftChildren = [
      createElement('span', { textContent: getAuthorDisplay(message) })
    ];

    // Add scope tag if available
    if (message.scope) {
      const scopeTag = createElement('span', {
        className: `message-scope-tag scope-${message.scope}`,
        textContent: getScopeLabel(message.scope)
      });
      metaLeftChildren.push(scopeTag);
    }

    const metaLeft = createElement('div', {
      className: 'message-meta-left',
      children: metaLeftChildren
    });

    const metaRight = createElement('div', { className: 'message-meta-right' });

    if (createButton) {
      const replyButton = createButton({
        text: 'Reply',
        size: 'xs',
        variant: 'secondary',
        onClick: () => setState({ replyTo: message, editingMessage: undefined })
      });
      const replyEl = replyButton.render();
      replyEl.classList.add('message-reply-button');
      metaRight.appendChild(replyEl);
    }

    metaRight.appendChild(
      createElement('span', { textContent: formatDate(message.updated_at || message.created_at), className: 'message-meta-date' })
    );

    meta.appendChild(metaLeft);
    meta.appendChild(metaRight);

    const title = createElement('h3', {
      className: 'message-title',
      textContent: message.title || '(no title)'
    });

    const body = createElement('div', {
      className: 'message-body markdown-body',
      innerHTML: renderMarkdown(message.content)
    });

    const actions = createElement('div', { className: 'message-actions' });

    // Only show edit/delete buttons if the user is the author
    const isAuthor = Boolean(message.is_author);

    if (isAuthor && createButton) {
      const editBtn = createButton({
        text: 'Edit',
        size: 'sm',
        variant: 'secondary',
        onClick: () =>
          setState({
            editingMessage: message,
            replyTo: undefined
          })
      });
      actions.appendChild(editBtn.render());
    }

    if (isAuthor && createButton) {
      const deleteBtn = createButton({
        text: 'Delete',
        size: 'sm',
        variant: 'tertiary',
        onClick: () => {
          vscode.postMessage({
            command: 'confirmDeleteMessage',
            data: { messageId: message.id, title: message.title }
          });
        }
      });
      actions.appendChild(deleteBtn.render());
    }

    card.appendChild(meta);
    card.appendChild(title);
    card.appendChild(body);
    if (actions.childNodes.length > 0) {
      card.appendChild(actions);
    }

    if (message.children && message.children.length > 0) {
      message.children.forEach((child) => {
        card.appendChild(renderMessageNode(child, depth + 1));
      });
    }

    return card;
  }

  function renderMessagesSection(container) {
    container.innerHTML = '';

    if (state.loading) {
      container.appendChild(
        createElement('div', {
          className: 'empty-state',
          textContent: 'Loading messages…'
        })
      );
      return;
    }

    if (state.error) {
      container.appendChild(
        createElement('div', {
          className: 'error-state',
          textContent: state.error
        })
      );
      return;
    }

    if (!state.messages || state.messages.length === 0) {
      container.appendChild(
        createElement('div', {
          className: 'empty-state',
          textContent: 'No messages yet. Start the discussion below.'
        })
      );
      return;
    }

    const threads = buildThreads(state.messages);
    threads.forEach((thread) => {
      container.appendChild(renderMessageNode(thread, thread.level ?? 0));
    });

    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }

  function renderForm(formWrapper) {
    formWrapper.innerHTML = '';

    const header = createElement('div', { className: 'form-header' });

    const contextInfo = state.replyTo
      ? `Replying to “${state.replyTo.title || 'message'}”`
      : state.editingMessage
      ? `Editing “${state.editingMessage.title || 'message'}”`
      : undefined;

    if (contextInfo) {
      header.appendChild(
        createElement('p', {
          className: 'form-context',
          textContent: contextInfo
        })
      );
    }

    const titleInput = createInput
      ? createInput({
          placeholder: 'Message title',
          value: state.editingMessage ? state.editingMessage.title || '' : '',
          disabled: state.loading
        })
      : null;

    const textarea = createElement('textarea', {
      className: 'vscode-input',
      attributes: {
        rows: '5',
        placeholder: 'Write your message…'
      }
    });
    textarea.value = state.editingMessage ? state.editingMessage.content || '' : '';

    const actions = createElement('div', { className: 'toolbar' });

    const submitButton = createButton
      ? createButton({
          text: state.editingMessage ? 'Save Changes' : 'Send Message',
          variant: 'primary',
          loading: state.loading,
          onClick: () => {
          const titleValue = titleInput ? titleInput.getValue() : '';
          const contentValue = textarea.value.trim();
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
                  title: titleValue,
                  content: contentValue
                }
              });
            } else {
              vscode.postMessage({
                command: 'createMessage',
                data: {
                  title: titleValue,
                  content: contentValue,
                  parent_id: state.replyTo ? state.replyTo.id : undefined
                }
              });
            }
          }
        })
      : null;

    if (submitButton) {
      actions.appendChild(submitButton.render());
    }

    if ((state.replyTo || state.editingMessage) && createButton) {
      const cancelButton = createButton({
        text: 'Cancel',
        variant: 'secondary',
        onClick: () => setState({ replyTo: undefined, editingMessage: undefined })
      });
      actions.appendChild(cancelButton.render());
    }

    if (titleInput) {
      const titleRow = createElement('div', {
        className: 'form-row'
      });
      titleRow.appendChild(
        createElement('label', { textContent: 'Title', attributes: { for: 'message-title' } })
      );
      const titleEl = titleInput.render();
      titleEl.id = 'message-title';
      titleRow.appendChild(titleEl);
      formWrapper.appendChild(titleRow);
    }

    const bodyRow = createElement('div', { className: 'form-row' });
    bodyRow.appendChild(createElement('label', { textContent: 'Message', attributes: { for: 'message-body' } }));
    textarea.id = 'message-body';
    bodyRow.appendChild(textarea);

    formWrapper.appendChild(header);
    formWrapper.appendChild(bodyRow);
    formWrapper.appendChild(actions);
  }

  function render() {
    const mount = root();
    if (!mount) {
      return;
    }

    mount.innerHTML = '';

    const view = createElement('div', { className: 'view-root' });

    const header = createElement('div', { className: 'view-header' });
    const headerTop = createElement('div', { className: 'view-header-top' });

    const titleEl = createElement('h1', {
      textContent: state.target?.title || 'Messages'
    });
    headerTop.appendChild(titleEl);

    if (createButton) {
      const refreshBtn = createButton({
        text: 'Refresh',
        variant: 'secondary',
        size: 'sm',
        onClick: () => {
          setState({ loading: true });
          vscode.postMessage({ command: 'refreshMessages' });
        }
      });
      const refreshEl = refreshBtn.render();
      refreshEl.classList.add('refresh-button');
      headerTop.appendChild(refreshEl);
    }

    header.appendChild(headerTop);
    if (state.target?.subtitle) {
      header.appendChild(
        createElement('p', { textContent: state.target.subtitle })
      );
    }

    const messagesContainer = createElement('div', { className: 'messages-container' });
    renderMessagesSection(messagesContainer);

    const formCard = createElement('div', { className: 'form-card' });
    formCard.appendChild(
      createElement('h2', {
        textContent: state.editingMessage ? 'Edit Message' : 'New Message'
      })
    );
    renderForm(formCard);

    view.appendChild(header);
    view.appendChild(messagesContainer);
    view.appendChild(formCard);

    mount.appendChild(view);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;

    switch (message.command) {
      case 'updateMessages':
        setState({ messages: message.data || [], loading: false, replyTo: undefined, editingMessage: undefined });
        break;
      case 'setLoading':
        setState({ loading: Boolean(message.data?.loading) });
        break;
      case 'setError':
        setState({ error: message.data, loading: false });
        break;
      case 'updateState':
        setState(message.data || {});
        break;
      case 'update':
        setState(message.data || {});
        break;
      default:
        break;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    render();
  });
})();
