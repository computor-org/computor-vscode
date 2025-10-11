// Course Content Type Details Webview Script

(function () {
  const vscode = window.vscodeApi || acquireVsCodeApi();
  let state = window.__INITIAL_STATE__ || {};

  // Initialize the view
  function init() {
    renderView();
    attachEventListeners();
  }

  // Render the entire view
  function renderView() {
    const app = document.getElementById('app');
    if (!app) return;

    const { contentType, course, contentKind } = state;

    if (!contentType) {
      app.innerHTML = '<div class="loading">No content type data available</div>';
      return;
    }

    app.innerHTML = `
      <div class="view-header">
        <h1 class="view-title">${escapeHtml(contentType.title || contentType.slug)}</h1>
        <p class="view-subtitle">Content Type in ${escapeHtml(course?.title || course?.path || 'Unknown Course')}</p>
      </div>

      <div class="view-content">
        <div class="section">
          <h2 class="section-title">Information</h2>
          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">ID</div>
              <div class="info-value">${escapeHtml(contentType.id)}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Slug</div>
              <div class="info-value"><code>${escapeHtml(contentType.slug)}</code></div>
            </div>
            <div class="info-item">
              <div class="info-label">Content Kind</div>
              <div class="info-value">${escapeHtml(contentKind?.title || 'Unknown')}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Color</div>
              <div class="info-value">
                <div class="color-preview">
                  <span class="color-swatch" style="background-color: ${escapeHtml(contentType.color)}"></span>
                  <span>${escapeHtml(contentType.color)}</span>
                </div>
              </div>
            </div>
          </div>

          ${contentKind ? `
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">Submittable</div>
                <div class="info-value">
                  <span class="badge ${contentKind.submittable ? 'success' : 'info'}">
                    ${contentKind.submittable ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
              <div class="info-item">
                <div class="info-label">Can Have Children</div>
                <div class="info-value">
                  <span class="badge ${contentKind.has_descendants ? 'success' : 'info'}">
                    ${contentKind.has_descendants ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
              <div class="info-item">
                <div class="info-label">Can Have Parent</div>
                <div class="info-value">
                  <span class="badge ${contentKind.has_ascendants ? 'success' : 'info'}">
                    ${contentKind.has_ascendants ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="section">
          <h2 class="section-title">Edit Content Type</h2>
          <form id="editForm" class="form">
            <div class="form-group">
              <label for="title" class="form-label">Title</label>
              <input
                type="text"
                id="title"
                name="title"
                class="form-input"
                value="${escapeHtml(contentType.title || '')}"
                placeholder="e.g., Lecture, Assignment"
              />
            </div>

            <div class="form-group">
              <label for="slug" class="form-label">Slug (Identifier)</label>
              <input
                type="text"
                id="slug"
                name="slug"
                class="form-input"
                value="${escapeHtml(contentType.slug)}"
                pattern="[a-z0-9_-]+"
                required
              />
              <div class="form-hint">Only lowercase letters, numbers, underscores, and hyphens</div>
            </div>

            <div class="form-group">
              <label for="color" class="form-label">Color</label>
              <div class="color-input-group">
                <input
                  type="color"
                  id="colorPicker"
                  class="color-picker"
                  value="${normalizeColorForPicker(contentType.color)}"
                />
                <input
                  type="text"
                  id="color"
                  name="color"
                  class="form-input flex-1"
                  value="${escapeHtml(contentType.color)}"
                  placeholder="e.g., #FF5733, blue, rgb(255,87,51)"
                  required
                />
              </div>
              <div class="form-hint">Color name (e.g., red, blue) or hex code (#FF0000)</div>
            </div>

            <div class="form-group">
              <label for="description" class="form-label">Description (Optional)</label>
              <textarea
                id="description"
                name="description"
                class="form-textarea"
                placeholder="Describe this content type..."
              >${escapeHtml(contentType.description || '')}</textarea>
            </div>

            <div class="button-group">
              <button type="submit" class="button button-primary">Save Changes</button>
              <button type="button" class="button button-secondary" id="refreshBtn">Refresh</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // Attach event listeners
  function attachEventListeners() {
    // Form submission
    const form = document.getElementById('editForm');
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }

    // Color picker sync
    const colorPicker = document.getElementById('colorPicker');
    const colorInput = document.getElementById('color');

    if (colorPicker && colorInput) {
      colorPicker.addEventListener('input', (e) => {
        colorInput.value = e.target.value;
      });

      colorInput.addEventListener('input', (e) => {
        const normalized = normalizeColorForPicker(e.target.value);
        if (normalized) {
          colorPicker.value = normalized;
        }
      });
    }

    // Action buttons
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', handleRefresh);
    }
  }

  // Handle form submission
  function handleFormSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const updates = {
      title: formData.get('title'),
      slug: formData.get('slug'),
      color: formData.get('color'),
      description: formData.get('description')
    };

    vscode.postMessage({
      command: 'updateContentType',
      data: {
        typeId: state.contentType.id,
        updates
      }
    });
  }

  // Handle refresh
  function handleRefresh() {
    vscode.postMessage({
      command: 'refresh',
      data: { typeId: state.contentType.id }
    });
  }

  // Listen for messages from extension
  window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.command) {
      case 'updateState':
        state = message.data;
        renderView();
        attachEventListeners();
        break;
    }
  });

  // Utility: Escape HTML
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Utility: Normalize color for picker
  function normalizeColorForPicker(color) {
    if (!color) return '#000000';
    if (color.startsWith('#')) return color;

    const colorMap = {
      'red': '#FF0000',
      'green': '#00FF00',
      'blue': '#0000FF',
      'yellow': '#FFFF00',
      'orange': '#FFA500',
      'purple': '#800080',
      'pink': '#FFC0CB',
      'brown': '#A52A2A',
      'black': '#000000',
      'white': '#FFFFFF',
      'gray': '#808080',
      'grey': '#808080'
    };

    return colorMap[color.toLowerCase()] || '#000000';
  }

  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
