(function() {
  const vscode = window.vscodeApi || acquireVsCodeApi();
  const state = window.__INITIAL_STATE__ || {};

  let currentFilter = 'all';
  let members = [];
  let availableRoles = [];
  let courseId = '';
  let isImporting = false;

  function init() {
    if (!state.members || !state.availableRoles) {
      showError('No import data available');
      return;
    }

    courseId = state.courseId;
    members = state.members.map(member => ({
      ...member,
      isSelected: member.status === 'missing',
      importResult: null,
      isImporting: false
    }));
    availableRoles = state.availableRoles;

    render();
    attachEventListeners();
  }

  function render() {
    const app = document.getElementById('app');
    if (!app) {
      return;
    }

    const selectedCount = members.filter(m => m.isSelected).length;
    const statusCounts = {
      missing: members.filter(m => m.status === 'missing').length,
      existing: members.filter(m => m.status === 'existing').length,
      modified: members.filter(m => m.status === 'modified').length
    };

    app.innerHTML = `
      <div class="header">
        <h1>Course Member Import Preview</h1>
        <p>${members.length} member(s) parsed from file</p>
      </div>

      <div class="controls">
        <div class="filter-bar">
          <span class="filter-label">Filter:</span>
          <button class="filter-button ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">
            All <span class="badge">${members.length}</span>
          </button>
          <button class="filter-button ${currentFilter === 'missing' ? 'active' : ''}" data-filter="missing">
            New <span class="badge">${statusCounts.missing}</span>
          </button>
          <button class="filter-button ${currentFilter === 'existing' ? 'active' : ''}" data-filter="existing">
            Existing <span class="badge">${statusCounts.existing}</span>
          </button>
          <button class="filter-button ${currentFilter === 'modified' ? 'active' : ''}" data-filter="modified">
            Modified <span class="badge">${statusCounts.modified}</span>
          </button>
        </div>

        <div class="action-bar">
          <button class="btn btn-secondary" id="loadFileBtn" ${isImporting ? 'disabled' : ''}>
            📁 Load Import File
          </button>
          <button class="btn btn-secondary" id="addMemberBtn" ${isImporting ? 'disabled' : ''}>
            ➕ Add New Member
          </button>
          <button class="btn btn-secondary" id="selectAllBtn" ${isImporting ? 'disabled' : ''}>
            Select All
          </button>
          <button class="btn btn-secondary" id="deselectAllBtn" ${isImporting ? 'disabled' : ''}>
            Deselect All
          </button>
          <button class="btn btn-primary" id="importBtn" ${selectedCount === 0 || isImporting ? 'disabled' : ''}>
            ${isImporting ? '<span class="spinner"></span>' : ''} Import Selected (${selectedCount})
          </button>
        </div>

        <div class="options-bar">
          <label class="option-checkbox">
            <input type="checkbox" id="createGroupsCheckbox" ${isImporting ? 'disabled' : ''} checked>
            <span>Create missing groups</span>
          </label>
          <label class="option-checkbox">
            <input type="checkbox" id="updateExistingCheckbox" ${isImporting ? 'disabled' : ''} checked>
            <span>Update existing members</span>
          </label>
        </div>
      </div>

      <div class="import-table-container">
        <table class="import-table">
          <thead>
            <tr>
              <th class="checkbox-cell">
                <input type="checkbox" id="headerCheckbox" ${isImporting ? 'disabled' : ''}>
              </th>
              <th class="status-cell">Status</th>
              <th>Email</th>
              <th>Given Name</th>
              <th>Family Name</th>
              <th>Group</th>
              <th class="role-cell">Course Role</th>
              <th class="result-cell">Result</th>
            </tr>
          </thead>
          <tbody>
            ${renderTableRows()}
          </tbody>
        </table>
      </div>

      <div class="summary" id="importSummary">
        <h3>Import Complete</h3>
        <div class="summary-stats" id="summaryStats"></div>
      </div>
    `;
  }

  function renderTableRows() {
    const visibleMembers = members.filter(m => {
      if (currentFilter === 'all') return true;
      return m.status === currentFilter;
    });

    if (visibleMembers.length === 0) {
      return `
        <tr>
          <td colspan="9" class="empty-state">
            No members match the current filter
          </td>
        </tr>
      `;
    }

    return visibleMembers.map(member => {
      const statusClass = `status-${member.status}`;
      const statusLabel = {
        missing: 'New',
        existing: 'Exists',
        modified: 'Modified'
      }[member.status] || member.status;

      let resultHtml = '';
      if (member.isImporting) {
        resultHtml = '<span class="result-badge result-importing"><span class="spinner"></span> Importing...</span>';
      } else if (member.importResult) {
        const resultClass = member.importResult.status === 'success' ? 'result-success' : 'result-error';
        const resultIcon = member.importResult.status === 'success' ? '✓' : '✗';
        resultHtml = `
          <span class="result-badge ${resultClass}">${resultIcon} ${member.importResult.status}</span>
          ${member.importResult.message ? `<div class="result-message">${escapeHtml(member.importResult.message)}</div>` : ''}
        `;
      }

      const rowClass = member.isImporting ? 'row-importing' :
                      (member.importResult?.status === 'success' ? 'row-success' :
                       member.importResult?.status === 'error' ? 'row-error' : '');

      const canEdit = member.status === 'missing' && !isImporting;
      const canDelete = member.status === 'missing' && !isImporting;

      return `
        <tr class="${rowClass}" data-row="${member.rowNumber}" ${canDelete ? 'oncontextmenu="return showContextMenu(event, ' + member.rowNumber + ')"' : ''}>
          <td class="checkbox-cell">
            <input
              type="checkbox"
              class="row-checkbox"
              data-row="${member.rowNumber}"
              ${member.isSelected ? 'checked' : ''}
              ${isImporting ? 'disabled' : ''}
            >
          </td>
          <td class="status-cell">
            <span class="status-badge ${statusClass}">${statusLabel}</span>
          </td>
          <td ${canEdit ? 'contenteditable="true"' : ''} class="editable-cell" data-row="${member.rowNumber}" data-field="email">${escapeHtml(member.email || '')}</td>
          <td ${canEdit ? 'contenteditable="true"' : ''} class="editable-cell" data-row="${member.rowNumber}" data-field="given_name">${escapeHtml(member.given_name || '')}</td>
          <td ${canEdit ? 'contenteditable="true"' : ''} class="editable-cell" data-row="${member.rowNumber}" data-field="family_name">${escapeHtml(member.family_name || '')}</td>
          <td ${canEdit ? 'contenteditable="true"' : ''} class="editable-cell" data-row="${member.rowNumber}" data-field="course_group_title">${escapeHtml(member.course_group_title || '')}</td>
          <td class="role-cell">
            <select
              class="role-select"
              data-row="${member.rowNumber}"
              ${!member.isSelected || isImporting ? 'disabled' : ''}
            >
              ${renderRoleOptions(member.selectedRoleId)}
            </select>
          </td>
          <td class="result-cell">
            ${resultHtml}
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderRoleOptions(selectedRoleId) {
    return availableRoles.map(role => {
      const selected = role.id === selectedRoleId ? 'selected' : '';
      const title = role.title || role.id;
      return `<option value="${escapeHtml(role.id)}" ${selected}>${escapeHtml(title)}</option>`;
    }).join('');
  }

  function attachEventListeners() {
    // Filter buttons
    document.querySelectorAll('.filter-button').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        render();
        attachEventListeners();
      });
    });

    // Select/Deselect all
    const selectAllBtn = document.getElementById('selectAllBtn');
    const deselectAllBtn = document.getElementById('deselectAllBtn');
    const headerCheckbox = document.getElementById('headerCheckbox');

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => selectAll(true));
    }

    if (deselectAllBtn) {
      deselectAllBtn.addEventListener('click', () => selectAll(false));
    }

    if (headerCheckbox) {
      headerCheckbox.addEventListener('change', (e) => {
        selectAll(e.target.checked);
      });
    }

    // Row checkboxes
    document.querySelectorAll('.row-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const rowNumber = parseInt(e.target.dataset.row);
        const member = members.find(m => m.rowNumber === rowNumber);
        if (member) {
          member.isSelected = e.target.checked;
          vscode.postMessage({
            command: 'selectionChanged',
            data: { rowNumber, isSelected: e.target.checked }
          });
          render();
          attachEventListeners();
        }
      });
    });

    // Role selects
    document.querySelectorAll('.role-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const rowNumber = parseInt(e.target.dataset.row);
        const roleId = e.target.value;
        const member = members.find(m => m.rowNumber === rowNumber);
        if (member) {
          member.selectedRoleId = roleId;
          vscode.postMessage({
            command: 'roleChanged',
            data: { rowNumber, roleId }
          });
        }
      });
    });

    // Load file button
    const loadFileBtn = document.getElementById('loadFileBtn');
    if (loadFileBtn) {
      loadFileBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'selectImportFile' });
      });
    }

    // Add member button
    const addMemberBtn = document.getElementById('addMemberBtn');
    if (addMemberBtn) {
      addMemberBtn.addEventListener('click', handleAddMember);
    }

    // Import button
    const importBtn = document.getElementById('importBtn');
    if (importBtn) {
      importBtn.addEventListener('click', handleImport);
    }

    // Editable cells
    document.querySelectorAll('.editable-cell').forEach(cell => {
      cell.addEventListener('blur', (e) => {
        const rowNumber = parseInt(e.target.dataset.row);
        const field = e.target.dataset.field;
        const value = e.target.textContent.trim();

        const member = members.find(m => m.rowNumber === rowNumber);
        if (member) {
          member[field] = value;
        }
      });

      // Prevent line breaks in contenteditable cells
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        }
      });
    });
  }

  function selectAll(selected) {
    const visibleMembers = members.filter(m => {
      if (currentFilter === 'all') return true;
      return m.status === currentFilter;
    });

    visibleMembers.forEach(member => {
      member.isSelected = selected;
      vscode.postMessage({
        command: 'selectionChanged',
        data: { rowNumber: member.rowNumber, isSelected: selected }
      });
    });

    render();
    attachEventListeners();
  }

  function handleImport() {
    if (isImporting) return;

    const selectedMembers = members.filter(m => m.isSelected);
    if (selectedMembers.length === 0) {
      return;
    }

    const createMissingGroups = document.getElementById('createGroupsCheckbox')?.checked || false;
    const updateIfExists = document.getElementById('updateExistingCheckbox')?.checked || false;

    isImporting = true;
    render();
    attachEventListeners();

    const selectedRows = selectedMembers.map(member => ({
      rowNumber: member.rowNumber,
      memberData: {
        email: member.email,
        given_name: member.given_name,
        family_name: member.family_name,
        student_id: member.student_id,
        course_group_title: member.course_group_title,
        course_role_id: member.selectedRoleId
      },
      selectedRoleId: member.selectedRoleId
    }));

    vscode.postMessage({
      command: 'importSelected',
      data: {
        selectedRows,
        options: {
          createMissingGroups,
          updateIfExists
        }
      }
    });
  }

  function handleImportProgress(data) {
    const member = members.find(m => m.rowNumber === data.rowNumber);
    if (member) {
      member.isImporting = false;
      member.importResult = data.result;
      render();
      attachEventListeners();
    }
  }

  function handleImportComplete(data) {
    isImporting = false;

    const summaryStats = document.getElementById('summaryStats');
    const summary = document.getElementById('importSummary');

    if (summaryStats && summary) {
      summaryStats.innerHTML = `
        <div class="summary-stat">
          <span class="summary-stat-label">Total</span>
          <span class="summary-stat-value">${data.total}</span>
        </div>
        <div class="summary-stat">
          <span class="summary-stat-label">Success</span>
          <span class="summary-stat-value" style="color: rgb(0, 255, 0);">${data.success}</span>
        </div>
        <div class="summary-stat">
          <span class="summary-stat-label">Errors</span>
          <span class="summary-stat-value" style="color: rgb(255, 100, 100);">${data.errors}</span>
        </div>
      `;
      summary.classList.add('visible');
    }

    render();
    attachEventListeners();
  }

  function handleAddMember() {
    const newMember = {
      email: '',
      given_name: '',
      family_name: '',
      course_group_title: '',
      course_role_id: '_student',
      rowNumber: members.length > 0 ? Math.max(...members.map(m => m.rowNumber)) + 1 : 1,
      status: 'missing',
      selectedRoleId: '_student',
      isSelected: true,
      importResult: null,
      isImporting: false
    };

    members.unshift(newMember); // Add to beginning instead of end
    render();
    attachEventListeners();

    // Focus on the first editable cell (email) of the new row
    setTimeout(() => {
      const firstEditableCell = document.querySelector(`[data-row="${newMember.rowNumber}"][data-field="email"]`);
      if (firstEditableCell) {
        firstEditableCell.focus();
      }
    }, 50);
  }

  function handleRemoveMember(rowNumber) {
    const index = members.findIndex(m => m.rowNumber === rowNumber);
    if (index !== -1) {
      members.splice(index, 1);
      render();
      attachEventListeners();
    }
  }

  function showError(message) {
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `<div class="error-state">${escapeHtml(message)}</div>`;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Context menu for rows
  window.showContextMenu = function(event, rowNumber) {
    event.preventDefault();

    // Remove any existing context menu
    const existingMenu = document.getElementById('contextMenu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const member = members.find(m => m.rowNumber === rowNumber);
    if (!member || member.status !== 'missing') {
      return false;
    }

    // Create context menu
    const menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';

    menu.innerHTML = `
      <div class="context-menu-item" onclick="handleRemoveMember(${rowNumber})">
        🗑️ Remove Row
      </div>
    `;

    document.body.appendChild(menu);

    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 10);

    return false;
  };

  window.handleRemoveMember = handleRemoveMember;

  // Handle messages from extension
  window.addEventListener('message', event => {
    const message = event.data;

    switch (message.command) {
      case 'updateMembers':
        // Update members with new data from import file
        if (message.data.members) {
          members = message.data.members.map(m => ({
            ...m,
            importResult: null,
            isImporting: false
          }));

          if (message.data.availableRoles) {
            availableRoles = message.data.availableRoles;
          }

          render();
          attachEventListeners();
        }
        break;

      case 'validationComplete':
        // Update members with validation results
        if (message.data.validated_members) {
          message.data.validated_members.forEach(validated => {
            const member = members.find(m => m.rowNumber === validated.row_number);
            if (member) {
              member.status = validated.status;
              if (validated.suggested_role_id) {
                member.selectedRoleId = validated.suggested_role_id;
              }
            }
          });
          render();
          attachEventListeners();
        }
        break;

      case 'importProgress':
        handleImportProgress(message.data);
        break;

      case 'importComplete':
        handleImportComplete(message.data);
        break;

      case 'bulkRoleUpdated':
        message.data.rowNumbers.forEach(rowNumber => {
          const member = members.find(m => m.rowNumber === rowNumber);
          if (member) {
            member.selectedRoleId = message.data.roleId;
          }
        });
        render();
        attachEventListeners();
        break;
    }
  });

  // Initialize on load
  init();
})();
