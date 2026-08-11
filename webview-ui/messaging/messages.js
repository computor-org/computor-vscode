(function () {
  // Shared runtime (base.js). formatDateTime matches the old local
  // formatDate (toLocaleString, i.e. date + time).
  const { vscode, escapeHtml, formatDateTime: formatDate, el, createStore } = window.ComputorWebview;

  const { state, setState } = createStore({
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
      created_before: null
    },
    typingUsers: [], // { userId, userName }
    _scrollToBottom: false,
    ...(window.__INITIAL_STATE__ || {})
  }, render);

  const root = () => document.getElementById('app');

  /**
   * Announcements and conversations are two different reading experiences,
   * and this panel used to render both as a chat log.
   *
   * A conversation is read forwards: oldest first, newest at the bottom
   * where you are typing, scrolled to the end, with a typing indicator.
   * An announcement board is read backwards: the newest one matters most,
   * nobody is "typing" at you, and being scrolled to the bottom shows you
   * the oldest notice in the course.
   *
   * `kind` comes from the target (server-computed for real messages), so an
   * empty announcement board still knows not to invite you to "start the
   * discussion".
   */
  const isAnnouncement = () => state.target?.kind === 'announcement';

  /**
   * Marks an announcement read once the reader has actually seen it.
   *
   * A board is worked through item by item, so clearing every notice because
   * the panel was opened loses the reader's place — and made the panel's own
   * "Unread" filter self-defeating, since it ran right after the sweep that
   * emptied it. A card counts as seen when most of it has been on screen for
   * a moment; ids are batched so a fast scroll is one request, not thirty.
   */
  const seenObserver = (() => {
    if (typeof IntersectionObserver === 'undefined') { return null; }
    const pending = new Set();
    const dwelling = new Map();
    let flushTimer = null;
    const DWELL_MS = 700;
    const BATCH_MS = 400;

    function flush() {
      flushTimer = null;
      if (pending.size === 0) { return; }
      const messageIds = [...pending];
      pending.clear();
      vscode.postMessage({ command: 'markRead', data: { messageIds } });
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const id = entry.target.dataset.messageId;
        if (!id) { return; }
        if (!entry.isIntersecting) {
          clearTimeout(dwelling.get(id));
          dwelling.delete(id);
          return;
        }
        if (dwelling.has(id)) { return; }
        dwelling.set(id, setTimeout(() => {
          dwelling.delete(id);
          observer.unobserve(entry.target);
          entry.target.classList.remove('message-unread');
          pending.add(id);
          if (!flushTimer) { flushTimer = setTimeout(flush, BATCH_MS); }
        }, DWELL_MS));
      });
    }, { threshold: 0.6 });

    return {
      watch(card) { observer.observe(card); },
      reset() {
        observer.disconnect();
        dwelling.forEach((t) => clearTimeout(t));
        dwelling.clear();
      }
    };
  })();

  // Thread assembly and ordering live in shared/messageThreads.js — pure, and
  // unit-tested there.
  const { buildThreads, flattenThreads } = window.ComputorWebview.messageThreads;

  function renderMarkdown(text) {
    if (!text) {
      return '';
    }
    if (typeof window.marked !== 'undefined') {
      // Message bodies are other users' content: sanitize the rendered HTML so
      // raw HTML in the source can't inject markup or image beacons.
      return window.ComputorWebview.sanitizeHtml(window.marked.parse(text));
    }
    return escapeHtml(text).replace(/\n/g, '<br/>');
  }

  // @[name](uuid) tokens are markdown-link syntax, so swap them for safe
  // placeholders around marked(), then re-insert highlighted mention chips.
  // The display name comes from message.mentions (kept fresh on renames),
  // falling back to the name embedded in the token.
  const MENTION_TOKEN_RE = /@\[([^\]]*)\]\(([0-9a-fA-F-]{36})\)/g;

  function formatRoleLabel(roleId) {
    if (!roleId) { return ''; }
    return String(roleId).replace(/^_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function renderContentWithMentions(message) {
    const infoById = {};
    (message.mentions || []).forEach((m) => {
      if (m && m.id) {
        infoById[String(m.id).toLowerCase()] = {
          name: [m.given_name, m.family_name].filter(Boolean).join(' ').trim(),
          role: formatRoleLabel(m.course_role_id)
        };
      }
    });
    const placeholders = [];
    const replaced = String(message.content || '').replace(MENTION_TOKEN_RE, (full, name, uuid) => {
      const info = infoById[uuid.toLowerCase()] || {};
      const display = info.name || name || 'user';
      // Themed hover (data-tooltip + CSS, not the native black `title`) shows the
      // course role; omitted when there's no extra info beyond the visible name.
      const tooltip = info.role ? display + ' — ' + info.role : '';
      const attr = tooltip ? ' data-tooltip="' + escapeHtml(tooltip) + '"' : '';
      const idx = placeholders.length;
      placeholders.push('<span class="mention-chip"' + attr + '>' + escapeHtml(display) + '</span>');
      return '@@CTMENTION' + idx + '@@';
    });
    let html = renderMarkdown(replaced);
    placeholders.forEach((chip, idx) => {
      html = html.split('@@CTMENTION' + idx + '@@').join(chip);
    });
    return html;
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

  // Buttons are plain base.css primitives (.btn + size/variant modifiers);
  // this only saves repeating the element-then-listener dance at each site.
  function button(text, className, onClick) {
    const node = createElement('button', {
      className: className,
      textContent: text,
      attributes: { type: 'button' }
    });
    node.addEventListener('click', onClick);
    return node;
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

    setState({ loading: true });
    vscode.postMessage({ command: 'applyFilters', data: filterData });
  }

  function clearFilters() {
    setState({
      filters: {
        unread: null,
        datePreset: null,
        created_after: null,
        created_before: null
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
      state.filters.created_before !== null
    );
  }

  function renderMessageNode(message, depth = 0) {
    const level = message.level ?? depth;
    // A deleted message only reaches the list when it still has live replies,
    // and it is kept solely so those replies keep their context — so mark it
    // as spent rather than letting it read like an ordinary message.
    const announcement = isAnnouncement();
    // Unread is only rendered on a board, where it survives being looked at
    // and tells the reader where they left off. A conversation is read by
    // opening it, so every card would carry the marker.
    const unread = announcement && message.is_read === false && !message.is_author;
    const card = createElement('article', {
      className: [
        'message-card',
        announcement ? 'message-announcement' : '',
        unread ? 'message-unread' : '',
        level > 0 ? 'message-reply' : '',
        message.is_deleted ? 'message-deleted' : ''
      ].filter(Boolean).join(' '),
      // data-level lets a live arrival find the end of its parent's subtree
      // without rebuilding the tree (see insertionPointFor).
      attributes: { 'data-message-id': message.id, 'data-level': String(level) }
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
        className: `badge xs author-role-badge role-${roleClass}`,
        textContent: roleLabel,
        attributes: {
          title: `Course Role: ${roleLabel}`
        }
      });
      metaLeftChildren.push(roleBadge);
    }

    // No per-message scope badge: every panel now pins exactly one scope, so
    // the chip was identical on every card in the list. It existed back when
    // a single panel mixed submission-group, course-content and course-wide
    // messages together and you needed to tell them apart.

    const metaLeft = createElement('div', {
      className: 'message-meta-left',
      children: metaLeftChildren
    });

    const metaRight = createElement('div', { className: 'message-meta-right' });

    const repliesAllowed = state.target?.allowReplies !== false;
    if (repliesAllowed) {
      metaRight.appendChild(
        button('Reply', 'btn secondary xs message-reply-button', () =>
          vscode.postMessage({ command: 'replyTo', data: message })
        )
      );
    }

    metaRight.appendChild(
      createElement('span', { textContent: formatDate(message.updated_at || message.created_at), className: 'message-meta-date' })
    );

    meta.appendChild(metaLeft);
    meta.appendChild(metaRight);

    // An announcement is identified by its subject, so it is the headline
    // and always present — the backend requires one. Legacy rows predating
    // that rule get a placeholder rather than an untitled card.
    const title = announcement
      ? createElement('h3', {
          className: 'message-title',
          textContent: message.title || '(no subject)'
        })
      : message.title
        ? createElement('h3', {
            className: 'message-title',
            textContent: message.title
          })
        : null;

    const body = createElement('div', {
      className: 'message-body markdown-body',
      innerHTML: renderContentWithMentions(message)
    });

    const actions = createElement('div', { className: 'message-actions' });

    // can_edit/can_delete, not is_author: a deleted message stays authored by
    // the person who wrote it, and the backend refuses to edit or re-delete
    // it. Offering the buttons on a tombstone is what made the deletion in
    // computor-org/issues#288 look like it had failed.
    if (message.can_edit) {
      actions.appendChild(
        button('Edit', 'btn secondary sm', () =>
          vscode.postMessage({ command: 'editMessage', data: message })
        )
      );
    }
    if (message.can_delete) {
      actions.appendChild(
        button('Delete', 'btn ghost sm', () =>
          vscode.postMessage({
            command: 'confirmDeleteMessage',
            data: { messageId: message.id, title: message.title }
          })
        )
      );
    }

    // On an announcement the subject leads and the byline follows it; in a
    // conversation the speaker leads and the body follows.
    if (announcement && title) {
      card.appendChild(title);
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

    if (title && !announcement) {
      card.appendChild(title);
    }
    card.appendChild(body);
    if (actions.childNodes.length > 0) {
      card.appendChild(actions);
    }

    if (unread && seenObserver) {
      seenObserver.watch(card);
    }

    // Don't nest children — they are rendered flat by flattenThreads
    return card;
  }

  function renderMessagesSection(container, prevScroll) {
    // The old cards are about to be discarded; stop watching them so their
    // dwell timers can't fire against detached nodes.
    if (seenObserver) { seenObserver.reset(); }
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
          textContent: emptyStateText()
        })
      );
      return;
    }

    const threads = buildThreads(state.messages, { newestFirst: isAnnouncement() });
    const flat = flattenThreads(threads);
    flat.forEach((msg) => {
      container.appendChild(renderMessageNode(msg, msg.level ?? 0));
    });

    // Nobody types at a notice board — the indicator only belongs where
    // someone is composing a reply you are waiting for.
    if (!isAnnouncement() && state.typingUsers && state.typingUsers.length > 0) {
      container.appendChild(renderTypingIndicator());
    }

    if (isAnnouncement()) {
      // Newest is already at the top; jumping to the bottom would land the
      // reader on the oldest notice in the course.
      state._scrollToBottom = false;
      container.scrollTop = prevScroll > 0 ? prevScroll : 0;
      return;
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

  function emptyStateText() {
    if (isAnnouncement()) {
      return state.target?.readOnly
        ? 'No announcements yet.'
        : 'No announcements yet. Post one from the input panel below.';
    }
    return state.target?.readOnly
      ? 'No messages yet.'
      : 'No messages yet. Use the input panel below to start the discussion.';
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

    // A selected quick filter is the primary .btn; the rest are secondary.
    const filterChip = (selected) => `btn xs${selected ? '' : ' secondary'}`;

    quickFilters.appendChild(
      button('All', filterChip(state.filters.unread === null), () => {
        state.filters.unread = null;
        applyFilters();
      })
    );
    quickFilters.appendChild(
      button('Unread', filterChip(state.filters.unread === true), () => {
        state.filters.unread = true;
        applyFilters();
      })
    );

    for (const [preset, label] of [
      ['today', 'Today'],
      ['week', 'This Week'],
      ['month', 'This Month']
    ]) {
      quickFilters.appendChild(
        button(label, filterChip(state.filters.datePreset === preset), () => {
          state.filters.datePreset = state.filters.datePreset === preset ? null : preset;
          applyFilters();
        })
      );
    }

    if (hasActiveFilters()) {
      quickFilters.appendChild(
        button('Clear Filters', 'btn ghost xs clear-filters-btn', clearFilters)
      );
    }

    filterBar.appendChild(quickFilters);

    // Advanced filters toggle
    filterBar.appendChild(
      button(
        state.filtersExpanded ? '▼ Advanced Filters' : '▶ Advanced Filters',
        'btn ghost xs advanced-toggle',
        () => setState({ filtersExpanded: !state.filtersExpanded })
      )
    );

    // Advanced filters panel (collapsible)
    if (state.filtersExpanded) {
      const advancedPanel = createElement('div', { className: 'advanced-filters' });

      // No tag filter: tags were parsed out of the title with a regex, and
      // the only thing that ever wrote them was the agent's retired
      // "#ai" / "#ai::response" convention — it identifies itself by
      // author_id now. The subject line is a human subject again.

      // Custom date range row
      const dateRow = createElement('div', { className: 'filter-row' });
      dateRow.appendChild(createElement('label', { textContent: 'Custom date range:' }));

      const fromInput = createElement('input', {
        className: 'filter-input date-input',
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
        className: 'filter-input date-input',
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
      const applyRow = createElement('div', { className: 'filter-row filter-actions' });
      applyRow.appendChild(
        button('Apply Filters', 'btn sm', applyFilters)
      );
      advancedPanel.appendChild(applyRow);

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

    headerTop.appendChild(
      button('Refresh', 'btn secondary sm refresh-button', () => {
        setState({ loading: true });
        vscode.postMessage({ command: 'refreshMessages' });
      })
    );

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

  // Where a newly arrived message belongs in the flat list, expressed as the
  // node to insert before (null = append). Mirrors buildThreads/flattenThreads
  // so a live arrival lands exactly where the next full render would put it.
  function insertionPointFor(container, message) {
    const typingEl = container.querySelector('.typing-indicator');
    if (!message.parent_id) {
      // Newest-first on an announcement board, so a new root goes at the top.
      if (isAnnouncement()) {
        return container.querySelector('.message-card');
      }
      // A new root goes at the end of the list, before the typing indicator.
      return typingEl || null;
    }
    const parentCard = container.querySelector(
      `[data-message-id="${message.parent_id}"]`
    );
    if (!parentCard) {
      return typingEl || null;
    }
    // Skip past the parent's existing replies (its subtree is contiguous and
    // every descendant renders deeper than the parent).
    const parentLevel = Number(parentCard.dataset.level ?? 0);
    let cursor = parentCard.nextElementSibling;
    while (
      cursor &&
      cursor.classList.contains('message-card') &&
      Number(cursor.dataset.level ?? 0) > parentLevel
    ) {
      cursor = cursor.nextElementSibling;
    }
    return cursor || typingEl || null;
  }

  // True when the scroll position is at (or within a small threshold of) the
  // bottom of the list.
  function isNearBottom(container, threshold) {
    const gap = container.scrollHeight - container.scrollTop - container.clientHeight;
    return gap <= (threshold || 120);
  }

  // WebSocket event handlers — patch DOM directly, no full re-render
  function handleWsMessageNew(data) {
    if (!data) return;
    // The same message can reach us twice — over the socket and again in a
    // refresh that raced it — and appending blindly rendered it twice until
    // the next full render.
    if (state.messages.some((m) => m.id === data.id)) { return; }
    state.messages = [...state.messages, data];

    const container = document.querySelector('.messages-container');
    if (!container) return;

    // Capture this before mutating the DOM: only auto-scroll to the new message
    // if the user was already at the bottom, otherwise leave their scroll
    // position alone so reading history isn't interrupted.
    const wasNearBottom = isNearBottom(container);

    // Remove empty state if present
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    // Flat layout: all messages are siblings in the container, but a reply
    // belongs directly after its parent's subtree — appending it to the end
    // put it in a different place than the next full render would, so the
    // message visibly jumped on refresh.
    let level = 0;
    if (data.parent_id) {
      const parent = state.messages.find((m) => m.id === data.parent_id);
      level = (parent?.level ?? 0) + 1;
    }
    data.level = level;
    const node = renderMessageNode(data, level);
    container.insertBefore(node, insertionPointFor(container, data));

    // A new announcement lands at the top; scrolling to the bottom would
    // take the reader away from it.
    if (isAnnouncement()) {
      return;
    }

    // Follow the new message to the bottom only if the user was already there.
    if (wasNearBottom) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
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
          textContent: emptyStateText()
        })
      );
    }
  }

  function handleWsTypingUpdate(data) {
    if (!data) return;
    // Announcement scopes are lecturer-write-only broadcasts; a "someone is
    // typing" line on a notice board is noise, not presence.
    if (isAnnouncement()) return;
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
