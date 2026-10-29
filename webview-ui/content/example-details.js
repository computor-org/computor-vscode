// Example Details Webview Script

(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();
  const { escapeHtml, formatDate, say } = window.ComputorWebview;
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
      app.innerHTML = `<div class="empty-state">${say('No example selected.', 'Kein Beispiel ausgewählt.')}</div>`;
      return;
    }

    const sortedVersions = (versions || []).slice().sort((a, b) => b.version_number - a.version_number);
    const displayVersion = localVersion || currentVersion || (latestVersion ? latestVersion.version_tag : say('N/A', 'k. A.'));
    const repoName = repository ? (repository.title || repository.name) : say('Unknown', 'Unbekannt');
    const title = example.title || example.directory;

    app.innerHTML = `
      <header class="detail-header">
        <div class="detail-header-main">
          <h1 class="detail-title">${escapeHtml(title)}</h1>
          <p class="detail-subtitle">${escapeHtml(example.identifier || example.directory)}</p>
        </div>
        ${isDownloaded
          ? `<span class="status-pill checked-out" title="${say('Checked out locally', 'Lokal ausgecheckt')}">
               <span class="pill-icon">✓</span>
               ${say('Checked out', 'Ausgecheckt')} · <span class="pill-version">${escapeHtml(displayVersion)}</span>
             </span>`
          : `<span class="status-pill not-checked-out" title="${say('Not checked out', 'Nicht ausgecheckt')}">
               <span class="pill-icon">○</span>
               ${say('Remote only', 'Nur auf dem Server')}
             </span>`
        }
      </header>

      <section class="detail-section">
        <h2 class="section-title">${say('Details', 'Details')}</h2>
        <div class="card">
          <dl class="field-grid">
            <dt>${say('Identifier', 'Kennung')}</dt>
            <dd><code>${escapeHtml(example.identifier)}</code></dd>
            <dt>${say('Directory', 'Verzeichnis')}</dt>
            <dd><code>${escapeHtml(example.directory)}</code></dd>
            <dt>${say('Repository', 'Repository')}</dt>
            <dd>${escapeHtml(repoName)}</dd>
            ${example.subject ? `
              <dt>${say('Subject', 'Fach')}</dt>
              <dd>${escapeHtml(example.subject)}</dd>
            ` : ''}
            ${example.category ? `
              <dt>${say('Category', 'Kategorie')}</dt>
              <dd>${escapeHtml(example.category)}</dd>
            ` : ''}
            ${example.tags && example.tags.length > 0 ? `
              <dt>${say('Tags', 'Schlagwörter')}</dt>
              <dd><div class="tag-list">${example.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div></dd>
            ` : ''}
          </dl>
        </div>
      </section>

      <section class="detail-section">
        <h2 class="section-title">${say('Actions', 'Aktionen')}</h2>
        <div class="card">
          <div class="action-row">
            <button class="btn" id="checkoutLatestBtn">${say('Checkout Latest', 'Neueste auschecken')}</button>
            <button class="btn secondary" id="refreshBtn">${say('Refresh', 'Aktualisieren')}</button>
          </div>
          ${isDownloaded ? `
            <div class="action-row">
              <span class="action-label">${say('Bump version:', 'Version erhöhen:')}</span>
              <span class="bump-group">
                <button class="btn secondary" data-bump="patch" title="${say('Bump patch (x.y.Z)', 'Patch erhöhen (x.y.Z)')}">Patch</button>
                <button class="btn secondary" data-bump="minor" title="${say('Bump minor (x.Y.0)', 'Minor erhöhen (x.Y.0)')}">Minor</button>
                <button class="btn secondary" data-bump="major" title="${say('Bump major (X.0.0)', 'Major erhöhen (X.0.0)')}">Major</button>
              </span>
              <button class="btn" id="uploadBtn">${say('Upload working copy', 'Arbeitskopie hochladen')}</button>
            </div>
          ` : ''}
        </div>
      </section>

      <section class="detail-section">
        <h2 class="section-title">${say('Versions', 'Versionen')} (${sortedVersions.length})</h2>
        ${sortedVersions.length === 0
          ? `<div class="empty-state">${say('No versions available yet.', 'Noch keine Versionen vorhanden.')}</div>`
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
                    <span class="version-date">${formatDate(v.created_at, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                    <span class="version-actions">
                      <button class="btn secondary sm" data-checkout-version="${escapeHtml(v.id)}" title="${say('Checkout this version', 'Diese Version auschecken')}">
                        ${say('Checkout', 'Auschecken')}
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

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) { return; }
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
