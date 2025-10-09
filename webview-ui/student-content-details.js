(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();

  const state = {
    ...(window.__INITIAL_STATE__ || {})
  };

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

  function formatPercent(value) {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return '-';
    }
    return `${Math.round(value)}%`;
  }

  function formatCount(current, max) {
    if (current === undefined || current === null) {
      return '-';
    }
    if (max === undefined || max === null) {
      return `${current}`;
    }
    return `${current} / ${max}`;
  }

  function formatDate(value) {
    if (!value) {
      return undefined;
    }
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }

  function formatStatus(value) {
    if (!value) {
      return '-';
    }
    return String(value)
      .toLowerCase()
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function pickValue(source, keys, fallback) {
    if (!source) {
      return fallback;
    }
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined && source[key] !== null) {
        return source[key];
      }
    }
    return fallback;
  }

  function sendMessage(command, data) {
    vscode.postMessage({ command, data });
  }

  function renderActions(actionsContainer, actions) {
    actionsContainer.innerHTML = '';
    if (!actions) {
      return;
    }

    if (actions.localPath) {
      const openFolderBtn = document.createElement('button');
      openFolderBtn.className = 'vscode-button vscode-button--secondary';
      openFolderBtn.textContent = 'Reveal in Explorer';
      openFolderBtn.addEventListener('click', () => sendMessage('openFolder', { path: actions.localPath }));
      actionsContainer.appendChild(openFolderBtn);
    }

    if (actions.webUrl) {
      const openRepoBtn = document.createElement('button');
      openRepoBtn.className = 'vscode-button vscode-button--secondary';
      openRepoBtn.textContent = 'Open Repository';
      openRepoBtn.addEventListener('click', () => sendMessage('openGitlab', { url: actions.webUrl }));
      actionsContainer.appendChild(openRepoBtn);
    }

    if (actions.cloneUrl) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'vscode-button vscode-button--tertiary';
      copyBtn.textContent = 'Copy Clone URL';
      copyBtn.addEventListener('click', () => sendMessage('copyCloneUrl', { url: actions.cloneUrl }));
      actionsContainer.appendChild(copyBtn);
    }
  }

  function renderGradingHistory(history) {
    if (!Array.isArray(history) || history.length === 0) {
      return `
        <section class="card grading-history">
          <h2>Grading History</h2>
          <div class="empty-state">No grading history yet.</div>
        </section>
      `;
    }

    const items = history.map((entry) => {
      const gradeText = formatPercent(entry.gradePercent);
      const statusText = formatStatus(entry.status);
      const gradedAt = formatDate(entry.gradedAt) || '-';
      const grader = entry.graderName || 'Unknown';
      const feedback = entry.feedback ? `<div class="history-feedback">${escapeHtml(entry.feedback)}</div>` : '';

      return `
        <article class="history-item">
          <div class="history-header">
            <span class="history-grade">${escapeHtml(gradeText)}</span>
            <span class="history-status chip">${escapeHtml(statusText)}</span>
            <span class="history-date">${escapeHtml(gradedAt)}</span>
          </div>
          <div class="history-meta">Graded by ${escapeHtml(grader)}</div>
          ${feedback}
        </article>
      `;
    }).join('');

    return `
      <section class="card grading-history">
        <h2>Grading History</h2>
        <div class="history-list">${items}</div>
      </section>
    `;
  }

  function renderResultsHistory(results) {
    if (!Array.isArray(results) || results.length === 0) {
      return `
        <section class="card results-history">
          <h2>Results History</h2>
          <div class="empty-state">No test results yet.</div>
        </section>
      `;
    }

    const items = results.map((entry) => {
      const resultPercent = pickValue(entry, ['resultPercent', 'result_percent']);
      const hasScore = typeof resultPercent === 'number' && !Number.isNaN(resultPercent);
      const testSystemId = pickValue(entry, ['testSystemId', 'test_system_id']);
      const hasTest = Boolean(testSystemId);
      const scoreText = hasTest && hasScore ? formatPercent(resultPercent) : '-';
      const statusRaw = pickValue(entry, ['status']);
      const statusText = formatStatus(statusRaw);
      const createdRaw = pickValue(entry, ['createdAt', 'created_at']);
      const updatedRaw = pickValue(entry, ['updatedAt', 'updated_at']);
      const createdDisplay = createdRaw ? formatDate(createdRaw) || '-' : '-';
      const updatedDisplay = formatDate(updatedRaw || createdRaw) || '-';
      const completedRaw = updatedRaw && createdRaw && updatedRaw !== createdRaw ? updatedRaw : undefined;
      const completedDisplay = completedRaw ? formatDate(completedRaw) || '-' : '-';
      const isSubmission = pickValue(entry, ['submit']) === true;
      const attemptLabel = isSubmission ? 'Submission' : 'Test Run';
      const testLabel = hasTest ? 'Tests Complete' : 'Awaiting Tests';
      const scoreLabel = hasTest
        ? (isSubmission ? 'Submission Score' : 'Test Result')
        : 'No Evaluation';

      const chips = [
        `<span class="chip chip-strong">${escapeHtml(attemptLabel)}</span>`,
        `<span class="chip ${hasTest ? 'chip-success' : 'chip-warning'}">${escapeHtml(testLabel)}</span>`
      ];
      if (statusText && statusText !== '-') {
        chips.push(`<span class="chip">${escapeHtml(statusText)}</span>`);
      }

      const detailCards = [];
      detailCards.push({ label: scoreLabel, value: scoreText, modifier: 'history-card--score' });
      detailCards.push({ label: 'Attempt Type', value: attemptLabel });
      detailCards.push({ label: 'Tests', value: hasTest ? 'Completed' : '-' });

      const detailMarkup = `<div class="history-body">${detailCards.map(card => {
        const classes = ['history-card'];
        if (card.modifier) {
          classes.push(card.modifier);
        }
        return `
          <div class="${classes.join(' ')}">
            <span class="label">${escapeHtml(card.label)}</span>
            <span class="value">${escapeHtml(card.value)}</span>
          </div>
        `;
      }).join('')}</div>`;

      let noteText = '';

      const timelineParts = [];
      // if (createdDisplay && createdDisplay !== '-') {
      //   timelineParts.push(`Started ${escapeHtml(createdDisplay)}`);
      // }
      // if (completedDisplay && completedDisplay !== '-' && completedDisplay !== createdDisplay) {
      //   timelineParts.push(`Finished ${escapeHtml(completedDisplay)}`);
      // }
      const timelineMarkup = timelineParts.length > 0
        ? `<div class="history-meta">${timelineParts.join(' • ')}</div>`
        : '';

      const noteMarkup = noteText
        ? `<div class="history-note">${escapeHtml(noteText)}</div>`
        : '';

      return `
        <article class="history-item">
          <div class="history-header">
            <div class="chip-row history-header-tags">${chips.join('')}</div>
            <span class="history-date">${escapeHtml(updatedDisplay)}</span>
          </div>
          ${detailMarkup}
          ${timelineMarkup}
          ${noteMarkup}
        </article>
      `;
    }).join('');

    return `
      <section class="card results-history">
        <h2>Results History</h2>
        <div class="history-list">${items}</div>
      </section>
    `;
  }

  function render() {
    const root = document.getElementById('app');
    if (!root) {
      return;
    }

    const data = state;
    const content = data.content || {};
    const contentType = data.contentType || {};
    const metrics = data.metrics || {};
    const repository = data.repository || {};
    const submissionGroup = data.submissionGroup || {};
    const team = data.team || {};
    const gradingHistory = Array.isArray(data.gradingHistory) ? data.gradingHistory : [];
    const resultsHistory = Array.isArray(data.resultsHistory) ? data.resultsHistory : [];

    const headerSubtitleParts = [];
    if (data.course?.title) {
      headerSubtitleParts.push(data.course.title);
    }
    if (content.path) {
      headerSubtitleParts.push(content.path);
    }

    const statusChips = [];
    function addStatusChip(value) {
      if (value === undefined || value === null) {
        return;
      }
      const raw = String(value).trim();
      const lower = raw.toLowerCase();
      if (!raw || raw === '-' || lower === 'unknown') {
        return;
      }
      const formatted = formatStatus(raw);
      if (!statusChips.includes(formatted)) {
        statusChips.push(formatted);
      }
    }
    if (contentType && (contentType.title || contentType.slug)) {
      addStatusChip(contentType.title || contentType.slug);
    }
    if (metrics.submitted) {
      addStatusChip('Submitted');
    }
    addStatusChip(metrics.gradeStatus || submissionGroup.status);

    const repoInfoItems = [];
    if (repository.fullPath) {
      repoInfoItems.push(`<div class="info-item"><span class="info-item-label">Remote Path</span><span class="info-item-value monospace">${escapeHtml(repository.fullPath)}</span></div>`);
    }
    if (repository.cloneUrl) {
      repoInfoItems.push(`<div class="info-item"><span class="info-item-label">Clone URL</span><span class="info-item-value monospace">${escapeHtml(repository.cloneUrl)}</span></div>`);
    }
    if (repository.localPath) {
      repoInfoItems.push(`<div class="info-item"><span class="info-item-label">Local Path</span><span class="info-item-value monospace">${escapeHtml(repository.localPath)}</span></div>`);
    }
    repoInfoItems.push(`<div class="info-item"><span class="info-item-label">Cloned</span><span class="info-item-value">${repository.isCloned ? 'Yes' : 'No'}</span></div>`);

    const teamItems = (team.members || []).map(member => {
      const name = member.name || member.full_name || member.username || 'Unknown member';
      return `<div class="team-member">${escapeHtml(name)}</div>`;
    });

    const headerSubtitle = headerSubtitleParts.length > 0
      ? `<div class="subtitle">${headerSubtitleParts.map(escapeHtml).join(' • ')}</div>`
      : '';

    const chips = statusChips.length > 0
      ? `<div class="chip-row">${statusChips.map(text => `<span class="chip">${text}</span>`).join('')}</div>`
      : '';

    const gradedAt = formatDate(metrics.gradedAt);
    const rawStatus = metrics.gradeStatus ?? submissionGroup.status ?? '';
    const statusString = String(rawStatus || '').trim();
    const statusDisplay = statusString && statusString.toLowerCase() !== 'unknown'
      ? formatStatus(statusString)
      : '-';

    root.innerHTML = `
      <div class="view-header">
        <div class="header-row">
          <h1>${escapeHtml(content.title || content.path || 'Course Content')}</h1>
          <button type="button" class="vscode-button vscode-button--secondary header-close" data-close>Close</button>
        </div>
        ${headerSubtitle}
        ${chips}
      </div>

      <section class="card">
        <h2>Overview</h2>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-item-label">Content Path</span>
            <span class="info-item-value">${escapeHtml(content.path || '-')}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Type</span>
            <span class="info-item-value">${escapeHtml(contentType.title || contentType.slug || 'Unknown')}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Course</span>
            <span class="info-item-value">${escapeHtml(data.course?.title || 'Current course')}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Group Size</span>
            <span class="info-item-value">${formatCount(team.currentSize, team.maxSize)}</span>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Progress &amp; Results</h2>
        <div class="stat-grid">
          <div class="stat-card">
            <strong>${formatCount(metrics.testsRun, metrics.maxTests)}</strong>
            <span>Test Runs</span>
          </div>
          <div class="stat-card">
            <strong>${formatCount(metrics.submissions, metrics.maxSubmissions)}</strong>
            <span>Submissions</span>
          </div>
          <div class="stat-card">
            <strong>${formatPercent(metrics.resultPercent)}</strong>
            <span>Latest Test Result</span>
          </div>
          <div class="stat-card">
            <strong>${formatPercent(metrics.gradePercent)}</strong>
            <span>Grading</span>
          </div>
        </div>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-item-label">Status</span>
            <span class="info-item-value">${escapeHtml(statusDisplay)}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Feedback</span>
            <span class="info-item-value">${escapeHtml(metrics.feedback || '-')}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Graded by</span>
            <span class="info-item-value">${escapeHtml(metrics.gradedBy || '-')}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Graded at</span>
            <span class="info-item-value">${escapeHtml(gradedAt || 'Not graded')}</span>
          </div>
        </div>
      </section>

      ${renderGradingHistory(gradingHistory)}

      <section class="card">
        <h2>Repository</h2>
        <div class="info-grid">${repoInfoItems.join('')}</div>
        <div class="actions" data-actions></div>
      </section>

      <section class="card">
        <h2>Submission Group</h2>
        ${teamItems.length > 0 ? `<div class="team-list">${teamItems.join('')}</div>` : '<div class="empty-state">No additional team members.</div>'}
      </section>

      ${renderResultsHistory(resultsHistory)}
    `;

    const actionsContainer = root.querySelector('[data-actions]');
    renderActions(actionsContainer, data.actions);

    const closeButton = root.querySelector('[data-close]');
    if (closeButton) {
      closeButton.addEventListener('click', () => sendMessage('close'));
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.command === 'updateState' || message.command === 'update') {
      Object.assign(state, message.data || {});
      render();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    render();
  });
})();
