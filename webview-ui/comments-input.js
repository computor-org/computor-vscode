(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();
  const { createButton } = window.UIComponents || {};

  const state = {
    courseMemberId: undefined,
    title: undefined,
    editingComment: undefined,
    loading: false,
    draft: ''
  };

  const root = () => document.getElementById('app');

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  function escapeHtml(value) {
    if (value === undefined || value === null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.textContent !== undefined) el.textContent = options.textContent;
    if (options.innerHTML !== undefined) el.innerHTML = options.innerHTML;
    if (options.attributes) {
      Object.entries(options.attributes).forEach(([k, v]) => {
        if (v !== undefined && v !== null) el.setAttribute(k, v);
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

  function submit(value) {
    const message = (value || '').trim();
    if (!message) {
      vscode.postMessage({ command: 'showWarning', data: 'Comment text is required.' });
      return;
    }
    if (state.editingComment) {
      vscode.postMessage({
        command: 'updateComment',
        data: { commentId: state.editingComment.id, message }
      });
    } else {
      vscode.postMessage({ command: 'createComment', data: { message } });
    }
  }

  function render() {
    const mount = root();
    if (!mount) return;
    mount.innerHTML = '';

    const wrapper = createElement('div', { className: 'comments-input-root' });

    if (!state.courseMemberId) {
      wrapper.appendChild(
        createElement('p', {
          className: 'comments-input-empty',
          textContent: 'Open a course member’s comments to add or edit a comment here.'
        })
      );
      mount.appendChild(wrapper);
      return;
    }

    const header = createElement('div', { className: 'comments-input-header' });
    header.appendChild(createElement('span', {
      className: 'comments-input-title',
      textContent: state.editingComment ? 'Editing comment' : 'New comment'
    }));
    if (state.title) {
      header.appendChild(createElement('span', {
        className: 'comments-input-target',
        textContent: state.title
      }));
    }
    wrapper.appendChild(header);

    const textarea = createElement('textarea', {
      className: 'vscode-input comments-input-textarea',
      attributes: {
        rows: '4',
        placeholder: state.editingComment ? 'Edit comment...' : 'Add a comment...',
        'aria-label': 'Comment text'
      }
    });
    textarea.value = state.editingComment
      ? (state.editingComment.message || '')
      : (state.draft || '');

    textarea.addEventListener('input', (e) => {
      state.draft = e.target.value;
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit(textarea.value);
      } else if (e.key === 'Escape' && state.editingComment) {
        e.preventDefault();
        vscode.postMessage({ command: 'cancel' });
      }
    });

    wrapper.appendChild(textarea);

    const actions = createElement('div', { className: 'comments-input-actions' });
    if (createButton) {
      const submitBtn = createButton({
        text: state.editingComment ? 'Save Changes' : 'Add Comment',
        variant: 'primary',
        loading: state.loading,
        onClick: () => submit(textarea.value)
      });
      actions.appendChild(submitBtn.render());

      if (state.editingComment) {
        const cancelBtn = createButton({
          text: 'Cancel',
          variant: 'secondary',
          onClick: () => vscode.postMessage({ command: 'cancel' })
        });
        actions.appendChild(cancelBtn.render());
      }
    } else {
      const submitBtn = createElement('button', {
        className: 'vscode-button vscode-button--primary',
        textContent: state.editingComment ? 'Save Changes' : 'Add Comment',
        attributes: { type: 'button' }
      });
      submitBtn.addEventListener('click', () => submit(textarea.value));
      actions.appendChild(submitBtn);
      if (state.editingComment) {
        const cancelBtn = createElement('button', {
          className: 'vscode-button vscode-button--secondary',
          textContent: 'Cancel',
          attributes: { type: 'button' }
        });
        cancelBtn.addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
        actions.appendChild(cancelBtn);
      }
    }

    const hint = createElement('span', {
      className: 'comments-input-hint',
      textContent: 'Ctrl/Cmd+Enter to submit'
    });
    actions.appendChild(hint);

    wrapper.appendChild(actions);
    mount.appendChild(wrapper);

    // restore focus to textarea after re-render when editing or composing
    textarea.focus();
    if (state.editingComment) {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;
    switch (message.command) {
      case 'updateState':
        setState({
          courseMemberId: message.data?.courseMemberId,
          title: message.data?.title,
          editingComment: message.data?.editingComment,
          loading: Boolean(message.data?.loading),
          draft: message.data?.editingComment ? state.draft : ''
        });
        break;
      case 'setLoading':
        setState({ loading: Boolean(message.data?.loading) });
        break;
      default:
        break;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    render();
    vscode.postMessage({ command: 'ready' });
  });

  // Render once immediately so first paint isn't blank
  render();
  vscode.postMessage({ command: 'ready' });

  // Suppress unused lint
  void escapeHtml;
})();
