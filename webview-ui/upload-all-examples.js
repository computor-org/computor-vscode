(function () {
  const vscode = acquireVsCodeApi();
  let examples = window.__INITIAL_STATE__ || [];
  let isUploading = false;

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function render() {
    const listEl = document.getElementById('exampleList');
    const countEl = document.getElementById('exampleCount');

    countEl.textContent = `${examples.length}`;

    if (examples.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No local working examples found.</div>';
      return;
    }

    const bumpPolicy = getSelectedPolicy();

    listEl.innerHTML = examples.map(function (ex) {
      const baseVersion = ex.remoteVersion || ex.localVersion;
      const proposedVersion = computeBump(baseVersion, bumpPolicy);
      const isNew = !ex.exampleId;
      const statusClass = ex._status || '';
      const statusIcon = getStatusIcon(ex._status);

      return '<div class="example-item ' + statusClass + '" data-directory="' + escapeHtml(ex.directory) + '">'
        + '<label class="example-checkbox">'
        + '<input type="checkbox" class="example-select" data-directory="' + escapeHtml(ex.directory) + '"'
        + (isUploading ? ' disabled' : ' checked') + '>'
        + '</label>'
        + '<div class="example-info">'
        + '<div class="example-title">' + escapeHtml(ex.title) + '</div>'
        + '<div class="example-directory">' + escapeHtml(ex.directory) + '</div>'
        + '</div>'
        + '<div class="example-versions">'
        + '<span class="version-label">Local:</span>'
        + '<span class="version-value">' + escapeHtml(ex.localVersion) + '</span>'
        + (ex.remoteVersion
          ? '<span class="version-label">Remote:</span><span class="version-value">' + escapeHtml(ex.remoteVersion) + '</span>'
          : '<span class="version-label">Remote:</span><span class="version-value new-badge">new</span>')
        + '<span class="version-label">Upload as:</span>'
        + '<span class="version-value proposed">' + escapeHtml(proposedVersion) + '</span>'
        + '</div>'
        + '<div class="example-status">' + statusIcon + '</div>'
        + (ex._error ? '<div class="example-error">' + escapeHtml(ex._error) + '</div>' : '')
        + '</div>';
    }).join('');
  }

  function getSelectedPolicy() {
    const checked = document.querySelector('input[name="bumpPolicy"]:checked');
    return checked ? checked.value : 'patch';
  }

  function computeBump(baseVersion, policy) {
    var parts = (baseVersion || '0.1.0').replace(/^v/i, '').split('.').map(Number);
    var major = parts[0] || 0;
    var minor = parts[1] || 0;
    var patch = parts[2] || 0;
    if (policy === 'major') { return (major + 1) + '.0.0'; }
    if (policy === 'minor') { return major + '.' + (minor + 1) + '.0'; }
    return major + '.' + minor + '.' + (patch + 1);
  }

  function getStatusIcon(status) {
    if (!status) { return ''; }
    switch (status) {
      case 'pending': return '<span class="status-icon pending">&#x23F3;</span>';
      case 'uploading': return '<span class="status-icon uploading">&#x21BB;</span>';
      case 'success': return '<span class="status-icon success">&#x2714;</span>';
      case 'error': return '<span class="status-icon error">&#x2716;</span>';
      case 'skipped': return '<span class="status-icon skipped">&#x2014;</span>';
      default: return '';
    }
  }

  function getSelectedDirectories() {
    var checkboxes = document.querySelectorAll('.example-select:checked');
    return Array.from(checkboxes).map(function (cb) { return cb.getAttribute('data-directory'); });
  }

  function setButtonsDisabled(disabled) {
    document.getElementById('uploadBtn').disabled = disabled;
    document.getElementById('uploadSelectedBtn').disabled = disabled;
    var radios = document.querySelectorAll('input[name="bumpPolicy"]');
    radios.forEach(function (r) { r.disabled = disabled; });
  }

  // Upload all
  document.getElementById('uploadBtn').addEventListener('click', function () {
    if (isUploading) { return; }
    var allDirs = examples.map(function (e) { return e.directory; });
    startUpload(allDirs);
  });

  // Upload selected
  document.getElementById('uploadSelectedBtn').addEventListener('click', function () {
    if (isUploading) { return; }
    var selected = getSelectedDirectories();
    if (selected.length === 0) { return; }
    startUpload(selected);
  });

  function startUpload(directories) {
    isUploading = true;
    setButtonsDisabled(true);
    vscode.postMessage({
      command: 'uploadAll',
      data: {
        bumpPolicy: getSelectedPolicy(),
        directories: directories
      }
    });
  }

  // Policy change re-renders proposed versions
  document.querySelectorAll('input[name="bumpPolicy"]').forEach(function (radio) {
    radio.addEventListener('change', function () { render(); });
  });

  // Messages from extension
  window.addEventListener('message', function (event) {
    var message = event.data;
    switch (message.command) {
      case 'update':
        examples = message.data;
        isUploading = false;
        setButtonsDisabled(false);
        render();
        break;
      case 'uploadStarted':
        applyResults(message.data);
        render();
        break;
      case 'uploadProgress':
        applyResults(message.data);
        render();
        break;
      case 'uploadComplete':
        isUploading = false;
        setButtonsDisabled(false);
        applyResults(message.data);
        render();
        showSummary(message.data);
        break;
    }
  });

  function applyResults(results) {
    if (!results) { return; }
    results.forEach(function (r) {
      var ex = examples.find(function (e) { return e.directory === r.directory; });
      if (ex) {
        ex._status = r.status;
        ex._error = r.error || null;
        if (r.uploadedVersion) {
          ex._uploadedVersion = r.uploadedVersion;
        }
      }
    });
  }

  function showSummary(results) {
    var summaryEl = document.getElementById('summary');
    var success = results.filter(function (r) { return r.status === 'success'; }).length;
    var errors = results.filter(function (r) { return r.status === 'error'; }).length;
    var total = results.length;

    summaryEl.style.display = 'block';
    summaryEl.className = 'summary ' + (errors > 0 ? 'has-errors' : 'all-success');
    summaryEl.innerHTML = '<h3>Upload Complete</h3>'
      + '<p>' + success + ' of ' + total + ' examples uploaded successfully.'
      + (errors > 0 ? ' ' + errors + ' failed.' : '')
      + '</p>';
  }

  // Initial render
  render();
})();
