(function () {
  const { escapeHtml, say } = window.ComputorWebview;
  const vscode = window.vscodeApi || acquireVsCodeApi();

  const state = {
    user: undefined,
    profile: null,
    studentProfiles: [],
    languages: [],
    organizations: [],
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
          const matchedOrg = organizations.find(o => o.id === sp.organization_id);
          const org = sp.organization || matchedOrg;
          const orgTitle = org?.title || org?.path || say('Unknown Organization', 'Unbekannte Organisation');
          return `
        <form class="student-profile-card stack tight student-profile-form" data-profile-id="${escapeHtml(sp.id)}" style="opacity: 0.5; pointer-events: none;">
          <h3>${say('Student Profile', 'Studierendenprofil')}: ${escapeHtml(orgTitle)}</h3>
          <div class="student-profile-meta">ID: ${escapeHtml(sp.id)}${sp.created_at ? ` · ${say('Created', 'Angelegt')}: ${escapeHtml(sp.created_at)}` : ''}</div>
          <p style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 12px;">
            ${say('Only administrators can modify student profiles. Please contact your administrator.', 'Studierendenprofile können nur Administrator:innen ändern. Wende dich bitte an deine Administration.')}
          </p>
          <div class="form-grid">
            <div class="form-field">
              <label for="student-id-${escapeHtml(sp.id)}">${say('Student ID', 'Matrikelnummer')}</label>
              <input id="student-id-${escapeHtml(sp.id)}" name="student_id" value="${escapeHtml(toInputValue(sp.student_id))}" placeholder="${say('e.g. matrikel number', 'z. B. 01234567')}" disabled>
            </div>
            <div class="form-field">
              <label for="student-email-${escapeHtml(sp.id)}">${say('Student Email', 'E-Mail-Adresse an der Hochschule')}</label>
              <input id="student-email-${escapeHtml(sp.id)}" name="student_email" type="email" value="${escapeHtml(toInputValue(sp.student_email))}" placeholder="example@university.edu" disabled>
            </div>
          </div>
          <div class="actions end">
            <button type="submit" class="btn" disabled>${say('Save Changes', 'Änderungen speichern')}</button>
          </div>
        </form>
      `;
      }).join('')
      : `<div class="text-muted">${say('No student profiles yet.', 'Noch keine Studierendenprofile.')}</div>`;

    root.innerHTML = `
      <div data-notice class="notice" style="display: none;"></div>

      <section class="section stack">
        <div>
          <h2>${say('Account Information', 'Konto')}</h2>
          <p class="section-description">${say('Core account details.', 'Die wichtigsten Angaben zu deinem Konto.')}</p>
        </div>
        <form id="account-form">
          <div class="form-grid">
            <div class="form-field">
              <label for="account-given-name">${say('Given Name', 'Vorname')}</label>
              <input id="account-given-name" name="given_name" value="${escapeHtml(toInputValue(user.given_name))}" placeholder="${say('Given name', 'Vorname')}" readonly>
            </div>
            <div class="form-field">
              <label for="account-family-name">${say('Family Name', 'Nachname')}</label>
              <input id="account-family-name" name="family_name" value="${escapeHtml(toInputValue(user.family_name))}" placeholder="${say('Family name', 'Nachname')}" readonly>
            </div>
            <div class="form-field">
              <label for="account-email">${say('Email', 'E-Mail-Adresse')}</label>
              <input id="account-email" name="email" type="email" value="${escapeHtml(toInputValue(user.email))}" placeholder="${say('Email', 'E-Mail-Adresse')}" autocomplete="email" readonly>
            </div>
            <div class="form-field">
              <label for="account-number">${say('Student Number', 'Matrikelnummer')}</label>
              <input id="account-number" name="number" value="${escapeHtml(toInputValue(user.number))}" placeholder="${say('Optional student number', 'Matrikelnummer (optional)')}" readonly>
            </div>
          </div>
        </form>
      </section>

      <section class="section stack">
        <div>
          <h2>${say('User Profile', 'Profil')}</h2>
          <p class="section-description">${say('Update your profile used across Computor.', 'Dein Profil, das überall in Computor verwendet wird.')}</p>
        </div>
        <form id="profile-form">
          <div class="form-grid">
            <div class="form-field">
              <label for="profile-nickname">${say('Nickname', 'Spitzname')}</label>
              <input id="profile-nickname" name="nickname" value="${escapeHtml(toInputValue(profile.nickname))}" placeholder="${say('Display name', 'Angezeigter Name')}">
            </div>
            <div class="form-field">
              <label for="profile-url">Website</label>
              <input id="profile-url" name="url" type="url" value="${escapeHtml(toInputValue(profile.url))}" placeholder="https://example.com">
            </div>
            <div class="form-field">
              <label for="profile-avatar-color">${say('Avatar Color', 'Avatarfarbe')}</label>
              <input id="profile-avatar-color" name="avatar_color" type="number" min="0" max="16777215" value="${escapeHtml(toInputValue(profile.avatar_color))}" placeholder="0 - 16777215">
            </div>
            <div class="form-field">
              <label for="profile-avatar-image">${say('Avatar Image URL', 'URL des Avatarbilds')}</label>
              <input id="profile-avatar-image" name="avatar_image" type="url" value="${escapeHtml(toInputValue(profile.avatar_image))}" placeholder="https://...">
            </div>
            <div class="form-field">
              <label for="profile-language">${say('Language', 'Sprache')}</label>
              <select id="profile-language" name="language_code">
                <option value="">${say('Automatic', 'Automatisch')}</option>
                ${languages.map(lang => `<option value="${escapeHtml(lang.code)}" ${profile.language_code === lang.code ? 'selected' : ''}>${escapeHtml(lang.name)}${lang.native_name ? ` (${escapeHtml(lang.native_name)})` : ''}</option>`).join('')}
              </select>
            </div>
            <div class="form-field" style="grid-column: 1 / -1;">
              <label for="profile-bio">${say('Biography', 'Über dich')}</label>
              <textarea id="profile-bio" name="bio" placeholder="${say('Tell others a little about you', 'Erzähl anderen ein wenig über dich')}">${escapeHtml(toInputValue(profile.bio))}</textarea>
            </div>
          </div>
          <div class="actions end">
            <button type="submit" class="btn">${say('Save Profile', 'Profil speichern')}</button>
          </div>
        </form>
      </section>

      <section class="section stack">
        <div>
          <h2>${say('Student Profiles', 'Studierendenprofile')}</h2>
          <p class="section-description">${say('Student profiles link your Computor account to academic identifiers used by organizations.', 'Studierendenprofile verbinden dein Computor-Konto mit den Kennungen, unter denen dich eine Hochschule oder Organisation führt.')}</p>
        </div>
        <div class="stack">
          ${studentProfilesHtml}
          
          <form id="new-student-profile-form" class="student-profile-card stack tight" style="opacity: 0.5; pointer-events: none;">
            <h3>${say('Add Student Profile', 'Studierendenprofil hinzufügen')}</h3>
            <p style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 12px;">
              ${say('Only administrators can create or modify student profiles. Please contact your administrator.', 'Studierendenprofile können nur Administrator:innen anlegen oder ändern. Wende dich bitte an deine Administration.')}
            </p>
            <div class="form-grid">
              <div class="form-field">
                <label for="new-organization">${say('Organization', 'Organisation')}</label>
                <select id="new-organization" name="organization_id" required disabled>
                  <option value="">${say('Select organization...', 'Organisation wählen …')}</option>
                  ${organizations.map(org => `<option value="${escapeHtml(org.id)}">${escapeHtml(org.title || org.name || org.path)}</option>`).join('')}
                </select>
              </div>
              <div class="form-field">
                <label for="new-student-id">${say('Student ID', 'Matrikelnummer')}</label>
                <input id="new-student-id" name="student_id" placeholder="${say('e.g. matrikel number', 'z. B. 01234567')}" disabled>
              </div>
              <div class="form-field">
                <label for="new-student-email">${say('Student Email', 'E-Mail-Adresse an der Hochschule')}</label>
                <input id="new-student-email" name="student_email" type="email" placeholder="example@university.edu" disabled>
              </div>
            </div>
            <div class="actions end">
              <button type="submit" class="btn" disabled>${say('Add Student Profile', 'Studierendenprofil hinzufügen')}</button>
            </div>
          </form>
        </div>
      </section>
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
          updateNotice({ type: 'warning', message: say('Please select an organization.', 'Wähle bitte eine Organisation.') });
          return;
        }
        if (!payload.student_id && !payload.student_email) {
          updateNotice({ type: 'warning', message: say('Provide at least a student ID or a student email.', 'Gib mindestens eine Matrikelnummer oder eine E-Mail-Adresse an der Hochschule an.') });
          return;
        }
        post('saveStudentProfile', payload);
        newStudentForm.reset();
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
      container.className = 'notice';
      return;
    }
    container.style.display = 'block';
    container.textContent = currentNotice.message;
    container.className = `notice ${currentNotice.type || 'info'}`;
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
      }
      render();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    render();
  });
})();
