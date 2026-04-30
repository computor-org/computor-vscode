// Example Details Webview Script

(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();
  let state = window.__INITIAL_STATE__ || {};

  function init() {
    renderView();
    attachEventListeners();
  }

  function renderView() {
    const app = document.getElementById('app');
    if (!app) return;

    const { example, repository, versions, latestVersion, isDownloaded, localVersion, currentVersion } = state;

    if (!example) {
      app.innerHTML = '<div class="empty-state">No example selected.</div>';
      return;
    }

    const sortedVersions = (versions || []).slice().sort((a, b) => b.version_number - a.version_number);
    const displayVersion = localVersion || currentVersion || (latestVersion ? latestVersion.version_tag : 'N/A');
    const repoName = repository ? (repository.title || repository.name) : 'Unknown';
    const title = example.title || example.directory;

    app.innerHTML = `
      <header class="detail-header">
        <div class="detail-header-main">
          <h1 class="detail-title">${escapeHtml(title)}</h1>
          <p class="detail-subtitle">${escapeHtml(example.identifier || example.directory)}</p>
        </div>
        ${isDownloaded
          ? `<span class="status-pill checked-out" title="Checked out locally">
               <span class="pill-icon">✓</span>
               Checked out · <span class="pill-version">${escapeHtml(displayVersion)}</span>
             </span>`
          : `<span class="status-pill not-checked-out" title="Not checked out">
               <span class="pill-icon">○</span>
               Remote only
             </span>`
        }
      </header>

      <section class="section">
        <h2 class="section-title">Details</h2>
        <div class="card">
          <dl class="field-grid">
            <dt>Identifier</dt>
            <dd><code>${escapeHtml(example.identifier)}</code></dd>
            <dt>Directory</dt>
            <dd><code>${escapeHtml(example.directory)}</code></dd>
            <dt>Repository</dt>
            <dd>${escapeHtml(repoName)}</dd>
            ${example.subject ? `
              <dt>Subject</dt>
              <dd>${escapeHtml(example.subject)}</dd>
            ` : ''}
            ${example.category ? `
              <dt>Category</dt>
              <dd>${escapeHtml(example.category)}</dd>
            ` : ''}
            ${example.tags && example.tags.length > 0 ? `
              <dt>Tags</dt>
              <dd><div class="tag-list">${example.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div></dd>
            ` : ''}
          </dl>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Actions</h2>
        <div class="card">
          <div class="action-row">
            <button class="btn" id="checkoutLatestBtn">Checkout Latest</button>
            <button class="btn secondary" id="refreshBtn">Refresh</button>
          </div>
          ${isDownloaded ? `
            <div class="action-row">
              <span class="action-label">Bump version:</span>
              <span class="bump-group">
                <button class="btn secondary" data-bump="patch" title="Bump patch (x.y.Z)">Patch</button>
                <button class="btn secondary" data-bump="minor" title="Bump minor (x.Y.0)">Minor</button>
                <button class="btn secondary" data-bump="major" title="Bump major (X.0.0)">Major</button>
              </span>
              <button class="btn" id="uploadBtn">Upload working copy</button>
            </div>
          ` : ''}
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Versions (${sortedVersions.length})</h2>
        ${sortedVersions.length === 0
          ? '<div class="empty-state">No versions available yet.</div>'
          : `<div class="version-table">
              ${sortedVersions.map(v => {
                const isLatest = latestVersion && v.id === latestVersion.id;
                const isCurrent = currentVersion && v.version_tag === currentVersion;
                const rowClasses = ['version-row'];
                if (isLatest) { rowClasses.push('is-latest'); }
                if (isCurrent) { rowClasses.push('is-current'); }
                return `
                  <div class="${rowClasses.join(' ')}">
                    <span class="version-tag">${escapeHtml(v.version_tag)}</span>
                    <span class="version-number">#${v.version_number}</span>
                    <span class="version-date">${v.created_at ? formatDate(v.created_at) : ''}</span>
                    <span class="version-actions">
                      <button class="btn secondary compact" data-checkout-version="${escapeHtml(v.id)}" title="Checkout this version">
                        Checkout
                      </button>
                    </span>
                  </div>`;
              }).join('')}
            </div>`
        }
      </section>
    `;
  }

  function attachEventListeners() {
    const checkoutLatestBtn = document.getElementById('checkoutLatestBtn');
    if (checkoutLatestBtn) {
      checkoutLatestBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'checkoutLatest' });
      });
    }

    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'refresh' });
      });
    }

    const uploadBtn = document.getElementById('uploadBtn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'upload' });
      });
    }

    document.querySelectorAll('[data-bump]').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ command: 'bumpVersion', data: { part: btn.dataset.bump } });
      });
    });

    document.querySelectorAll('[data-checkout-version]').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ command: 'checkoutVersion', data: { versionId: btn.dataset.checkoutVersion } });
      });
    });
  }

  function formatDate(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return isoString;
    }
  }

  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.command) {
      case 'update':
        state = message.data;
        renderView();
        attachEventListeners();
        break;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
