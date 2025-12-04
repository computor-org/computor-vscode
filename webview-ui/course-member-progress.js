/**
 * Course Member Progress Webview
 * Displays individual student progress visualization
 */

(function() {
  'use strict';

  const vscode = window.vscodeApi || acquireVsCodeApi();
  const state = window.__INITIAL_STATE__ || { memberGradings: null };

  let donutChart = null;

  function init() {
    render();
    setupMessageHandler();
  }

  function setupMessageHandler() {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'updateData':
          if (message.data?.memberGradings) {
            state.memberGradings = message.data.memberGradings;
            render();
          }
          break;
        case 'setLoading':
          setLoading(message.data?.loading);
          break;
        case 'update':
          if (message.data) {
            Object.assign(state, message.data);
            render();
          }
          break;
      }
    });
  }

  function render() {
    const app = document.getElementById('app');
    if (!app) return;

    const gradings = state.memberGradings;

    if (!gradings) {
      app.innerHTML = renderEmptyState('No Data', 'Student progress data not available.');
      return;
    }

    app.innerHTML = `
      <div class="course-member-progress">
        ${renderHeader(gradings, state.fallbackName)}
        ${renderOverallProgress(gradings)}
        ${renderChartsRow(gradings)}
        ${renderContentTree(gradings)}
        <div class="loading-overlay loading-overlay--hidden" id="loadingOverlay">
          <div class="loading-spinner"></div>
        </div>
      </div>
    `;

    initDonutChart(gradings);
  }

  function renderHeader(gradings, fallbackName) {
    const displayName = getStudentDisplayName(gradings, fallbackName);
    const lastActive = gradings.latest_submission_at
      ? ComputorCharts.formatRelativeDate(gradings.latest_submission_at)
      : 'Never';

    return `
      <header class="member-progress-header">
        <div class="member-progress-header__info">
          <h1 class="member-progress-header__title">${escapeHtml(displayName)}</h1>
          ${gradings.username ? `<p class="member-progress-header__username">@${escapeHtml(gradings.username)}</p>` : ''}
          <p class="member-progress-header__subtitle">Last active: ${escapeHtml(lastActive)}</p>
        </div>
        <div class="member-progress-header__actions">
          <button class="vscode-button vscode-button--secondary vscode-button--sm" onclick="handleRefresh()">
            Refresh
          </button>
        </div>
      </header>
    `;
  }

  function renderOverallProgress(gradings) {
    const percentage = gradings.overall_progress_percentage || 0;
    const submitted = gradings.total_submitted_assignments || 0;
    const total = gradings.total_max_assignments || 0;

    return `
      <div class="overall-progress-card">
        <div class="overall-progress-card__header">
          <h2 class="overall-progress-card__title">Overall Progress</h2>
          <div class="overall-progress-card__percentage">${percentage}%</div>
        </div>
        <div class="overall-progress-card__bar">
          <div class="overall-progress-card__fill" style="width: ${percentage}%;"></div>
        </div>
        <div class="overall-progress-card__stats">
          <div class="overall-progress-card__stat">
            <span>Submitted:</span>
            <span class="overall-progress-card__stat-value">${submitted} / ${total}</span>
          </div>
          <div class="overall-progress-card__stat">
            <span>Remaining:</span>
            <span class="overall-progress-card__stat-value">${total - submitted}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderChartsRow(gradings) {
    const contentTypes = gradings.by_content_type || [];

    return `
      <div class="member-charts-row">
        <div class="chart-card">
          <h3 class="chart-card__title">Completion by Type</h3>
          <div class="chart-card__canvas">
            <canvas id="donutChart"></canvas>
          </div>
        </div>
        <div class="chart-card">
          <h3 class="chart-card__title">Content Type Breakdown</h3>
          <div class="content-type-breakdown">
            ${renderContentTypeBreakdown(contentTypes)}
          </div>
        </div>
      </div>
    `;
  }

  function renderContentTypeBreakdown(contentTypes) {
    if (!contentTypes || contentTypes.length === 0) {
      return '<p style="color: var(--vscode-descriptionForeground); font-size: 13px;">No content types available.</p>';
    }

    return contentTypes.map(ct => {
      const color = ct.course_content_type_color || ComputorCharts.ThemeColors.primary;
      const label = ct.course_content_type_title || ct.course_content_type_slug;
      const percentage = ct.progress_percentage || 0;
      const submitted = ct.submitted_assignments || 0;
      const total = ct.max_assignments || 0;

      return `
        <div class="content-type-item">
          <div class="content-type-item__header">
            <span class="content-type-item__label">
              <span class="content-type-item__dot" style="background-color: ${color}"></span>
              ${escapeHtml(label)}
            </span>
            <span class="content-type-item__stats">${submitted} / ${total} (${percentage}%)</span>
          </div>
          <div class="content-type-item__bar">
            <div class="content-type-item__fill" style="width: ${percentage}%;"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderContentTree(gradings) {
    const nodes = gradings.nodes || [];

    if (nodes.length === 0) {
      return '';
    }

    // Build color map from by_content_type (which has the correct colors)
    const colorMap = new Map();
    (gradings.by_content_type || []).forEach(ct => {
      if (ct.course_content_type_color) {
        colorMap.set(ct.course_content_type_id, ct.course_content_type_color);
        colorMap.set(ct.course_content_type_slug, ct.course_content_type_color);
      }
    });

    // Build hierarchy from flat nodes
    const tree = buildTreeFromNodes(nodes);

    return `
      <section class="content-tree-section">
        <div class="content-tree-section__header">
          <h2 class="content-tree-section__title">Course Content Progress</h2>
        </div>
        <div class="content-tree">
          ${renderTreeNodes(tree, 0, colorMap)}
        </div>
      </section>
    `;
  }

  function buildTreeFromNodes(nodes) {
    // Group nodes by path depth
    const nodeMap = new Map();
    const roots = [];

    // Sort by path first to ensure parents come before children
    const sorted = [...nodes].sort((a, b) => a.path.localeCompare(b.path));

    sorted.forEach(node => {
      const pathParts = node.path.split('.');
      const depth = pathParts.length - 1;
      const parentPath = pathParts.slice(0, -1).join('.');

      const treeNode = {
        ...node,
        depth,
        children: [],
        expanded: depth < 2 // Auto-expand first two levels
      };

      nodeMap.set(node.path, treeNode);

      if (parentPath && nodeMap.has(parentPath)) {
        nodeMap.get(parentPath).children.push(treeNode);
      } else if (depth === 0) {
        roots.push(treeNode);
      } else {
        // Parent not found, treat as root
        roots.push(treeNode);
      }
    });

    // Sort all children arrays by position
    function sortByPosition(nodeList) {
      nodeList.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      nodeList.forEach(n => {
        if (n.children && n.children.length > 0) {
          sortByPosition(n.children);
        }
      });
    }

    sortByPosition(roots);
    return roots;
  }

  function renderTreeNodes(nodes, depth, colorMap) {
    return nodes.map((node, index) => {
      const hasChildren = node.children && node.children.length > 0;
      // Look up color from colorMap using type ID or slug, fallback to node's color, then default
      const color = colorMap.get(node.course_content_type_id)
        || colorMap.get(node.course_content_type_slug)
        || node.course_content_type_color
        || ComputorCharts.ThemeColors.primary;
      const percentage = node.progress_percentage || 0;
      const nodeId = `node-${node.path.replace(/\./g, '-')}`;
      const isSubmittable = node.is_submittable === true;
      const isSubmitted = node.submitted_assignments > 0;

      // Assignments (submittable): show status badge only, no progress bar
      // Units (not submittable): show progress bar with percentage
      const progressHtml = isSubmittable
        ? `<span class="content-tree-node__status" style="background-color: ${color}20; color: ${color}; border: 1px solid ${color}40;">
             ${isSubmitted ? 'Submitted' : 'Pending'}
           </span>`
        : `<div class="content-tree-node__progress">
             <div class="content-tree-node__bar">
               <div class="content-tree-node__fill" style="width: ${percentage}%;"></div>
             </div>
             <span class="content-tree-node__percentage">${percentage}%</span>
           </div>`;

      // Icon styling: filled for submitted/completed, outline for pending
      const iconStyle = isSubmittable
        ? (isSubmitted
            ? `background-color: ${color};`
            : `background-color: transparent; border: 2px solid ${color};`)
        : `background-color: ${color};`;

      return `
        <div class="content-tree-node" id="${nodeId}">
          <div class="content-tree-node__row content-tree-node__row--depth-${Math.min(depth, 3)}">
            <span class="content-tree-node__toggle ${hasChildren ? '' : 'content-tree-node__toggle--empty'}"
                  onclick="toggleNode('${nodeId}')">${hasChildren ? (node.expanded !== false ? '▼' : '▶') : ''}</span>
            <span class="content-tree-node__icon" style="${iconStyle}"></span>
            <span class="content-tree-node__title">${escapeHtml(node.title || node.path)}</span>
            ${progressHtml}
          </div>
          ${hasChildren ? `
            <div class="content-tree-node__children ${node.expanded !== false ? '' : 'content-tree-node__children--collapsed'}"
                 id="${nodeId}-children">
              ${renderTreeNodes(node.children, depth + 1, colorMap)}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function initDonutChart(gradings) {
    const contentTypes = gradings.by_content_type || [];

    if (contentTypes.length === 0) return;

    const labels = contentTypes.map(ct => ct.course_content_type_title || ct.course_content_type_slug);
    const values = contentTypes.map(ct => ct.submitted_assignments || 0);
    const colors = contentTypes.map(ct => ct.course_content_type_color || ComputorCharts.DEFAULT_PALETTE[0]);

    donutChart = ComputorCharts.createDonutChart('donutChart', {
      labels,
      values,
      colors
    }, {
      cutout: '65%',
      legendPosition: 'bottom'
    });
  }

  function renderEmptyState(title, description) {
    return `
      <div class="empty-state">
        <div class="empty-state__icon">📈</div>
        <div class="empty-state__title">${escapeHtml(title)}</div>
        <div class="empty-state__description">${escapeHtml(description)}</div>
      </div>
    `;
  }

  function getStudentDisplayName(gradings, fallbackName) {
    const parts = [gradings.given_name, gradings.family_name].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' ');
    }
    return fallbackName || gradings.username || 'Unknown Student';
  }

  function setLoading(loading) {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.classList.toggle('loading-overlay--hidden', !loading);
    }
  }

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  // Global handlers
  window.handleRefresh = function() {
    vscode.postMessage({ command: 'refresh' });
  };

  window.toggleNode = function(nodeId) {
    const childrenEl = document.getElementById(nodeId + '-children');
    const toggleEl = document.querySelector(`#${nodeId} .content-tree-node__toggle`);

    if (childrenEl && toggleEl) {
      const isCollapsed = childrenEl.classList.contains('content-tree-node__children--collapsed');
      childrenEl.classList.toggle('content-tree-node__children--collapsed');
      toggleEl.textContent = isCollapsed ? '▼' : '▶';
    }
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
