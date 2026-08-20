/**
 * Problem-report form.
 *
 * Free text only — no dropdowns, and nothing is captured on the user's behalf.
 * A screenshot exists only if the user took one and attached it, which is why
 * the warning about what a screenshot reveals sits right above the drop zone
 * rather than in a tooltip somewhere.
 */
(function () {
  'use strict';

  var CW = window.ComputorWebview;
  var app = document.getElementById('app');
  var state = window.__INITIAL_STATE__ || {};
  var maxBytes = state.maxScreenshotBytes || 5 * 1024 * 1024;
  var screenshot = null;

  var ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

  function field(id, label, placeholder, required, rows) {
    var mark = required ? ' <span class="report-required" aria-hidden="true">*</span>' : '';
    var control = rows
      ? '<textarea id="' + id + '" rows="' + rows + '" placeholder="' + placeholder + '"></textarea>'
      : '<input type="text" id="' + id + '" placeholder="' + placeholder + '">';
    return (
      '<div class="form-field">' +
      '<label for="' + id + '">' + label + mark + '</label>' +
      control +
      '</div>'
    );
  }

  app.innerHTML =
    '<div class="header"><h1>Report a Problem</h1></div>' +
    '<p class="report-intro">Your report is sent to the Computor maintainers as an issue. ' +
    'Everything you write below becomes part of it.</p>' +

    '<div class="notice warning report-warning">' +
    '<strong>Do not include personal data.</strong>' +
    'The issue is read by people outside your course. Leave out anything that identifies ' +
    'you or anyone else:' +
    '<ul>' +
    '<li>names, email addresses, matriculation or student numbers</li>' +
    '<li>grades, marks and feedback about a specific person</li>' +
    '<li>passwords, tokens and anything else that would let someone sign in</li>' +
    '</ul>' +
    '</div>' +

    '<div class="section">' +
    '<h2>What went wrong</h2>' +
    field('title', 'Summary', 'One line describing the problem', false, 0) +
    field('description', 'What happened', 'Describe the problem you ran into', true, 5) +
    field('expected', 'What you expected instead', 'Optional', false, 3) +
    field('steps', 'How to reproduce it', 'Optional — step by step, if you can', false, 4) +
    '</div>' +

    '<div class="section">' +
    '<h2>Screenshot (optional)</h2>' +
    '<div class="notice warning report-warning">' +
    '<strong>Check the screenshot before attaching it.</strong>' +
    'A screenshot shows everything that was on screen — open mail, chat windows, other ' +
    'students&rsquo; names, file paths. Crop it to the part that matters and black out the ' +
    'rest. Once it is attached it goes into the issue, and you are responsible for what ' +
    'it reveals.' +
    '</div>' +
    '<div id="dropzone" class="dropzone">' +
    '<div>Take a screenshot yourself, then paste it here, drop the file, or choose it.</div>' +
    '<div class="dropzone-actions">' +
    '<button type="button" class="btn secondary" id="choose">Choose image…</button>' +
    '</div>' +
    '<input type="file" id="file" accept="image/png,image/jpeg,image/gif,image/webp" class="is-hidden">' +
    '</div>' +
    '<div id="preview" class="screenshot-preview is-hidden">' +
    '<img id="preview-image" alt="Attached screenshot">' +
    '<div class="screenshot-meta">' +
    '<span id="preview-name"></span>' +
    '<button type="button" class="btn secondary sm" id="remove">Remove screenshot</button>' +
    '</div>' +
    '</div>' +
    '</div>' +

    '<div id="feedback" class="notice error is-hidden"></div>' +
    '<div id="result" class="notice success report-result is-hidden"></div>' +

    '<div class="form-actions">' +
    '<button type="button" class="btn" id="submit">Submit report</button>' +
    '<button type="button" class="btn secondary" id="cancel">Cancel</button>' +
    '</div>';

  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file');
  var preview = document.getElementById('preview');
  var previewImage = document.getElementById('preview-image');
  var previewName = document.getElementById('preview-name');
  var feedback = document.getElementById('feedback');
  var result = document.getElementById('result');
  var submitButton = document.getElementById('submit');

  function showError(message) {
    feedback.textContent = message;
    feedback.classList.remove('is-hidden');
  }

  function clearError() {
    feedback.textContent = '';
    feedback.classList.add('is-hidden');
  }

  function attach(file) {
    clearError();
    if (!file) {
      return;
    }
    if (ALLOWED.indexOf(file.type) === -1) {
      showError('Screenshots must be PNG, JPEG, GIF, or WebP.');
      return;
    }
    if (file.size > maxBytes) {
      showError('That image is larger than ' + Math.round(maxBytes / (1024 * 1024)) + ' MB.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      screenshot = { dataUrl: String(reader.result), fileName: file.name || 'screenshot' };
      previewImage.src = screenshot.dataUrl;
      previewName.textContent = screenshot.fileName;
      preview.classList.remove('is-hidden');
      dropzone.classList.add('is-hidden');
    };
    reader.onerror = function () {
      showError('That image could not be read.');
    };
    reader.readAsDataURL(file);
  }

  function detach() {
    screenshot = null;
    previewImage.removeAttribute('src');
    preview.classList.add('is-hidden');
    dropzone.classList.remove('is-hidden');
    fileInput.value = '';
  }

  document.getElementById('choose').addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    attach(fileInput.files && fileInput.files[0]);
  });
  document.getElementById('remove').addEventListener('click', detach);

  ['dragenter', 'dragover'].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', function (event) {
    attach(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
  });

  // Paste is the path most users will take: capture with the OS tool, crop it
  // there, then Ctrl+V straight into the form.
  window.addEventListener('paste', function (event) {
    var items = (event.clipboardData && event.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        attach(items[i].getAsFile());
        return;
      }
    }
  });

  function value(id) {
    return (document.getElementById(id).value || '').trim();
  }

  submitButton.addEventListener('click', function () {
    clearError();
    if (!value('description')) {
      showError('Please describe the problem before submitting.');
      document.getElementById('description').focus();
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting…';
    CW.post('submit', {
      title: value('title'),
      description: value('description'),
      expected: value('expected'),
      steps: value('steps'),
      screenshot: screenshot
    });
  });

  document.getElementById('cancel').addEventListener('click', function () {
    CW.post('cancel');
  });

  function ready() {
    submitButton.disabled = false;
    submitButton.textContent = 'Submit report';
  }

  CW.onCommand('error', function (data) {
    ready();
    showError((data && data.message) || 'The report could not be submitted.');
  });

  CW.onCommand('submitted', function (data) {
    clearError();
    document.querySelectorAll('.section, .form-actions').forEach(function (node) {
      node.classList.add('is-hidden');
    });
    var link = data && data.issueUrl
      ? '<dt>Issue</dt><dd><a href="' + CW.escapeHtml(data.issueUrl) + '">#' +
        CW.escapeHtml(String(data.issueNumber)) + '</a></dd>'
      : '';
    var dropped = data && data.screenshotDropped
      ? '<p class="report-hint">Your screenshot could not be attached — the report was sent ' +
        'without it. Mention it when you follow up if it matters.</p>'
      : '';
    result.innerHTML =
      '<strong>Thank you — your report was submitted.</strong>' +
      '<dl><dt>Reference</dt><dd>' + CW.escapeHtml(String(data.reportId)) + '</dd>' + link + '</dl>' +
      '<p class="report-hint">Quote that reference if you follow up with your lecturer.</p>' +
      dropped;
    result.classList.remove('is-hidden');
  });
})();
