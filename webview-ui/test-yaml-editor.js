(function() {
  var vscode = window.vscodeApi || acquireVsCodeApi();
  var state = window.__INITIAL_STATE__ || {};

  var app = document.getElementById('app');
  var registry = state.registry;
  var suite = state.testSuite || {};
  var currentLangId = state.detectedLanguage || (suite.type) || null;
  var isDirty = false;
  var collapsedCollections = {};
  var selectedAddType = null;
  var yamlPreviewOpen = false;

  function getLang(langId) {
    if (!langId) return null;
    return registry.languages.find(function(l) { return l.id === langId; }) || null;
  }

  function getTestType(lang, typeId) {
    if (!lang) return null;
    return lang.test_types.find(function(t) { return t.id === typeId; }) || null;
  }

  function getQualification(lang, qualId) {
    if (!lang || !lang.qualifications) return null;
    return lang.qualifications.find(function(q) { return q.id === qualId; }) || null;
  }

  function markDirty() {
    isDirty = true;
    var indicator = document.querySelector('.dirty-indicator');
    if (indicator) indicator.classList.remove('hidden');
  }

  function esc(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  // Build a new collection with defaults from the registry
  function buildNewCollection(testType) {
    var col = { type: testType.id, name: testType.name, tests: [] };
    if (testType.collection_fields) {
      testType.collection_fields.forEach(function(f) {
        if (f.default != null && f.name !== 'timeout') {
          col[f.name] = f.default;
        }
      });
    }
    // Set default timeout from registry
    var timeoutField = (testType.collection_fields || []).find(function(f) { return f.name === 'timeout'; });
    if (timeoutField && timeoutField.default != null) {
      col.timeout = timeoutField.default;
    }
    return col;
  }

  // Build a new test with defaults from the registry
  function buildNewTest(testType, lang) {
    var test = { name: '' };
    if (testType && testType.default_qualification) {
      test.qualification = testType.default_qualification;
    }
    if (testType && testType.test_fields) {
      testType.test_fields.forEach(function(f) {
        if (f.default != null && f.name !== 'name' && f.name !== 'qualification') {
          test[f.name] = f.default;
        }
      });
    }
    return test;
  }

  // Validate suite data and return errors
  function validateSuite(data) {
    var errors = [];
    var collections = (data.properties && data.properties.tests) || [];
    collections.forEach(function(col, ci) {
      var tests = col.tests || [];
      if (tests.length === 0) {
        errors.push({ type: 'collection', ci: ci, message: 'Collection has no tests' });
      }
      tests.forEach(function(test, ti) {
        if (!test.name || !test.name.trim()) {
          errors.push({ type: 'test', ci: ci, ti: ti, field: 'name', message: 'Test name is required' });
        }
      });
    });
    return errors;
  }

  // Simple YAML serializer for preview (no external dependency in webview)
  function toYaml(obj, indent) {
    indent = indent || 0;
    var pad = '';
    for (var p = 0; p < indent; p++) pad += '  ';
    var lines = [];

    if (Array.isArray(obj)) {
      if (obj.length === 0) return ' []';
      obj.forEach(function(item) {
        if (typeof item === 'object' && item !== null) {
          lines.push(pad + '-');
          var subLines = toYamlObj(item, indent + 1);
          lines.push(subLines);
        } else {
          lines.push(pad + '- ' + formatYamlValue(item));
        }
      });
      return '\n' + lines.join('\n');
    }

    if (typeof obj === 'object' && obj !== null) {
      return '\n' + toYamlObj(obj, indent);
    }

    return ' ' + formatYamlValue(obj);
  }

  function toYamlObj(obj, indent) {
    var pad = '';
    for (var p = 0; p < indent; p++) pad += '  ';
    var lines = [];
    Object.keys(obj).forEach(function(key) {
      var val = obj[key];
      if (val == null) return;
      if (typeof val === 'object') {
        lines.push(pad + key + ':' + toYaml(val, indent + 1));
      } else {
        lines.push(pad + key + ': ' + formatYamlValue(val));
      }
    });
    return lines.join('\n');
  }

  function formatYamlValue(val) {
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    var s = String(val);
    if (s === '' || s === 'true' || s === 'false' || s === 'null' || /[:{}\[\],&*?|>!%@`#]/.test(s) || /^\s|\s$/.test(s) || /^\d/.test(s)) {
      return "'" + s.replace(/'/g, "''") + "'";
    }
    return s;
  }

  function buildSuiteData() {
    var data = {};
    var nameEl = document.getElementById('suite-name');
    var descEl = document.getElementById('suite-description');
    var versionEl = document.getElementById('suite-version');

    if (nameEl && nameEl.value) data.name = nameEl.value;
    if (descEl && descEl.value) data.description = descEl.value;
    if (currentLangId) data.type = currentLangId;
    if (versionEl && versionEl.value) data.version = versionEl.value;

    var props = {};
    var timeoutEl = document.getElementById('suite-timeout');
    var relTolEl = document.getElementById('suite-relativeTolerance');
    var absTolEl = document.getElementById('suite-absoluteTolerance');

    if (timeoutEl && timeoutEl.value) props.timeout = parseFloat(timeoutEl.value);
    if (relTolEl && relTolEl.value) props.relativeTolerance = parseFloat(relTolEl.value);
    if (absTolEl && absTolEl.value) props.absoluteTolerance = parseFloat(absTolEl.value);

    props.tests = [];
    var collectionEls = document.querySelectorAll('.collection-card');
    collectionEls.forEach(function(colEl) {
      var col = {};
      col.type = colEl.dataset.type;

      colEl.querySelectorAll('[data-col-field]').forEach(function(fieldEl) {
        var fieldName = fieldEl.dataset.colField;
        var val = fieldEl.value;
        if (fieldEl.type === 'number' && val) {
          col[fieldName] = parseFloat(val);
        } else if (val) {
          col[fieldName] = val;
        }
      });

      colEl.querySelectorAll('[data-array-name]').forEach(function(arrContainer) {
        var arrName = arrContainer.dataset.arrayName;
        var items = [];
        arrContainer.querySelectorAll('.array-item input').forEach(function(inp) {
          if (inp.value) items.push(inp.value);
        });
        if (items.length > 0) col[arrName] = items;
      });

      col.tests = [];
      colEl.querySelectorAll('.test-row').forEach(function(testEl) {
        var test = {};
        testEl.querySelectorAll('[data-test-field]').forEach(function(fEl) {
          var fn = fEl.dataset.testField;
          var v = fEl.value;
          if (!v) return;
          if (fEl.type === 'number') {
            test[fn] = parseFloat(v);
          } else {
            test[fn] = v;
          }
        });
        if (test.name) col.tests.push(test);
      });

      props.tests.push(col);
    });

    data.properties = props;
    return data;
  }

  function bindEvents() {
    app.addEventListener('click', function(e) {
      var target = e.target;
      if (!target || !target.dataset) return;
      var action = target.dataset.action;
      if (!action) return;

      if (action === 'save') {
        var data = buildSuiteData();
        var errors = validateSuite(data);
        if (errors.length > 0) {
          highlightErrors(errors);
          return;
        }
        vscode.postMessage({ command: 'save', data: { filePath: state.filePath, testSuite: data } });
        return;
      }
      if (action === 'openRaw') {
        vscode.postMessage({ command: 'openFile', data: { filePath: state.filePath } });
        return;
      }
      if (action === 'addCollection') {
        var sel = document.getElementById('add-type-select');
        if (!sel) return;
        selectedAddType = sel.value;
        suite = buildSuiteData();
        if (!suite.properties) suite.properties = {};
        if (!suite.properties.tests) suite.properties.tests = [];
        var lang = getLang(currentLangId);
        var tt = getTestType(lang, selectedAddType);
        var newCol = tt ? buildNewCollection(tt) : { type: selectedAddType, name: selectedAddType, tests: [] };
        suite.properties.tests.push(newCol);
        markDirty();
        render();
        return;
      }
      if (action === 'toggleCollection') {
        var idx = target.closest('[data-index]').dataset.index;
        var body = document.getElementById('col-body-' + idx);
        var chevron = document.getElementById('chevron-' + idx);
        if (body) { body.classList.toggle('collapsed'); }
        if (chevron) { chevron.classList.toggle('open'); }
        collapsedCollections[idx] = body ? body.classList.contains('collapsed') : false;
        return;
      }
      if (action === 'removeCollection') {
        e.stopPropagation();
        var ci = parseInt(target.dataset.ci);
        suite = buildSuiteData();
        if (suite.properties && suite.properties.tests) {
          suite.properties.tests.splice(ci, 1);
          var newCollapsed = {};
          Object.keys(collapsedCollections).forEach(function(k) {
            var ki = parseInt(k);
            if (ki < ci) { newCollapsed[ki] = collapsedCollections[ki]; }
            else if (ki > ci) { newCollapsed[ki - 1] = collapsedCollections[ki]; }
          });
          collapsedCollections = newCollapsed;
        }
        markDirty();
        render();
        return;
      }
      if (action === 'addTest') {
        var ci2 = parseInt(target.dataset.ci);
        suite = buildSuiteData();
        if (suite.properties && suite.properties.tests && suite.properties.tests[ci2]) {
          var lang2 = getLang(currentLangId);
          var tt2 = getTestType(lang2, suite.properties.tests[ci2].type);
          var newTest = buildNewTest(tt2, lang2);
          suite.properties.tests[ci2].tests.push(newTest);
        }
        markDirty();
        render();
        return;
      }
      if (action === 'removeTest') {
        var rci = parseInt(target.dataset.ci);
        var rti = parseInt(target.dataset.ti);
        suite = buildSuiteData();
        if (suite.properties && suite.properties.tests && suite.properties.tests[rci]) {
          suite.properties.tests[rci].tests.splice(rti, 1);
        }
        markDirty();
        render();
        return;
      }
      if (action === 'moveCollectionUp' || action === 'moveCollectionDown') {
        e.stopPropagation();
        var mci = parseInt(target.dataset.ci);
        var dir = action === 'moveCollectionUp' ? -1 : 1;
        suite = buildSuiteData();
        if (suite.properties && suite.properties.tests) {
          var arr = suite.properties.tests;
          var swapIdx = mci + dir;
          if (swapIdx >= 0 && swapIdx < arr.length) {
            var tmp = arr[mci];
            arr[mci] = arr[swapIdx];
            arr[swapIdx] = tmp;
            var cOld = collapsedCollections[mci];
            collapsedCollections[mci] = collapsedCollections[swapIdx];
            collapsedCollections[swapIdx] = cOld;
          }
        }
        markDirty();
        render();
        return;
      }
      if (action === 'moveTestUp' || action === 'moveTestDown') {
        var mtci = parseInt(target.dataset.ci);
        var mti = parseInt(target.dataset.ti);
        var tdir = action === 'moveTestUp' ? -1 : 1;
        suite = buildSuiteData();
        if (suite.properties && suite.properties.tests && suite.properties.tests[mtci]) {
          var tarr = suite.properties.tests[mtci].tests;
          var tSwap = mti + tdir;
          if (tarr && tSwap >= 0 && tSwap < tarr.length) {
            var ttmp = tarr[mti];
            tarr[mti] = tarr[tSwap];
            tarr[tSwap] = ttmp;
          }
        }
        markDirty();
        render();
        return;
      }
      if (action === 'addArrayItem') {
        var container = target.parentElement;
        var div = document.createElement('div');
        div.className = 'array-item';
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.addEventListener('change', markDirty);
        var rmBtn = document.createElement('button');
        rmBtn.className = 'remove-btn';
        rmBtn.innerHTML = '&#10005;';
        rmBtn.title = 'Remove';
        rmBtn.dataset.action = 'removeArrayItem';
        div.appendChild(inp);
        div.appendChild(rmBtn);
        container.insertBefore(div, target);
        markDirty();
        return;
      }
      if (action === 'removeArrayItem') {
        var item = target.closest('.array-item');
        if (item) { item.remove(); markDirty(); }
        return;
      }
      if (action === 'toggleYamlPreview') {
        yamlPreviewOpen = !yamlPreviewOpen;
        var previewContent = document.getElementById('yaml-preview-content');
        var previewChevron = document.getElementById('yaml-preview-chevron');
        if (previewContent) { previewContent.classList.toggle('collapsed', !yamlPreviewOpen); }
        if (previewChevron) { previewChevron.classList.toggle('open', yamlPreviewOpen); }
        if (yamlPreviewOpen) { updateYamlPreview(); }
        return;
      }
    });

    app.addEventListener('change', function(e) {
      var target = e.target;
      if (target && target.id === 'lang-select') {
        currentLangId = target.value || null;
        selectedAddType = null;
        markDirty();
        render();
      } else if (target && target.id === 'add-type-select') {
        selectedAddType = target.value;
      } else if (target) {
        markDirty();
        if (yamlPreviewOpen) { updateYamlPreview(); }
        clearFieldError(target);
      }
    });

    app.addEventListener('input', function(e) {
      if (yamlPreviewOpen) { updateYamlPreview(); }
    });
  }

  function highlightErrors(errors) {
    // Clear previous errors
    document.querySelectorAll('.invalid').forEach(function(el) { el.classList.remove('invalid'); });
    document.querySelectorAll('.validation-error').forEach(function(el) { el.remove(); });
    document.querySelectorAll('.has-error').forEach(function(el) { el.classList.remove('has-error'); });

    var firstErrorEl = null;

    errors.forEach(function(err) {
      if (err.type === 'test' && err.field === 'name') {
        var rows = document.querySelectorAll('.collection-card[data-index="' + err.ci + '"] .test-row');
        var row = rows[err.ti];
        if (row) {
          row.classList.add('has-error');
          var nameInput = row.querySelector('[data-test-field="name"]');
          if (nameInput) {
            nameInput.classList.add('invalid');
            if (!firstErrorEl) firstErrorEl = nameInput;
          }
        }
        // Ensure collection is expanded
        var body = document.getElementById('col-body-' + err.ci);
        var chevron = document.getElementById('chevron-' + err.ci);
        if (body && body.classList.contains('collapsed')) {
          body.classList.remove('collapsed');
          if (chevron) chevron.classList.add('open');
          collapsedCollections[err.ci] = false;
        }
      }
    });

    if (firstErrorEl) {
      firstErrorEl.focus();
      firstErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function clearFieldError(el) {
    if (el.classList.contains('invalid') && el.value.trim()) {
      el.classList.remove('invalid');
      var row = el.closest('.test-row');
      if (row) row.classList.remove('has-error');
    }
  }

  function updateYamlPreview() {
    var previewEl = document.getElementById('yaml-preview-code');
    if (!previewEl) return;
    var data = buildSuiteData();
    previewEl.textContent = toYamlObj(data, 0);
  }

  function render() {
    var lang = getLang(currentLangId);
    var collections = (suite.properties && suite.properties.tests) || [];

    var html = '';

    // Toolbar
    html += '<div class="toolbar">';
    html += '<button data-action="save">Save</button>';
    html += '<button data-action="openRaw" class="btn-secondary btn-sm">Open Raw YAML</button>';
    html += '<span class="dirty-indicator ' + (isDirty ? '' : 'hidden') + '" title="Unsaved changes"></span>';
    html += '<div class="toolbar-spacer"></div>';
    html += '<label style="font-size:12px;color:var(--vscode-descriptionForeground)">Language:</label>';
    html += '<select id="lang-select" style="width:150px">';
    html += '<option value="">Select language...</option>';
    registry.languages.forEach(function(l) {
      html += '<option value="' + esc(l.id) + '"' + (l.id === currentLangId ? ' selected' : '') + '>' + esc(l.name) + '</option>';
    });
    html += '</select>';
    html += '</div>';

    // Suite metadata
    html += '<div class="section">';
    html += '<h2>Suite Properties</h2>';
    html += '<div class="suite-meta">';
    html += fgHint('Name', '<input type="text" id="suite-name" value="' + esc(suite.name || '') + '" placeholder="Test suite name">', 'Display name for the test suite');
    html += fgHint('Version', '<input type="text" id="suite-version" value="' + esc(suite.version || '1.0') + '" placeholder="1.0">', 'Suite version number');
    html += fgHint('Description', '<input type="text" id="suite-description" value="' + esc(suite.description || '') + '" placeholder="Description">', 'Brief description of what this suite tests', true);
    html += fgHint('Timeout (s)', '<input type="number" id="suite-timeout" value="' + esc(np(suite, 'properties.timeout', '')) + '" placeholder="30" step="1" min="1">', 'Global timeout for all tests in seconds');
    html += fgHint('Relative Tolerance', '<input type="number" id="suite-relativeTolerance" value="' + esc(np(suite, 'properties.relativeTolerance', '')) + '" placeholder="1e-12" step="any">', 'Global relative tolerance for numeric comparisons');
    html += fgHint('Absolute Tolerance', '<input type="number" id="suite-absoluteTolerance" value="' + esc(np(suite, 'properties.absoluteTolerance', '')) + '" placeholder="0.0001" step="any">', 'Global absolute tolerance for numeric comparisons');
    html += '</div></div>';

    // Test collections
    html += '<div class="section">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">';
    html += '<h2 style="margin:0;flex:1">Test Collections</h2>';
    if (lang) {
      html += renderTestTypeSelect(lang);
      html += '<button data-action="addCollection" class="btn-sm">+ Add Collection</button>';
    }
    html += '</div>';

    if (collections.length === 0) {
      if (!lang) {
        html += '<div class="empty-collections">Select a language above to add test collections.</div>';
      } else {
        html += '<div class="empty-collections">No test collections yet. Select a test type and click "+ Add Collection".</div>';
      }
    } else {
      collections.forEach(function(col, ci) {
        html += renderCollection(col, ci, lang, collections.length);
      });
    }
    html += '</div>';

    // YAML preview
    html += '<div class="section yaml-preview">';
    html += '<div class="yaml-preview-header" data-action="toggleYamlPreview">';
    html += '<span class="chevron' + (yamlPreviewOpen ? ' open' : '') + '" id="yaml-preview-chevron">&#9654;</span>';
    html += '<h2>YAML Preview</h2>';
    html += '</div>';
    html += '<div class="yaml-preview-content' + (yamlPreviewOpen ? '' : ' collapsed') + '" id="yaml-preview-content">';
    html += '<code id="yaml-preview-code"></code>';
    html += '</div>';
    html += '</div>';

    app.innerHTML = html;

    if (yamlPreviewOpen) { updateYamlPreview(); }
  }

  // Test type dropdown grouped by category
  function renderTestTypeSelect(lang) {
    var grouped = {};
    var ungrouped = [];
    lang.test_types.forEach(function(tt) {
      if (tt.category) {
        if (!grouped[tt.category]) grouped[tt.category] = [];
        grouped[tt.category].push(tt);
      } else {
        ungrouped.push(tt);
      }
    });

    var html = '<select id="add-type-select" style="width:200px">';

    var categories = Object.keys(grouped).sort();
    categories.forEach(function(cat) {
      var label = cat.charAt(0).toUpperCase() + cat.slice(1);
      html += '<optgroup label="' + esc(label) + '">';
      grouped[cat].forEach(function(tt) {
        var isSel = selectedAddType === tt.id ? ' selected' : '';
        html += '<option value="' + esc(tt.id) + '"' + isSel + ' title="' + esc(tt.description) + '">' + esc(tt.name) + '</option>';
      });
      html += '</optgroup>';
    });

    if (ungrouped.length > 0) {
      ungrouped.forEach(function(tt) {
        var isSel = selectedAddType === tt.id ? ' selected' : '';
        html += '<option value="' + esc(tt.id) + '"' + isSel + ' title="' + esc(tt.description) + '">' + esc(tt.name) + '</option>';
      });
    }

    html += '</select>';
    return html;
  }

  function fgHint(label, inputHtml, hint, fullWidth) {
    var html = '<div class="form-group' + (fullWidth ? ' full-width' : '') + '">';
    html += '<label>' + esc(label) + '</label>';
    html += inputHtml;
    if (hint) { html += '<div class="hint">' + esc(hint) + '</div>'; }
    html += '</div>';
    return html;
  }

  function fg(label, inputHtml, fullWidth) {
    return '<div class="form-group' + (fullWidth ? ' full-width' : '') + '"><label>' + esc(label) + '</label>' + inputHtml + '</div>';
  }

  function np(obj, p, def) {
    var parts = p.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return def;
      cur = cur[parts[i]];
    }
    return cur != null ? String(cur) : (def != null ? String(def) : '');
  }

  function renderCollection(col, index, lang, totalCollections) {
    var tt = getTestType(lang, col.type);
    var typeName = tt ? tt.name : col.type;
    var tests = col.tests || [];
    var isCollapsed = collapsedCollections[index] === true;

    var html = '<div class="collection-card" data-index="' + index + '" data-type="' + esc(col.type) + '">';

    html += '<div class="collection-header" data-action="toggleCollection">';
    html += '<span class="chevron' + (isCollapsed ? '' : ' open') + '" id="chevron-' + index + '">&#9654;</span>';
    html += '<span class="title">' + esc(col.name || 'Collection ' + (index + 1)) + '</span>';
    html += '<span class="type-badge">' + esc(typeName) + '</span>';
    if (tt && tt.category) { html += '<span class="cat-badge">' + esc(tt.category) + '</span>'; }
    html += '<span style="font-size:11px;color:var(--vscode-descriptionForeground)">' + tests.length + ' test' + (tests.length !== 1 ? 's' : '') + '</span>';
    if (index > 0) { html += '<button class="move-btn" data-action="moveCollectionUp" data-ci="' + index + '" title="Move up">&#9650;</button>'; }
    if (index < totalCollections - 1) { html += '<button class="move-btn" data-action="moveCollectionDown" data-ci="' + index + '" title="Move down">&#9660;</button>'; }
    html += '<button class="remove-btn" data-action="removeCollection" data-ci="' + index + '" title="Remove collection">&#10005;</button>';
    html += '</div>';

    html += '<div class="collection-body' + (isCollapsed ? ' collapsed' : '') + '" id="col-body-' + index + '">';

    // Show test type description
    if (tt && tt.description) {
      html += '<div class="collection-desc">' + esc(tt.description) + '</div>';
    }

    html += '<div class="collection-fields">';
    html += fgHint('Name', '<input type="text" data-col-field="name" value="' + esc(col.name || '') + '" placeholder="Collection name">', 'Display name for this test collection');
    html += renderCollectionField('entryPoint', col, tt);
    html += renderCollectionField('timeout', col, tt);
    html += fgHint('ID', '<input type="text" data-col-field="id" value="' + esc(col.id || '') + '" placeholder="Unique ID">', 'Optional unique identifier for referencing this collection');

    html += renderArrayFieldWithHint('inputAnswers', 'Input Answers', col.inputAnswers || [], 'Input lines to send to stdin during execution');
    html += renderArrayFieldWithHint('setUpCode', 'Setup Code', col.setUpCode || [], 'Code to run before each test in this collection');
    html += renderArrayFieldWithHint('successDependency', 'Success Dependency', col.successDependency || [], 'IDs of collections that must pass before this one runs');

    if (tt && tt.collection_fields) {
      tt.collection_fields.forEach(function(f) {
        if (['entryPoint', 'timeout', 'inputAnswers', 'setUpCode', 'name', 'id', 'successDependency'].indexOf(f.name) >= 0) return;
        if (f.type === 'array') {
          html += renderArrayFieldWithHint(f.name, f.description || f.name, col[f.name] || [], f.description);
        } else {
          var val = col[f.name] != null ? String(col[f.name]) : '';
          var inputType = f.type === 'number' || f.type === 'integer' ? 'number' : 'text';
          var attrs = 'type="' + inputType + '" data-col-field="' + esc(f.name) + '" value="' + esc(val) + '"';
          if (f.placeholder) { attrs += ' placeholder="' + esc(f.placeholder) + '"'; }
          if (f.min_value != null) { attrs += ' min="' + f.min_value + '"'; }
          if (f.max_value != null) { attrs += ' max="' + f.max_value + '"'; }
          if (f.enum_values && f.enum_values.length > 0) {
            var selectHtml = '<select data-col-field="' + esc(f.name) + '">';
            selectHtml += '<option value="">—</option>';
            f.enum_values.forEach(function(ev) {
              selectHtml += '<option value="' + esc(ev) + '"' + (ev === val ? ' selected' : '') + '>' + esc(ev) + '</option>';
            });
            selectHtml += '</select>';
            html += fgHint(f.description || f.name, selectHtml, f.description);
          } else {
            html += fgHint(f.description || f.name, '<input ' + attrs + '>', f.description);
          }
        }
      });
    }
    html += '</div>';

    html += '<div class="tests-header">';
    html += '<h3>Tests (' + tests.length + ')</h3>';
    html += '<button class="btn-sm" data-action="addTest" data-ci="' + index + '">+ Add Test</button>';
    html += '</div>';

    var qualifications = (tt && tt.qualifications) || [];

    tests.forEach(function(test, ti) {
      html += renderTestRow(test, index, ti, qualifications, tt, tests.length, lang);
    });

    if (tests.length === 0) {
      html += '<div style="text-align:center;padding:12px;color:var(--vscode-descriptionForeground);font-size:12px">No tests yet. Click "+ Add Test" to add one.</div>';
    }

    html += '</div></div>';
    return html;
  }

  function renderCollectionField(fieldName, col, tt) {
    var fieldDef = null;
    if (tt && tt.collection_fields) {
      fieldDef = tt.collection_fields.find(function(f) { return f.name === fieldName; });
    }
    if (fieldName === 'entryPoint') {
      var ph = (fieldDef && fieldDef.placeholder) ? fieldDef.placeholder : 'e.g., main.py';
      var hint = (fieldDef && fieldDef.description) ? fieldDef.description : 'Main file to execute';
      return fgHint('Entry Point', '<input type="text" data-col-field="entryPoint" value="' + esc(col.entryPoint || '') + '" placeholder="' + esc(ph) + '">', hint);
    }
    if (fieldName === 'timeout') {
      var defVal = (fieldDef && fieldDef.default != null) ? fieldDef.default : 30;
      var hint2 = (fieldDef && fieldDef.description) ? fieldDef.description : 'Maximum execution time in seconds';
      return fgHint('Timeout (s)', '<input type="number" data-col-field="timeout" value="' + esc(col.timeout || '') + '" placeholder="' + defVal + '" step="1" min="1">', hint2);
    }
    return '';
  }

  function toArray(val) {
    if (Array.isArray(val)) return val;
    if (val == null) return [];
    return [val];
  }

  function renderArrayFieldWithHint(name, label, items, hint) {
    items = toArray(items);
    var html = '<div class="form-group full-width">';
    html += '<label>' + esc(label) + '</label>';
    if (hint) { html += '<div class="hint">' + esc(hint) + '</div>'; }
    html += '<div class="array-field" data-array-name="' + esc(name) + '">';
    items.forEach(function(item) {
      html += '<div class="array-item">';
      html += '<input type="text" value="' + esc(String(item)) + '">';
      html += '<button class="remove-btn" data-action="removeArrayItem" title="Remove">&#10005;</button>';
      html += '</div>';
    });
    html += '<button class="btn-add btn-sm" data-action="addArrayItem" style="width:auto">+ Add</button>';
    html += '</div></div>';
    return html;
  }

  function renderTestRow(test, colIndex, testIndex, qualifications, testType, totalTests, lang) {
    var hasNameError = !test.name || !String(test.name).trim();
    var html = '<div class="test-row' + (hasNameError && test.name === '' ? '' : '') + '" data-col="' + colIndex + '" data-test="' + testIndex + '">';
    html += '<div class="test-order-btns">';
    if (testIndex > 0) { html += '<button class="move-btn move-btn-sm" data-action="moveTestUp" data-ci="' + colIndex + '" data-ti="' + testIndex + '" title="Move up">&#9650;</button>'; }
    if (testIndex < totalTests - 1) { html += '<button class="move-btn move-btn-sm" data-action="moveTestDown" data-ci="' + colIndex + '" data-ti="' + testIndex + '" title="Move down">&#9660;</button>'; }
    html += '</div>';
    html += '<div class="test-fields">';

    html += '<input type="text" class="field-name" data-test-field="name" value="' + esc(test.name || '') + '" placeholder="Test name (required)" title="Test name displayed in results">';

    if (qualifications.length > 0) {
      html += '<select class="field-qual" data-test-field="qualification" title="Comparison method">';
      html += '<option value="">Default</option>';
      qualifications.forEach(function(qId) {
        var qual = getQualification(lang, qId);
        var qLabel = qual ? qual.name : qId;
        var qTitle = qual ? qual.description : '';
        var sel = test.qualification === qId ? ' selected' : '';
        html += '<option value="' + esc(qId) + '"' + sel + ' title="' + esc(qTitle) + '">' + esc(qLabel) + '</option>';
      });
      html += '</select>';
    }

    // Show fields based on selected qualification
    var selectedQual = test.qualification ? getQualification(lang, test.qualification) : null;
    var showValue = !selectedQual || selectedQual.uses_value !== false;
    var showPattern = selectedQual ? selectedQual.uses_pattern === true : (testType && testType.test_fields && testType.test_fields.some(function(f) { return f.name === 'pattern'; }));
    var showTolerance = selectedQual ? selectedQual.uses_tolerance === true : false;

    if (showValue) {
      html += '<input type="text" class="field-value" data-test-field="value" value="' + esc(test.value != null ? String(test.value) : '') + '" placeholder="Expected value" title="Expected value to compare against">';
    }

    if (showPattern) {
      html += '<input type="text" class="field-value" data-test-field="pattern" value="' + esc(test.pattern || '') + '" placeholder="Pattern" title="Pattern for matching (string or regex)">';
    }

    if (showTolerance || test.relativeTolerance != null) {
      html += '<input type="number" class="field-small" data-test-field="relativeTolerance" value="' + esc(test.relativeTolerance != null ? String(test.relativeTolerance) : '') + '" placeholder="relTol" step="any" title="Relative tolerance for numeric comparison">';
    }
    if (showTolerance || test.absoluteTolerance != null) {
      html += '<input type="number" class="field-small" data-test-field="absoluteTolerance" value="' + esc(test.absoluteTolerance != null ? String(test.absoluteTolerance) : '') + '" placeholder="absTol" step="any" title="Absolute tolerance for numeric comparison">';
    }

    if (test.allowedOccuranceRange) {
      html += '<input type="number" class="field-small" data-test-field="allowedOccuranceMin" value="' + (test.allowedOccuranceRange[0] || 0) + '" placeholder="min" title="Minimum allowed occurrences">';
      html += '<input type="number" class="field-small" data-test-field="allowedOccuranceMax" value="' + (test.allowedOccuranceRange[1] || 0) + '" placeholder="max" title="Maximum allowed occurrences">';
    }

    if (test.evalString != null) {
      html += '<input type="text" class="field-value" data-test-field="evalString" value="' + esc(test.evalString) + '" placeholder="Eval expression" title="Expression to evaluate before comparison">';
    }

    html += '</div>';
    html += '<button class="remove-btn" data-action="removeTest" data-ci="' + colIndex + '" data-ti="' + testIndex + '" title="Remove test">&#10005;</button>';
    html += '</div>';
    return html;
  }

  window.addEventListener('message', function(event) {
    if (event.data.command === 'saved') {
      isDirty = false;
      var indicator = document.querySelector('.dirty-indicator');
      if (indicator) indicator.classList.add('hidden');
    }
  });

  bindEvents();
  render();
})();
