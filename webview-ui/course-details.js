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

    const { course, courseFamily, organization } = state;
    const gitlabUrl = course.properties?.gitlab?.url || '';

    app.innerHTML = `
      <div class="view-header">
        <h1>${escapeHtml(course.title || course.path)}</h1>
      </div>

      <div class="card">
        <h2>Course Information</h2>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-item-label">ID</div>
            <div class="info-item-value">${escapeHtml(course.id)}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Path</div>
            <div class="info-item-value">${escapeHtml(course.path)}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Course Family</div>
            <div class="info-item-value">${escapeHtml(courseFamily.title || courseFamily.path)}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Organization</div>
            <div class="info-item-value">${escapeHtml(organization.title || organization.path)}</div>
          </div>
          ${gitlabUrl ? `
          <div class="info-item">
            <div class="info-item-label">GitLab Repository</div>
            <div class="info-item-value"><a href="${escapeHtml(gitlabUrl)}">${escapeHtml(gitlabUrl)}</a></div>
          </div>
          ` : ''}
        </div>
      </div>

      <div class="card">
        <h2>Edit Course</h2>
        <form id="editCourseForm">
          <div class="form-group">
            <label for="title">Title</label>
            <input type="text" id="title" name="title" class="vscode-input" value="${escapeHtml(course.title || '')}" />
          </div>

          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" name="description" class="vscode-input" rows="4">${escapeHtml(course.description || '')}</textarea>
          </div>

          <div class="form-group">
            <label for="gitlabUrl">GitLab Repository URL</label>
            <input type="url" id="gitlabUrl" name="gitlabUrl" class="vscode-input" value="${escapeHtml(gitlabUrl)}" />
          </div>

          <div class="form-actions">
            <button type="submit" class="vscode-button vscode-button--primary">Save Changes</button>
          </div>
        </form>
      </div>
    `;

    // Attach event listeners
    const form = document.getElementById('editCourseForm');
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const gitlabUrl = formData.get('gitlabUrl');
    sendMessage('updateCourse', {
      courseId: state.course.id,
      updates: {
        title: formData.get('title'),
        description: formData.get('description'),
        properties: {
          gitlab: gitlabUrl ? { url: gitlabUrl } : null
        }
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
