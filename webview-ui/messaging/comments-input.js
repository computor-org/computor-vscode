(function () {
  // Shared runtime (base.js). The old local escapeHtml was unused and dropped.
  const { vscode, el, createStore, say } = window.ComputorWebview;

  const { state, setState } = createStore({
    courseMemberId: undefined,
    title: undefined,
    editingComment: undefined,
    loading: false,
    draft: ''
  }, render);

  const root = () => document.getElementById('app');

  // Persist unsent drafts in the webview's own state so they survive the view
  // being hidden/collapsed — these input panels are WebviewViews and are not
  // retained. Keyed by course member so a draft doesn't bleed across a context
  // switch, and restored in the updateState handler once the member is known.
  function readDraft(memberId) {
    if (!memberId || !vscode.getState) { return ''; }
    const drafts = (vscode.getState() || {}).drafts || {};
    return drafts[memberId] || '';
  }
  function persistDraft(memberId, value) {
    if (!memberId || !vscode.setState) { return; }
    const prev = (vscode.getState && vscode.getState()) || {};
    const drafts = Object.assign({}, prev.drafts);
    if (value) { drafts[memberId] = value; } else { delete drafts[memberId]; }
    vscode.setState(Object.assign({}, prev, { drafts: drafts }));
  }

  // ComputorWebview.el with the legacy options shape: children live in the
  // options object and null/undefined attribute values mean "omit" (el would
  // stringify them via setAttribute).
  function createElement(tag, options = {}) {
    const { children, attributes, ...props } = options;
    if (attributes) {
      props.attributes = Object.fromEntries(
        Object.entries(attributes).filter(([, value]) => value !== undefined && value !== null)
      );
    }
    return el(tag, props, children);
  }

  function submit(value) {
    const message = (value || '').trim();
    if (!message) {
      vscode.postMessage({ command: 'showWarning', data: say('Comment text is required.', 'Bitte gib einen Kommentar ein.') });
      return;
    }
    if (state.editingComment) {
      vscode.postMessage({
        command: 'updateComment',
        data: { commentId: state.editingComment.id, message }
      });
    } else {
      vscode.postMessage({ command: 'createComment', data: { message } });
      state.draft = '';
      persistDraft(state.courseMemberId, '');
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
          textContent: say('Open a course member’s comments to add or edit a comment here.',
            'Öffne die Kommentare zu einem Kursmitglied, um hier einen Kommentar zu schreiben oder zu bearbeiten.')
        })
      );
      mount.appendChild(wrapper);
      return;
    }

    const header = createElement('div', { className: 'comments-input-header' });
    header.appendChild(createElement('span', {
      className: 'comments-input-title',
      textContent: state.editingComment ? say('Editing comment', 'Kommentar bearbeiten') : say('New comment', 'Neuer Kommentar')
    }));
    if (state.title) {
      header.appendChild(createElement('span', {
        className: 'comments-input-target',
        textContent: state.title
      }));
    }
    wrapper.appendChild(header);

    const textarea = createElement('textarea', {
      className: 'comments-input-textarea',
      attributes: {
        rows: '4',
        placeholder: state.editingComment ? say('Edit comment...', 'Kommentar bearbeiten …') : say('Add a comment...', 'Kommentar schreiben …'),
        'aria-label': say('Comment text', 'Kommentartext')
      }
    });
    textarea.value = state.editingComment
      ? (state.editingComment.message || '')
      : (state.draft || '');

    textarea.addEventListener('input', (e) => {
      state.draft = e.target.value;
      persistDraft(state.courseMemberId, state.draft);
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

    const submitBtn = createElement('button', {
      className: 'btn',
      textContent: state.editingComment ? say('Save Changes', 'Änderungen speichern') : say('Add Comment', 'Kommentar hinzufügen'),
      attributes: { type: 'button', disabled: state.loading ? 'disabled' : null }
    });
    submitBtn.addEventListener('click', () => submit(textarea.value));
    actions.appendChild(submitBtn);

    if (state.editingComment) {
      const cancelBtn = createElement('button', {
        className: 'btn secondary',
        textContent: say('Cancel', 'Abbrechen'),
        attributes: { type: 'button' }
      });
      cancelBtn.addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
      actions.appendChild(cancelBtn);
    }

    const hint = createElement('span', {
      className: 'comments-input-hint',
      textContent: say('Ctrl/Cmd+Enter to submit', 'Strg/Cmd+Enter zum Speichern')
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
          draft: message.data?.editingComment ? state.draft : readDraft(message.data?.courseMemberId)
        });
        break;
      case 'setLoading':
        setState({ loading: Boolean(message.data?.loading) });
        break;
      default:
        break;
    }
  });

  // Render immediately: the script is injected at the end of <body>, so the
  // DOM already exists. A DOMContentLoaded handler would fire a second time,
  // double-rendering and posting 'ready' twice.
  render();
  vscode.postMessage({ command: 'ready' });
})();
