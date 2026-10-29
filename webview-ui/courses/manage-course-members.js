(function () {
  'use strict';

  const vscode = window.vscodeApi || acquireVsCodeApi();
  const say = window.ComputorWebview.say;
  const state = window.__INITIAL_STATE__ || {};

  const roleLabels = state.roleLabels || {};
  const assignableRoles = state.assignableRoles || [];
  const canManage = !!state.canManage;

  let members = state.members || [];
  let memberIds = new Set(members.map((m) => m.userId));

  let currentTab = 'roster';
  let usersLoaded = false;

  // Users-table local state.
  let userSearch = '';
  let userPage = 0;
  let userList = [];
  let userHasNext = false;
  let usersLoading = false;
  let usersError = '';
  const rowRole = {}; // userId -> selected role for the add action
  const addedUsers = new Set(); // userIds added this session
  const rowError = {}; // userId -> error message

  // Import-from-file local state (index-keyed).
  let fileRows = [];
  const fileSel = {};
  const fileRole = {};
  const fileGroup = {};
  const fileResults = {};
  let fileImporting = false;
  let fileQueue = [];

  const app = document.getElementById('app');

  const { escapeHtml: esc } = window.ComputorWebview;

  function roleLabel(id) {
    return roleLabels[id] || (id ? id.replace(/^_/, '') : '—');
  }

  function roleOptions(selected) {
    const opts = assignableRoles.slice();
    if (selected && opts.indexOf(selected) === -1) opts.unshift(selected);
    return opts
      .map(
        (r) =>
          `<option value="${esc(r)}"${r === selected ? ' selected' : ''}>${esc(roleLabel(r))}</option>`
      )
      .join('');
  }

  // Members already in the course don't belong in the add picker (they're on the
  // roster tab). Keep users added this session visible so their "Added ✓" shows.
  function visibleUserList() {
    return userList.filter((u) => addedUsers.has(u.id) || !memberIds.has(u.id));
  }

  // ---- shell (built once) -------------------------------------------------
  function buildShell() {
    const tabs = canManage
      ? `<button class="tab" data-tab="roster">${say('Members', 'Mitglieder')} (<span id="member-count">${members.length}</span>)</button>
         <button class="tab" data-tab="add">${say('Add from list', 'Aus Liste hinzufügen')}</button>
         <button class="tab" data-tab="email">${say('By email', 'Per E-Mail')}</button>
         <button class="tab" data-tab="file">${say('Import file', 'Datei importieren')}</button>`
      : `<button class="tab" data-tab="roster">${say('Members', 'Mitglieder')} (<span id="member-count">${members.length}</span>)</button>`;

    const addPanels = canManage
      ? `
      <section id="tab-add" class="tab-panel">
        <p class="hint">${say('You can only see users your permissions allow. Members already in the course are hidden — pick a role and add them.', 'Du siehst nur Personen, die deine Berechtigungen zulassen. Wer schon im Kurs ist, wird ausgeblendet. Wähle eine Rolle und füge die Personen hinzu.')}</p>
        <input id="user-search" type="text" placeholder="${say('Search by name or email…', 'Nach Name oder E-Mail suchen …')}" autocomplete="off" />
        <div id="users-status" class="status"></div>
        <table class="table grid">
          <thead><tr><th>${say('User', 'Person')}</th><th>${say('Role', 'Rolle')}</th><th></th></tr></thead>
          <tbody id="users-body"></tbody>
        </table>
        <div class="pager">
          <span id="users-page-label" class="text-muted"></span>
          <span>
            <button id="users-prev" class="btn-secondary">${say('Previous', 'Zurück')}</button>
            <button id="users-next" class="btn-secondary">${say('Next', 'Weiter')}</button>
          </span>
        </div>
      </section>
      <section id="tab-email" class="tab-panel">
        <p class="hint">${say('Adds the user with this email, creating the account if it does not exist yet. Use this for people not yet in the system.', 'Fügt die Person mit dieser E-Mail-Adresse hinzu und legt das Konto an, falls es noch nicht existiert. Das ist für Personen gedacht, die noch nicht im System sind.')}</p>
        <form id="email-form">
          <label>${say('Email', 'E-Mail')} *<input id="email-input" type="email" placeholder="person@example.org" required /></label>
          <label>${say('Given name', 'Vorname')}<input id="email-given" type="text" /></label>
          <label>${say('Family name', 'Nachname')}<input id="email-family" type="text" /></label>
          <label>${say('Role', 'Rolle')} *<select id="email-role">${roleOptions(assignableRoles[0])}</select></label>
          <label>${say('Group', 'Gruppe')}<input id="email-group" type="text" placeholder="${say('Optional — created if missing', 'Optional; wird bei Bedarf angelegt')}" /></label>
          <button id="email-submit" type="submit">${say('Add by email', 'Per E-Mail hinzufügen')}</button>
        </form>
        <div id="email-status" class="status"></div>
      </section>
      <section id="tab-file" class="tab-panel">
        <p class="hint">${say('Upload a CSV, JSON, Excel (.xlsx) or Excel-XML student list. Review and adjust the rows, then import the ones you want.', 'Lade eine Teilnehmerliste als CSV, JSON, Excel (.xlsx) oder Excel-XML hoch. Prüfe und korrigiere die Zeilen und importiere dann die gewünschten.')}</p>
        <button id="file-pick" class="btn-secondary">${say('Choose file…', 'Datei auswählen …')}</button>
        <div id="file-status" class="status"></div>
        <div id="file-preview"></div>
      </section>`
      : '';

    const readonlyNotice = canManage
      ? ''
      : `<div class="notice info">${say('You have read-only access to this roster. A lecturer role (or higher) on this course is required to add or change members.', 'Du hast nur Lesezugriff auf diese Liste. Um Mitglieder hinzuzufügen oder zu ändern, brauchst du in diesem Kurs mindestens die Rolle Lehrende.')}</div>`;

    app.innerHTML = `
      <header class="header">
        <h1>${say('Members', 'Mitglieder')}</h1>
        <div class="text-muted">${esc(state.courseName || say('Course', 'Kurs'))}</div>
      </header>
      <nav class="tabs">${tabs}</nav>
      <section id="tab-roster" class="tab-panel">
        ${readonlyNotice}
        <table class="table grid">
          <thead><tr><th>${say('Member', 'Mitglied')}</th><th>${say('Role', 'Rolle')}</th><th>${say('Group', 'Gruppe')}</th><th></th></tr></thead>
          <tbody id="roster-body"></tbody>
        </table>
      </section>
      ${addPanels}`;

    attachShellEvents();
    showTab('roster');
    renderRoster();
  }

  function showTab(name) {
    currentTab = name;
    ['roster', 'add', 'email', 'file'].forEach((t) => {
      const panel = document.getElementById('tab-' + t);
      if (panel) panel.classList.toggle('active', t === name);
    });
    app.querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    // Load the user list lazily the first time the Add tab is opened.
    if (name === 'add' && canManage && !usersLoaded) {
      usersLoaded = true;
      requestUsers();
    }
  }

  // ---- roster -------------------------------------------------------------
  function renderRoster() {
    const count = document.getElementById('member-count');
    if (count) count.textContent = String(members.length);

    const body = document.getElementById('roster-body');
    if (!body) return;

    if (!members.length) {
      body.innerHTML = `<tr><td colspan="4" class="empty">${say('No members yet.', 'Noch keine Mitglieder.')}</td></tr>`;
      return;
    }
    body.innerHTML = members
      .map((m) => {
        const roleCell = m.manageable
          ? `<select class="member-role" data-id="${esc(m.id)}">${roleOptions(m.roleId)}</select>`
          : `<span class="badge badge-muted">${esc(roleLabel(m.roleId))}</span>`;
        const actionCell = m.manageable
          ? `<button class="link-danger remove-member" data-id="${esc(m.id)}" data-name="${esc(m.name)}">${say('Remove', 'Entfernen')}</button>`
          : '';
        return `<tr>
          <td>
            <div class="strong">${esc(m.name)}${m.isSelf ? ' <span class="text-muted">' + say('(you)', '(du)') + '</span>' : ''}</div>
            <div class="text-muted">${esc(m.email || '—')}</div>
          </td>
          <td>${roleCell}</td>
          <td>${esc(m.group || '—')}</td>
          <td class="right">${actionCell}</td>
        </tr>`;
      })
      .join('');
  }

  // ---- users table --------------------------------------------------------
  function requestUsers() {
    usersLoading = true;
    usersError = '';
    renderUsers();
    vscode.postMessage({ command: 'searchUsers', data: { search: userSearch, page: userPage } });
  }

  function renderUsers() {
    const body = document.getElementById('users-body');
    if (!body) return;
    const status = document.getElementById('users-status');
    if (status) {
      status.textContent = usersError || '';
      status.className = 'status' + (usersError ? ' error' : '');
    }

    const visible = visibleUserList();
    if (usersLoading) {
      body.innerHTML = `<tr><td colspan="3" class="empty">${say('Loading users…', 'Personen werden geladen …')}</td></tr>`;
    } else if (!visible.length) {
      body.innerHTML = `<tr><td colspan="3" class="empty">${say('No users to add.', 'Keine Personen zum Hinzufügen.')}</td></tr>`;
    } else {
      body.innerHTML = visible
        .map((u) => {
          const isAdded = addedUsers.has(u.id);
          const err = rowError[u.id];
          const action = isAdded
            ? `<span class="ok">${say('Added', 'Hinzugefügt')} ✓</span>`
            : `<button class="add-user" data-id="${esc(u.id)}">${say('Add', 'Hinzufügen')}</button>`;
          return `<tr>
            <td>
              <div class="strong">${esc(u.name)}</div>
              <div class="text-muted">${esc(u.email || '—')}</div>
              ${err ? `<div class="error small">${esc(err)}</div>` : ''}
            </td>
            <td>
              <select class="row-role" data-id="${esc(u.id)}"${isAdded ? ' disabled' : ''}>
                ${roleOptions(rowRole[u.id] || assignableRoles[0])}
              </select>
            </td>
            <td class="right">${action}</td>
          </tr>`;
        })
        .join('');
    }

    const label = document.getElementById('users-page-label');
    if (label) label.textContent = `${say('Page', 'Seite')} ${userPage + 1}`;
    const prev = document.getElementById('users-prev');
    const next = document.getElementById('users-next');
    if (prev) prev.disabled = userPage === 0 || usersLoading;
    if (next) next.disabled = !userHasNext || usersLoading;
  }

  // ---- import from file ---------------------------------------------------
  function renderFile() {
    const preview = document.getElementById('file-preview');
    if (!preview) return;
    if (!fileRows.length) {
      preview.innerHTML = '';
      return;
    }
    const selCount = fileRows.reduce((n, _, i) => n + (fileSel[i] ? 1 : 0), 0);
    const body = fileRows
      .map((r, i) => {
        const res = fileResults[i];
        const name = `${r.given_name || ''} ${r.family_name || ''}`.trim() || r.email;
        const status = res
          ? res.ok
            ? '<span class="ok">' + say('Added', 'Hinzugefügt') + ' ✓</span>'
            : `<span class="error" title="${esc(res.message || '')}">${say('Failed', 'Fehlgeschlagen')}</span>`
          : '<span class="text-muted">—</span>';
        const dis = fileImporting ? ' disabled' : '';
        return `<tr>
          <td><input type="checkbox" class="file-sel" data-i="${i}"${fileSel[i] ? ' checked' : ''}${dis} /></td>
          <td><div class="strong">${esc(name)}</div><div class="text-muted">${esc(r.email)}</div></td>
          <td><select class="file-role" data-i="${i}"${dis}>${roleOptions(fileRole[i] || assignableRoles[0])}</select></td>
          <td><input class="file-group" data-i="${i}" value="${esc(fileGroup[i] || '')}" placeholder="—"${dis} /></td>
          <td class="right">${status}</td>
        </tr>`;
      })
      .join('');
    preview.innerHTML = `
      <table class="table grid">
        <thead><tr><th></th><th>${say('User', 'Person')}</th><th>${say('Role', 'Rolle')}</th><th>${say('Group', 'Gruppe')}</th><th>Status</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="pager">
        <span class="text-muted">${say(`${selCount} selected`, `${selCount} ausgewählt`)}</span>
        <button id="file-import"${fileImporting || selCount === 0 ? ' disabled' : ''}>${fileImporting ? say('Importing…', 'Wird importiert …') : say('Import selected', 'Ausgewählte importieren')}</button>
      </div>`;
  }

  function startFileImport() {
    if (fileImporting) return;
    fileQueue = fileRows
      .map((_, i) => i)
      .filter((i) => fileSel[i] && !(fileResults[i] && fileResults[i].ok));
    if (!fileQueue.length) return;
    fileImporting = true;
    renderFile();
    processNextFileImport();
  }

  // Import one row at a time (serialised) so concurrent create-missing-group
  // calls can't race on the same new group.
  function processNextFileImport() {
    if (!fileQueue.length) {
      fileImporting = false;
      renderFile();
      vscode.postMessage({ command: 'refresh' });
      const st = document.getElementById('file-status');
      if (st) {
        st.textContent = say('Import finished.', 'Import abgeschlossen.');
        st.className = 'status ok';
      }
      return;
    }
    const i = fileQueue[0];
    const r = fileRows[i];
    vscode.postMessage({
      command: 'importFileRow',
      data: {
        index: i,
        member: {
          email: r.email,
          given_name: r.given_name,
          family_name: r.family_name,
          course_role_id: fileRole[i] || assignableRoles[0],
          course_group_title: fileGroup[i],
        },
      },
    });
  }

  // ---- events -------------------------------------------------------------
  let searchTimer = null;

  function attachShellEvents() {
    app.querySelectorAll('.tab').forEach((b) => {
      b.addEventListener('click', () => showTab(b.getAttribute('data-tab')));
    });

    // Roster delegation.
    const rosterBody = document.getElementById('roster-body');
    if (rosterBody) {
      rosterBody.addEventListener('change', (e) => {
        const sel = e.target.closest('select.member-role');
        if (sel) {
          vscode.postMessage({
            command: 'changeRole',
            data: { memberId: sel.getAttribute('data-id'), roleId: sel.value },
          });
        }
      });
      rosterBody.addEventListener('click', (e) => {
        const btn = e.target.closest('button.remove-member');
        if (btn) {
          vscode.postMessage({
            command: 'removeMember',
            data: { memberId: btn.getAttribute('data-id'), name: btn.getAttribute('data-name') },
          });
        }
      });
    }

    if (!canManage) return;

    const search = document.getElementById('user-search');
    if (search) {
      search.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          userSearch = search.value.trim();
          userPage = 0;
          requestUsers();
        }, 300);
      });
    }
    const prev = document.getElementById('users-prev');
    if (prev) prev.addEventListener('click', () => {
      if (userPage > 0) {
        userPage -= 1;
        requestUsers();
      }
    });
    const next = document.getElementById('users-next');
    if (next) next.addEventListener('click', () => {
      if (userHasNext) {
        userPage += 1;
        requestUsers();
      }
    });

    const usersBody = document.getElementById('users-body');
    if (usersBody) {
      usersBody.addEventListener('change', (e) => {
        const sel = e.target.closest('select.row-role');
        if (sel) rowRole[sel.getAttribute('data-id')] = sel.value;
      });
      usersBody.addEventListener('click', (e) => {
        const btn = e.target.closest('button.add-user');
        if (btn) {
          const id = btn.getAttribute('data-id');
          btn.disabled = true;
          btn.textContent = say('Adding…', 'Wird hinzugefügt …');
          delete rowError[id];
          vscode.postMessage({
            command: 'addMember',
            data: { userId: id, roleId: rowRole[id] || assignableRoles[0] },
          });
        }
      });
    }

    const form = document.getElementById('email-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('email-input').value.trim();
        if (!email) return;
        const status = document.getElementById('email-status');
        if (status) {
          status.textContent = say('Adding…', 'Wird hinzugefügt …');
          status.className = 'status';
        }
        vscode.postMessage({
          command: 'importByEmail',
          data: {
            email,
            given_name: document.getElementById('email-given').value,
            family_name: document.getElementById('email-family').value,
            course_role_id: document.getElementById('email-role').value,
            course_group_title: document.getElementById('email-group').value,
          },
        });
      });
    }

    const filePick = document.getElementById('file-pick');
    if (filePick) {
      filePick.addEventListener('click', () => vscode.postMessage({ command: 'pickImportFile' }));
    }
    const fileSection = document.getElementById('tab-file');
    if (fileSection) {
      fileSection.addEventListener('change', (e) => {
        const cb = e.target.closest('input.file-sel');
        if (cb) {
          fileSel[Number(cb.getAttribute('data-i'))] = cb.checked;
          renderFile();
          return;
        }
        const role = e.target.closest('select.file-role');
        if (role) {
          fileRole[Number(role.getAttribute('data-i'))] = role.value;
          return;
        }
        const group = e.target.closest('input.file-group');
        if (group) fileGroup[Number(group.getAttribute('data-i'))] = group.value;
      });
      fileSection.addEventListener('input', (e) => {
        const group = e.target.closest('input.file-group');
        if (group) fileGroup[Number(group.getAttribute('data-i'))] = group.value;
      });
      fileSection.addEventListener('click', (e) => {
        if (e.target.closest('#file-import')) startFileImport();
      });
    }
  }

  // ---- inbound messages ---------------------------------------------------
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    switch (msg.command) {
      case 'membersUpdated':
        members = (msg.data && msg.data.members) || [];
        memberIds = new Set(members.map((m) => m.userId));
        renderRoster();
        renderUsers(); // drop any freshly-added members from the picker
        break;
      case 'usersResult': {
        const d = msg.data || {};
        // Ignore stale responses from an earlier query/page.
        if ((d.search || '') !== userSearch || d.page !== userPage) break;
        userList = d.users || [];
        userHasNext = !!d.hasNext;
        usersError = d.error || '';
        usersLoading = false;
        renderUsers();
        break;
      }
      case 'addResult': {
        const d = msg.data || {};
        if (d.ok) {
          addedUsers.add(d.userId);
          delete rowError[d.userId];
        } else {
          rowError[d.userId] = d.message || say('Failed to add', 'Hinzufügen fehlgeschlagen');
        }
        renderUsers();
        break;
      }
      case 'importResult': {
        const d = msg.data || {};
        const status = document.getElementById('email-status');
        if (status) {
          status.textContent = d.ok
            ? (d.workflowId ? say(`${d.message} (repository provisioning started)`, `${d.message} (Repository wird angelegt)`) : d.message)
            : d.message;
          status.className = 'status ' + (d.ok ? 'ok' : 'error');
        }
        if (d.ok) {
          ['email-input', 'email-given', 'email-family', 'email-group'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = '';
          });
        }
        break;
      }
      case 'parsedRows': {
        const d = msg.data || {};
        fileRows = d.rows || [];
        [fileSel, fileRole, fileGroup, fileResults].forEach((m) => {
          Object.keys(m).forEach((k) => delete m[k]);
        });
        fileRows.forEach((r, i) => {
          fileSel[i] = true;
          fileRole[i] =
            r.course_role_id && assignableRoles.indexOf(r.course_role_id) !== -1
              ? r.course_role_id
              : assignableRoles[0];
          fileGroup[i] = r.course_group_title || '';
        });
        const st = document.getElementById('file-status');
        if (st) {
          if (d.error) {
            st.textContent = d.error;
            st.className = 'status error';
          } else if (!fileRows.length) {
            st.textContent = say('No members with an email address were found in the file.', 'In der Datei wurden keine Mitglieder mit E-Mail-Adresse gefunden.');
            st.className = 'status';
          } else {
            st.textContent = say(`Parsed ${fileRows.length} member(s) from ${d.filename || 'the file'}.`, `${fileRows.length} Mitglied(er) aus ${d.filename || 'der Datei'} gelesen.`);
            st.className = 'status';
          }
        }
        renderFile();
        break;
      }
      case 'fileRowResult': {
        const d = msg.data || {};
        fileResults[d.index] = { ok: d.ok, message: d.message };
        fileQueue = fileQueue.filter((x) => x !== d.index);
        renderFile();
        processNextFileImport();
        break;
      }
      default:
        break;
    }
  });

  buildShell();
})();
