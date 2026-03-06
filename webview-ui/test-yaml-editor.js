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

  function getLang(langId) {
    if (!langId) return null;
    return registry.languages.find(function(l) { return l.id === langId; }) || null;
  }

  function getTestType(lang, typeId) {
    if (!lang) return null;
    return lang.test_types.find(function(t) { return t.id === typeId; }) || null;
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
        suite.properties.tests.push({ type: selectedAddType, name: tt ? tt.name : selectedAddType, tests: [] });
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
          suite.properties.tests[ci2].tests.push({ name: '' });
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
      }
    });
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
    html += fg('Name', '<input type="text" id="suite-name" value="' + esc(suite.name || '') + '" placeholder="Test suite name">');
    html += fg('Version', '<input type="text" id="suite-version" value="' + esc(suite.version || '1.0') + '" placeholder="1.0">');
    html += fg('Description', '<input type="text" id="suite-description" value="' + esc(suite.description || '') + '" placeholder="Description">', true);
    html += fg('Timeout', '<input type="number" id="suite-timeout" value="' + esc(np(suite, 'properties.timeout', '')) + '" placeholder="30" step="1" min="1">');
    html += fg('Relative Tolerance', '<input type="number" id="suite-relativeTolerance" value="' + esc(np(suite, 'properties.relativeTolerance', '')) + '" placeholder="1e-12" step="any">');
    html += fg('Absolute Tolerance', '<input type="number" id="suite-absoluteTolerance" value="' + esc(np(suite, 'properties.absoluteTolerance', '')) + '" placeholder="0.0001" step="any">');
    html += '</div></div>';

    // Test collections
    html += '<div class="section">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">';
    html += '<h2 style="margin:0;flex:1">Test Collections</h2>';
    if (lang) {
      html += '<select id="add-type-select" style="width:160px">';
      lang.test_types.forEach(function(tt) {
        var isSel = selectedAddType === tt.id ? ' selected' : '';
        html += '<option value="' + esc(tt.id) + '"' + isSel + '>' + esc(tt.name) + '</option>';
      });
      html += '</select>';
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

    app.innerHTML = html;
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
    html += '<span style="font-size:11px;color:var(--vscode-descriptionForeground)">' + tests.length + ' test' + (tests.length !== 1 ? 's' : '') + '</span>';
    if (index > 0) { html += '<button class="move-btn" data-action="moveCollectionUp" data-ci="' + index + '" title="Move up">&#9650;</button>'; }
    if (index < totalCollections - 1) { html += '<button class="move-btn" data-action="moveCollectionDown" data-ci="' + index + '" title="Move down">&#9660;</button>'; }
    html += '<button class="remove-btn" data-action="removeCollection" data-ci="' + index + '" title="Remove collection">&#10005;</button>';
    html += '</div>';

    html += '<div class="collection-body' + (isCollapsed ? ' collapsed' : '') + '" id="col-body-' + index + '">';

    html += '<div class="collection-fields">';
    html += fg('Name', '<input type="text" data-col-field="name" value="' + esc(col.name || '') + '" placeholder="Collection name">');
    html += fg('Entry Point', '<input type="text" data-col-field="entryPoint" value="' + esc(col.entryPoint || '') + '" placeholder="e.g., main.py">');
    html += fg('Timeout', '<input type="number" data-col-field="timeout" value="' + esc(col.timeout || '') + '" placeholder="30" step="1" min="1">');
    html += fg('ID', '<input type="text" data-col-field="id" value="' + esc(col.id || '') + '" placeholder="Unique ID">');

    html += renderArrayField('inputAnswers', 'Input Answers', col.inputAnswers || []);
    html += renderArrayField('setUpCode', 'Setup Code', col.setUpCode || []);
    html += renderArrayField('successDependency', 'Success Dependency', col.successDependency || []);

    if (tt && tt.collection_fields) {
      tt.collection_fields.forEach(function(f) {
        if (['entryPoint', 'timeout', 'inputAnswers', 'setUpCode'].indexOf(f.name) >= 0) return;
        if (f.type === 'array') {
          html += renderArrayField(f.name, f.description || f.name, col[f.name] || []);
        } else {
          var val = col[f.name] != null ? String(col[f.name]) : '';
          var inputType = f.type === 'number' || f.type === 'integer' ? 'number' : 'text';
          html += fg(f.description || f.name,
            '<input type="' + inputType + '" data-col-field="' + esc(f.name) + '" value="' + esc(val) + '"' +
            (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '>');
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
      html += renderTestRow(test, index, ti, qualifications, tt, tests.length);
    });

    if (tests.length === 0) {
      html += '<div style="text-align:center;padding:12px;color:var(--vscode-descriptionForeground);font-size:12px">No tests yet</div>';
    }

    html += '</div></div>';
    return html;
  }

  function toArray(val) {
    if (Array.isArray(val)) return val;
    if (val == null) return [];
    return [val];
  }

  function renderArrayField(name, label, items) {
    items = toArray(items);
    var html = '<div class="form-group full-width">';
    html += '<label>' + esc(label) + '</label>';
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

  function renderTestRow(test, colIndex, testIndex, qualifications, testType, totalTests) {
    var html = '<div class="test-row" data-col="' + colIndex + '" data-test="' + testIndex + '">';
    html += '<div class="test-order-btns">';
    if (testIndex > 0) { html += '<button class="move-btn move-btn-sm" data-action="moveTestUp" data-ci="' + colIndex + '" data-ti="' + testIndex + '" title="Move up">&#9650;</button>'; }
    if (testIndex < totalTests - 1) { html += '<button class="move-btn move-btn-sm" data-action="moveTestDown" data-ci="' + colIndex + '" data-ti="' + testIndex + '" title="Move down">&#9660;</button>'; }
    html += '</div>';
    html += '<div class="test-fields">';

    html += '<input type="text" class="field-name" data-test-field="name" value="' + esc(test.name || '') + '" placeholder="Test name">';

    if (qualifications.length > 0) {
      html += '<select class="field-qual" data-test-field="qualification">';
      html += '<option value="">Default</option>';
      qualifications.forEach(function(qId) {
        var sel = test.qualification === qId ? ' selected' : '';
        html += '<option value="' + esc(qId) + '"' + sel + '>' + esc(qId) + '</option>';
      });
      html += '</select>';
    }

    html += '<input type="text" class="field-value" data-test-field="value" value="' + esc(test.value != null ? String(test.value) : '') + '" placeholder="Expected value">';

    if (testType && testType.test_fields && testType.test_fields.some(function(f) { return f.name === 'pattern'; })) {
      html += '<input type="text" class="field-value" data-test-field="pattern" value="' + esc(test.pattern || '') + '" placeholder="Pattern">';
    }

    if (test.relativeTolerance != null) {
      html += '<input type="number" class="field-small" data-test-field="relativeTolerance" value="' + esc(String(test.relativeTolerance)) + '" placeholder="relTol" step="any" title="Relative Tolerance">';
    }
    if (test.absoluteTolerance != null) {
      html += '<input type="number" class="field-small" data-test-field="absoluteTolerance" value="' + esc(String(test.absoluteTolerance)) + '" placeholder="absTol" step="any" title="Absolute Tolerance">';
    }

    if (test.allowedOccuranceRange) {
      html += '<input type="number" class="field-small" data-test-field="allowedOccuranceMin" value="' + (test.allowedOccuranceRange[0] || 0) + '" placeholder="min" title="Min Occurrences">';
      html += '<input type="number" class="field-small" data-test-field="allowedOccuranceMax" value="' + (test.allowedOccuranceRange[1] || 0) + '" placeholder="max" title="Max Occurrences">';
    }

    if (test.evalString != null) {
      html += '<input type="text" class="field-value" data-test-field="evalString" value="' + esc(test.evalString) + '" placeholder="Eval expression">';
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
