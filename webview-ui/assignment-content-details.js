// Assignment Content Details Webview Script

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

    const { courseContent, course, contentType, exampleInfo, isSubmittable } = state;

    if (!courseContent) {
      app.innerHTML = '<div class="loading">No assignment data available</div>';
      return;
    }

    const hasExample = courseContent.has_deployment;
    const deploymentStatus = courseContent.deployment_status || 'not_deployed';

    app.innerHTML = `
      <div class="view-header">
        <h1 class="view-title">${escapeHtml(courseContent.title || courseContent.path)}</h1>
        <p class="view-subtitle">Assignment in ${escapeHtml(course?.title || 'Unknown Course')}</p>
      </div>

      <div class="view-content">
        <div class="section">
          <h2 class="section-title">Assignment Information</h2>
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

          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">Max Group Size</div>
              <div class="info-value">${courseContent.max_group_size || 'N/A'}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Max Test Runs</div>
              <div class="info-value">${courseContent.max_test_runs || 'Unlimited'}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Max Submissions</div>
              <div class="info-value">${courseContent.max_submissions || 'Unlimited'}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Submittable</div>
              <div class="info-value">
                <span class="badge ${isSubmittable ? 'success' : 'info'}">
                  ${isSubmittable ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
          </div>
        </div>

        ${hasExample ? `
          <div class="section">
            <h2 class="section-title">Deployment Status</h2>
            <div class="info-item">
              <div class="info-label">Status</div>
              <div class="info-value">
                <span class="badge ${deploymentStatus === 'deployed' ? 'success' : 'info'}">
                  ${deploymentStatus}
                </span>
              </div>
            </div>
            ${exampleInfo ? `
              <div class="info-item">
                <div class="info-label">Example</div>
                <div class="info-value">${escapeHtml(exampleInfo.title || 'Unknown')}</div>
              </div>
            ` : ''}
            <div class="button-group">
              <button class="button button-secondary" id="viewSubmissionsBtn">View Submissions</button>
              <button class="button button-secondary" id="openGitLabBtn">Open GitLab</button>
              <button class="button button-secondary" id="unassignExampleBtn">Unassign Example</button>
            </div>
          </div>
        ` : `
          <div class="section">
            <h2 class="section-title">No Example Assigned</h2>
            <p>This assignment does not have an example assigned yet.</p>
            <button class="button button-primary" id="assignExampleBtn">Assign Example</button>
          </div>
        `}

        <div class="section">
          <h2 class="section-title">Edit Assignment</h2>
          <form id="editForm" class="form">
            <div class="form-group">
              <label for="title" class="form-label">Title</label>
              <input
                type="text"
                id="title"
                name="title"
                class="form-input"
                value="${escapeHtml(courseContent.title || '')}"
                required
              />
            </div>

            <div class="form-group">
              <label for="description" class="form-label">Description</label>
              <textarea
                id="description"
                name="description"
                class="form-textarea"
                placeholder="Describe this assignment..."
              >${escapeHtml(courseContent.description || '')}</textarea>
            </div>

            <div class="form-group">
              <label for="maxGroupSize" class="form-label">Max Group Size</label>
              <input
                type="number"
                id="maxGroupSize"
                name="maxGroupSize"
                class="form-input"
                min="1"
                value="${courseContent.max_group_size || ''}"
                placeholder="Leave empty for individual work"
              />
            </div>

            <div class="form-group">
              <label for="maxTestRuns" class="form-label">Max Test Runs</label>
              <input
                type="number"
                id="maxTestRuns"
                name="maxTestRuns"
                class="form-input"
                min="0"
                value="${courseContent.max_test_runs || ''}"
                placeholder="Leave empty for unlimited"
              />
            </div>

            <div class="form-group">
              <label for="maxSubmissions" class="form-label">Max Submissions</label>
              <input
                type="number"
                id="maxSubmissions"
                name="maxSubmissions"
                class="form-input"
                min="0"
                value="${courseContent.max_submissions || ''}"
                placeholder="Leave empty for unlimited"
              />
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
            ${hasExample && deploymentStatus !== 'deployed' ? `
              <button class="button button-primary" id="deployBtn">Deploy to Students</button>
            ` : ''}
            <button class="button button-secondary" id="createChildBtn">Create Child Content</button>
            <button class="button button-danger" id="deleteBtn">Delete Assignment</button>
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

    const assignExampleBtn = document.getElementById('assignExampleBtn');
    if (assignExampleBtn) assignExampleBtn.addEventListener('click', handleAssignExample);

    const unassignExampleBtn = document.getElementById('unassignExampleBtn');
    if (unassignExampleBtn) unassignExampleBtn.addEventListener('click', handleUnassignExample);

    const viewSubmissionsBtn = document.getElementById('viewSubmissionsBtn');
    if (viewSubmissionsBtn) viewSubmissionsBtn.addEventListener('click', handleViewSubmissions);

    const openGitLabBtn = document.getElementById('openGitLabBtn');
    if (openGitLabBtn) openGitLabBtn.addEventListener('click', handleOpenGitLab);

    const deployBtn = document.getElementById('deployBtn');
    if (deployBtn) deployBtn.addEventListener('click', handleDeploy);

    const createChildBtn = document.getElementById('createChildBtn');
    if (createChildBtn) createChildBtn.addEventListener('click', handleCreateChild);

    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) deleteBtn.addEventListener('click', handleDelete);
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);

    const updates = {
      title: formData.get('title'),
      description: formData.get('description')
    };

    const maxGroupSize = formData.get('maxGroupSize');
    if (maxGroupSize) updates.max_group_size = parseInt(maxGroupSize);

    const maxTestRuns = formData.get('maxTestRuns');
    if (maxTestRuns) updates.max_test_runs = parseInt(maxTestRuns);

    const maxSubmissions = formData.get('maxSubmissions');
    if (maxSubmissions) updates.max_submissions = parseInt(maxSubmissions);

    vscode.postMessage({
      command: 'updateContent',
      data: {
        courseId: state.course.id,
        contentId: state.courseContent.id,
        updates
      }
    });
  }

  function handleRefresh() {
    vscode.postMessage({
      command: 'refresh',
      data: {
        courseId: state.course.id,
        contentId: state.courseContent.id
      }
    });
  }

  function handleAssignExample() {
    vscode.postMessage({
      command: 'assignExample',
      data: {
        courseId: state.course.id,
        contentId: state.courseContent.id
      }
    });
  }

  function handleUnassignExample() {
    const confirmed = confirm('Are you sure you want to unassign the example from this assignment?');
    if (confirmed) {
      vscode.postMessage({
        command: 'unassignExample',
        data: {
          courseId: state.course.id,
          contentId: state.courseContent.id
        }
      });
    }
  }

  function handleViewSubmissions() {
    vscode.postMessage({
      command: 'viewSubmissions',
      data: {
        courseId: state.course.id,
        contentId: state.courseContent.id
      }
    });
  }

  function handleOpenGitLab() {
    vscode.postMessage({
      command: 'openGitLabRepo',
      data: {
        courseId: state.course.id,
        contentId: state.courseContent.id
      }
    });
  }

  function handleDeploy() {
    const confirmed = confirm('Deploy this assignment to students?');
    if (confirmed) {
      vscode.postMessage({
        command: 'deployAssignment',
        data: {
          courseId: state.course.id,
          contentId: state.courseContent.id
        }
      });
    }
  }

  function handleCreateChild() {
    vscode.postMessage({
      command: 'createChild',
      data: {
        courseId: state.course.id,
        parentContent: state.courseContent
      }
    });
  }

  function handleDelete() {
    const confirmed = confirm(`Are you sure you want to delete "${state.courseContent.title || state.courseContent.path}"? This action cannot be undone.`);
    if (confirmed) {
      vscode.postMessage({
        command: 'deleteContent',
        data: {
          courseId: state.course.id,
          contentId: state.courseContent.id
        }
      });
    }
  }

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
