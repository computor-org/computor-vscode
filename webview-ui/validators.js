/**
 * Shared validation utilities for webview UIs.
 *
 * Provides pure validator functions (return error string or null)
 * and a helper to wire live validation onto input elements.
 *
 * Usage:
 *   <script nonce="..." src="${validatorsUri}"></script>
 *
 * Available on window.Validators after loading.
 */
(function () {
  'use strict';

  // ── Pure validators ────────────────────────────────────────────────
  // Each returns an error message string, or null when valid.

  /**
   * Validate that a value is a well-formed HTTP(S) URL or IP-based URL.
   * @param {string} value
   * @param {object}  [opts]
   * @param {boolean} [opts.required=true]
   * @param {string}  [opts.label='URL']
   * @returns {string|null}
   */
  function url(value, opts) {
    var required = !(opts && opts.required === false);
    var label = (opts && opts.label) || 'URL';

    if (!value || !value.trim()) {
      return required ? label + ' is required' : null;
    }

    var trimmed = value.trim();
    // Allow bare hostnames, IPs, and www. prefixes by auto-prepending http://
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = 'http://' + trimmed;
    }

    try {
      var parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return label + ' must use http:// or https://';
      }
      if (!parsed.hostname || parsed.hostname.indexOf('.') === -1 && !/^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) && parsed.hostname !== 'localhost') {
        return 'Enter a valid ' + label;
      }
      return null;
    } catch (e) {
      return 'Enter a valid ' + label;
    }
  }

  /**
   * Validate an email address.
   * @param {string} value
   * @param {object}  [opts]
   * @param {boolean} [opts.required=true]
   * @returns {string|null}
   */
  function email(value, opts) {
    var required = !(opts && opts.required === false);

    if (!value || !value.trim()) {
      return required ? 'Email is required' : null;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      return 'Enter a valid email address';
    }
    return null;
  }

  /**
   * Validate minimum string length.
   * @param {string} value
   * @param {number} min
   * @param {object}  [opts]
   * @param {boolean} [opts.required=true]
   * @param {string}  [opts.label='Value']
   * @returns {string|null}
   */
  function minLength(value, min, opts) {
    var required = !(opts && opts.required === false);
    var label = (opts && opts.label) || 'Value';

    if (!value || !value.trim()) {
      return required ? label + ' is required' : null;
    }

    if (value.trim().length < min) {
      return label + ' must be at least ' + min + ' characters';
    }
    return null;
  }

  /**
   * Validate that two values match (e.g. password confirmation).
   * @param {string} value
   * @param {string} other
   * @param {object}  [opts]
   * @param {string}  [opts.message='Values do not match']
   * @returns {string|null}
   */
  function matches(value, other, opts) {
    var message = (opts && opts.message) || 'Values do not match';
    if (value !== other) {
      return message;
    }
    return null;
  }

  /**
   * Validate that a value is not empty.
   * @param {string} value
   * @param {object}  [opts]
   * @param {string}  [opts.label='Value']
   * @returns {string|null}
   */
  function required(value, opts) {
    var label = (opts && opts.label) || 'Value';
    if (!value || !value.trim()) {
      return label + ' is required';
    }
    return null;
  }

  // ── Live field validation helper ───────────────────────────────────

  /**
   * Attach live validation to an input element.
   * Shows/hides an error message and toggles the `invalid` CSS class
   * on the input on every `input` and `blur` event.
   *
   * @param {HTMLInputElement} inputEl   The input element.
   * @param {function} validatorFn       A function(value) => errorString|null.
   * @param {object} [opts]
   * @param {boolean} [opts.eager=false] If true, validate on every keystroke.
   *                                     If false (default), only validate after
   *                                     the field loses focus once (then live).
   * @returns {{ destroy: function }}    Call destroy() to remove listeners.
   */
  function attachLiveValidation(inputEl, validatorFn, opts) {
    var eager = !!(opts && opts.eager);
    var touched = eager;
    var errorEl = null;

    var parent = inputEl.closest('.form-field');
    if (parent) {
      errorEl = parent.querySelector('.field-error');
      if (!errorEl) {
        errorEl = document.createElement('span');
        errorEl.className = 'field-error';
        parent.appendChild(errorEl);
      }
    }

    function validate() {
      var error = validatorFn(inputEl.value);
      if (touched) {
        if (error) {
          inputEl.classList.add('invalid');
          inputEl.classList.remove('valid');
          if (errorEl) {
            errorEl.textContent = error;
            errorEl.classList.add('visible');
          }
        } else {
          inputEl.classList.remove('invalid');
          inputEl.classList.add('valid');
          if (errorEl) {
            errorEl.textContent = '';
            errorEl.classList.remove('visible');
          }
        }
      }
      return error;
    }

    function onInput() {
      if (touched) {
        validate();
      }
    }

    function onBlur() {
      touched = true;
      validate();
    }

    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('blur', onBlur);

    return {
      destroy: function () {
        inputEl.removeEventListener('input', onInput);
        inputEl.removeEventListener('blur', onBlur);
        inputEl.classList.remove('invalid', 'valid');
        if (errorEl) {
          errorEl.textContent = '';
          errorEl.classList.remove('visible');
        }
      },
      validate: function () {
        touched = true;
        return validate();
      }
    };
  }

  // ── Save-success indicator ───────────────────────────────────────

  /**
   * Show a brief "Saved" indicator next to a button or inside a section.
   * Inserts a `.save-indicator` span that auto-fades after a timeout.
   *
   * @param {HTMLElement} anchorEl  Element next to which the indicator appears.
   * @param {object} [opts]
   * @param {string}  [opts.message='Saved']
   * @param {number}  [opts.duration=2500]  How long to show (ms).
   * @param {string}  [opts.type='success'] 'success' | 'error'
   */
  function showSaveIndicator(anchorEl, opts) {
    var message = (opts && opts.message) || 'Saved';
    var duration = (opts && opts.duration) || 2500;
    var type = (opts && opts.type) || 'success';

    var existing = anchorEl.parentElement && anchorEl.parentElement.querySelector('.save-indicator');
    if (existing) { existing.remove(); }

    var indicator = document.createElement('span');
    indicator.className = 'save-indicator save-indicator-' + type;
    indicator.textContent = message;
    anchorEl.insertAdjacentElement('afterend', indicator);

    requestAnimationFrame(function () {
      indicator.classList.add('visible');
    });

    setTimeout(function () {
      indicator.classList.remove('visible');
      setTimeout(function () { indicator.remove(); }, 300);
    }, duration);
  }

  // ── Public API ─────────────────────────────────────────────────────

  window.Validators = {
    url: url,
    email: email,
    minLength: minLength,
    matches: matches,
    required: required,
    attachLiveValidation: attachLiveValidation,
    showSaveIndicator: showSaveIndicator
  };
})();
