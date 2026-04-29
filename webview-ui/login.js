(function () {
  var V = window.Validators;
  var vscode = window.vscodeApi || acquireVsCodeApi();

  var state = {
    backendUrl: '',
    username: '',
    password: '',
    enableAutoLogin: false,
    showAutoLoginToggle: true,
    previousBackendUrls: [],
    submitting: false,
    notice: null
  };
  Object.assign(state, window.__INITIAL_STATE__ || {});

  var liveValidators = [];

  function escapeHtml(value) {
    if (value === undefined || value === null) { return ''; }
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

  function handleSubmit() {
    var hasErrors = false;
    liveValidators.forEach(function (lv) {
      if (lv.validate()) { hasErrors = true; }
    });
    if (hasErrors) { return; }

    if (!state.username || !state.password) {
      state.notice = { type: 'error', message: 'Username and password are required.' };
      render();
      return;
    }

    var trimmedUrl = (state.backendUrl || '').trim();
    if (!trimmedUrl) {
      state.notice = { type: 'error', message: 'Backend URL is required.' };
      render();
      return;
    }

    state.submitting = true;
    state.notice = null;
    render();

    post('login', {
      username: state.username.trim(),
      password: state.password,
      enableAutoLogin: state.enableAutoLogin,
      backendUrl: trimmedUrl
    });
  }

  function render() {
    liveValidators.forEach(function (lv) { lv.destroy(); });
    liveValidators = [];

    var root = document.getElementById('app');
    if (!root) { return; }

    var noticeHtml = '';
    if (state.notice) {
      noticeHtml = '<div class="login-notice ' + escapeHtml(state.notice.type) + '">' +
        escapeHtml(state.notice.message) + '</div>';
    }

    var seen = {};
    var deduped = [];
    var srcUrls = (Array.isArray(state.previousBackendUrls) ? state.previousBackendUrls.slice() : []);
    for (var i = 0; i < srcUrls.length; i++) {
      var u = (srcUrls[i] || '').trim();
      if (!u) { continue; }
      var key = u.toLowerCase();
      if (seen[key]) { continue; }
      seen[key] = true;
      deduped.push(u);
    }

    var typedUrl = (state.backendUrl || '').trim();
    var typedKnown = typedUrl ? deduped.some(function (u) { return u.toLowerCase() === typedUrl.toLowerCase(); }) : true;

    var optionsHtml = '';
    if (deduped.length === 0) {
      optionsHtml = '<li class="url-option url-option-empty">No saved URLs yet.</li>';
    } else {
      for (var j = 0; j < deduped.length; j++) {
        var url = deduped[j];
        var active = url.toLowerCase() === typedUrl.toLowerCase() ? ' url-option-active' : '';
        optionsHtml +=
          '<li class="url-option' + active + '" data-url="' + escapeHtml(url) + '">' +
            '<span class="url-option-label">' + escapeHtml(url) + '</span>' +
            '<button type="button" class="url-option-remove" data-remove="' + escapeHtml(url) + '" title="Remove from list" aria-label="Remove">✕</button>' +
          '</li>';
      }
    }

    var addRowHtml = (typedUrl && !typedKnown)
      ? '<div class="url-add-row"><button type="button" class="url-add-btn" id="url-add-btn">＋ Save “' + escapeHtml(typedUrl) + '”</button></div>'
      : '';

    var serverInfoHtml = '<div class="form-field">' +
        '<label for="backend-url">Backend URL</label>' +
        '<div class="url-combo" id="backend-url-combo">' +
          '<input type="url" id="backend-url" class="url-combo-input" value="' + escapeHtml(state.backendUrl) + '" placeholder="https://computor.example.com" autocomplete="url" aria-haspopup="listbox" aria-expanded="false">' +
          '<button type="button" class="url-combo-toggle" id="url-combo-toggle" aria-label="Show saved backends" tabindex="-1">▾</button>' +
          '<div class="url-combo-pop" id="url-combo-pop" role="listbox" hidden>' +
            '<ul class="url-combo-list">' + optionsHtml + '</ul>' +
            addRowHtml +
          '</div>' +
        '</div>' +
        '<span class="field-error"></span>' +
      '</div>';

    var autoLoginHtml = '';
    if (state.showAutoLoginToggle) {
      autoLoginHtml = '<label class="login-toggle">' +
        '<input type="checkbox" id="auto-login-checkbox"' + (state.enableAutoLogin ? ' checked' : '') + '>' +
        'Enable auto-login for this workspace' +
      '</label>';
    }

    root.innerHTML =
      '<div class="login-card">' +
        '<h1>Computor Login</h1>' +
        '<p class="subtitle">Sign in to your Computor account.</p>' +
        serverInfoHtml +
        noticeHtml +
        '<div class="form-field">' +
          '<label for="username">Username</label>' +
          '<input type="text" id="username" value="' + escapeHtml(state.username) + '" placeholder="Enter your username" autocomplete="username">' +
          '<span class="field-error"></span>' +
        '</div>' +
        '<div class="form-field">' +
          '<label for="password">Password</label>' +
          '<input type="password" id="password" value="' + escapeHtml(state.password) + '" placeholder="Enter your password" autocomplete="current-password">' +
          '<span class="field-error"></span>' +
        '</div>' +
        autoLoginHtml +
        '<button type="button" class="btn btn-primary" id="login-btn"' +
          (state.submitting ? ' disabled' : '') + '>' +
          (state.submitting ? 'Signing in...' : 'Sign In') +
        '</button>' +
      '</div>';

    attachEventListeners();
    attachValidation();

    // Auto-focus username or password field
    if (!state.username) {
      var usernameEl = document.getElementById('username');
      if (usernameEl) { usernameEl.focus(); }
    } else {
      var passwordEl = document.getElementById('password');
      if (passwordEl) { passwordEl.focus(); }
    }
  }

  function attachEventListeners() {
    bindInput('backend-url', function (v) { state.backendUrl = v; });
    bindInput('username', function (v) { state.username = v; });
    bindInput('password', function (v) { state.password = v; });
    bindClick('login-btn', handleSubmit);
    attachBackendUrlCombo();

    var checkbox = document.getElementById('auto-login-checkbox');
    if (checkbox) {
      checkbox.addEventListener('change', function (e) {
        state.enableAutoLogin = e.target.checked;
      });
    }

    // Submit on Enter in either field
    var usernameEl = document.getElementById('username');
    var passwordEl = document.getElementById('password');
    if (usernameEl) {
      usernameEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (passwordEl) { passwordEl.focus(); }
        }
      });
    }
    if (passwordEl) {
      passwordEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSubmit();
        }
      });
    }
  }

  function attachValidation() {
    attachLive('username', function (v) {
      return V.required(v, { label: 'Username' });
    });
    attachLive('password', function (v) {
      return V.required(v, { label: 'Password' });
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

  function attachBackendUrlCombo() {
    var wrap = document.getElementById('backend-url-combo');
    var input = document.getElementById('backend-url');
    var toggle = document.getElementById('url-combo-toggle');
    var pop = document.getElementById('url-combo-pop');
    if (!wrap || !input || !toggle || !pop) { return; }

    var setOpen = function (open) {
      pop.hidden = !open;
      wrap.classList.toggle('open', open);
      input.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(pop.hidden);
    });

    pop.addEventListener('click', function (e) {
      var target = e.target;
      if (!target) { return; }

      // Remove button: prune from list
      var removeBtn = target.closest && target.closest('[data-remove]');
      if (removeBtn) {
        e.stopPropagation();
        var removeUrl = removeBtn.getAttribute('data-remove') || '';
        if (!removeUrl) { return; }
        state.previousBackendUrls = (state.previousBackendUrls || []).filter(function (u) {
          return (u || '').trim().toLowerCase() !== removeUrl.toLowerCase();
        });
        post('removeBackendUrl', { url: removeUrl });
        render();
        var newPop = document.getElementById('url-combo-pop');
        if (newPop) { newPop.hidden = false; document.getElementById('backend-url-combo').classList.add('open'); }
        return;
      }

      // Option click: pick this URL
      var optionEl = target.closest && target.closest('[data-url]');
      if (optionEl) {
        var url = optionEl.getAttribute('data-url') || '';
        if (!url) { return; }
        input.value = url;
        state.backendUrl = url;
        setOpen(false);
        input.focus();
        render();
        return;
      }
    });

    var addBtn = document.getElementById('url-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var newUrl = (state.backendUrl || '').trim();
        if (!newUrl) { return; }
        var existing = (state.previousBackendUrls || []).filter(function (u) {
          return (u || '').trim().toLowerCase() !== newUrl.toLowerCase();
        });
        state.previousBackendUrls = [newUrl].concat(existing).slice(0, 10);
        post('recordBackendUrl', { url: newUrl });
        render();
        var newPop = document.getElementById('url-combo-pop');
        if (newPop) { newPop.hidden = false; document.getElementById('backend-url-combo').classList.add('open'); }
      });
    }

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) { setOpen(false); }
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !pop.hidden) {
        setOpen(false);
        e.stopPropagation();
      }
    });
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
      case 'loginResult':
        state.submitting = false;
        if (message.data.success) {
          state.notice = { type: 'success', message: 'Login successful!' };
        } else {
          state.notice = { type: 'error', message: message.data.error || 'Authentication failed.' };
        }
        render();
        break;
      case 'notice':
        state.submitting = false;
        if (message.data) {
          state.notice = message.data;
        }
        render();
        break;
    }
  });

  render();
})();
