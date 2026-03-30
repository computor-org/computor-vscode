(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();
  const { createButton } = window.UIComponents || {};

  const state = {
    target: undefined,
    messages: [],
    loading: false,
    error: undefined,
    identity: undefined,
    filtersExpanded: false,
    filters: {
      unread: null,
      datePreset: null,
      created_after: null,
      created_before: null,
      tags: null,
      tags_match_all: false
    },
    typingUsers: [], // { userId, userName }
    _scrollToBottom: false,
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

  function flattenThreads(threads, depth) {
    const result = [];
    threads.forEach((node) => {
      const d = depth ?? (node.level ?? 0);
      result.push({ ...node, level: d, children: [] });
      if (node.children && node.children.length > 0) {
        result.push(...flattenThreads(node.children, d + 1));
      }
    });
    return result;
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
      'global': 'Global',
      'organization': 'Organization',
      'course_family': 'Course Family',
      'course': 'Course',
      'course_content': 'Content',
      'course_group': 'Group',
      'submission_group': 'Submission',
      'course_member': 'Member',
      'user': 'Direct'
    };
    return labels[scope] || scope;
  }

  function getAuthorRoleLabel(courseRoleId) {
    if (!courseRoleId) return null;
    const roleLabels = {
      '_student': 'Student',
      '_tutor': 'Tutor',
      '_lecturer': 'Lecturer',
      '_admin': 'Admin'
    };
    return roleLabels[courseRoleId] || null;
  }

  function getDatePresetRange(preset) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (preset) {
      case 'today':
        return { created_after: today.toISOString(), created_before: null };
      case 'week': {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return { created_after: weekAgo.toISOString(), created_before: null };
      }
      case 'month': {
        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        return { created_after: monthAgo.toISOString(), created_before: null };
      }
      default:
        return { created_after: null, created_before: null };
    }
  }

  function applyFilters() {
    const filterData = {};

    if (state.filters.unread === true) {
      filterData.unread = true;
    } else if (state.filters.unread === false) {
      filterData.unread = false;
    }

    if (state.filters.datePreset) {
      const range = getDatePresetRange(state.filters.datePreset);
      if (range.created_after) filterData.created_after = range.created_after;
      if (range.created_before) filterData.created_before = range.created_before;
    } else {
      if (state.filters.created_after) filterData.created_after = state.filters.created_after;
      if (state.filters.created_before) filterData.created_before = state.filters.created_before;
    }

    if (state.filters.tags && state.filters.tags.length > 0) {
      filterData.tags = state.filters.tags;
      filterData.tags_match_all = state.filters.tags_match_all;
    }

    setState({ loading: true });
    vscode.postMessage({ command: 'applyFilters', data: filterData });
  }

  function clearFilters() {
    setState({
      filters: {
        unread: null,
        datePreset: null,
        created_after: null,
        created_before: null,
        tags: null,
        tags_match_all: false
      }
    });
    setState({ loading: true });
    vscode.postMessage({ command: 'applyFilters', data: {} });
  }

  function hasActiveFilters() {
    return (
      state.filters.unread !== null ||
      state.filters.datePreset !== null ||
      state.filters.created_after !== null ||
      state.filters.created_before !== null ||
      (state.filters.tags && state.filters.tags.length > 0)
    );
  }

  function renderMessageNode(message, depth = 0) {
    const level = message.level ?? depth;
    const card = createElement('article', {
      className: `message-card ${level > 0 ? 'message-reply' : ''}`,
      attributes: { 'data-message-id': message.id }
    });

    const meta = createElement('div', { className: 'message-meta' });

    const metaLeftChildren = [
      createElement('span', { textContent: getAuthorDisplay(message) })
    ];

    // Add author role badge if available (from author_course_member)
    const authorRole = message.author_course_member?.course_role_id;
    const roleLabel = getAuthorRoleLabel(authorRole);
    if (roleLabel) {
      const roleClass = authorRole ? authorRole.replace('_', '') : '';
      const roleBadge = createElement('span', {
        className: `author-role-badge role-${roleClass}`,
        textContent: roleLabel,
        attributes: {
          title: `Course Role: ${roleLabel}`
        }
      });
      metaLeftChildren.push(roleBadge);
    }

    // Add scope tag if available
    if (message.scope) {
      const scopeLabel = getScopeLabel(message.scope);
      const scopeTag = createElement('span', {
        className: `message-scope-tag scope-${message.scope}`,
        textContent: scopeLabel,
        attributes: {
          title: `Message Scope: ${scopeLabel}`
        }
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
        onClick: () => vscode.postMessage({ command: 'replyTo', data: message })
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

    const title = message.title
      ? createElement('h3', {
          className: 'message-title',
          textContent: message.title
        })
      : null;

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
        onClick: () => vscode.postMessage({ command: 'editMessage', data: message })
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

    // Reply context line — below meta
    if (level > 0 && message.parent_id) {
      const parentMsg = state.messages.find((m) => m.id === message.parent_id);
      const parentAuthor = parentMsg ? getAuthorDisplay(parentMsg) : null;
      const replyContext = createElement('div', {
        className: 'reply-context-line',
        innerHTML: `&#8627; ${escapeHtml(parentAuthor ? 'replying to ' + parentAuthor : 'reply')}`
      });
      card.appendChild(replyContext);
    }

    if (title) {
      card.appendChild(title);
    }
    card.appendChild(body);
    if (actions.childNodes.length > 0) {
      card.appendChild(actions);
    }

    // Don't nest children — they are rendered flat by flattenThreads
    return card;
  }

  function renderMessagesSection(container, prevScroll) {
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
          textContent: 'No messages yet. Use the input panel below to start the discussion.'
        })
      );
      return;
    }

    const threads = buildThreads(state.messages);
    const flat = flattenThreads(threads);
    flat.forEach((msg) => {
      container.appendChild(renderMessageNode(msg, msg.level ?? 0));
    });

    // Render typing indicator if someone is typing
    if (state.typingUsers && state.typingUsers.length > 0) {
      const typingIndicator = renderTypingIndicator();
      container.appendChild(typingIndicator);
    }

    if (state._scrollToBottom) {
      state._scrollToBottom = false;
      // Use rAF so layout is complete before scrolling to the very bottom
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    } else if (prevScroll > 0) {
      container.scrollTop = prevScroll;
    }
  }

  function renderTypingIndicator() {
    const users = state.typingUsers || [];
    let text = '';

    if (users.length === 1) {
      text = `${users[0].userName} is typing…`;
    } else if (users.length === 2) {
      text = `${users[0].userName} and ${users[1].userName} are typing…`;
    } else if (users.length > 2) {
      text = `${users[0].userName} and ${users.length - 1} others are typing…`;
    }

    return createElement('div', {
      className: 'typing-indicator',
      innerHTML: `<span class="typing-dots"><span></span><span></span><span></span></span> ${escapeHtml(text)}`
    });
  }

  function renderFilterBar() {
    const filterBar = createElement('div', { className: 'filter-bar' });

    // Quick filter buttons row
    const quickFilters = createElement('div', { className: 'quick-filters' });

    if (createButton) {
      // Unread filter buttons
      const allBtn = createButton({
        text: 'All',
        size: 'xs',
        variant: state.filters.unread === null ? 'primary' : 'secondary',
        onClick: () => {
          state.filters.unread = null;
          applyFilters();
        }
      });
      quickFilters.appendChild(allBtn.render());

      const unreadBtn = createButton({
        text: 'Unread',
        size: 'xs',
        variant: state.filters.unread === true ? 'primary' : 'secondary',
        onClick: () => {
          state.filters.unread = true;
          applyFilters();
        }
      });
      quickFilters.appendChild(unreadBtn.render());

      // Date preset buttons
      const todayBtn = createButton({
        text: 'Today',
        size: 'xs',
        variant: state.filters.datePreset === 'today' ? 'primary' : 'secondary',
        onClick: () => {
          state.filters.datePreset = state.filters.datePreset === 'today' ? null : 'today';
          applyFilters();
        }
      });
      quickFilters.appendChild(todayBtn.render());

      const weekBtn = createButton({
        text: 'This Week',
        size: 'xs',
        variant: state.filters.datePreset === 'week' ? 'primary' : 'secondary',
        onClick: () => {
          state.filters.datePreset = state.filters.datePreset === 'week' ? null : 'week';
          applyFilters();
        }
      });
      quickFilters.appendChild(weekBtn.render());

      const monthBtn = createButton({
        text: 'This Month',
        size: 'xs',
        variant: state.filters.datePreset === 'month' ? 'primary' : 'secondary',
        onClick: () => {
          state.filters.datePreset = state.filters.datePreset === 'month' ? null : 'month';
          applyFilters();
        }
      });
      quickFilters.appendChild(monthBtn.render());

      // Clear filters button (only show if filters are active)
      if (hasActiveFilters()) {
        const clearBtn = createButton({
          text: 'Clear Filters',
          size: 'xs',
          variant: 'tertiary',
          onClick: clearFilters
        });
        const clearEl = clearBtn.render();
        clearEl.classList.add('clear-filters-btn');
        quickFilters.appendChild(clearEl);
      }
    }

    filterBar.appendChild(quickFilters);

    // Advanced filters toggle
    if (createButton) {
      const toggleBtn = createButton({
        text: state.filtersExpanded ? '▼ Advanced Filters' : '▶ Advanced Filters',
        size: 'xs',
        variant: 'tertiary',
        onClick: () => setState({ filtersExpanded: !state.filtersExpanded })
      });
      const toggleEl = toggleBtn.render();
      toggleEl.classList.add('advanced-toggle');
      filterBar.appendChild(toggleEl);
    }

    // Advanced filters panel (collapsible)
    if (state.filtersExpanded) {
      const advancedPanel = createElement('div', { className: 'advanced-filters' });

      // Tags filter row
      const tagsRow = createElement('div', { className: 'filter-row' });
      tagsRow.appendChild(createElement('label', { textContent: 'Tags (comma-separated):' }));

      const tagsInput = createElement('input', {
        className: 'vscode-input filter-input',
        attributes: {
          type: 'text',
          placeholder: 'e.g., ai::request, priority::high'
        }
      });
      tagsInput.value = state.filters.tags ? state.filters.tags.join(', ') : '';
      tagsRow.appendChild(tagsInput);

      // Tags match all checkbox
      const matchAllLabel = createElement('label', { className: 'checkbox-label' });
      const matchAllCheckbox = createElement('input', {
        attributes: { type: 'checkbox' }
      });
      matchAllCheckbox.checked = state.filters.tags_match_all;
      matchAllCheckbox.addEventListener('change', () => {
        state.filters.tags_match_all = matchAllCheckbox.checked;
      });
      matchAllLabel.appendChild(matchAllCheckbox);
      matchAllLabel.appendChild(document.createTextNode(' Match all tags'));
      tagsRow.appendChild(matchAllLabel);

      advancedPanel.appendChild(tagsRow);

      // Custom date range row
      const dateRow = createElement('div', { className: 'filter-row' });
      dateRow.appendChild(createElement('label', { textContent: 'Custom date range:' }));

      const fromInput = createElement('input', {
        className: 'vscode-input filter-input date-input',
        attributes: {
          type: 'date',
          placeholder: 'From'
        }
      });
      if (state.filters.created_after && !state.filters.datePreset) {
        fromInput.value = state.filters.created_after.split('T')[0];
      }
      fromInput.addEventListener('change', () => {
        state.filters.datePreset = null;
        state.filters.created_after = fromInput.value ? new Date(fromInput.value).toISOString() : null;
      });
      dateRow.appendChild(fromInput);

      dateRow.appendChild(createElement('span', { textContent: ' to ', className: 'date-separator' }));

      const toInput = createElement('input', {
        className: 'vscode-input filter-input date-input',
        attributes: {
          type: 'date',
          placeholder: 'To'
        }
      });
      if (state.filters.created_before && !state.filters.datePreset) {
        toInput.value = state.filters.created_before.split('T')[0];
      }
      toInput.addEventListener('change', () => {
        state.filters.datePreset = null;
        state.filters.created_before = toInput.value ? new Date(toInput.value + 'T23:59:59').toISOString() : null;
      });
      dateRow.appendChild(toInput);

      advancedPanel.appendChild(dateRow);

      // Apply button for advanced filters
      if (createButton) {
        const applyRow = createElement('div', { className: 'filter-row filter-actions' });
        const applyBtn = createButton({
          text: 'Apply Filters',
          size: 'sm',
          variant: 'primary',
          onClick: () => {
            // Parse tags from input
            const tagsValue = tagsInput.value.trim();
            state.filters.tags = tagsValue
              ? tagsValue.split(',').map(t => t.trim()).filter(t => t.length > 0)
              : null;
            applyFilters();
          }
        });
        applyRow.appendChild(applyBtn.render());
        advancedPanel.appendChild(applyRow);
      }

      filterBar.appendChild(advancedPanel);
    }

    return filterBar;
  }

  function render() {
    const mount = root();
    if (!mount) {
      return;
    }

    // Save scroll position from old container before destroying DOM
    const oldContainer = mount.querySelector('.messages-container');
    const prevScroll = oldContainer ? oldContainer.scrollTop : 0;

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

    // Add filter bar after header
    const filterBar = renderFilterBar();

    const messagesContainer = createElement('div', { className: 'messages-container' });
    renderMessagesSection(messagesContainer, prevScroll);

    view.appendChild(header);
    view.appendChild(filterBar);
    view.appendChild(messagesContainer);

    mount.appendChild(view);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;

    switch (message.command) {
      case 'updateMessages':
        setState({ messages: message.data || [], loading: false, _scrollToBottom: true });
        break;
      case 'setLoading': {
        const isLoading = Boolean(message.data?.loading);
        // Skip redundant render when loading finishes and messages are already displayed
        if (!isLoading && !state.loading) break;
        setState({ loading: isLoading });
        break;
      }
      case 'setError':
        setState({ error: message.data, loading: false });
        break;
      case 'updateState':
        setState(message.data || {});
        break;
      case 'update':
        setState(message.data || {});
        break;
      // WebSocket events
      case 'wsMessageNew':
        handleWsMessageNew(message.data);
        break;
      case 'wsMessageUpdate':
        handleWsMessageUpdate(message.data);
        break;
      case 'wsMessageDelete':
        handleWsMessageDelete(message.data);
        break;
      case 'wsTypingUpdate':
        handleWsTypingUpdate(message.data);
        break;
      default:
        break;
    }
  });

  // WebSocket event handlers — patch DOM directly, no full re-render
  function handleWsMessageNew(data) {
    if (!data) return;
    state.messages = [...state.messages, data];

    const container = document.querySelector('.messages-container');
    if (!container) return;

    // Remove empty state if present
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    // Flat layout: all messages are siblings in the container
    const typingEl = container.querySelector('.typing-indicator');
    let level = 0;
    if (data.parent_id) {
      // Find parent's level from state and go one deeper
      const parent = state.messages.find((m) => m.id === data.parent_id);
      level = (parent?.level ?? 0) + 1;
    }
    data.level = level;
    const node = renderMessageNode(data, level);
    container.insertBefore(node, typingEl || null);

    // Scroll to bottom for new messages
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }

  function handleWsMessageUpdate(data) {
    if (!data || !data.messageId) return;
    state.messages = state.messages.map((msg) => {
      if (msg.id === data.messageId) {
        return { ...msg, ...data };
      }
      return msg;
    });

    const container = document.querySelector('.messages-container');
    if (!container) return;

    const oldCard = container.querySelector(`[data-message-id="${data.messageId}"]`);
    if (!oldCard) return;

    // Find the updated message in state
    const updatedMsg = state.messages.find((m) => m.id === data.messageId);
    if (!updatedMsg) return;

    // Re-render just this card, preserving children (replies)
    const newCard = renderMessageNode(updatedMsg, updatedMsg.level ?? 0);
    oldCard.replaceWith(newCard);
  }

  function handleWsMessageDelete(data) {
    if (!data || !data.messageId) return;
    state.messages = state.messages.filter((msg) => msg.id !== data.messageId);

    const container = document.querySelector('.messages-container');
    if (!container) return;

    const card = container.querySelector(`[data-message-id="${data.messageId}"]`);
    if (card) {
      card.remove();
    }

    // Show empty state if no messages left
    if (state.messages.length === 0) {
      container.appendChild(
        createElement('div', {
          className: 'empty-state',
          textContent: 'No messages yet. Use the input panel below to start the discussion.'
        })
      );
    }
  }

  function handleWsTypingUpdate(data) {
    if (!data) return;
    const { userId, userName, isTyping } = data;

    let typingUsers = [...(state.typingUsers || [])];

    if (isTyping) {
      if (!typingUsers.find((u) => u.userId === userId)) {
        typingUsers.push({ userId, userName });
      }
    } else {
      typingUsers = typingUsers.filter((u) => u.userId !== userId);
    }

    // Update state without re-render
    state.typingUsers = typingUsers;

    // Patch the typing indicator in-place
    const container = document.querySelector('.messages-container');
    if (!container) return;

    const existing = container.querySelector('.typing-indicator');
    if (existing) {
      existing.remove();
    }

    if (typingUsers.length > 0) {
      container.appendChild(renderTypingIndicator());
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    state._scrollToBottom = true;
    render();
  });
})();
