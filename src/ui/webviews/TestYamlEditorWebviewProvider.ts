import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { SHARED_STYLES } from './shared/webviewStyles';
import { escapeHtml } from './shared/webviewHelpers';
import blockRegistryJson from '../../data/block-registry.json';

interface TestYamlEditorData {
  filePath: string;
  exampleDir: string;
  exampleTitle?: string;
}

interface BlockRegistryLanguage {
  id: string;
  name: string;
  file_extensions: string[];
  test_types: BlockRegistryTestType[];
  qualifications?: BlockRegistryQualification[];
}

interface BlockRegistryTestType {
  id: string;
  name: string;
  description: string;
  category?: string;
  qualifications: string[];
  default_qualification?: string;
  collection_fields?: BlockRegistryField[];
  test_fields?: BlockRegistryField[];
  example?: Record<string, unknown>;
}

interface BlockRegistryQualification {
  id: string;
  name: string;
  description: string;
  uses_value?: boolean;
  uses_pattern?: boolean;
  uses_tolerance?: boolean;
  extra_fields?: BlockRegistryField[];
}

interface BlockRegistryField {
  name: string;
  type: string;
  description: string;
  required?: boolean;
  default?: unknown;
  enum_values?: string[] | null;
  array_item_type?: string | null;
  min_value?: number | null;
  max_value?: number | null;
  placeholder?: string | null;
  examples?: unknown[] | null;
}

interface BlockRegistry {
  version: string;
  languages: BlockRegistryLanguage[];
}

export class TestYamlEditorWebviewProvider extends BaseWebviewProvider {
  private blockRegistry: BlockRegistry | undefined;

  constructor(context: vscode.ExtensionContext) {
    super(context, 'computor.testYamlEditor');
  }

  private loadBlockRegistry(): BlockRegistry {
    if (this.blockRegistry) { return this.blockRegistry; }
    this.blockRegistry = blockRegistryJson as unknown as BlockRegistry;
    return this.blockRegistry;
  }

  private detectLanguage(exampleDir: string): string | undefined {
    const registry = this.loadBlockRegistry();
    const files = this.listFilesRecursive(exampleDir);

    for (const lang of registry.languages) {
      for (const ext of lang.file_extensions) {
        if (files.some(f => f.endsWith(ext))) {
          return lang.id;
        }
      }
    }
    return undefined;
  }

  private listFilesRecursive(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) { continue; }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.listFilesRecursive(fullPath));
        } else {
          results.push(entry.name);
        }
      }
    } catch {
      // Directory might not exist yet
    }
    return results;
  }

  private parseTestYaml(filePath: string): Record<string, unknown> | undefined {
    if (!fs.existsSync(filePath)) { return undefined; }
    try {
      const yaml = require('js-yaml');
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private saveTestYaml(filePath: string, data: Record<string, unknown>): void {
    const yaml = require('js-yaml');
    const content = yaml.dump(data, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
      quotingType: "'",
      forceQuotes: false
    });
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf8');
  }

  protected async getWebviewContent(data?: TestYamlEditorData): Promise<string> {
    if (!data) {
      return this.getBaseHtml('Test Editor', '<p>No data available</p>');
    }

    const nonce = this.getNonce();
    const registry = this.loadBlockRegistry();
    const existingData = this.parseTestYaml(data.filePath);
    const detectedLanguage = existingData?.type as string
      || this.detectLanguage(data.exampleDir);

    const initialState = {
      registry,
      testSuite: existingData || null,
      detectedLanguage: detectedLanguage || null,
      filePath: data.filePath,
      exampleTitle: data.exampleTitle || path.basename(data.exampleDir)
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Test Editor</title>
  <style>
    ${SHARED_STYLES}
    ${EDITOR_STYLES}
  </style>
</head>
<body>
  <div class="header">
    <h1>Test Configuration</h1>
    <p>${escapeHtml(data.exampleTitle || '')} &mdash; test.yaml</p>
  </div>
  <div id="app"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const STATE = ${JSON.stringify(initialState)};
    ${EDITOR_SCRIPT}
  </script>
</body>
</html>`;
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'save':
        await this.handleSave(message.data);
        break;
      case 'openFile':
        await this.handleOpenFile(message.data.filePath);
        break;
    }
  }

  private async handleSave(data: { filePath: string; testSuite: Record<string, unknown> }): Promise<void> {
    try {
      this.saveTestYaml(data.filePath, data.testSuite);
      vscode.window.showInformationMessage('test.yaml saved successfully');
      if (this.panel) {
        this.panel.webview.postMessage({ command: 'saved' });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save test.yaml: ${error}`);
    }
  }

  private async handleOpenFile(filePath: string): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  }
}

