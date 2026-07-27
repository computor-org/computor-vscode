(function () {
  const { escapeHtml, formatDateTime } = window.ComputorWebview;
  const vscode = window.vscodeApi || acquireVsCodeApi();

  const state = {
    user: undefined,
    profile: null,
    studentProfiles: [],
    isAdmin: false,
    availableRoles: [],
    ...(window.__INITIAL_STATE__ || {})
  };

  let currentNotice = null;

  function toInputValue(value) {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value);
  }

  function post(command, data) {
    vscode.postMessage({ command, data });
  }

  function formatDate(dateString) {
    return formatDateTime(dateString) || 'N/A';
  }

  function render() {
    const root = document.getElementById('app');
    if (!root) {
      return;
    }

    const user = state.user || {};
    const profile = state.profile || {};
    const studentProfiles = Array.isArray(state.studentProfiles) ? state.studentProfiles : [];

    const assignedRoleIds = new Set((Array.isArray(user.user_roles) ? user.user_roles : []).map(ur => ur.role_id));
    const userRolesHtml = assignedRoleIds.size > 0
      ? Array.from(assignedRoleIds).map(roleId => `
          <span class="role-badge">
            <span class="role-badge-label">${escapeHtml(roleId)}</span>
            <button type="button" class="role-badge-remove" data-role-remove="${escapeHtml(roleId)}" title="Remove role">×</button>
          </span>
        `).join('')
      : '<span class="empty-value">No roles assigned</span>';

    const availableRoles = Array.isArray(state.availableRoles) ? state.availableRoles : [];
    const assignableRoles = availableRoles.filter(r => !assignedRoleIds.has(r.id));
    const addRoleOptionsHtml = assignableRoles.length > 0
      ? assignableRoles.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.title || r.id)}</option>`).join('')
      : '';

    const studentProfilesHtml = studentProfiles.length > 0
      ? studentProfiles.map(sp => {
          const orgTitle = sp.organization?.title || sp.organization?.name || sp.organization?.path || 'Unknown Organization';
          return `
        <div class="section stack tight">
          <h3>Student Profile: ${escapeHtml(orgTitle)}</h3>
          <div class="profile-grid">
            <div class="info-field">
              <label>Student ID</label>
              <div class="info-value">${escapeHtml(sp.student_id || 'Not set')}</div>
            </div>
            <div class="info-field">
              <label>Student Email</label>
              <div class="info-value">${escapeHtml(sp.student_email || 'Not set')}</div>
            </div>
            <div class="info-field">
              <label>Profile ID</label>
              <div class="info-value">${escapeHtml(sp.id)}</div>
            </div>
            <div class="info-field">
              <label>Created</label>
              <div class="info-value">${formatDate(sp.created_at)}</div>
            </div>
          </div>
        </div>
      `;
      }).join('')
      : '<div class="text-muted">No student profiles</div>';

    const archivedBanner = user.archived_at
      ? `<div class="notice warning">⚠️ This user was archived on ${formatDate(user.archived_at)}</div>`
      : '';

    const bannedBanner = user.banned_at
      ? `<div class="notice error">🚫 This user is banned${user.ban_reason ? ` — ${escapeHtml(user.ban_reason)}` : ''} (since ${formatDate(user.banned_at)}). They cannot authenticate.</div>`
      : '';

    const serviceAccountBanner = user.is_service
      ? `<div class="notice info">🤖 This is a service account</div>`
      : '';

    root.innerHTML = `
      <div data-notice class="notice" style="display: none;"></div>

      ${bannedBanner}
      ${archivedBanner}
      ${serviceAccountBanner}

      <section class="section stack" aria-labelledby="section-identity">
        <div>
          <h2 id="section-identity">Identity</h2>
          <p class="section-description">Core account fields.${state.isAdmin ? '' : ' Name edits are admin-only.'}</p>
        </div>
        ${state.isAdmin ? `
        <form id="identity-form">
          <div class="form-grid">
            <div class="form-field">
              <label for="user-given-name">Given Name</label>
              <input id="user-given-name" name="given_name" type="text" value="${escapeHtml(toInputValue(user.given_name))}" autocomplete="given-name">
            </div>
            <div class="form-field">
              <label for="user-family-name">Family Name</label>
              <input id="user-family-name" name="family_name" type="text" value="${escapeHtml(toInputValue(user.family_name))}" autocomplete="family-name">
            </div>
          </div>
          <div class="form-actions end">
            <button type="submit" class="btn">Save Identity</button>
          </div>
        </form>
        ` : `
        <div class="form-grid">
          <div class="info-field">
            <label>Given Name</label>
            <div class="info-value">${escapeHtml(user.given_name || 'Not set')}</div>
          </div>
          <div class="info-field">
            <label>Family Name</label>
            <div class="info-value">${escapeHtml(user.family_name || 'Not set')}</div>
          </div>
        </div>
        `}
        <form id="email-form">
          <div class="form-field">
            <label for="user-email">Email Address</label>
            <input id="user-email" name="email" type="email" value="${escapeHtml(toInputValue(user.email))}" placeholder="user@example.com" autocomplete="email">
          </div>
          <div class="form-actions end">
            <button type="submit" class="btn">Update Email</button>
          </div>
        </form>
      </section>

      <section class="section stack" aria-labelledby="section-roles">
        <div>
          <h2 id="section-roles">Roles</h2>
          <p class="section-description">System roles assigned to this user. Granting <code>_admin</code> requires admin privileges and is enforced server-side.</p>
        </div>
        <div class="info-field full-width">
          <div class="info-value role-badges">${userRolesHtml}</div>
        </div>
        ${assignableRoles.length > 0 ? `
        <form id="add-role-form" class="role-add-form">
          <div class="form-field">
            <label for="role-add-select">Add a role</label>
            <select id="role-add-select" name="role_id" required>
              <option value="" disabled selected>Choose a role…</option>
              ${addRoleOptionsHtml}
            </select>
          </div>
          <div class="form-actions end">
            <button type="submit" class="btn">Assign Role</button>
          </div>
        </form>
        ` : '<p class="field-hint">All available roles are already assigned.</p>'}
      </section>

      <section class="section stack" aria-labelledby="section-profile">
        <div>
          <h2 id="section-profile">Profile</h2>
          <p class="section-description">User profile information (read-only).</p>
        </div>
        <div class="form-grid">
          <div class="info-field">
            <label>Nickname</label>
            <div class="info-value">${escapeHtml(profile.nickname || 'Not set')}</div>
          </div>
          <div class="info-field">
            <label>Avatar Color</label>
            <div class="info-value">${escapeHtml(profile.avatar_color !== null && profile.avatar_color !== undefined ? profile.avatar_color : 'Not set')}</div>
          </div>
          <div class="info-field">
            <label>Website</label>
            <div class="info-value">${profile.url ? `<a href="${escapeHtml(profile.url)}" target="_blank">${escapeHtml(profile.url)}</a>` : 'Not set'}</div>
          </div>
          <div class="info-field">
            <label>Language</label>
            <div class="info-value">${escapeHtml(profile.language_code || 'Not set')}</div>
          </div>
          <div class="info-field full-width">
            <label>Biography</label>
            <div class="info-value">${escapeHtml(profile.bio || 'Not set')}</div>
          </div>
        </div>
        ${studentProfiles.length > 0 ? `
        <div>
          <h3>Student Profiles</h3>
          ${studentProfilesHtml}
        </div>
        ` : ''}
      </section>

      <section class="section stack" aria-labelledby="section-audit">
        <div>
          <h2 id="section-audit">Audit</h2>
          <p class="section-description">Identifiers and timestamps.</p>
        </div>
        <div class="form-grid">
          <div class="info-field">
            <label>User ID</label>
            <div class="info-value">${escapeHtml(user.id)}</div>
          </div>
          <div class="info-field">
            <label>Created</label>
            <div class="info-value">${formatDate(user.created_at)}</div>
          </div>
          <div class="info-field">
            <label>Updated</label>
            <div class="info-value">${formatDate(user.updated_at)}</div>
          </div>
          ${user.archived_at ? `
          <div class="info-field">
            <label>Archived</label>
            <div class="info-value">${formatDate(user.archived_at)}</div>
          </div>
          ` : ''}
        </div>
      </section>

      <section class="section stack danger-zone" aria-labelledby="section-danger">
        <div>
          <h2 id="section-danger">Danger Zone</h2>
          <p class="section-description">Destructive actions on this account.</p>
        </div>

        <div class="form-field">
          <label>Archive Status</label>
          <p class="field-hint">${user.archived_at
            ? 'This user is archived. Unarchiving restores access.'
            : 'Archiving hides the user from default lists and blocks authentication.'}</p>
          <div class="form-actions end">
            <button type="button" id="archive-toggle-btn" class="btn ${user.archived_at ? '' : 'danger'}">
              ${user.archived_at ? 'Unarchive User' : 'Archive User'}
            </button>
          </div>
        </div>

        <div class="form-field">
          <label>Access Control</label>
          <p class="field-hint">${user.banned_at
            ? 'This user is banned. Unbanning restores their ability to sign in.'
            : 'Banning immediately blocks this user from signing in and revokes their active sessions.'}</p>
          ${user.banned_at ? '' : `
          <input id="ban-reason" type="text" maxlength="1024" placeholder="Reason (optional)" value="">
          `}
          <div class="form-actions end">
            <button type="button" id="ban-toggle-btn" class="btn ${user.banned_at ? '' : 'danger'}">
              ${user.banned_at ? 'Unban User' : 'Ban User'}
            </button>
          </div>
        </div>
      </section>
    `;

    attachEventListeners();
    showCurrentNotice();
  }

  function attachEventListeners() {
    const emailForm = document.getElementById('email-form');
    if (emailForm) {
      emailForm.addEventListener('submit', handleEmailUpdate);
    }

    const identityForm = document.getElementById('identity-form');
    if (identityForm) {
      identityForm.addEventListener('submit', handleIdentityUpdate);
    }

    const archiveBtn = document.getElementById('archive-toggle-btn');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', () => {
        const isArchived = !!(state.user && state.user.archived_at);
        post(isArchived ? 'unarchiveUser' : 'archiveUser');
      });
    }

    const banBtn = document.getElementById('ban-toggle-btn');
    if (banBtn) {
      banBtn.addEventListener('click', () => {
        const isBanned = !!(state.user && state.user.banned_at);
        if (isBanned) {
          post('unbanUser');
        } else {
          const reasonInput = document.getElementById('ban-reason');
          const reason = reasonInput instanceof HTMLInputElement ? reasonInput.value : '';
          post('banUser', { reason });
        }
      });
    }

    document.querySelectorAll('[data-role-remove]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        const target = event.currentTarget;
        const roleId = target instanceof HTMLElement ? target.getAttribute('data-role-remove') : null;
        if (roleId) {
          post('revokeRole', { role_id: roleId });
        }
      });
    });

    const addRoleForm = document.getElementById('add-role-form');
    if (addRoleForm) {
      addRoleForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const select = document.getElementById('role-add-select');
        const value = select && 'value' in select ? select.value : '';
        if (value) {
          post('assignRole', { role_id: value });
        }
      });
    }
  }

  function handleIdentityUpdate(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const givenName = formData.get('given_name');
    const familyName = formData.get('family_name');

    post('updateIdentity', {
      given_name: typeof givenName === 'string' ? givenName : undefined,
      family_name: typeof familyName === 'string' ? familyName : undefined
    });
  }

  function handleEmailUpdate(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const email = formData.get('email');

    if (!email || !email.trim()) {
      showNotice('warning', 'Email address cannot be empty.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showNotice('warning', 'Please enter a valid email address.');
      return;
    }

    post('updateEmail', { email: email.trim() });
  }

  function showNotice(type, message) {
    currentNotice = { type, message };
    showCurrentNotice();
  }

  function showCurrentNotice() {
    const noticeEl = document.querySelector('[data-notice]');
    if (!noticeEl) {
      return;
    }

    if (!currentNotice) {
      noticeEl.style.display = 'none';
      return;
    }

    noticeEl.className = `notice ${currentNotice.type}`;
    noticeEl.textContent = currentNotice.message;
    noticeEl.style.display = 'block';

    if (currentNotice.type === 'success' || currentNotice.type === 'info') {
      setTimeout(() => {
        if (noticeEl) {
          noticeEl.style.display = 'none';
        }
        currentNotice = null;
      }, 5000);
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;

    if (!message) {
      return;
    }

    switch (message.command) {
      case 'updateState':
        Object.assign(state, message.data || {});
        render();
        break;

      default:
        break;
    }
  });

  render();
})();
