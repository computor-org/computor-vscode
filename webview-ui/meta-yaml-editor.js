(function() {
  var vscode = window.vscodeApi || acquireVsCodeApi();
  var state = window.__INITIAL_STATE__ || {};

  var app = document.getElementById('app');
  var meta = state.meta || {};
  var filePath = state.filePath;
  var exampleFiles = state.exampleFiles || [];
  var languages = state.languages || [];
  var isDirty = false;
  var yamlPreviewOpen = false;

  function markDirty() {
    isDirty = true;
    var indicator = document.querySelector('.dirty-indicator');
    if (indicator) { indicator.classList.remove('hidden'); }
  }

  function esc(text) {
    if (!text) { return ''; }
    var div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  // Ensure arrays exist
  function ensureArray(val) {
    return Array.isArray(val) ? val : [];
  }

  // Build current meta from form state
  function collectMeta() {
    var m = {};
    m.slug = (document.getElementById('meta-slug') || {}).value || '';
    m.version = (document.getElementById('meta-version') || {}).value || '';
    m.title = (document.getElementById('meta-title') || {}).value || '';
    m.description = (document.getElementById('meta-description') || {}).value || '';
    m.language = (document.getElementById('meta-language') || {}).value || '';
    m.license = (document.getElementById('meta-license') || {}).value || '';

    m.authors = collectPersonList('authors');
    m.maintainers = collectPersonList('maintainers');
    m.links = collectLinkList('links');
    m.supportingMaterial = collectLinkList('supportingMaterial');
    m.keywords = collectStringList('keywords');

    m.properties = {};
    m.properties.studentSubmissionFiles = collectStringList('studentSubmissionFiles');
    m.properties.additionalFiles = collectStringList('additionalFiles');
    m.properties.testFiles = collectStringList('testFiles');
    m.properties.studentTemplates = collectStringList('studentTemplates');

    // Preserve executionBackend if it exists
    if (meta.properties && meta.properties.executionBackend) {
      m.properties.executionBackend = meta.properties.executionBackend;
    }

    // Preserve testDependencies if it exists
    if (meta.properties && meta.properties.testDependencies) {
      m.properties.testDependencies = meta.properties.testDependencies;
    }

    return m;
  }

  function collectPersonList(prefix) {
    var items = [];
    var rows = document.querySelectorAll('[data-list="' + prefix + '"] .list-item');
    rows.forEach(function(row) {
      var name = row.querySelector('.person-name');
      var email = row.querySelector('.person-email');
      var affiliation = row.querySelector('.person-affiliation');
      if (name && (name.value || (email && email.value))) {
        var person = {};
        if (name.value) { person.name = name.value; }
        if (email && email.value) { person.email = email.value; }
        if (affiliation && affiliation.value) { person.affiliation = affiliation.value; }
        items.push(person);
      }
    });
    return items;
  }

  function collectLinkList(prefix) {
    var items = [];
    var rows = document.querySelectorAll('[data-list="' + prefix + '"] .list-item');
    rows.forEach(function(row) {
      var desc = row.querySelector('.link-description');
      var url = row.querySelector('.link-url');
      if (desc && url && (desc.value || url.value)) {
        items.push({ description: desc.value || '', url: url.value || '' });
      }
    });
    return items;
  }

  function collectStringList(prefix) {
    var items = [];
    var rows = document.querySelectorAll('[data-list="' + prefix + '"] .list-item');
    rows.forEach(function(row) {
      var input = row.querySelector('input');
      if (input && input.value.trim()) {
        items.push(input.value.trim());
      }
    });
    return items;
  }

  // YAML preview serializer
  function toYaml(obj, indent) {
    indent = indent || 0;
    var pad = '';
    for (var i = 0; i < indent; i++) { pad += '  '; }
    var lines = [];

    Object.keys(obj).forEach(function(key) {
      var val = obj[key];
      if (val === null || val === undefined) { return; }
      if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(pad + key + ': []');
        } else if (typeof val[0] === 'object') {
          lines.push(pad + key + ':');
          val.forEach(function(item) {
            var itemLines = [];
            Object.keys(item).forEach(function(k) {
              itemLines.push(k + ': ' + formatValue(item[k]));
            });
            lines.push(pad + '  - ' + itemLines[0]);
            for (var j = 1; j < itemLines.length; j++) {
              lines.push(pad + '    ' + itemLines[j]);
            }
          });
        } else {
          lines.push(pad + key + ':');
          val.forEach(function(v) {
            lines.push(pad + '  - ' + formatValue(v));
          });
        }
      } else if (typeof val === 'object') {
        lines.push(pad + key + ':');
        lines.push(toYaml(val, indent + 1));
      } else {
        lines.push(pad + key + ': ' + formatValue(val));
      }
    });
    return lines.join('\n');
  }

  function formatValue(v) {
    if (v === null || v === undefined) { return "''"; }
    if (typeof v === 'string') {
      if (v === '' || /[:#{}[\],&*?|>!%@`]/.test(v) || /^\s|\s$/.test(v)) {
        return "'" + v.replace(/'/g, "''") + "'";
      }
      return v;
    }
    return String(v);
  }

  // Validate meta
  function validateMeta(m) {
    var errors = [];
    if (!m.slug) { errors.push({ field: 'meta-slug', message: 'Slug is required' }); }
    if (!m.title) { errors.push({ field: 'meta-title', message: 'Title is required' }); }
    if (!m.version) { errors.push({ field: 'meta-version', message: 'Version is required' }); }
    return errors;
  }

  function showValidationErrors(errors) {
    // Clear previous
    document.querySelectorAll('.invalid').forEach(function(el) { el.classList.remove('invalid'); });
    document.querySelectorAll('.validation-error').forEach(function(el) { el.remove(); });

    errors.forEach(function(err) {
      var el = document.getElementById(err.field);
      if (el) {
        el.classList.add('invalid');
        var msg = document.createElement('div');
        msg.className = 'validation-error';
        msg.textContent = err.message;
        el.parentNode.appendChild(msg);
      }
    });
  }

  // Save handler
  function doSave() {
    var m = collectMeta();
    var errors = validateMeta(m);
    if (errors.length > 0) {
      showValidationErrors(errors);
      return;
    }
    showValidationErrors([]);
    vscode.postMessage({ command: 'save', data: { filePath: filePath, meta: m } });
  }

  // Open file in editor
  function openInEditor() {
    vscode.postMessage({ command: 'openFile', data: { filePath: filePath } });
  }

  // Render person list (authors/maintainers)
  function renderPersonList(prefix, items) {
    var html = '<div class="list-container" data-list="' + prefix + '">';
    items.forEach(function(item, i) {
      html += '<div class="list-item person-row">';
      html += '<input class="person-name" type="text" placeholder="Name" value="' + esc(item.name || '') + '" />';
      html += '<input class="person-email" type="text" placeholder="Email" value="' + esc(item.email || '') + '" />';
      html += '<input class="person-affiliation" type="text" placeholder="Affiliation" value="' + esc(item.affiliation || '') + '" />';
      html += '<button class="remove-btn" data-action="remove-person" data-prefix="' + prefix + '" data-index="' + i + '" title="Remove">&times;</button>';
      html += '</div>';
    });
    html += '<button class="btn-add" data-action="add-person" data-prefix="' + prefix + '">+ Add Person</button>';
    html += '</div>';
    return html;
  }

  // Render link list (links/supportingMaterial)
  function renderLinkList(prefix, items) {
    var html = '<div class="list-container" data-list="' + prefix + '">';
    items.forEach(function(item, i) {
      html += '<div class="list-item link-row">';
      html += '<input class="link-description" type="text" placeholder="Description" value="' + esc(item.description || '') + '" />';
      html += '<input class="link-url" type="text" placeholder="URL" value="' + esc(item.url || '') + '" />';
      html += '<button class="remove-btn" data-action="remove-link" data-prefix="' + prefix + '" data-index="' + i + '" title="Remove">&times;</button>';
      html += '</div>';
    });
    html += '<button class="btn-add" data-action="add-link" data-prefix="' + prefix + '">+ Add Link</button>';
    html += '</div>';
    return html;
  }

  // Render string list (keywords, file lists)
  function renderStringList(prefix, items, placeholder) {
    var html = '<div class="list-container" data-list="' + prefix + '">';
    items.forEach(function(item, i) {
      html += '<div class="list-item string-row">';
      html += '<input type="text" placeholder="' + esc(placeholder || '') + '" value="' + esc(item) + '" />';
      html += '<button class="remove-btn" data-action="remove-string" data-prefix="' + prefix + '" data-index="' + i + '" title="Remove">&times;</button>';
      html += '</div>';
    });
    html += '<button class="btn-add" data-action="add-string" data-prefix="' + prefix + '">+ Add</button>';
    html += '</div>';
    return html;
  }

  // Render file list with autocomplete from example files
  function renderFileList(prefix, items, placeholder) {
    var html = '<div class="list-container" data-list="' + prefix + '">';
    items.forEach(function(item, i) {
      html += '<div class="list-item string-row">';
      html += '<input type="text" list="file-suggestions" placeholder="' + esc(placeholder || 'filename') + '" value="' + esc(item) + '" />';
      html += '<button class="remove-btn" data-action="remove-string" data-prefix="' + prefix + '" data-index="' + i + '" title="Remove">&times;</button>';
      html += '</div>';
    });
    html += '<button class="btn-add" data-action="add-string" data-prefix="' + prefix + '">+ Add File</button>';
    html += '</div>';
    return html;
  }

  function render() {
    var authors = ensureArray(meta.authors);
    var maintainers = ensureArray(meta.maintainers);
    var links = ensureArray(meta.links);
    var supportingMaterial = ensureArray(meta.supportingMaterial);
    var keywords = ensureArray(meta.keywords);
    var props = meta.properties || {};
    var studentSubmissionFiles = ensureArray(props.studentSubmissionFiles);
    var additionalFiles = ensureArray(props.additionalFiles);
    var testFiles = ensureArray(props.testFiles);
    var studentTemplates = ensureArray(props.studentTemplates);

    var html = '';

    // Toolbar
    html += '<div class="toolbar">';
    html += '<button class="btn" onclick="return false" id="btn-save">Save</button>';
    html += '<span class="dirty-indicator hidden"></span>';
    html += '<div class="toolbar-spacer"></div>';
    html += '<button class="btn btn-secondary" onclick="return false" id="btn-open-file">Open in Editor</button>';
    html += '</div>';

    // General section
    html += '<div class="section">';
    html += '<h2>General</h2>';
    html += '<div class="meta-grid">';
    html += '<div class="form-group">';
    html += '<label for="meta-slug">Slug / Identifier</label>';
    html += '<input id="meta-slug" type="text" value="' + esc(meta.slug || '') + '" placeholder="e.g. itpcp.pgph.jl.simple_computations" />';
    html += '<div class="hint">Unique identifier for this example</div>';
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="meta-version">Version</label>';
    html += '<input id="meta-version" type="text" value="' + esc(meta.version || '') + '" placeholder="e.g. 0.1.0" />';
    html += '<div class="hint">Semantic version string</div>';
    html += '</div>';
    html += '<div class="form-group full-width">';
    html += '<label for="meta-title">Title</label>';
    html += '<input id="meta-title" type="text" value="' + esc(meta.title || '') + '" placeholder="Example title" />';
    html += '</div>';
    html += '<div class="form-group full-width">';
    html += '<label for="meta-description">Description</label>';
    html += '<textarea id="meta-description" rows="3" placeholder="Describe this example">' + esc(meta.description || '') + '</textarea>';
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="meta-language">Language</label>';
    html += '<select id="meta-language">';
    var currentLang = meta.language || '';
    var langFound = false;
    languages.forEach(function(l) {
      var sel = l.code === currentLang ? ' selected' : '';
      if (l.code === currentLang) { langFound = true; }
      html += '<option value="' + esc(l.code) + '"' + sel + '>' + esc(l.name) + ' (' + esc(l.code) + ')</option>';
    });
    if (currentLang && !langFound) {
      html += '<option value="' + esc(currentLang) + '" selected>' + esc(currentLang) + '</option>';
    }
    if (!currentLang && languages.length === 0) {
      html += '<option value="">-- Select language --</option>';
    }
    html += '</select>';
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="meta-license">License</label>';
    html += '<input id="meta-license" type="text" value="' + esc(meta.license || '') + '" placeholder="e.g. MIT" />';
    html += '</div>';
    html += '</div>'; // meta-grid
    html += '</div>'; // section

    // Authors
    html += '<div class="section">';
    html += '<h2>Authors</h2>';
    html += '<div class="hint section-hint">People who created this example</div>';
    html += renderPersonList('authors', authors);
    html += '</div>';

    // Maintainers
    html += '<div class="section">';
    html += '<h2>Maintainers</h2>';
    html += '<div class="hint section-hint">People who maintain this example</div>';
    html += renderPersonList('maintainers', maintainers);
    html += '</div>';

    // Keywords
    html += '<div class="section">';
    html += '<h2>Keywords</h2>';
    html += '<div class="hint section-hint">Tags for discovery and categorization</div>';
    html += renderStringList('keywords', keywords, 'keyword');
    html += '</div>';

    // Links
    html += '<div class="section">';
    html += '<h2>Links</h2>';
    html += '<div class="hint section-hint">Related resources and references</div>';
    html += renderLinkList('links', links);
    html += '</div>';

    // Supporting Material
    html += '<div class="section">';
    html += '<h2>Supporting Material</h2>';
    html += '<div class="hint section-hint">Additional learning materials</div>';
    html += renderLinkList('supportingMaterial', supportingMaterial);
    html += '</div>';

    // Properties
    html += '<div class="section">';
    html += '<h2>Properties</h2>';

    html += '<div class="subsection">';
    html += '<h3>Student Submission Files</h3>';
    html += '<div class="hint section-hint">Files that students submit</div>';
    html += renderFileList('studentSubmissionFiles', studentSubmissionFiles, 'filename');
    html += '</div>';

    html += '<div class="subsection">';
    html += '<h3>Additional Files</h3>';
    html += '<div class="hint section-hint">Extra files provided to students</div>';
    html += renderFileList('additionalFiles', additionalFiles, 'filename');
    html += '</div>';

    html += '<div class="subsection">';
    html += '<h3>Test Files</h3>';
    html += '<div class="hint section-hint">Files used for testing</div>';
    html += renderFileList('testFiles', testFiles, 'filename');
    html += '</div>';

    html += '<div class="subsection">';
    html += '<h3>Student Templates</h3>';
    html += '<div class="hint section-hint">Template files provided to students</div>';
    html += renderFileList('studentTemplates', studentTemplates, 'filename');
    html += '</div>';

    // Show execution backend info if present (read-only)
    if (meta.properties && meta.properties.executionBackend) {
      var eb = meta.properties.executionBackend;
      html += '<div class="subsection">';
      html += '<h3>Execution Backend</h3>';
      html += '<div class="info-row"><span class="info-label">Slug:</span> <span class="info-value">' + esc(eb.slug || '') + '</span></div>';
      html += '<div class="info-row"><span class="info-label">Version:</span> <span class="info-value">' + esc(eb.version || '') + '</span></div>';
      html += '</div>';
    }

    // Show test dependencies if present (read-only)
    if (meta.properties && meta.properties.testDependencies && meta.properties.testDependencies.length > 0) {
      html += '<div class="subsection">';
      html += '<h3>Test Dependencies</h3>';
      meta.properties.testDependencies.forEach(function(dep) {
        if (typeof dep === 'string') {
          html += '<div class="info-row">' + esc(dep) + '</div>';
        } else {
          html += '<div class="info-row">' + esc(dep.slug) + (dep.version ? ' @ ' + esc(dep.version) : '') + '</div>';
        }
      });
      html += '</div>';
    }

    html += '</div>'; // section Properties

    // YAML Preview
    html += '<div class="yaml-preview">';
    html += '<div class="yaml-preview-header" id="yaml-toggle">';
    html += '<span class="chevron' + (yamlPreviewOpen ? ' open' : '') + '">&#9654;</span>';
    html += '<h2>YAML Preview</h2>';
    html += '</div>';
    html += '<div class="yaml-preview-content' + (yamlPreviewOpen ? '' : ' collapsed') + '" id="yaml-content"></div>';
    html += '</div>';

    // File suggestions datalist
    html += '<datalist id="file-suggestions">';
    exampleFiles.forEach(function(f) {
      html += '<option value="' + esc(f) + '">';
    });
    html += '</datalist>';

    app.innerHTML = html;
    bindEvents();
    updateYamlPreview();
  }

  function updateYamlPreview() {
    var el = document.getElementById('yaml-content');
    if (!el || el.classList.contains('collapsed')) { return; }
    var m = collectMeta();
    el.textContent = toYaml(m, 0);
  }

  function bindEvents() {
    // Save button
    var saveBtn = document.getElementById('btn-save');
    if (saveBtn) { saveBtn.addEventListener('click', doSave); }

    // Open file button
    var openBtn = document.getElementById('btn-open-file');
    if (openBtn) { openBtn.addEventListener('click', openInEditor); }

    // YAML preview toggle
    var yamlToggle = document.getElementById('yaml-toggle');
    if (yamlToggle) {
      yamlToggle.addEventListener('click', function() {
        yamlPreviewOpen = !yamlPreviewOpen;
        var content = document.getElementById('yaml-content');
        var chevron = yamlToggle.querySelector('.chevron');
        if (content) { content.classList.toggle('collapsed', !yamlPreviewOpen); }
        if (chevron) { chevron.classList.toggle('open', yamlPreviewOpen); }
        if (yamlPreviewOpen) { updateYamlPreview(); }
      });
    }

    // Mark dirty on any input change
    app.addEventListener('input', function() {
      markDirty();
      if (yamlPreviewOpen) { updateYamlPreview(); }
    });

    // Keyboard shortcut: Ctrl+S / Cmd+S
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        doSave();
      }
    });

    // Delegated click events for add/remove buttons
    app.addEventListener('click', function(e) {
      var target = e.target;
      if (!target || !target.dataset) { return; }
      var action = target.dataset.action;
      if (!action) { return; }

      var prefix = target.dataset.prefix;

      if (action === 'add-person') {
        meta = collectMeta();
        var personList = ensureArray(meta[prefix]);
        personList.push({ name: '', email: '', affiliation: '' });
        meta[prefix] = personList;
        markDirty();
        render();
      } else if (action === 'remove-person' || action === 'remove-link') {
        var idx = parseInt(target.dataset.index, 10);
        meta = collectMeta();
        var arr = prefix === 'links' || prefix === 'supportingMaterial'
          ? ensureArray(meta[prefix])
          : ensureArray(meta[prefix]);
        arr.splice(idx, 1);
        meta[prefix] = arr;
        markDirty();
        render();
      } else if (action === 'add-link') {
        meta = collectMeta();
        var linkList = ensureArray(meta[prefix]);
        linkList.push({ description: '', url: '' });
        meta[prefix] = linkList;
        markDirty();
        render();
      } else if (action === 'add-string') {
        meta = collectMeta();
        var propFields = ['studentSubmissionFiles', 'additionalFiles', 'testFiles', 'studentTemplates'];
        if (propFields.indexOf(prefix) >= 0) {
          if (!meta.properties) { meta.properties = {}; }
          var sl = ensureArray(meta.properties[prefix]);
          sl.push('');
          meta.properties[prefix] = sl;
        } else {
          var sList = ensureArray(meta[prefix]);
          sList.push('');
          meta[prefix] = sList;
        }
        markDirty();
        render();
      } else if (action === 'remove-string') {
        var sIdx = parseInt(target.dataset.index, 10);
        meta = collectMeta();
        var propFields2 = ['studentSubmissionFiles', 'additionalFiles', 'testFiles', 'studentTemplates'];
        if (propFields2.indexOf(prefix) >= 0) {
          if (!meta.properties) { meta.properties = {}; }
          var rl = ensureArray(meta.properties[prefix]);
          rl.splice(sIdx, 1);
          meta.properties[prefix] = rl;
        } else {
          var rList = ensureArray(meta[prefix]);
          rList.splice(sIdx, 1);
          meta[prefix] = rList;
        }
        markDirty();
        render();
      }
    });
  }

  // Listen for messages from extension
  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (msg.command === 'saved') {
      isDirty = false;
      var indicator = document.querySelector('.dirty-indicator');
      if (indicator) { indicator.classList.add('hidden'); }
    } else if (msg.command === 'update' && msg.data) {
      // Re-initialize with new data
      if (msg.data.meta) { meta = msg.data.meta; }
      if (msg.data.filePath) { filePath = msg.data.filePath; }
      if (msg.data.exampleFiles) { exampleFiles = msg.data.exampleFiles; }
      if (msg.data.languages) { languages = msg.data.languages; }
      isDirty = false;
      render();
    }
  });

  render();
})();
