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
      app.innerHTML = '<p>No example selected.</p>';
      return;
    }

    const sortedVersions = (versions || []).slice().sort((a, b) => b.version_number - a.version_number);
    const displayVersion = localVersion || currentVersion || (latestVersion ? latestVersion.version_tag : 'N/A');

    app.innerHTML = `
      <h2>${escapeHtml(example.title || example.directory)}</h2>

      <div class="section">
        <div class="section-title">Details</div>
        <div class="field">
          <div class="field-label">Identifier</div>
          <div class="field-value"><code>${escapeHtml(example.identifier)}</code></div>
        </div>
        <div class="field">
          <div class="field-label">Directory</div>
          <div class="field-value"><code>${escapeHtml(example.directory)}</code></div>
        </div>
        <div class="field">
          <div class="field-label">Repository</div>
          <div class="field-value">${escapeHtml(repository ? repository.title : 'Unknown')}</div>
        </div>
        ${example.tags && example.tags.length > 0 ? `
          <div class="field">
            <div class="field-label">Tags</div>
            <div class="field-value">${example.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
          </div>
        ` : ''}
      </div>

      <div class="section">
        <div class="section-title">Local Status</div>
        ${isDownloaded ? `
          <div class="info-box">
            <span class="status-downloaded">&#10003;</span> Checked out locally
            <div style="margin-top: 4px;">
              <span class="field-label">Local version:</span> <strong>${escapeHtml(displayVersion)}</strong>
            </div>
          </div>
          <div class="actions">
            <div class="bump-group">
              <button class="btn secondary" data-bump="patch" title="Bump patch (x.y.Z)">Patch</button>
              <button class="btn secondary" data-bump="minor" title="Bump minor (x.Y.0)">Minor</button>
              <button class="btn secondary" data-bump="major" title="Bump major (X.0.0)">Major</button>
            </div>
            <button class="btn" id="uploadBtn">Upload</button>
          </div>
        ` : `
          <div class="info-box">
            <span class="status-not-downloaded">&#9675;</span> Not checked out
          </div>
        `}
        <div class="actions" style="margin-top: 8px;">
          <button class="btn" id="checkoutLatestBtn">Checkout Latest</button>
          <button class="btn secondary" id="refreshBtn">Refresh</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Versions (${sortedVersions.length})</div>
        ${sortedVersions.length === 0 ? '<p>No versions available.</p>' : `
          <div class="version-list">
            ${sortedVersions.map(v => {
              const isLatest = latestVersion && v.id === latestVersion.id;
              const isCurrent = currentVersion && v.version_tag === currentVersion;
              return `
                <div class="version-row${isLatest ? ' latest' : ''}">
                  <span class="version-tag">
                    ${escapeHtml(v.version_tag)}${isLatest ? ' (latest)' : ''}${isCurrent ? ' (current)' : ''}
                  </span>
                  <span class="version-number">#${v.version_number}</span>
                  ${v.created_at ? `<span class="version-date">${formatDate(v.created_at)}</span>` : ''}
                  <button class="btn secondary" data-checkout-version="${escapeHtml(v.id)}" title="Checkout this version" style="padding: 2px 8px; font-size: 11px; margin-left: 8px;">
                    Checkout
                  </button>
                </div>`;
            }).join('')}
          </div>
        `}
      </div>
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
