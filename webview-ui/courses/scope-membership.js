(function () {
  const { escapeHtml, say } = window.ComputorWebview;
  const vscode = window.vscodeApi || acquireVsCodeApi();

  let state = window.__INITIAL_STATE__ || null;
  const localState = {
    addRoleId: '',
    pending: false,
    notice: null
  };

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
    return `<div class="notice ${escapeHtml(type)}">${escapeHtml(message)}</div>`;
  }

  function renderRoot() {
    const root = document.getElementById('app');
    if (!root) { return; }

    if (!state || !state.target) {
      root.innerHTML = '<p>' + say('Loading…', 'Wird geladen …') + '</p>';
      return;
    }

    const { target, members, availableRoles, canManage } = state;
    const headerLabel = target.kind === 'organization' ? say('Organization', 'Organisation') : say('Course Family', 'Kursfamilie');

    root.innerHTML = `
      <header class="header">
        <h1>${escapeHtml(target.scopeTitle)}</h1>
        <p>${escapeHtml(target.scopeSubtitle || headerLabel)} · ${say('Members', 'Mitglieder')}</p>
        ${canManage ? '' : `<p class="notice info">${say('You have read-only access. Backend rejects mutations from non-managers.', 'Du hast nur Lesezugriff. Änderungen nimmt der Server nur von Personen mit Verwaltungsrechten an.')}</p>`}
      </header>

      ${noticeHtml()}

      <section class="section stack tight">
        <div class="section-header">
          <h2>${say('Members', 'Mitglieder')} (${members.length})</h2>
        </div>
        ${members.length === 0
          ? `<p class="text-muted">${say('No members yet.', 'Noch keine Mitglieder.')}</p>`
          : `<table class="table scope-members">
              <thead>
                <tr>
                  <th>${say('User', 'Person')}</th>
                  <th>${say('Role', 'Rolle')}</th>
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
                          ? `<button type="button" class="btn-danger btn-sm" data-remove-member="${escapeHtml(member.id)}">${say('Remove', 'Entfernen')}</button>`
                          : ''}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>`}
      </section>

      ${canManage ? `
      <section class="section stack tight">
        <div class="section-header">
          <h2>${say('Add Member', 'Mitglied hinzufügen')}</h2>
        </div>
        <form id="add-member-form" class="form-grid scope-add-form">
          <div class="form-field">
            <label for="add-role">${say('Role', 'Rolle')}</label>
            <select id="add-role" name="role_id" required>
              <option value="" disabled${localState.addRoleId ? '' : ' selected'}>${say('Choose a role…', 'Rolle auswählen …')}</option>
              ${availableRoles.map(r => `<option value="${escapeHtml(r.id)}"${r.id === localState.addRoleId ? ' selected' : ''}>${escapeHtml(r.title || r.id)}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="add-identifier">${say('Email', 'E-Mail')}</label>
            <input id="add-identifier" name="identifier" type="text" placeholder="user@example.com" autocomplete="off" />
            <p class="field-hint">${say('Looks up the user by exact email.', 'Sucht die Person über die genaue E-Mail-Adresse.')}</p>
          </div>
          <div class="form-actions end">
            <button type="button" id="browse-users-btn" class="btn-secondary">${say('Browse users…', 'Personen durchsuchen …')}</button>
            <button type="submit" class="btn">${say('Add Member', 'Mitglied hinzufügen')}</button>
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
          showNotice('warning', say('Pick a role.', 'Wähle eine Rolle.'));
          return;
        }
        if (!identifier) {
          showNotice('warning', say('Type an email/username or use Browse users…', 'Gib eine E-Mail-Adresse oder einen Benutzernamen ein oder nutze „Personen durchsuchen …“.'));
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
          showNotice('warning', say('Pick a role first.', 'Wähle zuerst eine Rolle.'));
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
        state = Object.assign(state || {}, message.data || {});
        renderRoot();
        break;
      default:
        break;
    }
  });

  renderRoot();
})();
