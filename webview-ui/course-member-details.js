(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();

  const state = {
    ...(window.__INITIAL_STATE__ || {})
  };

  function escapeHtml(value) {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sendMessage(command, data) {
    vscode.postMessage({ command, data });
  }

  function renderView() {
    const app = document.getElementById('app');
    if (!app) return;

    const { member, course, group, role, availableGroups, availableRoles } = state;
    const user = member.user;
    const displayName = [user?.given_name, user?.family_name].filter(Boolean).join(' ') || user?.username || user?.email || 'Unknown User';

    app.innerHTML = `
      <div class="view-header">
        <h1>${escapeHtml(displayName)}</h1>
      </div>

      <div class="card">
        <h2>Course Member Information</h2>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-item-label">ID</div>
            <div class="info-item-value">${escapeHtml(member.id)}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Username</div>
            <div class="info-item-value">${escapeHtml(user?.username || '-')}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Email</div>
            <div class="info-item-value">${escapeHtml(user?.email || '-')}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Course</div>
            <div class="info-item-value">${escapeHtml(course?.title || course?.path || '-')}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Role</div>
            <div class="info-item-value">${escapeHtml(role?.title || role?.id || '-')}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Group</div>
            <div class="info-item-value">${group ? escapeHtml(group.title || group.id) : 'No Group'}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Edit Course Member</h2>
        <form id="editCourseMemberForm">
          <div class="form-group">
            <label for="courseRoleId">Role</label>
            <select id="courseRoleId" name="courseRoleId" class="vscode-select">
              ${(availableRoles || []).map(r => `
                <option value="${escapeHtml(r.id)}" ${r.id === member.course_role_id ? 'selected' : ''}>
                  ${escapeHtml(r.title || r.id)}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="form-group">
            <label for="courseGroupId">Group</label>
            <select id="courseGroupId" name="courseGroupId" class="vscode-select">
              <option value="">No Group</option>
              ${(availableGroups || []).map(g => `
                <option value="${escapeHtml(g.id)}" ${g.id === member.course_group_id ? 'selected' : ''}>
                  ${escapeHtml(g.title || g.id)}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="form-actions">
            <button type="submit" class="vscode-button vscode-button--primary">Save Changes</button>
          </div>
        </form>
      </div>
    `;

    // Attach event listeners
    const form = document.getElementById('editCourseMemberForm');
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const groupId = formData.get('courseGroupId');
    sendMessage('updateCourseMember', {
      memberId: state.member.id,
      updates: {
        course_role_id: formData.get('courseRoleId'),
        course_group_id: groupId || null
      }
    });
  }

  function updateState(newState) {
    Object.assign(state, newState);
    renderView();
  }

  // Handle messages from extension
  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
      case 'updateState':
        updateState(message.data);
        break;
    }
  });

  // Initial render
  renderView();
})();
