(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();

  const state = {
    backendUrl: '',
    gitName: '',
    gitEmail: '',
    storedGitLabTokens: [],
    gitlabEntries: [],
    password: '',
    confirmPassword: '',
    submitting: false,
    progressMessage: '',
    notice: null,
    ...(window.__INITIAL_STATE__ || {})
  };

  let nextEntryId = 1;

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

  function post(command, data) {
    vscode.postMessage({ command, data });
  }

  function normalizeUrl(url) {
    try {
      return new URL(url).origin;
    } catch (e) {
      return url;
    }
  }

  function validateUrl(value) {
    if (!value) {
      return 'URL is required';
    }
    try {
      var url = new URL(value);
      if (!url.protocol.startsWith('http')) {
        return 'URL must start with http:// or https://';
      }
      return null;
    } catch (e) {
      return 'Enter a valid URL';
    }
  }

  function validateEmail(value) {
    if (!value || !value.trim()) {
      return 'Email is required';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      return 'Enter a valid email address';
    }
    return null;
  }

  // --- Individual save handlers ---

  function saveBackendUrl() {
    if (validateUrl(state.backendUrl)) {
      state.notice = { type: 'error', message: 'Backend URL is invalid.' };
      render();
      return;
    }
    post('saveBackendUrl', { backendUrl: state.backendUrl.trim() });
  }

  function saveGitConfig() {
    var errors = [];
    if (!state.gitName || state.gitName.trim().length < 2) {
      errors.push('Name must be at least 2 characters');
    }
    var emailError = validateEmail(state.gitEmail);
    if (emailError) {
      errors.push(emailError);
    }
    if (errors.length > 0) {
      state.notice = { type: 'error', message: errors.join('. ') };
      render();
      return;
    }
    post('saveGitConfig', { gitName: state.gitName.trim(), gitEmail: state.gitEmail.trim() });
  }

  // --- GitLab entry management ---

  function addGitLabEntry() {
    state.gitlabEntries.push({
      id: nextEntryId++,
      url: '',
      token: '',
      validationStatus: 'pending',
      validationMessage: ''
    });
    render();
  }

  function removeGitLabEntry(entryId) {
    state.gitlabEntries = state.gitlabEntries.filter(function (e) { return e.id !== entryId; });
    render();
  }

  function removeStoredGitLabToken(url) {
    post('removeGitLabToken', { url: url });
  }

  function validateGitLabEntry(entryId) {
    var entry = state.gitlabEntries.find(function (e) { return e.id === entryId; });
    if (!entry) {
      return;
    }

    var urlError = validateUrl(entry.url);
    if (urlError) {
      entry.validationStatus = 'invalid';
      entry.validationMessage = urlError;
      render();
      return;
    }

    if (!entry.token || entry.token.length < 10) {
      entry.validationStatus = 'invalid';
      entry.validationMessage = 'Token is too short';
      render();
      return;
    }

    entry.validationStatus = 'validating';
    entry.validationMessage = 'Validating...';
    render();

    post('validateGitLabToken', { url: normalizeUrl(entry.url), token: entry.token });
  }

  function saveGitLabEntry(entryId) {
    var entry = state.gitlabEntries.find(function (e) { return e.id === entryId; });
    if (!entry || entry.validationStatus !== 'valid') {
      state.notice = { type: 'error', message: 'Validate the token before saving.' };
      render();
      return;
    }
    post('saveGitLabToken', { url: normalizeUrl(entry.url), token: entry.token });
  }

  // --- Password submit ---

  function validatePasswordFields() {
    var errors = [];
    if (!state.password || state.password.length < 12) {
      errors.push('Password must be at least 12 characters');
    }
    if (state.password !== state.confirmPassword) {
      errors.push('Passwords do not match');
    }
    return errors;
  }

  function handleSubmit() {
    var errors = [];

    if (validateUrl(state.backendUrl)) {
      errors.push('Backend URL is invalid');
    }
    if (!state.gitName || state.gitName.trim().length < 2) {
      errors.push('Git name must be at least 2 characters');
    }
    var emailError = validateEmail(state.gitEmail);
    if (emailError) {
      errors.push(emailError);
    }
    var passwordErrors = validatePasswordFields();
    errors = errors.concat(passwordErrors);

    var hasUnvalidatedEntries = state.gitlabEntries.some(function (e) {
      return e.validationStatus !== 'valid';
    });
    if (state.gitlabEntries.length > 0 && hasUnvalidatedEntries) {
      errors.push('All new GitLab tokens must be validated before submitting');
    }

    if (errors.length > 0) {
      state.notice = { type: 'error', message: errors.join('. ') };
      render();
      return;
    }

    state.submitting = true;
    state.notice = null;
    state.progressMessage = '';
    render();

    var gitlabEntries = state.gitlabEntries
      .filter(function (e) { return e.validationStatus === 'valid'; })
      .map(function (e) { return { url: normalizeUrl(e.url), token: e.token }; });

    post('submit', {
      backendUrl: state.backendUrl.trim(),
      gitName: state.gitName.trim(),
      gitEmail: state.gitEmail.trim(),
      password: state.password,
      gitlabEntries: gitlabEntries
    });
  }

  // --- Rendering ---

  function renderStoredTokens() {
    if (!state.storedGitLabTokens || state.storedGitLabTokens.length === 0) {
      return '<p class="section-description" style="margin-top: 4px;">No stored tokens yet.</p>';
    }

    var items = state.storedGitLabTokens.map(function (t) {
      return '<div class="gitlab-stored-item">' +
        '<span class="gitlab-stored-url">' + escapeHtml(t.url) + '</span>' +
        '<span class="gitlab-stored-status">' + (t.hasToken ? 'Token stored' : 'No token') + '</span>' +
        '<button type="button" class="btn btn-danger btn-sm gitlab-remove-stored-btn" data-url="' + escapeHtml(t.url) + '">Remove</button>' +
      '</div>';
    });

    return '<div class="gitlab-stored-list">' + items.join('') + '</div>';
  }

  function renderGitLabEntry(entry) {
    var statusClass = entry.validationStatus;
    var statusText = '';
    switch (entry.validationStatus) {
      case 'valid':
        statusText = entry.validationMessage || 'Valid';
        break;
      case 'invalid':
        statusText = entry.validationMessage || 'Invalid';
        break;
      case 'validating':
        statusText = 'Validating...';
        break;
      default:
        statusText = 'Not validated';
        break;
    }

    var canSave = entry.validationStatus === 'valid';

    return '<div class="gitlab-entry" data-entry-id="' + entry.id + '">' +
      '<div class="gitlab-entry-header">' +
        '<span>New GitLab Instance</span>' +
        '<button type="button" class="btn-icon gitlab-remove-btn" data-entry-id="' + entry.id + '" title="Remove">&times;</button>' +
      '</div>' +
      '<div class="gitlab-entry-fields">' +
        '<div class="form-field">' +
          '<label>GitLab URL</label>' +
          '<input type="url" class="gitlab-url-input" data-entry-id="' + entry.id + '" ' +
            'value="' + escapeHtml(entry.url) + '" placeholder="https://gitlab.example.com">' +
        '</div>' +
        '<div class="form-field">' +
          '<label>Personal Access Token</label>' +
          '<input type="password" class="gitlab-token-input" data-entry-id="' + entry.id + '" ' +
            'value="' + escapeHtml(entry.token) + '" placeholder="glpat-xxxxxxxxxxxxxxxxxxxx">' +
        '</div>' +
      '</div>' +
      '<div class="gitlab-entry-actions">' +
        '<button type="button" class="btn btn-secondary btn-sm gitlab-validate-btn" data-entry-id="' + entry.id + '">Validate</button>' +
        '<button type="button" class="btn btn-primary btn-sm gitlab-save-btn" data-entry-id="' + entry.id + '"' +
          (canSave ? '' : ' disabled') + '>Save Token</button>' +
        '<span class="gitlab-validation-status ' + statusClass + '">' + escapeHtml(statusText) + '</span>' +
      '</div>' +
    '</div>';
  }

  function render() {
    var root = document.getElementById('app');
    if (!root) {
      return;
    }

    var noticeHtml = '';
    if (state.notice) {
      noticeHtml = '<div class="sign-up-notice ' + escapeHtml(state.notice.type) + '">' +
        escapeHtml(state.notice.message) + '</div>';
    }

    var progressHtml = '';
    if (state.submitting && state.progressMessage) {
      progressHtml = '<div class="sign-up-progress">' + escapeHtml(state.progressMessage) + '</div>';
    }

    var gitlabEntriesHtml = state.gitlabEntries.map(renderGitLabEntry).join('');

    var passwordError = '';
    if (state.password && state.password.length > 0 && state.password.length < 12) {
      passwordError = 'Password must be at least 12 characters';
    }
    var confirmError = '';
    if (state.confirmPassword && state.password !== state.confirmPassword) {
      confirmError = 'Passwords do not match';
    }

    root.innerHTML =
      '<h1>Computor Sign Up</h1>' +
      '<p class="subtitle">Set your initial password and configure your environment.</p>' +
      noticeHtml +

      // Two-column row: Backend URL | Git Config
      '<div class="sign-up-grid">' +
        '<div class="sign-up-section">' +
          '<div class="section-header"><h2>Backend URL</h2></div>' +
          '<p class="section-description">The URL of your institution\'s Computor server.</p>' +
          '<div class="form-field">' +
            '<label for="backend-url">Server URL</label>' +
            '<input type="url" id="backend-url" value="' + escapeHtml(state.backendUrl) + '" placeholder="http://localhost:8000">' +
          '</div>' +
          '<div class="section-actions">' +
            '<button type="button" class="btn btn-secondary btn-sm" id="save-backend-url-btn">Save URL</button>' +
          '</div>' +
        '</div>' +

        '<div class="sign-up-section">' +
          '<div class="section-header"><h2>Git Configuration</h2></div>' +
          '<p class="section-description">Your name and email for git commits.</p>' +
          '<div class="form-field">' +
            '<label for="git-name">Name</label>' +
            '<input type="text" id="git-name" value="' + escapeHtml(state.gitName) + '" placeholder="John Doe">' +
          '</div>' +
          '<div class="form-field">' +
            '<label for="git-email">Email</label>' +
            '<input type="email" id="git-email" value="' + escapeHtml(state.gitEmail) + '" placeholder="you@example.com">' +
          '</div>' +
          '<div class="section-actions">' +
            '<button type="button" class="btn btn-secondary btn-sm" id="save-git-config-btn">Save Git Config</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Full-width: GitLab Instances
      '<div class="sign-up-section">' +
        '<div class="section-header">' +
          '<h2>GitLab Instances</h2>' +
          '<button type="button" class="btn btn-secondary btn-sm" id="add-gitlab-btn">+ Add</button>' +
        '</div>' +
        '<p class="section-description">Manage your GitLab personal access tokens. Tokens need api, read_repository, and write_repository scopes.</p>' +
        renderStoredTokens() +
        '<div id="gitlab-entries">' + gitlabEntriesHtml + '</div>' +
      '</div>' +

      // Full-width: Password + Submit
      '<div class="sign-up-section">' +
        '<div class="section-header"><h2>Set Password</h2></div>' +
        '<p class="section-description">Set your initial password (minimum 12 characters). This cannot be changed later without an administrator reset.</p>' +
        '<div class="form-row">' +
          '<div class="form-field">' +
            '<label for="password">Password</label>' +
            '<input type="password" id="password" value="' + escapeHtml(state.password) + '" placeholder="Min 12 characters">' +
            '<span class="field-error">' + escapeHtml(passwordError) + '</span>' +
          '</div>' +
          '<div class="form-field">' +
            '<label for="confirm-password">Confirm Password</label>' +
            '<input type="password" id="confirm-password" value="' + escapeHtml(state.confirmPassword) + '" placeholder="Confirm password">' +
            '<span class="field-error">' + escapeHtml(confirmError) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="sign-up-submit">' +
        progressHtml +
        '<button type="button" class="btn btn-primary" id="submit-btn"' +
          (state.submitting ? ' disabled' : '') + '>' +
          (state.submitting ? 'Signing up...' : 'Sign Up') +
        '</button>' +
      '</div>';

    attachEventListeners();
  }

  function attachEventListeners() {
    bindInput('backend-url', function (v) { state.backendUrl = v; });
    bindInput('git-name', function (v) { state.gitName = v; });
    bindInput('git-email', function (v) { state.gitEmail = v; });
    bindInput('password', function (v) { state.password = v; });
    bindInput('confirm-password', function (v) { state.confirmPassword = v; });

    bindClick('save-backend-url-btn', saveBackendUrl);
    bindClick('save-git-config-btn', saveGitConfig);
    bindClick('add-gitlab-btn', addGitLabEntry);
    bindClick('submit-btn', handleSubmit);

    document.querySelectorAll('.gitlab-url-input').forEach(function (input) {
      input.addEventListener('input', function (e) {
        var entry = findEntryFromElement(e.target);
        if (entry) {
          entry.url = e.target.value;
          entry.validationStatus = 'pending';
          entry.validationMessage = '';
        }
      });
    });

    document.querySelectorAll('.gitlab-token-input').forEach(function (input) {
      input.addEventListener('input', function (e) {
        var entry = findEntryFromElement(e.target);
        if (entry) {
          entry.token = e.target.value;
          entry.validationStatus = 'pending';
          entry.validationMessage = '';
        }
      });
    });

    document.querySelectorAll('.gitlab-validate-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var entryId = parseInt(e.target.getAttribute('data-entry-id'), 10);
        validateGitLabEntry(entryId);
      });
    });

    document.querySelectorAll('.gitlab-save-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var entryId = parseInt(e.target.getAttribute('data-entry-id'), 10);
        saveGitLabEntry(entryId);
      });
    });

    document.querySelectorAll('.gitlab-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var entryId = parseInt(e.target.getAttribute('data-entry-id'), 10);
        removeGitLabEntry(entryId);
      });
    });

    document.querySelectorAll('.gitlab-remove-stored-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var url = e.target.getAttribute('data-url');
        removeStoredGitLabToken(url);
      });
    });
  }

  function bindInput(id, setter) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', function (e) { setter(e.target.value); });
    }
  }

  function bindClick(id, handler) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', handler);
    }
  }

  function findEntryFromElement(el) {
    var entryId = parseInt(el.getAttribute('data-entry-id'), 10);
    return state.gitlabEntries.find(function (en) { return en.id === entryId; });
  }

  // --- Message handling ---

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message) {
      return;
    }

    switch (message.command) {
      case 'validationResult':
        handleValidationResult(message.data);
        break;
      case 'submitResult':
        handleSubmitResult(message.data);
        break;
      case 'submitProgress':
        state.progressMessage = message.data.message || '';
        render();
        break;
      case 'notice':
        state.notice = message.data;
        render();
        break;
      case 'gitLabTokenSaved':
        handleGitLabTokenSaved(message.data);
        break;
      case 'gitLabTokenRemoved':
        handleGitLabTokenRemoved(message.data);
        break;
      case 'update':
        if (message.data) {
          Object.assign(state, message.data);
          render();
        }
        break;
      default:
        break;
    }
  });

  function handleValidationResult(data) {
    var entry = state.gitlabEntries.find(function (e) {
      return normalizeUrl(e.url) === data.url;
    });
    if (!entry) {
      return;
    }

    if (data.valid) {
      entry.validationStatus = 'valid';
      entry.validationMessage = 'Authenticated as ' + (data.name || data.username || 'unknown');
    } else {
      entry.validationStatus = 'invalid';
      entry.validationMessage = data.error || 'Validation failed';
    }
    render();
  }

  function handleGitLabTokenSaved(data) {
    state.storedGitLabTokens = data.storedGitLabTokens || state.storedGitLabTokens;
    state.gitlabEntries = state.gitlabEntries.filter(function (e) {
      return normalizeUrl(e.url) !== data.url;
    });
    render();
  }

  function handleGitLabTokenRemoved(data) {
    state.storedGitLabTokens = data.storedGitLabTokens || state.storedGitLabTokens;
    render();
  }

  function handleSubmitResult(data) {
    state.submitting = false;
    state.progressMessage = '';

    if (data.success) {
      state.notice = { type: 'success', message: 'Sign-up successful! Redirecting to login...' };
    } else {
      state.notice = { type: 'error', message: data.error || 'Sign-up failed' };
    }
    render();
  }

  render();
})();
