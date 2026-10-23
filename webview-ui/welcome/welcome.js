/**
 * Welcome page.
 *
 * The markup is rendered by the extension; this only reports clicks. Buttons
 * name a help page, a link key or a role — never a URL or a command — and the
 * extension decides what that may open.
 */
(function () {
  'use strict';

  var CW = window.ComputorWebview;

  CW.registerActions({
    help: function (dataset) {
      CW.post('help', { page: dataset.page });
    },
    link: function (dataset) {
      CW.post('link', { key: dataset.link });
    },
    view: function (dataset) {
      CW.post('view', { role: dataset.role });
    },
    login: function () {
      CW.post('login');
    },
    setBackend: function () {
      CW.post('setBackend');
    },
    reportProblem: function () {
      CW.post('reportProblem');
    }
  });

  var startup = document.getElementById('show-on-startup');
  if (startup) {
    startup.addEventListener('change', function () {
      CW.post('showOnStartup', { value: startup.checked });
    });
  }
})();
