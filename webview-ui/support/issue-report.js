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
  var say = CW.say;
  var app = document.getElementById('app');
  var state = window.__INITIAL_STATE__ || {};
  var maxBytes = state.maxScreenshotBytes || 5 * 1024 * 1024;
  var screenshot = null;
  var log = null;
  // 'tickets': the backend files a support ticket (issues#520). Anything else is
  // the older GitHub issue path of the 2026.10 backends.
  var tickets = state.mode === 'tickets';
  var maxLogBytes = state.maxLogBytes || 1024 * 1024;

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

  var ticketsIntro =
    '<p class="report-intro">' + say(
      'Your report goes to the Computor support team as a ticket. ' +
      'Nothing is published. Replies appear in the web app under your reports.',
      'Deine Meldung geht als Ticket an das Support-Team von Computor. ' +
      'Nichts davon wird veröffentlicht. Antworten findest du in der Web-App unter deinen Meldungen.') + '</p>' +
    '<div class="notice warning report-warning">' +
    '<strong>' + say('Only include what is needed.', 'Schreib nur, was nötig ist.') + '</strong>' +
    say('Leave out passwords, tokens and other people\'s data, and check a screenshot or log ' +
      'before attaching it.',
      'Lass Passwörter, Tokens und Daten anderer Personen weg, und sieh dir einen Screenshot oder ' +
      'ein Log genau an, bevor du es anhängst.') +
    '</div>';

  var logSection = tickets
    ? '<div class="section">' +
      '<h2>' + say('Log file (optional)', 'Log-Datei (optional)') + '</h2>' +
      '<p class="report-hint">' + say(
        'Attach a text log only if you want to, for example saved test output. Up to ',
        'Häng ein Text-Log nur an, wenn du willst, zum Beispiel gespeicherte Testausgaben. Bis zu ') +
      Math.round(maxLogBytes / 1024) + ' KB.</p>' +
      '<input type="file" id="log-file" accept=".log,.txt,text/plain">' +
      '<div id="log-meta" class="report-hint is-hidden"></div>' +
      '</div>'
    : '';

  app.innerHTML =
    '<div class="header"><h1>' + say('Report a Problem', 'Problem melden') + '</h1></div>' +
    (tickets ? ticketsIntro :
    '<p class="report-intro">' + say(
      'Your report is sent to the Computor maintainers as an issue. ' +
      'Everything you write below becomes part of it.',
      'Deine Meldung geht als Issue an das Entwicklungsteam von Computor. ' +
      'Alles, was du unten schreibst, wird Teil davon.') + '</p>' +

    '<div class="notice warning report-warning">' +
    '<strong>' + say('Do not include personal data.', 'Schreib keine personenbezogenen Daten hinein.') + '</strong>' +
    say('The issue is read by people outside your course. Leave out anything that identifies ' +
      'you or anyone else:',
      'Das Issue lesen auch Personen außerhalb deines Kurses. Lass alles weg, woran man dich ' +
      'oder andere erkennen kann:') +
    '<ul>' +
    '<li>' + say('names, email addresses, matriculation or student numbers',
      'Namen, E-Mail-Adressen und Matrikelnummern') + '</li>' +
    '<li>' + say('grades, marks and feedback about a specific person',
      'Noten, Punkte und Rückmeldungen zu einer bestimmten Person') + '</li>' +
    '<li>' + say('passwords, tokens and anything else that would let someone sign in',
      'Passwörter, Tokens und alles andere, womit sich jemand anmelden könnte') + '</li>' +
    '</ul>' +
    '</div>') +

    '<div class="section">' +
    '<h2>' + say('What went wrong', 'Was ist schiefgegangen?') + '</h2>' +
    field('title', say('Summary', 'Zusammenfassung'),
      say('One line describing the problem', 'Das Problem in einer Zeile'), false, 0) +
    field('description', say('What happened', 'Was ist passiert?'),
      say('Describe the problem you ran into', 'Beschreib das Problem, auf das du gestoßen bist'), true, 5) +
    field('expected', say('What you expected instead', 'Was hast du stattdessen erwartet?'),
      say('Optional', 'Optional'), false, 3) +
    field('steps', say('How to reproduce it', 'Wie lässt es sich nachstellen?'),
      say('Optional — step by step, if you can', 'Optional, wenn möglich Schritt für Schritt'), false, 4) +
    '</div>' +

    '<div class="section">' +
    '<h2>' + say('Screenshot (optional)', 'Screenshot (optional)') + '</h2>' +
    '<div class="notice warning report-warning">' +
    '<strong>' + say('Check the screenshot before attaching it.',
      'Sieh dir den Screenshot an, bevor du ihn anhängst.') + '</strong>' +
    say('A screenshot shows everything that was on screen — open mail, chat windows, other ' +
      'students&rsquo; names, file paths. Crop it to the part that matters and black out the ' +
      'rest. Once it is attached it goes into the issue, and you are responsible for what ' +
      'it reveals.',
      'Ein Screenshot zeigt alles, was auf dem Bildschirm war: offene Mails, Chatfenster, ' +
      'Namen anderer Studierender und Dateipfade. Schneide ihn auf den Teil zu, auf den es ' +
      'ankommt, und schwärze den Rest. Sobald er angehängt ist, wird er Teil des Issues, und ' +
      'du bist dafür verantwortlich, was er zeigt.') +
    '</div>' +
    '<div id="dropzone" class="dropzone">' +
    '<div>' + say('Take a screenshot yourself, then paste it here, drop the file, or choose it.',
      'Mach selbst einen Screenshot und füge ihn hier ein, zieh die Datei hierher oder wähle sie aus.') + '</div>' +
    '<div class="dropzone-actions">' +
    '<button type="button" class="btn secondary" id="choose">' + say('Choose image…', 'Bild auswählen …') + '</button>' +
    '</div>' +
    '<input type="file" id="file" accept="image/png,image/jpeg,image/gif,image/webp" class="is-hidden">' +
    '</div>' +
    '<div id="preview" class="screenshot-preview is-hidden">' +
    '<img id="preview-image" alt="' + say('Attached screenshot', 'Angehängter Screenshot') + '">' +
    '<div class="screenshot-meta">' +
    '<span id="preview-name"></span>' +
    '<button type="button" class="btn secondary sm" id="remove">' + say('Remove screenshot', 'Screenshot entfernen') + '</button>' +
    '</div>' +
    '</div>' +
    '</div>' +

    logSection +
    '<div id="feedback" class="notice error is-hidden"></div>' +
    '<div id="result" class="notice success report-result is-hidden"></div>' +

    '<div class="form-actions">' +
    '<button type="button" class="btn" id="submit">' + say('Submit report', 'Meldung absenden') + '</button>' +
    '<button type="button" class="btn secondary" id="cancel">' + say('Cancel', 'Abbrechen') + '</button>' +
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
      showError(say('Screenshots must be PNG, JPEG, GIF, or WebP.', 'Screenshots müssen PNG, JPEG, GIF oder WebP sein.'));
      return;
    }
    if (file.size > maxBytes) {
      var megabytes = Math.round(maxBytes / (1024 * 1024));
      showError(say('That image is larger than ' + megabytes + ' MB.', 'Das Bild ist größer als ' + megabytes + ' MB.'));
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
      showError(say('That image could not be read.', 'Das Bild ließ sich nicht lesen.'));
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

  var logInput = document.getElementById('log-file');
  if (logInput) {
    logInput.addEventListener('change', function () {
      clearError();
      log = null;
      var meta = document.getElementById('log-meta');
      meta.classList.add('is-hidden');
      var file = logInput.files && logInput.files[0];
      if (!file) {
        return;
      }
      if (file.size > maxLogBytes) {
        var kilobytes = Math.round(maxLogBytes / 1024);
        showError(say('That log is larger than ' + kilobytes + ' KB.', 'Das Log ist größer als ' + kilobytes + ' KB.'));
        logInput.value = '';
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        log = { text: String(reader.result), fileName: file.name || 'computor.log' };
        meta.textContent = say('Attached: ', 'Angehängt: ') + log.fileName;
        meta.classList.remove('is-hidden');
      };
      reader.onerror = function () {
        showError(say('That log could not be read.', 'Das Log ließ sich nicht lesen.'));
      };
      reader.readAsText(file);
    });
  }

  function value(id) {
    return (document.getElementById(id).value || '').trim();
  }

  submitButton.addEventListener('click', function () {
    clearError();
    if (!value('description')) {
      showError(say('Please describe the problem before submitting.', 'Beschreib bitte das Problem, bevor du die Meldung absendest.'));
      document.getElementById('description').focus();
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = say('Submitting…', 'Wird gesendet …');
    CW.post('submit', {
      title: value('title'),
      description: value('description'),
      expected: value('expected'),
      steps: value('steps'),
      screenshot: screenshot,
      log: log
    });
  });

  document.getElementById('cancel').addEventListener('click', function () {
    CW.post('cancel');
  });

  function ready() {
    submitButton.disabled = false;
    submitButton.textContent = say('Submit report', 'Meldung absenden');
  }

  CW.onCommand('error', function (data) {
    ready();
    showError((data && data.message) || say('The report could not be submitted.', 'Die Meldung konnte nicht abgesendet werden.'));
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
      ? '<p class="report-hint">' + say(
        'Your screenshot could not be attached — the report was sent ' +
        'without it. Mention it when you follow up if it matters.',
        'Dein Screenshot konnte nicht angehängt werden, deshalb wurde die Meldung ohne ihn ' +
        'gesendet. Erwähne ihn bei einer Rückfrage, falls er wichtig ist.') + '</p>'
      : '';
    if (data && data.ticketNumber) {
      var logDropped = data.logDropped
        ? '<p class="report-hint">' + say('Your log could not be attached.', 'Dein Log konnte nicht angehängt werden.') + '</p>'
        : '';
      result.innerHTML =
        '<strong>' + say('Thank you — your report was received.', 'Danke, deine Meldung ist angekommen.') + '</strong>' +
        '<dl><dt>Ticket</dt><dd>#' + CW.escapeHtml(String(data.ticketNumber)) + '</dd></dl>' +
        '<p class="report-hint">' + say(
          'The support team answers in the web app, where you can also follow the status of your report.',
          'Das Support-Team antwortet in der Web-App, wo du auch den Stand deiner Meldung verfolgen kannst.') + '</p>' +
        (data.canOpen ? '<button type="button" class="btn secondary" id="open-report">' +
          say('Open in browser', 'Im Browser öffnen') + '</button>' : '') +
        dropped + logDropped;
      result.classList.remove('is-hidden');
      var open = document.getElementById('open-report');
      if (open) {
        open.addEventListener('click', function () {
          CW.post('openReport', { ticketId: data.ticketId });
        });
      }
      return;
    }
    result.innerHTML =
      '<strong>' + say('Thank you — your report was submitted.', 'Danke, deine Meldung wurde abgesendet.') + '</strong>' +
      '<dl><dt>' + say('Reference', 'Referenz') + '</dt><dd>' + CW.escapeHtml(String(data.reportId)) + '</dd>' + link + '</dl>' +
      '<p class="report-hint">' + say('Quote that reference if you follow up with your lecturer.',
        'Gib diese Referenz an, wenn du bei deinen Lehrenden nachfragst.') + '</p>' +
      dropped;
    result.classList.remove('is-hidden');
  });
})();
