(function () {
  var V = window.Validators;
  var vscode = window.vscodeApi || acquireVsCodeApi();

  var state = {
    backendUrl: '',
    gitName: '',
    gitEmail: '',
    storedGitLabTokens: [],
    gitlabSource: 'new',
    selectedStoredUrl: '',
    gitlabUrl: '',
    gitlabToken: '',
    gitlabValidationStatus: 'pending',
    gitlabValidationMessage: '',
    password: '',
    confirmPassword: '',
    submitting: false,
    backendUrlValidationStatus: 'pending',
    backendUrlValidationMessage: '',
    progressMessage: '',
    notice: null
  };
  Object.assign(state, window.__INITIAL_STATE__ || {});

  if (state.storedGitLabTokens && state.storedGitLabTokens.length > 0) {
    state.gitlabSource = 'stored';
    state.selectedStoredUrl = state.storedGitLabTokens[0].url;
  }

  var initialValues = {
    backendUrl: state.backendUrl,
    gitName: state.gitName,
    gitEmail: state.gitEmail
  };

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

  function validateBackendUrl() {
    var urlError = V.url(state.backendUrl, { label: 'Server URL' });
    if (urlError) {
      state.backendUrlValidationStatus = 'invalid';
      state.backendUrlValidationMessage = urlError;
      render();
      return;
    }
    state.backendUrlValidationStatus = 'validating';
    state.backendUrlValidationMessage = 'Checking...';
    render();
    post('validateBackendUrl', { url: state.backendUrl.trim() });
  }

  function cancelBackendUrl() {
    state.backendUrl = initialValues.backendUrl;
    state.backendUrlValidationStatus = 'pending';
    state.backendUrlValidationMessage = '';
    render();
  }

  function cancelGitConfig() {
    state.gitName = initialValues.gitName;
    state.gitEmail = initialValues.gitEmail;
    render();
  }

  // --- GitLab source switching ---

  function switchGitlabSource(source) {
    state.gitlabSource = source;
    state.gitlabValidationStatus = 'pending';
    state.gitlabValidationMessage = '';
    if (source === 'stored' && state.storedGitLabTokens.length > 0 && !state.selectedStoredUrl) {
      state.selectedStoredUrl = state.storedGitLabTokens[0].url;
    }
    render();
  }

  function selectStoredToken(url) {
    state.selectedStoredUrl = url;
    state.gitlabValidationStatus = 'pending';
    state.gitlabValidationMessage = '';
    render();
  }

  // --- GitLab token validation ---

  function validateGitLabToken() {
    if (state.gitlabSource === 'stored') {
      if (!state.selectedStoredUrl) {
        state.gitlabValidationStatus = 'invalid';
        state.gitlabValidationMessage = 'Select a stored GitLab instance';
        render();
        return;
      }
      state.gitlabValidationStatus = 'validating';
      state.gitlabValidationMessage = 'Loading stored token...';
      render();
      post('resolveStoredToken', { url: state.selectedStoredUrl });
      return;
    }

    var urlError = V.url(state.gitlabUrl, { label: 'GitLab URL' });
    if (urlError) {
      state.gitlabValidationStatus = 'invalid';
      state.gitlabValidationMessage = urlError;
      render();
      return;
    }

    if (!state.gitlabToken || state.gitlabToken.length < 10) {
      state.gitlabValidationStatus = 'invalid';
      state.gitlabValidationMessage = 'Token is too short';
      render();
      return;
    }

    state.gitlabValidationStatus = 'validating';
    state.gitlabValidationMessage = 'Validating...';
    render();

    post('validateGitLabToken', { url: normalizeUrl(state.gitlabUrl), token: state.gitlabToken });
  }

  // --- Submit ---

  function getEffectiveGitLab() {
    if (state.gitlabSource === 'stored') {
      return { url: state.selectedStoredUrl, token: state._resolvedStoredToken || '' };
    }
    return { url: normalizeUrl(state.gitlabUrl), token: state.gitlabToken };
  }

  function handleSubmit() {
    var errors = [];

    var urlErr = V.url(state.backendUrl, { label: 'Backend URL' });
    if (urlErr) { errors.push(urlErr); }
    var nameErr = V.minLength(state.gitName, 2, { label: 'Git name' });
    if (nameErr) { errors.push(nameErr); }
    var emailErr = V.email(state.gitEmail);
    if (emailErr) { errors.push(emailErr); }

    if (state.gitlabSource === 'stored') {
      if (!state.selectedStoredUrl) {
        errors.push('Select a GitLab instance');
      }
    } else {
      var gitlabUrlErr = V.url(state.gitlabUrl, { label: 'GitLab URL' });
      if (gitlabUrlErr) { errors.push(gitlabUrlErr); }
      if (!state.gitlabToken || state.gitlabToken.length < 10) {
        errors.push('GitLab token is required');
      }
    }

    if (state.gitlabValidationStatus !== 'valid') {
      errors.push('GitLab token must be validated before submitting');
    }

    var pwErr = V.minLength(state.password, 12, { label: 'Password' });
    if (pwErr) { errors.push(pwErr); }
    var matchErr = V.matches(state.password, state.confirmPassword, { message: 'Passwords do not match' });
    if (matchErr) { errors.push(matchErr); }

    liveValidators.forEach(function (lv) { lv.validate(); });

    if (errors.length > 0) {
      state.notice = { type: 'error', message: errors.join('. ') };
      render();
      return;
    }

    state.submitting = true;
    state.notice = null;
    state.progressMessage = '';
    render();

    var gitlab = getEffectiveGitLab();
    post('submit', {
      backendUrl: state.backendUrl.trim(),
      gitName: state.gitName.trim(),
      gitEmail: state.gitEmail.trim(),
      password: state.password,
      gitlabUrl: gitlab.url,
      gitlabToken: gitlab.token
    });
  }

  // --- Rendering ---

  function renderGitLabSection() {
    var hasStored = state.storedGitLabTokens && state.storedGitLabTokens.length > 0;

    var html = '<div class="sign-up-section">' +
      '<div class="section-header"><h2>GitLab Authentication</h2></div>' +
      '<p class="section-description">Authenticate with your GitLab account. The token needs api, read_repository, and write_repository scopes.</p>';

    if (hasStored) {
      html += '<div class="gitlab-source-tabs">' +
        '<button type="button" class="gitlab-source-tab' + (state.gitlabSource === 'stored' ? ' active' : '') + '" data-source="stored">Use Stored Token</button>' +
        '<button type="button" class="gitlab-source-tab' + (state.gitlabSource === 'new' ? ' active' : '') + '" data-source="new">Enter New Token</button>' +
      '</div>';
    }

    if (state.gitlabSource === 'stored' && hasStored) {
      html += '<div class="form-field">' +
        '<label for="gitlab-stored-select">GitLab Instance</label>' +
        '<select id="gitlab-stored-select" class="form-select">';
      state.storedGitLabTokens.forEach(function (t) {
        html += '<option value="' + escapeHtml(t.url) + '"' +
          (state.selectedStoredUrl === t.url ? ' selected' : '') + '>' +
          escapeHtml(t.url) + (t.hasToken ? '' : ' (no token)') +
        '</option>';
      });
      html += '</select></div>';
    } else {
      html += '<div class="form-row">' +
        '<div class="form-field">' +
          '<label for="gitlab-url">GitLab URL</label>' +
          '<input type="url" id="gitlab-url" value="' + escapeHtml(state.gitlabUrl) + '" placeholder="https://gitlab.example.com">' +
          '<span class="field-error"></span>' +
        '</div>' +
        '<div class="form-field">' +
          '<label for="gitlab-token">Personal Access Token</label>' +
          '<input type="password" id="gitlab-token" value="' + escapeHtml(state.gitlabToken) + '" placeholder="glpat-xxxxxxxxxxxxxxxxxxxx">' +
          '<span class="field-error"></span>' +
        '</div>' +
      '</div>';
    }

    var gitlabStatusClass = state.gitlabValidationStatus;
    var gitlabStatusText = '';
    switch (state.gitlabValidationStatus) {
      case 'valid':      gitlabStatusText = state.gitlabValidationMessage || 'Valid'; break;
      case 'invalid':    gitlabStatusText = state.gitlabValidationMessage || 'Invalid'; break;
      case 'validating': gitlabStatusText = 'Validating...'; break;
      default:           gitlabStatusText = 'Not validated'; break;
    }

    html += '<div class="gitlab-entry-actions">' +
      '<button type="button" class="btn btn-secondary btn-sm" id="validate-gitlab-btn">Validate</button>' +
      '<span class="gitlab-validation-status ' + gitlabStatusClass + '">' + escapeHtml(gitlabStatusText) + '</span>' +
    '</div></div>';

    return html;
  }

  function render() {
    liveValidators.forEach(function (lv) { lv.destroy(); });
    liveValidators = [];

    var root = document.getElementById('app');
    if (!root) { return; }

    var noticeHtml = '';
    if (state.notice) {
      noticeHtml = '<div class="sign-up-notice ' + escapeHtml(state.notice.type) + '">' +
        escapeHtml(state.notice.message) + '</div>';
    }

    var progressHtml = '';
    if (state.submitting && state.progressMessage) {
      progressHtml = '<div class="sign-up-progress">' + escapeHtml(state.progressMessage) + '</div>';
    }

    root.innerHTML =
      '<h1>Computor Sign Up</h1>' +
      '<p class="subtitle">Set your initial password and configure your environment.</p>' +
      noticeHtml +

      '<div class="sign-up-grid">' +
        '<div class="sign-up-section">' +
          '<div class="section-header"><h2>Backend URL</h2></div>' +
          '<p class="section-description">The URL of your institution\'s Computor server.</p>' +
          '<div class="form-field">' +
            '<label for="backend-url">Server URL</label>' +
            '<input type="url" id="backend-url" value="' + escapeHtml(state.backendUrl) + '" placeholder="http://localhost:8000">' +
            '<span class="field-error"></span>' +
          '</div>' +
          (function () {
            var cls = state.backendUrlValidationStatus;
            var txt = '';
            switch (state.backendUrlValidationStatus) {
              case 'valid':      txt = 'Reachable'; break;
              case 'invalid':    txt = state.backendUrlValidationMessage || 'Unreachable'; break;
              case 'validating': txt = 'Checking...'; break;
              default:           txt = ''; break;
            }
            return txt ? '<span class="gitlab-validation-status ' + cls + '">' + escapeHtml(txt) + '</span>' : '';
          })() +
          '<div class="section-actions">' +
            '<button type="button" class="btn btn-secondary btn-sm" id="validate-backend-url-btn">Validate</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" id="cancel-backend-url-btn">Cancel</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" id="save-backend-url-btn">Save URL</button>' +
          '</div>' +
        '</div>' +

        '<div class="sign-up-section">' +
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
            '<button type="button" class="btn btn-secondary btn-sm" id="cancel-git-config-btn">Cancel</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" id="save-git-config-btn">Save Git Config</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      renderGitLabSection() +

      '<div class="sign-up-section">' +
        '<div class="section-header"><h2>Set Password</h2></div>' +
        '<p class="section-description">Set your initial password (minimum 12 characters).</p>' +
        '<div class="form-row">' +
          '<div class="form-field">' +
            '<label for="password">Password</label>' +
            '<input type="password" id="password" value="' + escapeHtml(state.password) + '" placeholder="Min 12 characters">' +
            '<span class="field-error"></span>' +
          '</div>' +
          '<div class="form-field">' +
            '<label for="confirm-password">Confirm Password</label>' +
            '<input type="password" id="confirm-password" value="' + escapeHtml(state.confirmPassword) + '" placeholder="Confirm password">' +
            '<span class="field-error"></span>' +
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
    attachValidation();
  }

  // --- Event binding ---

  function attachEventListeners() {
    bindInput('backend-url', function (v) {
      state.backendUrl = v;
      state.backendUrlValidationStatus = 'pending';
      state.backendUrlValidationMessage = '';
    });
    bindInput('git-name', function (v) { state.gitName = v; });
    bindInput('git-email', function (v) { state.gitEmail = v; });
    bindInput('gitlab-url', function (v) {
      state.gitlabUrl = v;
      state.gitlabValidationStatus = 'pending';
      state.gitlabValidationMessage = '';
    });
    bindInput('gitlab-token', function (v) {
      state.gitlabToken = v;
      state.gitlabValidationStatus = 'pending';
      state.gitlabValidationMessage = '';
    });
    bindInput('password', function (v) { state.password = v; });
    bindInput('confirm-password', function (v) { state.confirmPassword = v; });

    bindClick('validate-backend-url-btn', validateBackendUrl);
    bindClick('save-backend-url-btn', saveBackendUrl);
    bindClick('cancel-backend-url-btn', cancelBackendUrl);
    bindClick('save-git-config-btn', saveGitConfig);
    bindClick('cancel-git-config-btn', cancelGitConfig);
    bindClick('validate-gitlab-btn', validateGitLabToken);
    bindClick('submit-btn', handleSubmit);

    // GitLab source tabs
    document.querySelectorAll('.gitlab-source-tab').forEach(function (tab) {
      tab.addEventListener('click', function (e) {
        switchGitlabSource(e.target.getAttribute('data-source'));
      });
    });

    // Stored token selector
    var selectEl = document.getElementById('gitlab-stored-select');
    if (selectEl) {
      selectEl.addEventListener('change', function (e) {
        selectStoredToken(e.target.value);
      });
    }
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

    if (state.gitlabSource === 'new') {
      attachLive('gitlab-url', function (v) {
        return V.url(v, { label: 'GitLab URL' });
      });

      attachLive('gitlab-token', function (v) {
        return V.minLength(v, 10, { label: 'Token' });
      });
    }

    attachLive('password', function (v) {
      return V.minLength(v, 12, { label: 'Password' });
    });

    attachLive('confirm-password', function (v) {
      if (!v) { return 'Confirmation is required'; }
      return V.matches(v, state.password, { message: 'Passwords do not match' });
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

  // --- Message handling ---

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message) { return; }

    switch (message.command) {
      case 'backendUrlValidationResult':
        handleBackendUrlValidationResult(message.data);
        break;
      case 'validationResult':
        handleValidationResult(message.data);
        break;
      case 'storedTokenResolved':
        handleStoredTokenResolved(message.data);
        break;
      case 'submitResult':
        handleSubmitResult(message.data);
        break;
      case 'submitProgress':
        state.progressMessage = message.data.message || '';
        render();
        break;
      case 'notice':
        handleNotice(message.data);
        break;
    }
  });

  function handleBackendUrlValidationResult(data) {
    state.backendUrlValidationStatus = data.valid ? 'valid' : 'invalid';
    state.backendUrlValidationMessage = data.valid ? 'Reachable' : (data.error || 'Unreachable');
    render();
  }

  function handleNotice(data) {
    if (!data) { return; }

    var btnId = null;
    var msg = data.message || '';

    if (msg.indexOf('Backend URL saved') !== -1) {
      btnId = 'save-backend-url-btn';
      if (data.type === 'success') { initialValues.backendUrl = state.backendUrl; }
    } else if (msg.indexOf('Git configuration saved') !== -1) {
      btnId = 'save-git-config-btn';
      if (data.type === 'success') { initialValues.gitName = state.gitName; initialValues.gitEmail = state.gitEmail; }
    }

    if (btnId) {
      var btn = document.getElementById(btnId);
      if (btn) {
        V.showSaveIndicator(btn, { message: data.type === 'success' ? 'Saved' : msg, type: data.type });
        return;
      }
    }

    if (data.type !== 'success') {
      state.notice = data;
      render();
    }
  }

  function handleValidationResult(data) {
    if (data.valid) {
      state.gitlabValidationStatus = 'valid';
      state.gitlabValidationMessage = 'Authenticated as ' + (data.name || data.username || 'unknown');
    } else {
      state.gitlabValidationStatus = 'invalid';
      state.gitlabValidationMessage = data.error || 'Validation failed';
    }
    render();
  }

  function handleStoredTokenResolved(data) {
    if (!data.token) {
      state.gitlabValidationStatus = 'invalid';
      state.gitlabValidationMessage = 'No token found for this instance';
      render();
      return;
    }
    state._resolvedStoredToken = data.token;
    state.gitlabValidationStatus = 'validating';
    state.gitlabValidationMessage = 'Validating...';
    render();
    post('validateGitLabToken', { url: data.url, token: data.token });
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