const EDITOR_STYLES = `
  /* Input styling override — make fields stand out */
  input, textarea, select {
    background-color: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
  }
  input:focus, textarea:focus, select:focus {
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
  }

  /* Test Editor specific styles */
  .toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .toolbar-spacer { flex: 1; }

  .suite-meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .suite-meta .form-group { margin-bottom: 0; }

  .collection-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  .collection-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--vscode-sideBar-background);
    cursor: pointer;
    user-select: none;
  }
  .collection-header:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .collection-header .chevron {
    font-size: 10px;
    transition: transform 0.15s;
    color: var(--vscode-descriptionForeground);
  }
  .collection-header .chevron.open { transform: rotate(90deg); }
  .collection-header .title { font-weight: 600; flex: 1; }
  .collection-header .type-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 8px;
    background: rgba(0, 120, 212, 0.15);
    color: var(--vscode-textLink-foreground);
  }
  .collection-header .remove-btn {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 14px;
    border-radius: 3px;
  }
  .collection-header .remove-btn:hover {
    color: #d13438;
    background: rgba(209, 52, 56, 0.1);
  }
  .collection-body {
    padding: 14px;
    border-top: 1px solid var(--vscode-panel-border);
  }
  .collection-body.collapsed { display: none; }

  .collection-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 14px;
  }
  .collection-fields .form-group { margin-bottom: 0; }
  .collection-fields .form-group.full-width { grid-column: 1 / -1; }

  .tests-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .tests-header h3 {
    margin: 0;
    font-size: 13px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    flex: 1;
  }

  .test-row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 8px 10px;
    margin-bottom: 4px;
    border-radius: 4px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
  }
  .test-row:hover {
    border-color: var(--vscode-focusBorder);
  }
  .test-fields {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .test-fields input, .test-fields select {
    padding: 4px 6px;
    font-size: 12px;
  }
  .test-fields .field-name { width: 150px; }
  .test-fields .field-value { width: 180px; }
  .test-fields .field-qual { width: 130px; }
  .test-fields .field-small { width: 80px; }
  .test-row .remove-btn {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 4px;
    font-size: 13px;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .test-row .remove-btn:hover {
    color: #d13438;
  }

  .btn-sm {
    padding: 4px 10px;
    font-size: 12px;
  }
  .btn-add {
    background: none;
    border: 1px dashed var(--vscode-panel-border);
    color: var(--vscode-textLink-foreground);
    padding: 6px 12px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 12px;
    width: 100%;
    text-align: center;
  }
  .btn-add:hover {
    background: var(--vscode-list-hoverBackground);
    border-color: var(--vscode-focusBorder);
  }

  .dirty-indicator {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vscode-editorWarning-foreground);
    margin-left: 4px;
  }
  .dirty-indicator.hidden { display: none; }

  .empty-collections {
    text-align: center;
    padding: 30px;
    color: var(--vscode-descriptionForeground);
    border: 1px dashed var(--vscode-panel-border);
    border-radius: 6px;
    margin-bottom: 12px;
  }

  .move-btn {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 2px 5px;
    font-size: 10px;
    border-radius: 3px;
    line-height: 1;
  }
  .move-btn:hover {
    color: var(--vscode-foreground);
    background: var(--vscode-list-hoverBackground);
  }
  .move-btn-sm {
    font-size: 8px;
    padding: 1px 4px;
  }
  .test-order-btns {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex-shrink: 0;
    min-width: 18px;
    align-items: center;
    padding-top: 4px;
  }

  .array-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .array-item {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .array-item input { flex: 1; }
  .array-item .remove-btn { padding: 2px 4px; font-size: 11px; }
`;

const EDITOR_SCRIPT = `
(function() {
  var app = document.getElementById('app');
  var registry = STATE.registry;
  var suite = STATE.testSuite || {};
  var currentLangId = STATE.detectedLanguage || (suite.type) || null;
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
    // Toolbar buttons
    app.addEventListener('click', function(e) {
      var target = e.target;
      if (!target || !target.dataset) return;
      var action = target.dataset.action;
      if (!action) return;

      if (action === 'save') {
        var data = buildSuiteData();
        vscode.postMessage({ command: 'save', data: { filePath: STATE.filePath, testSuite: data } });
        return;
      }
      if (action === 'openRaw') {
        vscode.postMessage({ command: 'openFile', data: { filePath: STATE.filePath } });
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
          // Shift collapse state for indices after removed one
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
            // Swap collapse state
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

    // Language select change
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

  // Listen for messages from extension
  window.addEventListener('message', function(event) {
    if (event.data.command === 'saved') {
      isDirty = false;
      var indicator = document.querySelector('.dirty-indicator');
      if (indicator) indicator.classList.add('hidden');
    }
  });

  // Bind event delegation and render
  bindEvents();
  render();
})();
`;
