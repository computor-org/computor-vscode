(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();

  const state = window.__INITIAL_STATE__ || null;
  const localState = {
    addRoleId: '',
    pending: false,
    notice: null
  };

  function escapeHtml(value) {
    if (value === undefined || value === null) { return ''; }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function post(command, data) {
    vscode.postMessage({ command, data });
  }

  function userDisplayName(user) {
    if (!user) { return ''; }
    const family = user.family_name || '';
    const given = user.given_name || '';
    if (family && given) { return `${family}, ${given}`; }
    return family || given || user.username || user.email || user.id;
  }

  function roleLabel(roleId, availableRoles) {
    const found = availableRoles.find(r => r.id === roleId);
    return found?.title || roleId;
  }

  function noticeHtml() {
    if (!localState.notice) { return ''; }
    const { type, message } = localState.notice;
    return `<div class="scope-notice scope-notice-${escapeHtml(type)}">${escapeHtml(message)}</div>`;
  }

  function renderRoot() {
    const root = document.getElementById('app');
    if (!root) { return; }

    if (!state) {
      root.innerHTML = '<p>Loading…</p>';
      return;
    }

    const { target, members, availableRoles, canManage } = state;
    const headerLabel = target.kind === 'organization' ? 'Organization' : 'Course Family';

    root.innerHTML = `
      <header class="scope-header">
        <h1>${escapeHtml(target.scopeTitle)}</h1>
        <p class="scope-subtitle">${escapeHtml(target.scopeSubtitle || headerLabel)} · Members</p>
        ${canManage ? '' : '<p class="scope-notice scope-notice-info">You have read-only access. Backend rejects mutations from non-managers.</p>'}
      </header>

      ${noticeHtml()}

      <section class="scope-section">
        <div class="scope-section-header">
          <h2>Members (${members.length})</h2>
        </div>
        ${members.length === 0
          ? '<p class="scope-empty">No members yet.</p>'
          : `<table class="scope-members">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${members.map(member => {
                  const name = userDisplayName(member.user) || member.user_id;
                  const roleOptions = availableRoles.map(r =>
                    `<option value="${escapeHtml(r.id)}"${r.id === member.role_id ? ' selected' : ''}>${escapeHtml(r.title || r.id)}</option>`
                  ).join('');
                  return `
                    <tr data-member-id="${escapeHtml(member.id)}">
                      <td>
                        <div class="member-name">${escapeHtml(name)}</div>
                        <div class="member-meta">${escapeHtml(member.user?.email || member.user?.username || member.user_id)}</div>
                      </td>
                      <td>
                        ${canManage
                          ? `<select data-role-select data-member-id="${escapeHtml(member.id)}">${roleOptions}</select>`
                          : `<span class="role-tag">${escapeHtml(roleLabel(member.role_id, availableRoles))}</span>`}
                      </td>
                      <td class="member-actions">
                        ${canManage
                          ? `<button type="button" class="danger" data-remove-member="${escapeHtml(member.id)}">Remove</button>`
                          : ''}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>`}
      </section>

      ${canManage ? `
      <section class="scope-section">
        <div class="scope-section-header">
          <h2>Add Member</h2>
        </div>
        <form id="add-member-form" class="scope-add-form">
          <div class="form-field">
            <label for="add-role">Role</label>
            <select id="add-role" name="role_id" required>
              <option value="" disabled${localState.addRoleId ? '' : ' selected'}>Choose a role…</option>
              ${availableRoles.map(r => `<option value="${escapeHtml(r.id)}"${r.id === localState.addRoleId ? ' selected' : ''}>${escapeHtml(r.title || r.id)}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="add-identifier">Email or username</label>
            <input id="add-identifier" name="identifier" type="text" placeholder="user@example.com or alice42" autocomplete="off" />
            <p class="field-hint">Looks up the user by exact email, then by exact username.</p>
          </div>
          <div class="form-actions">
            <button type="button" id="browse-users-btn" class="secondary">Browse users…</button>
            <button type="submit" class="primary">Add Member</button>
          </div>
        </form>
      </section>
      ` : ''}
    `;

    attachListeners();
  }

  function attachListeners() {
    const addForm = document.getElementById('add-member-form');
    if (addForm) {
      addForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const roleSelect = document.getElementById('add-role');
        const identifierInput = document.getElementById('add-identifier');
        const roleId = roleSelect && 'value' in roleSelect ? roleSelect.value : '';
        const identifier = identifierInput && 'value' in identifierInput ? identifierInput.value.trim() : '';
        if (!roleId) {
          showNotice('warning', 'Pick a role.');
          return;
        }
        if (!identifier) {
          showNotice('warning', 'Type an email/username or use Browse users…');
          return;
        }
        post('addMember', { identifier, role_id: roleId });
      });
    }

    const browseBtn = document.getElementById('browse-users-btn');
    if (browseBtn) {
      browseBtn.addEventListener('click', () => {
        const roleSelect = document.getElementById('add-role');
        const roleId = roleSelect && 'value' in roleSelect ? roleSelect.value : '';
        if (!roleId) {
          showNotice('warning', 'Pick a role first.');
          return;
        }
        post('browseAndAdd', { role_id: roleId });
      });
    }

    document.querySelectorAll('[data-role-select]').forEach((el) => {
      el.addEventListener('change', (event) => {
        const target = event.currentTarget;
        if (!(target instanceof HTMLSelectElement)) { return; }
        const memberId = target.getAttribute('data-member-id');
        if (!memberId) { return; }
        post('changeRole', { member_id: memberId, role_id: target.value });
      });
    });

    document.querySelectorAll('[data-remove-member]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        const target = event.currentTarget;
        if (!(target instanceof HTMLElement)) { return; }
        const memberId = target.getAttribute('data-remove-member');
        if (!memberId) { return; }
        post('removeMember', { member_id: memberId });
      });
    });
  }

  function showNotice(type, message) {
    localState.notice = { type, message };
    renderRoot();
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) { return; }
    switch (message.command) {
      case 'updateState':
        Object.assign(state || {}, message.data || {});
        if (message.notice) { localState.notice = message.notice; }
        renderRoot();
        break;
      case 'notice':
        if (message.notice) { showNotice(message.notice.type, message.notice.message); }
        break;
      default:
        break;
    }
  });

  renderRoot();
})();
