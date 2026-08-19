(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();
  const { escapeHtml } = window.ComputorWebview;
  let examples = window.__INITIAL_STATE__ || [];
  let isUploading = false;
  // Selection lives here rather than in the DOM so it survives re-renders
  // (e.g. switching the bump policy).
  let selected = new Set();

  function resetSelection() {
    selected = new Set(
      examples.filter(function (e) { return e.hasChanges; }).map(function (e) { return e.directory; })
    );
  }

  function render() {
    const listEl = document.getElementById('exampleList');

    if (examples.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No local working examples found.</div>';
      updateControls();
      return;
    }

    const bumpPolicy = getSelectedPolicy();

    listEl.innerHTML = examples.map(function (ex) {
      const isNew = !ex.remoteVersion;
      const proposedVersion = isNew ? ex.localVersion : computeBump(ex.remoteVersion, bumpPolicy);
      const statusClass = ex._status || (ex.hasChanges ? '' : 'unchanged');
      const statusIcon = getStatusIcon(ex._status);
      const changeIndicator = ex.hasChanges
        ? '<span class="change-badge changed">modified</span>'
        : '<span class="change-badge unchanged">unchanged</span>';
      const isChecked = selected.has(ex.directory);

      return '<div class="example-item ' + statusClass + '" data-directory="' + escapeHtml(ex.directory) + '">'
        + '<label class="example-checkbox">'
        + '<input type="checkbox" class="example-select" data-directory="' + escapeHtml(ex.directory) + '"'
        + (isUploading ? ' disabled' : '') + (isChecked ? ' checked' : '') + '>'
        + '</label>'
        + '<div class="example-info">'
        + '<div class="example-title">' + escapeHtml(ex.title) + ' ' + changeIndicator + '</div>'
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

    updateControls();
  }

  /** Keeps counts, the select-all toggle and the action buttons in sync. */
  function updateControls() {
    const changedCount = examples.filter(function (e) { return e.hasChanges; }).length;
    const selectedCount = selected.size;
    const hasExamples = examples.length > 0;

    document.getElementById('exampleCount').textContent =
      changedCount + ' changed / ' + examples.length + ' total';

    const headerEl = document.getElementById('listHeader');
    const toggleEl = document.getElementById('selectAllToggle');
    headerEl.style.display = hasExamples ? '' : 'none';
    toggleEl.disabled = isUploading || !hasExamples;
    toggleEl.checked = hasExamples && selectedCount === examples.length;
    toggleEl.indeterminate = selectedCount > 0 && selectedCount < examples.length;
    document.getElementById('selectionSummary').textContent = selectedCount === 0
      ? 'Select all'
      : selectedCount + ' of ' + examples.length + ' selected';

    const uploadBtn = document.getElementById('uploadBtn');
    uploadBtn.textContent = changedCount > 0 ? 'Upload Changed (' + changedCount + ')' : 'Upload Changed';
    uploadBtn.disabled = isUploading || changedCount === 0;

    const uploadSelectedBtn = document.getElementById('uploadSelectedBtn');
    uploadSelectedBtn.textContent = selectedCount > 0 ? 'Upload Selected (' + selectedCount + ')' : 'Upload Selected';
    uploadSelectedBtn.disabled = isUploading || selectedCount === 0;

    document.querySelectorAll('input[name="bumpPolicy"]').forEach(function (r) { r.disabled = isUploading; });
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
      case 'pending': return '<span class="status-icon pending" role="img" aria-label="Pending">&#x23F3;</span>';
      case 'uploading': return '<span class="status-icon uploading" role="img" aria-label="Uploading">&#x21BB;</span>';
      case 'success': return '<span class="status-icon success" role="img" aria-label="Uploaded">&#x2714;</span>';
      case 'error': return '<span class="status-icon error" role="img" aria-label="Failed">&#x2716;</span>';
      case 'skipped': return '<span class="status-icon skipped" role="img" aria-label="Skipped">&#x2014;</span>';
      default: return '';
    }
  }

  function getSelectedDirectories() {
    return examples
      .filter(function (e) { return selected.has(e.directory); })
      .map(function (e) { return e.directory; });
  }

  // Per-example checkboxes (delegated — the list is re-rendered on every change)
  document.getElementById('exampleList').addEventListener('change', function (event) {
    var checkbox = event.target;
    if (!checkbox.classList || !checkbox.classList.contains('example-select')) { return; }
    var directory = checkbox.getAttribute('data-directory');
    if (checkbox.checked) { selected.add(directory); } else { selected.delete(directory); }
    updateControls();
  });

  // Select all / deselect all
  document.getElementById('selectAllToggle').addEventListener('change', function (event) {
    if (isUploading) { return; }
    if (event.target.checked) {
      selected = new Set(examples.map(function (e) { return e.directory; }));
    } else {
      selected = new Set();
    }
    render();
  });

  // Upload all changed
  document.getElementById('uploadBtn').addEventListener('click', function () {
    if (isUploading) { return; }
    var changedDirs = examples.filter(function (e) { return e.hasChanges; }).map(function (e) { return e.directory; });
    if (changedDirs.length === 0) { return; }
    startUpload(changedDirs);
  });

  // Upload selected
  document.getElementById('uploadSelectedBtn').addEventListener('click', function () {
    if (isUploading) { return; }
    var selectedDirs = getSelectedDirectories();
    if (selectedDirs.length === 0) { return; }
    startUpload(selectedDirs);
  });

  function startUpload(directories) {
    isUploading = true;
    render();
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
    if (!message) { return; }
    switch (message.command) {
      case 'update':
        examples = message.data;
        isUploading = false;
        resetSelection();
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
  resetSelection();
  render();
})();
