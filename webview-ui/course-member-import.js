(function() {
  const vscode = window.vscodeApi || acquireVsCodeApi();
  const state = window.__INITIAL_STATE__ || {};

  let currentFilter = 'all';
  let members = [];
  let availableRoles = [];
  let availableGroups = [];
  let courseId = '';
  let isImporting = false;
  let sortColumn = null;
  let sortDirection = 'asc';
  let workflowPollingIntervals = {};

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
    availableGroups = state.availableGroups || [];

    console.log('Initialized with', availableGroups.length, 'available groups:', availableGroups);

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

    // Calculate header checkbox state based on visible members
    const visibleMembers = members.filter(m => {
      if (currentFilter === 'all') return true;
      return m.status === currentFilter;
    });
    const visibleSelectedCount = visibleMembers.filter(m => m.isSelected).length;
    const allVisibleSelected = visibleMembers.length > 0 && visibleSelectedCount === visibleMembers.length;

    app.innerHTML = `
      <div class="header">
        <h1>Course Members</h1>
        <p>${members.length} member(s)</p>
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
                <input type="checkbox" id="headerCheckbox" ${isImporting ? 'disabled' : ''} ${allVisibleSelected ? 'checked' : ''}>
              </th>
              <th class="status-cell sortable" data-sort="status">
                Status ${renderSortIcon('status')}
              </th>
              <th class="email-cell sortable" data-sort="email">
                Email ${renderSortIcon('email')}
              </th>
              <th class="given-name-cell sortable" data-sort="given_name">
                Given Name ${renderSortIcon('given_name')}
              </th>
              <th class="family-name-cell sortable" data-sort="family_name">
                Family Name ${renderSortIcon('family_name')}
              </th>
              <th class="group-cell sortable" data-sort="course_group_title">
                Group ${renderSortIcon('course_group_title')}
              </th>
              <th class="role-cell sortable" data-sort="selectedRoleId">
                Course Role ${renderSortIcon('selectedRoleId')}
              </th>
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

  function renderSortIcon(column) {
    if (sortColumn !== column) {
      return '<span class="sort-icon">⇅</span>';
    }
    return sortDirection === 'asc'
      ? '<span class="sort-icon active">▲</span>'
      : '<span class="sort-icon active">▼</span>';
  }

  function sortMembers(membersToSort) {
    if (!sortColumn) return membersToSort;

    return [...membersToSort].sort((a, b) => {
      let aVal = a[sortColumn] || '';
      let bVal = b[sortColumn] || '';

      // Convert to lowercase for string comparison
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function renderTableRows() {
    let visibleMembers = members.filter(m => {
      if (currentFilter === 'all') return true;
      return m.status === currentFilter;
    });

    // Apply sorting
    visibleMembers = sortMembers(visibleMembers);

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
        const status = member.importResult.status;
        let resultClass, resultIcon, displayStatus;

        if (status === 'success') {
          resultClass = 'result-success';
          resultIcon = '✓';
          displayStatus = 'success';
        } else if (status === 'error') {
          resultClass = 'result-error';
          resultIcon = '✗';
          displayStatus = 'error';
        } else if (status === 'pending' || status === 'running' || status === 'queued') {
          resultClass = 'result-pending';
          resultIcon = '';
          displayStatus = status;
        } else {
          resultClass = 'result-pending';
          resultIcon = '';
          displayStatus = status;
        }

        const showSpinner = ['pending', 'running', 'queued'].includes(status);

        resultHtml = `
          <span class="result-badge ${resultClass}">
            ${showSpinner ? '<span class="spinner"></span>' : resultIcon} ${displayStatus}
          </span>
          ${member.importResult.message ? `<div class="result-message">${escapeHtml(member.importResult.message)}</div>` : ''}
        `;
      }

      const rowClass = member.isImporting ? 'row-importing' :
                      (member.importResult?.status === 'success' ? 'row-success' :
                       member.importResult?.status === 'error' ? 'row-error' : '');

      const canEdit = member.status === 'missing' && !isImporting;
      const canDelete = member.status === 'missing' && !isImporting;

      return `
        <tr class="${rowClass}" data-row="${member.rowNumber}" ${canDelete ? 'data-can-delete="true"' : ''}>
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
          <td ${canEdit ? 'contenteditable="true"' : ''} class="editable-cell email-cell" data-row="${member.rowNumber}" data-field="email">${escapeHtml(member.email || '')}</td>
          <td ${canEdit ? 'contenteditable="true"' : ''} class="editable-cell given-name-cell" data-row="${member.rowNumber}" data-field="given_name">${escapeHtml(member.given_name || '')}</td>
          <td ${canEdit ? 'contenteditable="true"' : ''} class="editable-cell family-name-cell" data-row="${member.rowNumber}" data-field="family_name">${escapeHtml(member.family_name || '')}</td>
          <td class="group-cell">
            <select
              class="group-select"
              data-row="${member.rowNumber}"
              ${!member.isSelected || isImporting ? 'disabled' : ''}
            >
              ${renderGroupOptionsWithCustom(member.course_group_title)}
            </select>
          </td>
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

  function renderGroupOptionsWithCustom(currentValue) {
    let options = '<option value="">(No Group)</option>';

    // Add existing groups
    availableGroups.forEach(group => {
      const title = group.title || group.id;
      const selected = title === currentValue ? 'selected' : '';
      options += `<option value="${escapeHtml(title)}" ${selected}>${escapeHtml(title)}</option>`;
    });

    // Add "Custom..." option
    options += '<option value="__CUSTOM__">+ New Group...</option>';

    // If current value is not in the list and not empty, add it as selected custom option
    if (currentValue && !availableGroups.find(g => (g.title || g.id) === currentValue)) {
      options = '<option value="">(No Group)</option>';
      availableGroups.forEach(group => {
        const title = group.title || group.id;
        options += `<option value="${escapeHtml(title)}">${escapeHtml(title)}</option>`;
      });
      options += `<option value="${escapeHtml(currentValue)}" selected>${escapeHtml(currentValue)}</option>`;
      options += '<option value="__CUSTOM__">+ New Group...</option>';
    }

    return options;
  }

  function attachEventListeners() {
    // Sortable column headers
    document.querySelectorAll('.sortable').forEach(header => {
      header.addEventListener('click', () => {
        const column = header.dataset.sort;
        if (sortColumn === column) {
          // Toggle direction
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          // New column, default to ascending
          sortColumn = column;
          sortDirection = 'asc';
        }
        render();
        attachEventListeners();
      });
    });

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

    // Group selects
    document.querySelectorAll('.group-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        const rowNumber = parseInt(e.target.dataset.row);
        const selectedValue = e.target.value;
        const member = members.find(m => m.rowNumber === rowNumber);

        if (selectedValue === '__CUSTOM__') {
          // Prompt for custom group name
          vscode.postMessage({
            command: 'promptCustomGroup',
            data: { rowNumber }
          });
        } else if (member) {
          member.course_group_title = selectedValue;
          vscode.postMessage({
            command: 'groupChanged',
            data: { rowNumber, groupTitle: selectedValue }
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

    // Context menu for rows
    document.querySelectorAll('tr[data-can-delete="true"]').forEach(row => {
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const rowNumber = parseInt(row.dataset.row);
        showContextMenu(e, rowNumber);
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
    console.log('handleImportProgress received:', data);
    const member = members.find(m => m.rowNumber === data.rowNumber);
    if (member) {
      member.importResult = data.result;

      // If we got a workflow_id, start polling for status
      if (data.result.workflowId) {
        console.log('Got workflowId:', data.result.workflowId);
        member.workflowId = data.result.workflowId;
        startWorkflowPolling(data.rowNumber, data.result.workflowId);
      } else {
        member.isImporting = false;
      }

      render();
      attachEventListeners();
    }
  }

  function startWorkflowPolling(rowNumber, workflowId) {
    console.log('Starting workflow polling for row', rowNumber, 'workflowId:', workflowId);

    // Clear any existing polling for this row
    if (workflowPollingIntervals[rowNumber]) {
      clearInterval(workflowPollingIntervals[rowNumber]);
    }

    // Poll immediately
    vscode.postMessage({
      command: 'pollWorkflowStatus',
      data: { rowNumber, workflowId }
    });

    // Then poll every 3 seconds
    workflowPollingIntervals[rowNumber] = setInterval(() => {
      vscode.postMessage({
        command: 'pollWorkflowStatus',
        data: { rowNumber, workflowId }
      });
    }, 3000);
  }

  function handleWorkflowStatusUpdate(data) {
    const member = members.find(m => m.rowNumber === data.rowNumber);
    if (!member) return;

    // Update the import result with workflow status
    member.importResult = {
      ...member.importResult,
      status: data.status,
      workflowId: data.workflowId
    };

    // Check if workflow is complete (success or failure)
    const completedStatuses = ['completed', 'success', 'failed', 'error'];
    if (completedStatuses.includes(data.status.toLowerCase())) {
      // Stop polling
      if (workflowPollingIntervals[data.rowNumber]) {
        clearInterval(workflowPollingIntervals[data.rowNumber]);
        delete workflowPollingIntervals[data.rowNumber];
      }

      member.isImporting = false;

      // Update result message based on final status
      if (data.status.toLowerCase() === 'completed' || data.status.toLowerCase() === 'success') {
        member.importResult.status = 'success';
        member.importResult.message = data.result?.message || 'Import completed successfully';
      } else {
        member.importResult.status = 'error';
        member.importResult.message = data.error || data.result?.error || 'Import failed';
      }
    }

    render();
    attachEventListeners();
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
  function showContextMenu(event, rowNumber) {
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

    const menuItem = document.createElement('div');
    menuItem.className = 'context-menu-item';
    menuItem.textContent = '🗑️ Remove Row';
    menuItem.addEventListener('click', () => {
      handleRemoveMember(rowNumber);
      menu.remove();
    });

    menu.appendChild(menuItem);
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
  }

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

          if (message.data.availableGroups) {
            availableGroups = message.data.availableGroups;
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

      case 'customGroupEntered':
        // Update member with custom group name and available groups list
        const member = members.find(m => m.rowNumber === message.data.rowNumber);
        if (member && message.data.groupTitle) {
          member.course_group_title = message.data.groupTitle;
        }

        // Update available groups if provided
        if (message.data.availableGroups) {
          availableGroups = message.data.availableGroups;
        }

        render();
        attachEventListeners();
        break;

      case 'workflowStatusUpdate':
        handleWorkflowStatusUpdate(message.data);
        break;
    }
  });

  // Initialize on load
  init();
})();
