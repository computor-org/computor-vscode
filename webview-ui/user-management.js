(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();

  const state = {
    user: undefined,
    profile: null,
    studentProfiles: [],
    canResetPassword: false,
    ...(window.__INITIAL_STATE__ || {})
  };

  let currentNotice = null;

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
    if (!dateString) {
      return 'N/A';
    }
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch (e) {
      return dateString;
    }
  }

  function render() {
    const root = document.getElementById('app');
    if (!root) {
      return;
    }

    const user = state.user || {};
    const profile = state.profile || {};
    const studentProfiles = Array.isArray(state.studentProfiles) ? state.studentProfiles : [];

    const userRolesHtml = Array.isArray(user.user_roles) && user.user_roles.length > 0
      ? user.user_roles.map(ur => `<span class="role-badge">${escapeHtml(ur.role_id)}</span>`).join('')
      : '<span class="empty-value">No roles assigned</span>';

    const studentProfilesHtml = studentProfiles.length > 0
      ? studentProfiles.map(sp => {
          const orgTitle = sp.organization?.title || sp.organization?.name || sp.organization?.path || 'Unknown Organization';
          return `
        <div class="student-profile-card">
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
      : '<div class="empty-state">No student profiles</div>';

    const archivedBanner = user.archived_at
      ? `<div class="warning-banner">⚠️ This user was archived on ${formatDate(user.archived_at)}</div>`
      : '';

    const serviceAccountBanner = user.is_service
      ? `<div class="info-banner">🤖 This is a service account</div>`
      : '';

    root.innerHTML = `
      <div data-notice class="user-management-notice" style="display: none;"></div>

      ${archivedBanner}
      ${serviceAccountBanner}

      <section class="user-section">
        <div>
          <h2>User Information</h2>
          <p class="section-description">Core user account details (read-only except email).</p>
        </div>
        <div class="info-grid">
          <div class="info-field">
            <label>User ID</label>
            <div class="info-value">${escapeHtml(user.id)}</div>
          </div>
          <div class="info-field">
            <label>Given Name</label>
            <div class="info-value">${escapeHtml(user.given_name || 'Not set')}</div>
          </div>
          <div class="info-field">
            <label>Family Name</label>
            <div class="info-value">${escapeHtml(user.family_name || 'Not set')}</div>
          </div>
          <div class="info-field">
            <label>Username</label>
            <div class="info-value">${escapeHtml(user.username || 'Not set')}</div>
          </div>
          <div class="info-field">
            <label>Created</label>
            <div class="info-value">${formatDate(user.created_at)}</div>
          </div>
          <div class="info-field">
            <label>Updated</label>
            <div class="info-value">${formatDate(user.updated_at)}</div>
          </div>
          <div class="info-field full-width">
            <label>Roles</label>
            <div class="info-value">${userRolesHtml}</div>
          </div>
        </div>
      </section>

      <section class="user-section">
        <div>
          <h2>Email Address</h2>
          <p class="section-description">Update the user's email address.</p>
        </div>
        <form id="email-form">
          <div class="form-field">
            <label for="user-email">Email Address</label>
            <input id="user-email" name="email" type="email" value="${escapeHtml(toInputValue(user.email))}" placeholder="user@example.com" autocomplete="email">
          </div>
          <div class="form-actions">
            <button type="submit" class="primary">Update Email</button>
          </div>
        </form>
      </section>

      <section class="user-section">
        <div>
          <h2>Profile</h2>
          <p class="section-description">User profile information (read-only).</p>
        </div>
        <div class="info-grid">
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
      </section>

      <section class="user-section">
        <div>
          <h2>Student Profiles</h2>
          <p class="section-description">Student profiles associated with this user (read-only).</p>
        </div>
        ${studentProfilesHtml}
      </section>

      <section class="user-section danger-zone">
        <div>
          <h2>Password Reset</h2>
          <p class="section-description">Reset this user's password. This will set their password to NULL and they will need to set a new password on their next login.</p>
        </div>
        <form id="password-reset-form">
          <div class="form-field">
            <label for="manager-password">Your Password (Required)</label>
            <input id="manager-password" name="managerPassword" type="password" placeholder="Enter your password to confirm" autocomplete="current-password">
            <p class="field-hint">Your password is required to perform this critical action.</p>
          </div>
          <div class="form-actions">
            <button type="submit" class="danger">Reset User Password</button>
          </div>
        </form>
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

    const passwordResetForm = document.getElementById('password-reset-form');
    if (passwordResetForm) {
      passwordResetForm.addEventListener('submit', handlePasswordReset);
    }
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

  function handlePasswordReset(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const managerPassword = formData.get('managerPassword');

    if (!managerPassword || !managerPassword.trim()) {
      showNotice('warning', 'Your password is required to perform this action.');
      return;
    }

    post('resetPassword', { managerPassword: managerPassword.trim() });

    document.getElementById('manager-password').value = '';
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

    noticeEl.className = `user-management-notice ${currentNotice.type}`;
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
        if (message.notice) {
          currentNotice = message.notice;
        }
        render();
        break;

      case 'notice':
        if (message.notice) {
          showNotice(message.notice.type, message.notice.message);
        }
        break;

      default:
        break;
    }
  });

  render();
})();
