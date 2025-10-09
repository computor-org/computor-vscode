(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();

  const state = {
    user: undefined,
    profile: null,
    studentProfiles: [],
    languages: [],
    organizations: [],
    canChangePassword: false,
    username: undefined,
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

  function render() {
    const root = document.getElementById('app');
    if (!root) {
      return;
    }

    const user = state.user || {};
    const profile = state.profile || {};
    const studentProfiles = Array.isArray(state.studentProfiles) ? state.studentProfiles : [];
    const languages = Array.isArray(state.languages) ? state.languages : [];
    const organizations = Array.isArray(state.organizations) ? state.organizations : [];

    const studentProfilesHtml = studentProfiles.length > 0
      ? studentProfiles.map((sp, index) => {
          const orgTitle = sp.organization?.title || sp.organization?.name || sp.organization?.path || 'Unknown Organization';
          return `
        <form class="student-profile-card student-profile-form" data-profile-id="${escapeHtml(sp.id)}" style="opacity: 0.5; pointer-events: none;">
          <h3>Student Profile: ${escapeHtml(orgTitle)}</h3>
          <div class="student-profile-meta">ID: ${escapeHtml(sp.id)}${sp.created_at ? ` · Created: ${escapeHtml(sp.created_at)}` : ''}</div>
          <p style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 12px;">
            Only administrators can modify student profiles. Please contact your administrator.
          </p>
          <div class="profile-grid">
            <div class="form-field">
              <label for="student-id-${escapeHtml(sp.id)}">Student ID</label>
              <input id="student-id-${escapeHtml(sp.id)}" name="student_id" value="${escapeHtml(toInputValue(sp.student_id))}" placeholder="e.g. matrikel number" disabled>
            </div>
            <div class="form-field">
              <label for="student-email-${escapeHtml(sp.id)}">Student Email</label>
              <input id="student-email-${escapeHtml(sp.id)}" name="student_email" type="email" value="${escapeHtml(toInputValue(sp.student_email))}" placeholder="example@university.edu" disabled>
            </div>
          </div>
          <div class="profile-actions">
            <button type="submit" class="primary" disabled>Save Changes</button>
          </div>
        </form>
      `;
      }).join('')
      : '<div class="empty-state">No student profiles yet.</div>';

    root.innerHTML = `
      <div data-notice class="profile-notice" style="display: none;"></div>

      <section class="profile-section">
        <div>
          <h2>Account Information</h2>
          <p class="section-description">Core account details.</p>
        </div>
        <form id="account-form">
          <div class="profile-grid">
            <div class="form-field">
              <label for="account-given-name">Given Name</label>
              <input id="account-given-name" name="given_name" value="${escapeHtml(toInputValue(user.given_name))}" placeholder="Given name" readonly>
            </div>
            <div class="form-field">
              <label for="account-family-name">Family Name</label>
              <input id="account-family-name" name="family_name" value="${escapeHtml(toInputValue(user.family_name))}" placeholder="Family name" readonly>
            </div>
            <div class="form-field">
              <label for="account-email">Email</label>
              <input id="account-email" name="email" type="email" value="${escapeHtml(toInputValue(user.email))}" placeholder="Email" autocomplete="email" readonly>
            </div>
            <div class="form-field">
              <label for="account-username">Username</label>
              <input id="account-username" name="username" value="${escapeHtml(toInputValue(user.username))}" placeholder="Username" autocomplete="username" readonly>
            </div>
            <div class="form-field">
              <label for="account-number">Student Number</label>
              <input id="account-number" name="number" value="${escapeHtml(toInputValue(user.number))}" placeholder="Optional student number" readonly>
            </div>
          </div>
        </form>
      </section>

      <section class="profile-section">
        <div>
          <h2>User Profile</h2>
          <p class="section-description">Update your profile used across Computor.</p>
        </div>
        <form id="profile-form">
          <div class="profile-grid">
            <div class="form-field">
              <label for="profile-nickname">Nickname</label>
              <input id="profile-nickname" name="nickname" value="${escapeHtml(toInputValue(profile.nickname))}" placeholder="Display name">
            </div>
            <div class="form-field">
              <label for="profile-url">Website</label>
              <input id="profile-url" name="url" type="url" value="${escapeHtml(toInputValue(profile.url))}" placeholder="https://example.com">
            </div>
            <div class="form-field">
              <label for="profile-avatar-color">Avatar Color</label>
              <input id="profile-avatar-color" name="avatar_color" type="number" min="0" max="16777215" value="${escapeHtml(toInputValue(profile.avatar_color))}" placeholder="0 - 16777215">
            </div>
            <div class="form-field">
              <label for="profile-avatar-image">Avatar Image URL</label>
              <input id="profile-avatar-image" name="avatar_image" type="url" value="${escapeHtml(toInputValue(profile.avatar_image))}" placeholder="https://...">
            </div>
            <div class="form-field">
              <label for="profile-language">Language</label>
              <select id="profile-language" name="language_code">
                <option value="">No preference</option>
                ${languages.map(lang => `<option value="${escapeHtml(lang.code)}" ${profile.language_code === lang.code ? 'selected' : ''}>${escapeHtml(lang.name)}${lang.native_name ? ` (${escapeHtml(lang.native_name)})` : ''}</option>`).join('')}
              </select>
            </div>
            <div class="form-field" style="grid-column: 1 / -1;">
              <label for="profile-bio">Biography</label>
              <textarea id="profile-bio" name="bio" placeholder="Tell others a little about you">${escapeHtml(toInputValue(profile.bio))}</textarea>
            </div>
          </div>
          <div class="profile-actions">
            <button type="submit" class="primary">Save Profile</button>
          </div>
        </form>
      </section>

      <section class="profile-section">
        <div>
          <h2>Student Profiles</h2>
          <p class="section-description">Student profiles link your Computor account to academic identifiers used by organizations.</p>
        </div>
        <div class="student-profile-list">
          ${studentProfilesHtml}
          <div class="profile-divider"></div>
          <form id="new-student-profile-form" class="student-profile-card" style="opacity: 0.5; pointer-events: none;">
            <h3>Add Student Profile</h3>
            <p style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 12px;">
              Only administrators can create or modify student profiles. Please contact your administrator.
            </p>
            <div class="profile-grid">
              <div class="form-field">
                <label for="new-organization">Organization</label>
                <select id="new-organization" name="organization_id" required disabled>
                  <option value="">Select organization...</option>
                  ${organizations.map(org => `<option value="${escapeHtml(org.id)}">${escapeHtml(org.title || org.name || org.path)}</option>`).join('')}
                </select>
              </div>
              <div class="form-field">
                <label for="new-student-id">Student ID</label>
                <input id="new-student-id" name="student_id" placeholder="e.g. matrikel number" disabled>
              </div>
              <div class="form-field">
                <label for="new-student-email">Student Email</label>
                <input id="new-student-email" name="student_email" type="email" placeholder="example@university.edu" disabled>
              </div>
            </div>
            <div class="profile-actions">
              <button type="submit" class="primary" disabled>Add Student Profile</button>
            </div>
          </form>
        </div>
      </section>

      ${state.canChangePassword ? `
        <section class="profile-section">
          <div>
            <h2>Change Password</h2>
            <p class="section-description">Update the password used for basic authentication. You must provide the current password to confirm this change.</p>
          </div>
          <form id="password-form">
            <div class="password-grid">
              <div class="form-field">
                <label for="password-current">Current Password</label>
                <input id="password-current" name="currentPassword" type="password" autocomplete="current-password" required>
              </div>
              <div class="form-field">
                <label for="password-new">New Password</label>
                <input id="password-new" name="newPassword" type="password" autocomplete="new-password" required>
              </div>
              <div class="form-field">
                <label for="password-confirm">Confirm Password</label>
                <input id="password-confirm" name="confirmPassword" type="password" autocomplete="new-password" required>
              </div>
            </div>
            <div class="profile-actions">
              <button type="submit" class="primary">Update Password</button>
            </div>
          </form>
        </section>
      ` : ''}
    `;

    bindEvents(root);
    updateNotice(currentNotice);
  }

  function bindEvents(root) {
    const accountForm = root.querySelector('#account-form');
    if (accountForm) {
      accountForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const formData = new FormData(accountForm);
        const payload = {
          username: formData.get('username')?.toString().trim() || undefined,
          email: formData.get('email')?.toString().trim() || undefined,
          given_name: formData.get('given_name')?.toString().trim() || undefined,
          family_name: formData.get('family_name')?.toString().trim() || undefined,
          number: formData.get('number')?.toString().trim() || undefined
        };
        post('saveUser', payload);
      });
    }

    const profileForm = root.querySelector('#profile-form');
    if (profileForm) {
      profileForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const formData = new FormData(profileForm);
        const payload = {
          nickname: formData.get('nickname')?.toString().trim() || undefined,
          bio: formData.get('bio')?.toString() || undefined,
          url: formData.get('url')?.toString().trim() || undefined,
          avatar_color: formData.get('avatar_color')?.toString().trim() || undefined,
          avatar_image: formData.get('avatar_image')?.toString().trim() || undefined,
          language_code: formData.get('language_code')?.toString().trim() || undefined
        };
        post('saveProfile', payload);
      });
    }

    const studentForms = root.querySelectorAll('.student-profile-form');
    studentForms.forEach((form) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const profileId = form.getAttribute('data-profile-id');
        const payload = {
          id: profileId,
          student_id: formData.get('student_id')?.toString().trim() || undefined,
          student_email: formData.get('student_email')?.toString().trim() || undefined
        };
        post('saveStudentProfile', payload);
      });
    });

    const newStudentForm = root.querySelector('#new-student-profile-form');
    if (newStudentForm) {
      newStudentForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const formData = new FormData(newStudentForm);
        const payload = {
          organization_id: formData.get('organization_id')?.toString().trim() || undefined,
          student_id: formData.get('student_id')?.toString().trim() || undefined,
          student_email: formData.get('student_email')?.toString().trim() || undefined
        };
        if (!payload.organization_id) {
          updateNotice({ type: 'warning', message: 'Please select an organization.' });
          return;
        }
        if (!payload.student_id && !payload.student_email) {
          updateNotice({ type: 'warning', message: 'Provide at least a student ID or a student email.' });
          return;
        }
        post('saveStudentProfile', payload);
        newStudentForm.reset();
      });
    }

    const passwordForm = root.querySelector('#password-form');
    if (passwordForm) {
      passwordForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const formData = new FormData(passwordForm);
        const payload = {
          currentPassword: formData.get('currentPassword')?.toString() || '',
          newPassword: formData.get('newPassword')?.toString() || '',
          confirmPassword: formData.get('confirmPassword')?.toString() || ''
        };
        post('changePassword', payload);
        passwordForm.reset();
      });
    }
  }

  function updateNotice(notice) {
    currentNotice = notice && notice.message ? notice : null;
    const container = document.querySelector('[data-notice]');
    if (!container) {
      return;
    }
    if (!currentNotice) {
      container.style.display = 'none';
      container.textContent = '';
      container.className = 'profile-notice';
      return;
    }
    container.style.display = 'block';
    container.textContent = currentNotice.message;
    container.className = `profile-notice ${currentNotice.type || 'info'}`;
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.command === 'updateState' || message.command === 'update') {
      if (message.data) {
        state.user = message.data.user ?? state.user;
        state.profile = message.data.profile ?? state.profile;
        state.studentProfiles = message.data.studentProfiles ?? state.studentProfiles;
        state.languages = message.data.languages ?? state.languages;
        state.organizations = message.data.organizations ?? state.organizations;
        state.canChangePassword = message.data.canChangePassword ?? state.canChangePassword;
        state.username = message.data.username ?? state.username;
      }
      render();
      if (message.notice) {
        updateNotice(message.notice);
      }
    } else if (message.command === 'notice') {
      updateNotice(message.notice);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    render();
  });
})();
