(function () {
  var V = window.Validators;
  var vscode = window.vscodeApi || acquireVsCodeApi();

  var state = {
    backendUrl: '',
    gitName: '',
    gitEmail: '',
    storedGitLabTokens: [],
    gitlabEntries: [],
    canChangePassword: false,
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    notice: null
  };
  Object.assign(state, window.__INITIAL_STATE__ || {});

  var nextEntryId = 1;
  var liveValidators = [];

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
    vscode.postMessage({ command: command, data: data });
  }

  function normalizeUrl(url) {
    try { return new URL(url).origin; } catch (e) { return url; }
  }

  // --- Individual save handlers ---

  function saveBackendUrl() {
    var urlValidator = liveValidators.find(function (lv) { return lv._fieldId === 'backend-url'; });
    if (urlValidator) {
      var err = urlValidator.validate();
      if (err) { return; }
    } else {
      var error = V.url(state.backendUrl, { label: 'Server URL' });
      if (error) {
        state.notice = { type: 'error', message: error };
        render();
        return;
      }
    }
    post('saveBackendUrl', { backendUrl: state.backendUrl.trim() });
  }

  function saveGitConfig() {
    var hasErrors = false;
    liveValidators.forEach(function (lv) {
      if (lv._fieldId === 'git-name' || lv._fieldId === 'git-email') {
        if (lv.validate()) { hasErrors = true; }
      }
    });
    if (hasErrors) { return; }

    var nameErr = V.minLength(state.gitName, 2, { label: 'Name' });
    var emailErr = V.email(state.gitEmail);
    if (nameErr || emailErr) {
      state.notice = { type: 'error', message: [nameErr, emailErr].filter(Boolean).join('. ') };
      render();
      return;
    }
    post('saveGitConfig', { gitName: state.gitName.trim(), gitEmail: state.gitEmail.trim() });
  }

  function changePassword() {
    var hasErrors = false;
    liveValidators.forEach(function (lv) {
      if (lv._fieldId === 'current-password' || lv._fieldId === 'new-password' || lv._fieldId === 'confirm-new-password') {
        if (lv.validate()) { hasErrors = true; }
      }
    });
    if (hasErrors) { return; }

    post('changePassword', {
      currentPassword: state.currentPassword,
      newPassword: state.newPassword,
      confirmPassword: state.confirmPassword
    });
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
    if (!entry) { return; }

    var urlError = V.url(entry.url, { label: 'GitLab URL' });
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
      case 'valid':      statusText = entry.validationMessage || 'Valid'; break;
      case 'invalid':    statusText = entry.validationMessage || 'Invalid'; break;
      case 'validating': statusText = 'Validating...'; break;
      default:           statusText = 'Not validated'; break;
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
          '<span class="field-error"></span>' +
        '</div>' +
        '<div class="form-field">' +
          '<label>Personal Access Token</label>' +
          '<input type="password" class="gitlab-token-input" data-entry-id="' + entry.id + '" ' +
            'value="' + escapeHtml(entry.token) + '" placeholder="glpat-xxxxxxxxxxxxxxxxxxxx">' +
          '<span class="field-error"></span>' +
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

  function renderPasswordSection() {
    if (!state.canChangePassword) {
      return '<div class="settings-section">' +
        '<div class="section-header"><h2>Change Password</h2></div>' +
        '<p class="section-description">Password changes are only available after logging in with password-based authentication.</p>' +
      '</div>';
    }

    return '<div class="settings-section">' +
      '<div class="section-header"><h2>Change Password</h2></div>' +
      '<p class="section-description">Update your password (minimum 12 characters).</p>' +
      '<div class="form-field">' +
        '<label for="current-password">Current Password</label>' +
        '<input type="password" id="current-password" value="' + escapeHtml(state.currentPassword) + '" placeholder="Enter current password">' +
        '<span class="field-error"></span>' +
      '</div>' +
      '<div class="form-row">' +
        '<div class="form-field">' +
          '<label for="new-password">New Password</label>' +
          '<input type="password" id="new-password" value="' + escapeHtml(state.newPassword) + '" placeholder="Min 12 characters">' +
          '<span class="field-error"></span>' +
        '</div>' +
        '<div class="form-field">' +
          '<label for="confirm-new-password">Confirm New Password</label>' +
          '<input type="password" id="confirm-new-password" value="' + escapeHtml(state.confirmPassword) + '" placeholder="Confirm new password">' +
          '<span class="field-error"></span>' +
        '</div>' +
      '</div>' +
      '<div class="section-actions">' +
        '<button type="button" class="btn btn-secondary btn-sm" id="change-password-btn">Change Password</button>' +
      '</div>' +
    '</div>';
  }

  function render() {
    liveValidators.forEach(function (lv) { lv.destroy(); });
    liveValidators = [];

    var root = document.getElementById('app');
    if (!root) { return; }

    var noticeHtml = '';
    if (state.notice) {
      noticeHtml = '<div class="settings-notice ' + escapeHtml(state.notice.type) + '">' +
        escapeHtml(state.notice.message) + '</div>';
    }

    var gitlabEntriesHtml = state.gitlabEntries.map(renderGitLabEntry).join('');

    root.innerHTML =
      '<h1>Computor Settings</h1>' +
      '<p class="subtitle">Manage your environment configuration.</p>' +
      noticeHtml +

      '<div class="settings-grid">' +
        '<div class="settings-section">' +
          '<div class="section-header"><h2>Backend URL</h2></div>' +
          '<p class="section-description">The URL of your institution\'s Computor server.</p>' +
          '<div class="form-field">' +
            '<label for="backend-url">Server URL</label>' +
            '<input type="url" id="backend-url" value="' + escapeHtml(state.backendUrl) + '" placeholder="http://localhost:8000">' +
            '<span class="field-error"></span>' +
          '</div>' +
          '<div class="section-actions">' +
            '<button type="button" class="btn btn-secondary btn-sm" id="save-backend-url-btn">Save URL</button>' +
          '</div>' +
        '</div>' +

        '<div class="settings-section">' +
          '<div class="section-header"><h2>Git Configuration</h2></div>' +
          '<p class="section-description">Your name and email for git commits.</p>' +
          '<div class="form-field">' +
            '<label for="git-name">Name</label>' +
            '<input type="text" id="git-name" value="' + escapeHtml(state.gitName) + '" placeholder="John Doe">' +
            '<span class="field-error"></span>' +
          '</div>' +
          '<div class="form-field">' +
            '<label for="git-email">Email</label>' +
            '<input type="email" id="git-email" value="' + escapeHtml(state.gitEmail) + '" placeholder="you@example.com">' +
            '<span class="field-error"></span>' +
          '</div>' +
          '<div class="section-actions">' +
            '<button type="button" class="btn btn-secondary btn-sm" id="save-git-config-btn">Save Git Config</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="settings-section">' +
        '<div class="section-header">' +
          '<h2>GitLab Instances</h2>' +
          '<button type="button" class="btn btn-secondary btn-sm" id="add-gitlab-btn">+ Add</button>' +
        '</div>' +
        '<p class="section-description">Manage your GitLab personal access tokens. Tokens need api, read_repository, and write_repository scopes.</p>' +
        renderStoredTokens() +
        '<div id="gitlab-entries">' + gitlabEntriesHtml + '</div>' +
      '</div>' +

      renderPasswordSection();

    attachEventListeners();
    attachValidation();
  }

  // --- Event binding ---

  function attachEventListeners() {
    bindInput('backend-url', function (v) { state.backendUrl = v; });
    bindInput('git-name', function (v) { state.gitName = v; });
    bindInput('git-email', function (v) { state.gitEmail = v; });
    bindInput('current-password', function (v) { state.currentPassword = v; });
    bindInput('new-password', function (v) { state.newPassword = v; });
    bindInput('confirm-new-password', function (v) { state.confirmPassword = v; });

    bindClick('save-backend-url-btn', saveBackendUrl);
    bindClick('save-git-config-btn', saveGitConfig);
    bindClick('add-gitlab-btn', addGitLabEntry);
    bindClick('change-password-btn', changePassword);

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

  function attachValidation() {
    attachLive('backend-url', function (v) {
      return V.url(v, { label: 'Server URL' });
    });

    attachLive('git-name', function (v) {
      return V.minLength(v, 2, { label: 'Name' });
    });

    attachLive('git-email', function (v) {
      return V.email(v);
    });

    if (state.canChangePassword) {
      attachLive('current-password', function (v) {
        return V.required(v, { label: 'Current password' });
      });

      attachLive('new-password', function (v) {
        return V.minLength(v, 12, { label: 'New password' });
      });

      attachLive('confirm-new-password', function (v) {
        if (!v) { return 'Confirmation is required'; }
        return V.matches(v, state.newPassword, { message: 'Passwords do not match' });
      });
    }

    document.querySelectorAll('.gitlab-url-input').forEach(function (input) {
      liveValidators.push(V.attachLiveValidation(input, function (v) {
        return V.url(v, { label: 'GitLab URL' });
      }));
    });

    document.querySelectorAll('.gitlab-token-input').forEach(function (input) {
      liveValidators.push(V.attachLiveValidation(input, function (v) {
        return V.minLength(v, 10, { label: 'Token' });
      }));
    });
  }

  function attachLive(id, validatorFn) {
    var el = document.getElementById(id);
    if (el) {
      var lv = V.attachLiveValidation(el, validatorFn);
      lv._fieldId = id;
      liveValidators.push(lv);
    }
  }

  function bindInput(id, setter) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', function (e) { setter(e.target.value); });
    }
  }

  function bindClick(id, handler) {
    var el = document.getElementById(id);
    if (el) { el.addEventListener('click', handler); }
  }

  function findEntryFromElement(el) {
    var entryId = parseInt(el.getAttribute('data-entry-id'), 10);
    return state.gitlabEntries.find(function (en) { return en.id === entryId; });
  }

  // --- Message handling ---

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message) { return; }

    switch (message.command) {
      case 'validationResult':
        handleValidationResult(message.data);
        break;
      case 'notice':
        handleNotice(message.data);
        break;
      case 'gitLabTokenSaved':
        handleGitLabTokenSaved(message.data);
        break;
      case 'gitLabTokenRemoved':
        handleGitLabTokenRemoved(message.data);
        break;
      case 'update':
        if (message.data) { Object.assign(state, message.data); render(); }
        break;
    }
  });

  function handleNotice(data) {
    if (!data) { return; }

    var btnId = null;
    var msg = data.message || '';

    if (msg.indexOf('Backend URL saved') !== -1) {
      btnId = 'save-backend-url-btn';
    } else if (msg.indexOf('Git configuration saved') !== -1) {
      btnId = 'save-git-config-btn';
    } else if (msg.indexOf('Password updated') !== -1) {
      btnId = 'change-password-btn';
    } else if (msg.indexOf('GitLab token saved') !== -1) {
      btnId = null;
    }

    if (btnId) {
      var btn = document.getElementById(btnId);
      if (btn) {
        V.showSaveIndicator(btn, { message: data.type === 'success' ? 'Saved' : msg, type: data.type });
        if (data.type === 'success' && btnId === 'change-password-btn') {
          state.currentPassword = '';
          state.newPassword = '';
          state.confirmPassword = '';
          render();
        }
        return;
      }
    }

    if (data.type !== 'success') {
      state.notice = data;
      render();
    }
  }

  function handleValidationResult(data) {
    var entry = state.gitlabEntries.find(function (e) {
      return normalizeUrl(e.url) === data.url;
    });
    if (!entry) { return; }

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
    var addBtn = document.getElementById('add-gitlab-btn');
    if (addBtn) {
      V.showSaveIndicator(addBtn, { message: 'Token saved' });
    }
  }

  function handleGitLabTokenRemoved(data) {
    state.storedGitLabTokens = data.storedGitLabTokens || state.storedGitLabTokens;
    render();
  }

  render();
})();
