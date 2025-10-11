// Generic Content Details Webview Script

(function () {
  const vscode = acquireVsCodeApi();
  let state = window.__INITIAL_STATE__ || {};

  function init() {
    renderView();
    attachEventListeners();
  }

  function renderView() {
    const app = document.getElementById('app');
    if (!app) return;

    const { courseContent, course, contentType } = state;

    if (!courseContent) {
      app.innerHTML = '<div class="loading">No content data available</div>';
      return;
    }

    app.innerHTML = `
      <div class="view-header">
        <h1 class="view-title">${escapeHtml(courseContent.title || courseContent.path)}</h1>
        <p class="view-subtitle">Content in ${escapeHtml(course?.title || 'Unknown Course')}</p>
      </div>

      <div class="view-content">
        <div class="section">
          <h2 class="section-title">Content Information</h2>
          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">ID</div>
              <div class="info-value">${escapeHtml(courseContent.id)}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Path</div>
              <div class="info-value"><code>${escapeHtml(courseContent.path)}</code></div>
            </div>
            <div class="info-item">
              <div class="info-label">Type</div>
              <div class="info-value">${escapeHtml(contentType?.title || 'Unknown')}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Position</div>
              <div class="info-value">${courseContent.position}</div>
            </div>
          </div>
        </div>

        <div class="section">
          <h2 class="section-title">Edit Content</h2>
          <form id="editForm" class="form">
            <div class="form-group">
              <label for="title" class="form-label">Title</label>
              <input type="text" id="title" name="title" class="form-input" value="${escapeHtml(courseContent.title || '')}" required />
            </div>
            <div class="form-group">
              <label for="description" class="form-label">Description</label>
              <textarea id="description" name="description" class="form-textarea">${escapeHtml(courseContent.description || '')}</textarea>
            </div>
            <div class="button-group">
              <button type="submit" class="button button-primary">Save Changes</button>
              <button type="button" class="button button-secondary" id="refreshBtn">Refresh</button>
            </div>
          </form>
        </div>

        <div class="section actions-section">
          <h2 class="section-title">Actions</h2>
          <div class="button-group">
            <button class="button button-danger" id="deleteBtn">Delete Content</button>
          </div>
        </div>
      </div>
    `;
  }

  function attachEventListeners() {
    const form = document.getElementById('editForm');
    if (form) form.addEventListener('submit', handleFormSubmit);

    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', handleRefresh);

    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) deleteBtn.addEventListener('click', handleDelete);
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    vscode.postMessage({
      command: 'updateContent',
      data: {
        courseId: state.course.id,
        contentId: state.courseContent.id,
        updates: {
          title: formData.get('title'),
          description: formData.get('description')
        }
      }
    });
  }

  function handleRefresh() {
    vscode.postMessage({ command: 'refresh', data: { courseId: state.course.id, contentId: state.courseContent.id } });
  }

  function handleDelete() {
    const confirmed = confirm(`Delete "${state.courseContent.title || state.courseContent.path}"?`);
    if (confirmed) {
      vscode.postMessage({ command: 'deleteContent', data: { courseId: state.course.id, contentId: state.courseContent.id } });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.data.command === 'updateState') {
      state = event.data.data;
      renderView();
      attachEventListeners();
    }
  });

  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
