(function () {
  'use strict';

  const vscode = window.vscodeApi || acquireVsCodeApi();
  const state = window.__INITIAL_STATE__ || {};

  const roleLabels = state.roleLabels || {};
  const assignableRoles = state.assignableRoles || [];
  const canManage = !!state.canManage;
  const usersPageSize = state.usersPageSize || 10;

  let members = state.members || [];

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

  const app = document.getElementById('app');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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

  // ---- shell (built once) -------------------------------------------------
  function buildShell() {
    const addSection = canManage
      ? `
      <section class="add">
        <div class="add-grid">
          <div class="pane users-pane">
            <h2>Add from the user list</h2>
            <p class="hint">You can only see users your permissions allow. Pick a role and add them.</p>
            <input id="user-search" type="text" placeholder="Search by name or email…" autocomplete="off" />
            <div id="users-status" class="status"></div>
            <table class="grid">
              <thead><tr><th>User</th><th>Role</th><th></th></tr></thead>
              <tbody id="users-body"></tbody>
            </table>
            <div class="pager">
              <span id="users-page-label" class="muted"></span>
              <span>
                <button id="users-prev" class="secondary">Previous</button>
                <button id="users-next" class="secondary">Next</button>
              </span>
            </div>
          </div>
          <div class="pane email-pane">
            <h2>By email</h2>
            <p class="hint">Adds the user with this email, creating the account if it does not exist yet.</p>
            <form id="email-form">
              <label>Email *<input id="email-input" type="email" placeholder="person@example.org" required /></label>
              <label>Given name<input id="email-given" type="text" /></label>
              <label>Family name<input id="email-family" type="text" /></label>
              <label>Role *<select id="email-role">${roleOptions(assignableRoles[0])}</select></label>
              <label>Group<input id="email-group" type="text" placeholder="Optional — created if missing" /></label>
              <button id="email-submit" type="submit" class="primary">Add by email</button>
            </form>
            <div id="email-status" class="status"></div>
          </div>
        </div>
      </section>`
      : `<div class="notice">You have read-only access to this roster. A lecturer role (or higher) on this course is required to add or change members.</div>`;

    app.innerHTML = `
      <header>
        <h1>Members</h1>
        <div class="muted">${esc(state.courseName || 'Course')}</div>
      </header>
      <section class="roster">
        <h2>Roster (<span id="member-count">${members.length}</span>)</h2>
        <table class="grid">
          <thead><tr><th>Member</th><th>Role</th><th>Group</th><th></th></tr></thead>
          <tbody id="roster-body"></tbody>
        </table>
      </section>
      ${addSection}`;

    attachShellEvents();
    renderRoster();
    if (canManage) requestUsers();
  }

  // ---- roster -------------------------------------------------------------
  function renderRoster() {
    const body = document.getElementById('roster-body');
    if (!body) return;
    const count = document.getElementById('member-count');
    if (count) count.textContent = String(members.length);

    if (!members.length) {
      body.innerHTML = `<tr><td colspan="4" class="empty">No members yet.</td></tr>`;
      return;
    }
    body.innerHTML = members
      .map((m) => {
        const roleCell = m.manageable
          ? `<select class="member-role" data-id="${esc(m.id)}">${roleOptions(m.roleId)}</select>`
          : `<span class="badge">${esc(roleLabel(m.roleId))}</span>`;
        const actionCell = m.manageable
          ? `<button class="link-danger remove-member" data-id="${esc(m.id)}" data-name="${esc(m.name)}">Remove</button>`
          : '';
        return `<tr>
          <td>
            <div class="strong">${esc(m.name)}${m.isSelf ? ' <span class="muted">(you)</span>' : ''}</div>
            <div class="muted">${esc(m.email || '—')}</div>
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
    if (status) status.textContent = usersError ? usersError : '';
    if (status) status.className = 'status' + (usersError ? ' error' : '');

    if (usersLoading) {
      body.innerHTML = `<tr><td colspan="3" class="empty">Loading users…</td></tr>`;
    } else if (!userList.length) {
      body.innerHTML = `<tr><td colspan="3" class="empty">No users found.</td></tr>`;
    } else {
      body.innerHTML = userList
        .map((u) => {
          const isAdded = addedUsers.has(u.id);
          const err = rowError[u.id];
          const action = isAdded
            ? `<span class="ok">Added ✓</span>`
            : `<button class="primary add-user" data-id="${esc(u.id)}">Add</button>`;
          return `<tr>
            <td>
              <div class="strong">${esc(u.name)}</div>
              <div class="muted">${esc(u.email || '—')}</div>
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
    if (label) label.textContent = `Page ${userPage + 1}`;
    const prev = document.getElementById('users-prev');
    const next = document.getElementById('users-next');
    if (prev) prev.disabled = userPage === 0 || usersLoading;
    if (next) next.disabled = !userHasNext || usersLoading;
  }

  // ---- events -------------------------------------------------------------
  let searchTimer = null;

  function attachShellEvents() {
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
          btn.textContent = 'Adding…';
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
          status.textContent = 'Adding…';
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
  }

  // ---- inbound messages ---------------------------------------------------
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    switch (msg.command) {
      case 'membersUpdated':
        members = (msg.data && msg.data.members) || [];
        renderRoster();
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
          rowError[d.userId] = d.message || 'Failed to add';
        }
        renderUsers();
        break;
      }
      case 'importResult': {
        const d = msg.data || {};
        const status = document.getElementById('email-status');
        if (status) {
          status.textContent = d.ok
            ? (d.workflowId ? `${d.message} (repository provisioning started)` : d.message)
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
      default:
        break;
    }
  });

  buildShell();
})();
