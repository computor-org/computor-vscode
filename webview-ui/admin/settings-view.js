(function () {
  var V = window.Validators;
  var escapeHtml = window.ComputorWebview.escapeHtml;
  var vscode = window.vscodeApi || acquireVsCodeApi();

  var state = {
    backendUrl: '',
    gitName: '',
    gitEmail: '',
    storedProviderTokens: [],
    providerEntries: [],
    backendUrlValidationStatus: 'pending',
    backendUrlValidationMessage: '',
    notice: null,
    // { section: 'gitProvider' | 'backendUrl', url? } — set when a credential
    // notification deep-linked here (computor-org/issues#247).
    focus: null
  };
  Object.assign(state, window.__INITIAL_STATE__ || {});

  var initialValues = {
    backendUrl: state.backendUrl,
    gitName: state.gitName,
    gitEmail: state.gitEmail
  };

  var nextEntryId = 1;
  var liveValidators = [];
  var updatingTokens = {};

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

  // --- Provider entry management ---

  function addProviderEntry() {
    state.providerEntries.push({
      id: nextEntryId++,
      url: '',
      token: '',
      validationStatus: 'pending',
      validationMessage: ''
    });
    render();
  }

  function removeProviderEntry(entryId) {
    state.providerEntries = state.providerEntries.filter(function (e) { return e.id !== entryId; });
    render();
  }

  function removeStoredProviderToken(url) {
    post('removeProviderToken', { url: url });
  }

  function validateProviderEntry(entryId) {
    var entry = state.providerEntries.find(function (e) { return e.id === entryId; });
    if (!entry) { return; }

    var urlError = V.url(entry.url, { label: 'Provider URL' });
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

    post('validateProviderToken', { url: normalizeUrl(entry.url), token: entry.token });
  }

  function saveProviderEntry(entryId) {
    var entry = state.providerEntries.find(function (e) { return e.id === entryId; });
    if (!entry || entry.validationStatus !== 'valid') {
      state.notice = { type: 'error', message: 'Validate the token before saving.' };
      render();
      return;
    }
    post('saveProviderToken', { url: normalizeUrl(entry.url), token: entry.token });
  }

  // --- Rendering ---

  function toggleUpdateToken(url) {
    if (updatingTokens[url]) {
      delete updatingTokens[url];
    } else {
      updatingTokens[url] = { token: '', validationStatus: 'pending', validationMessage: '' };
    }
    render();
  }

  function validateUpdateToken(url) {
    var entry = updatingTokens[url];
    if (!entry) { return; }

    if (!entry.token || entry.token.length < 10) {
      entry.validationStatus = 'invalid';
      entry.validationMessage = 'Token is too short';
      render();
      return;
    }

    entry.validationStatus = 'validating';
    entry.validationMessage = 'Validating...';
    render();

    post('validateProviderToken', { url: url, token: entry.token });
  }

  function saveUpdateToken(url) {
    var entry = updatingTokens[url];
    if (!entry || entry.validationStatus !== 'valid') {
      state.notice = { type: 'error', message: 'Validate the token before saving.' };
      render();
      return;
    }
    post('saveProviderToken', { url: url, token: entry.token });
  }

  function renderStoredTokens() {
    if (!state.storedProviderTokens || state.storedProviderTokens.length === 0) {
      return '<p class="section-description" style="margin-top: 4px;">No stored tokens yet.</p>';
    }
    var items = state.storedProviderTokens.map(function (t) {
      var isUpdating = !!updatingTokens[t.url];
      var html = '<div class="provider-stored-item">' +
        '<span class="provider-stored-url">' + escapeHtml(t.url) + '</span>' +
        '<span class="provider-stored-status">' + (t.hasToken ? 'Token stored' : 'No token') + '</span>' +
        '<button type="button" class="btn btn-secondary btn-sm provider-update-stored-btn" data-url="' + escapeHtml(t.url) + '">' +
          (isUpdating ? 'Cancel' : 'Update') +
        '</button>' +
        '<button type="button" class="btn btn-danger btn-sm provider-remove-stored-btn" data-url="' + escapeHtml(t.url) + '">Remove</button>' +
      '</div>';

      if (isUpdating) {
        var entry = updatingTokens[t.url];
        var statusClass = entry.validationStatus;
        var statusText = '';
        switch (entry.validationStatus) {
          case 'valid':      statusText = entry.validationMessage || 'Valid'; break;
          case 'invalid':    statusText = entry.validationMessage || 'Invalid'; break;
          case 'validating': statusText = 'Validating...'; break;
          default:           statusText = ''; break;
        }
        var canSave = entry.validationStatus === 'valid';

        html += '<div class="provider-update-panel" data-url="' + escapeHtml(t.url) + '">' +
          '<div class="form-field">' +
            '<label>New Personal Access Token</label>' +
            '<input type="password" class="provider-update-token-input" data-url="' + escapeHtml(t.url) + '" ' +
              'value="' + escapeHtml(entry.token) + '" placeholder="glpat-xxxxxxxxxxxxxxxxxxxx">' +
            '<span class="field-error"></span>' +
          '</div>' +
          '<div class="provider-entry-actions">' +
            '<button type="button" class="btn btn-secondary btn-sm provider-validate-update-btn" data-url="' + escapeHtml(t.url) + '">Validate</button>' +
            '<button type="button" class="btn sm provider-save-update-btn" data-url="' + escapeHtml(t.url) + '"' +
              (canSave ? '' : ' disabled') + '>Save Token</button>' +
            (statusText ? '<span class="provider-validation-status ' + statusClass + '">' + escapeHtml(statusText) + '</span>' : '') +
          '</div>' +
        '</div>';
      }

      return html;
    });
    return '<div class="provider-stored-list">' + items.join('') + '</div>';
  }

  function renderProviderEntry(entry) {
    var statusClass = entry.validationStatus;
    var statusText = '';
    switch (entry.validationStatus) {
      case 'valid':      statusText = entry.validationMessage || 'Valid'; break;
      case 'invalid':    statusText = entry.validationMessage || 'Invalid'; break;
      case 'validating': statusText = 'Validating...'; break;
      default:           statusText = 'Not validated'; break;
    }
    var canSave = entry.validationStatus === 'valid';

    return '<div class="provider-entry" data-entry-id="' + entry.id + '">' +
      '<div class="provider-entry-header">' +
        '<span>New Provider Instance</span>' +
      '</div>' +
      '<div class="provider-entry-fields">' +
        '<div class="form-field">' +
          '<label>Provider URL</label>' +
          '<input type="url" class="provider-url-input" data-entry-id="' + entry.id + '" ' +
            'value="' + escapeHtml(entry.url) + '" placeholder="https://provider.example.com">' +
          '<span class="field-error"></span>' +
        '</div>' +
        '<div class="form-field">' +
          '<label>Personal Access Token</label>' +
          '<input type="password" class="provider-token-input" data-entry-id="' + entry.id + '" ' +
            'value="' + escapeHtml(entry.token) + '" placeholder="glpat-xxxxxxxxxxxxxxxxxxxx">' +
          '<span class="field-error"></span>' +
        '</div>' +
      '</div>' +
      '<div class="provider-entry-actions">' +
        '<button type="button" class="btn btn-secondary btn-sm provider-validate-btn" data-entry-id="' + entry.id + '">Validate</button>' +
        '<button type="button" class="btn sm provider-save-btn" data-entry-id="' + entry.id + '"' +
          (canSave ? '' : ' disabled') + '>Save Token</button>' +
        '<button type="button" class="btn btn-danger btn-sm provider-remove-btn" data-entry-id="' + entry.id + '">Cancel</button>' +
        '<span class="provider-validation-status ' + statusClass + '">' + escapeHtml(statusText) + '</span>' +
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
      noticeHtml = '<div class="notice ' + escapeHtml(state.notice.type) + '">' +
        escapeHtml(state.notice.message) + '</div>';
    }

    var providerEntriesHtml = state.providerEntries.map(renderProviderEntry).join('');

    root.innerHTML =
      '<div class="header">' +
        '<h1>Computor Settings</h1>' +
        '<p>Manage your environment configuration.</p>' +
      '</div>' +
      noticeHtml +

      '<div class="settings-grid">' +
        '<div class="section stack tight">' +
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
            return txt ? '<span class="provider-validation-status ' + cls + '">' + escapeHtml(txt) + '</span>' : '';
          })() +
          '<div class="actions end section-actions">' +
            '<button type="button" class="btn btn-secondary btn-sm" id="validate-backend-url-btn">Validate</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" id="cancel-backend-url-btn">Cancel</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" id="save-backend-url-btn">Save URL</button>' +
          '</div>' +
        '</div>' +

        '<div class="section stack tight">' +
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
          '<div class="actions end section-actions">' +
            '<button type="button" class="btn btn-secondary btn-sm" id="cancel-git-config-btn">Cancel</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" id="save-git-config-btn">Save Git Config</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="section stack tight">' +
        '<div class="section-header">' +
          '<h2>Git Providers</h2>' +
          '<button type="button" class="btn btn-secondary btn-sm" id="add-provider-btn">+ Add</button>' +
        '</div>' +
        '<p class="section-description">Store access tokens for your git providers (GitLab, Forgejo, ...). Each token needs repository read/write access on its instance.</p>' +
        renderStoredTokens() +
        '<div id="provider-entries">' + providerEntriesHtml + '</div>' +
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

    bindClick('validate-backend-url-btn', validateBackendUrl);
    bindClick('save-backend-url-btn', saveBackendUrl);
    bindClick('cancel-backend-url-btn', cancelBackendUrl);
    bindClick('save-git-config-btn', saveGitConfig);
    bindClick('cancel-git-config-btn', cancelGitConfig);
    bindClick('add-provider-btn', addProviderEntry);

    document.querySelectorAll('.provider-url-input').forEach(function (input) {
      input.addEventListener('input', function (e) {
        var entry = findEntryFromElement(e.target);
        if (entry) {
          entry.url = e.target.value;
          entry.validationStatus = 'pending';
          entry.validationMessage = '';
        }
      });
    });

    document.querySelectorAll('.provider-token-input').forEach(function (input) {
      input.addEventListener('input', function (e) {
        var entry = findEntryFromElement(e.target);
        if (entry) {
          entry.token = e.target.value;
          entry.validationStatus = 'pending';
          entry.validationMessage = '';
        }
      });
    });

    document.querySelectorAll('.provider-validate-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var entryId = parseInt(e.target.getAttribute('data-entry-id'), 10);
        validateProviderEntry(entryId);
      });
    });

    document.querySelectorAll('.provider-save-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var entryId = parseInt(e.target.getAttribute('data-entry-id'), 10);
        saveProviderEntry(entryId);
      });
    });

    document.querySelectorAll('.provider-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var entryId = parseInt(e.target.getAttribute('data-entry-id'), 10);
        removeProviderEntry(entryId);
      });
    });

    document.querySelectorAll('.provider-remove-stored-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var url = e.target.getAttribute('data-url');
        removeStoredProviderToken(url);
      });
    });

    document.querySelectorAll('.provider-update-stored-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var url = e.target.getAttribute('data-url');
        toggleUpdateToken(url);
      });
    });

    document.querySelectorAll('.provider-update-token-input').forEach(function (input) {
      input.addEventListener('input', function (e) {
        var url = e.target.getAttribute('data-url');
        if (updatingTokens[url]) {
          updatingTokens[url].token = e.target.value;
          updatingTokens[url].validationStatus = 'pending';
          updatingTokens[url].validationMessage = '';
        }
      });
    });

    document.querySelectorAll('.provider-validate-update-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var url = e.target.getAttribute('data-url');
        validateUpdateToken(url);
      });
    });

    document.querySelectorAll('.provider-save-update-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var url = e.target.getAttribute('data-url');
        saveUpdateToken(url);
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

    document.querySelectorAll('.provider-url-input').forEach(function (input) {
      liveValidators.push(V.attachLiveValidation(input, function (v) {
        return V.url(v, { label: 'Provider URL' });
      }));
    });

    document.querySelectorAll('.provider-token-input').forEach(function (input) {
      liveValidators.push(V.attachLiveValidation(input, function (v) {
        return V.minLength(v, 10, { label: 'Token' });
      }));
    });

    document.querySelectorAll('.provider-update-token-input').forEach(function (input) {
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
    return state.providerEntries.find(function (en) { return en.id === entryId; });
  }

  // --- Deep link (computor-org/issues#247) ---

  // Attribute values here are URLs and ids, so build no selector out of them —
  // match on the parsed attribute instead of quoting into a CSS string.
  function findByAttr(selector, attr, value) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute(attr) === String(value)) { return nodes[i]; }
    }
    return null;
  }

  function highlightField(el) {
    if (!el) { return; }
    if (el.scrollIntoView) { el.scrollIntoView({ block: 'center' }); }
    el.focus();
    el.classList.add('field-highlight');
    setTimeout(function () { el.classList.remove('field-highlight'); }, 2000);
  }

  /**
   * Open on the entry the user was sent here to fix. Consumed once: a later
   * re-render (validation result, save) must not yank focus back.
   */
  function applyFocus() {
    var focus = state.focus;
    if (!focus) { return; }
    state.focus = null;

    if (focus.section === 'backendUrl') {
      highlightField(document.getElementById('backend-url'));
      return;
    }
    if (focus.section !== 'gitProvider') { return; }

    var url = focus.url ? normalizeUrl(focus.url) : '';
    var isStored = !!url && (state.storedProviderTokens || []).some(function (t) {
      return t.url === url;
    });

    if (isStored) {
      // Expand that server's "Update" panel — replacing a token is the point.
      updatingTokens[url] = { token: '', validationStatus: 'pending', validationMessage: '' };
      render();
      highlightField(findByAttr('.provider-update-token-input', 'data-url', url));
      return;
    }

    // Nothing stored for this realm yet (or git never named it): a pre-filled
    // new entry is still a better landing spot than the view root.
    var entry = {
      id: nextEntryId++,
      url: url,
      token: '',
      validationStatus: 'pending',
      validationMessage: ''
    };
    state.providerEntries.push(entry);
    render();
    highlightField(findByAttr(url ? '.provider-token-input' : '.provider-url-input', 'data-entry-id', entry.id));
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
      case 'notice':
        handleNotice(message.data);
        break;
      case 'providerTokenSaved':
        handleProviderTokenSaved(message.data);
        break;
      case 'providerTokenRemoved':
        handleProviderTokenRemoved(message.data);
        break;
      case 'update':
        if (message.data) { Object.assign(state, message.data); render(); applyFocus(); }
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
    } else if (msg.indexOf('Provider token saved') !== -1) {
      btnId = null;
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
    var validMsg = 'Authenticated as ' + (data.name || data.username || 'unknown');
    var invalidMsg = data.error || 'Validation failed';

    // Check new Provider entries
    var entry = state.providerEntries.find(function (e) {
      return normalizeUrl(e.url) === data.url;
    });
    if (entry) {
      entry.validationStatus = data.valid ? 'valid' : 'invalid';
      entry.validationMessage = data.valid ? validMsg : invalidMsg;
    }

    // Check updating stored tokens
    if (updatingTokens[data.url]) {
      updatingTokens[data.url].validationStatus = data.valid ? 'valid' : 'invalid';
      updatingTokens[data.url].validationMessage = data.valid ? validMsg : invalidMsg;
    }

    render();
  }

  function handleProviderTokenSaved(data) {
    state.storedProviderTokens = data.storedProviderTokens || state.storedProviderTokens;
    state.providerEntries = state.providerEntries.filter(function (e) {
      return normalizeUrl(e.url) !== data.url;
    });
    delete updatingTokens[data.url];
    render();
    var addBtn = document.getElementById('add-provider-btn');
    if (addBtn) {
      V.showSaveIndicator(addBtn, { message: 'Token saved' });
    }
  }

  function handleProviderTokenRemoved(data) {
    state.storedProviderTokens = data.storedProviderTokens || state.storedProviderTokens;
    render();
  }

  render();
  applyFocus();
})();
