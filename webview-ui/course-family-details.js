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

    const { courseFamily, organization, coursesCount } = state;

    app.innerHTML = `
      <div class="view-header">
        <h1>${escapeHtml(courseFamily.title || courseFamily.path)}</h1>
      </div>

      <div class="card">
        <h2>Course Family Information</h2>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-item-label">ID</div>
            <div class="info-item-value">${escapeHtml(courseFamily.id)}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Path</div>
            <div class="info-item-value">${escapeHtml(courseFamily.path)}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Organization</div>
            <div class="info-item-value">${escapeHtml(organization.title || organization.path)}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Courses</div>
            <div class="info-item-value">${coursesCount ?? 0}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Edit Course Family</h2>
        <form id="editCourseFamilyForm">
          <div class="form-group">
            <label for="title">Title</label>
            <input type="text" id="title" name="title" class="vscode-input" value="${escapeHtml(courseFamily.title || '')}" required />
          </div>

          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" name="description" class="vscode-input" rows="4">${escapeHtml(courseFamily.description || '')}</textarea>
          </div>

          <div class="form-actions">
            <button type="submit" class="vscode-button vscode-button--primary">Save Changes</button>
          </div>
        </form>
      </div>
    `;

    // Attach event listeners
    const form = document.getElementById('editCourseFamilyForm');
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    sendMessage('updateCourseFamily', {
      familyId: state.courseFamily.id,
      updates: {
        title: formData.get('title'),
        description: formData.get('description')
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
