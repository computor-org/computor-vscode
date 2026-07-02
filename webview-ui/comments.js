(function () {
  // Shared runtime (base.js). formatDateTime matches the old local
  // formatDate (toLocaleString, i.e. date + time).
  const { vscode, escapeHtml, formatDateTime: formatDate, el, createStore } = window.ComputorWebview;
  const { createButton } = window.UIComponents || {};

  const { state, setState } = createStore({
    courseMemberId: undefined,
    title: 'Comments',
    comments: [],
    loading: false,
    error: undefined,
    ...(window.__INITIAL_STATE__ || {})
  }, render);

  const root = () => document.getElementById('app');

  function renderMarkdown(text) {
    if (!text) return '';
    if (typeof window.marked !== 'undefined') {
      return window.marked.parse(text);
    }
    return escapeHtml(text).replace(/\n/g, '<br/>');
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

  function renderComments(container) {
    container.innerHTML = '';

    if (state.loading) {
      container.appendChild(
        createElement('div', {
          className: 'empty-state',
          textContent: 'Loading comments…'
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

    if (!state.comments || state.comments.length === 0) {
      container.appendChild(
        createElement('div', {
          className: 'empty-state',
          textContent: 'No comments yet.'
        })
      );
      return;
    }

    state.comments
      .slice()
      .sort((a, b) => {
        const aTime = a.updated_at || a.created_at || '';
        const bTime = b.updated_at || b.created_at || '';
        return aTime.localeCompare(bTime);
      })
      .forEach((comment) => {
        const card = createElement('article', { className: 'comment-card' });

        const authorName = comment.transmitter?.user
          ? `${comment.transmitter.user.given_name || ''} ${comment.transmitter.user.family_name || ''}`.trim() || comment.transmitter.user.username || comment.transmitter.user.email
          : comment.transmitter_id || 'Unknown';

        card.appendChild(
          createElement('div', {
            className: 'comment-meta',
            children: [
              createElement('span', { textContent: authorName }),
              createElement('span', { textContent: formatDate(comment.updated_at || comment.created_at) })
            ]
          })
        );

        card.appendChild(
          createElement('div', {
            className: 'comment-body markdown-body',
            innerHTML: renderMarkdown(comment.message)
          })
        );

        const actions = createElement('div', { className: 'comment-actions' });

        if (createButton) {
          const editBtn = createButton({
            text: 'Edit',
            size: 'sm',
            variant: 'secondary',
            onClick: () => {
              vscode.postMessage({
                command: 'editComment',
                data: { commentId: comment.id }
              });
            }
          });
          actions.appendChild(editBtn.render());
        }

        const deleteBtn = createElement('button', {
          className: 'vscode-button vscode-button--tertiary vscode-button--sm',
          textContent: 'Delete',
          attributes: { type: 'button' }
        });

        deleteBtn.addEventListener('click', () => {
          vscode.postMessage({
            command: 'requestDeleteComment',
            data: { commentId: comment.id, courseMemberId: state.courseMemberId }
          });
        });

        actions.appendChild(deleteBtn);
        card.appendChild(actions);

        container.appendChild(card);
      });
  }

  function render() {
    const mount = root();
    if (!mount) return;

    mount.innerHTML = '';

    const view = createElement('div', { className: 'view-root' });

    const header = createElement('div', { className: 'view-header' });
    header.appendChild(
      createElement('h1', {
        textContent: state.title || 'Comments'
      })
    );

    const toolbar = createElement('div', { className: 'toolbar' });
    if (createButton) {
      const refreshBtn = createButton({
        text: 'Refresh',
        variant: 'secondary',
        onClick: () => {
          setState({ loading: true });
          vscode.postMessage({ command: 'refreshComments' });
        }
      });
      toolbar.appendChild(refreshBtn.render());
    }

    const commentsContainer = createElement('div', { className: 'comments-container' });
    renderComments(commentsContainer);

    view.appendChild(header);
    view.appendChild(toolbar);
    view.appendChild(commentsContainer);

    mount.appendChild(view);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;

    switch (message.command) {
      case 'updateComments':
        setState({ comments: message.data || [], loading: false });
        break;
      case 'setLoading':
        setState({ loading: Boolean(message.data?.loading) });
        break;
      case 'setError':
        setState({ error: message.data, loading: false });
        break;
      case 'updateState':
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
