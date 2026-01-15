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
        case 'copySuccess':
          showCopyFeedback(message.data?.btnId);
          break;
      }
    });
  }

  function showCopyFeedback(btnId) {
    const btn = btnId ? document.getElementById(btnId) : null;
    if (btn) {
      btn.innerHTML = CHECK_ICON;
      btn.classList.add('copyable-id__btn--copied');
      setTimeout(() => {
        btn.innerHTML = COPY_ICON;
        btn.classList.remove('copyable-id__btn--copied');
      }, 1500);
    }
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
    attachCopyButtonListeners();
  }

  function attachCopyButtonListeners() {
    document.querySelectorAll('.copyable-id__btn[data-copy-value]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const value = this.getAttribute('data-copy-value');
        const btnId = this.id;
        if (value) {
          vscode.postMessage({ command: 'copyToClipboard', data: { text: value, btnId } });
        }
      });
    });
  }

  function renderHeader(gradings, fallbackName) {
    const displayName = getStudentDisplayName(gradings, fallbackName);
    const lastActive = gradings.latest_submission_at
      ? ComputorCharts.formatRelativeDate(gradings.latest_submission_at)
      : 'Never';
    const studentId = gradings.student_id;

    return `
      <header class="member-progress-header">
        <div class="member-progress-header__info">
          <h1 class="member-progress-header__title">${escapeHtml(displayName)}</h1>
          <div class="member-progress-header__meta">
            ${studentId ? renderCopyableId(studentId, 'Matr.') : ''}
            <span class="member-progress-header__last-active">Last active: ${escapeHtml(lastActive)}</span>
          </div>
        </div>
      </header>
    `;
  }

  function renderOverallProgress(gradings) {
    const total = toNonNegativeInt(gradings.total_max_assignments);
    const submitted = toNonNegativeInt(gradings.total_submitted_assignments);
    const remaining = Math.max(total - submitted, 0);

    const percentageRaw = gradings.overall_progress_percentage;
    const computedPercentage = total > 0 ? (submitted / total) * 100 : 0;
    const percentage = clamp(
      (typeof percentageRaw === 'number' && Number.isFinite(percentageRaw)) ? percentageRaw : computedPercentage,
      0,
      100
    );
    const percentageRounded = Math.round(percentage);

    const avgGrading = gradings.overall_average_grading;
    const avgGradingDisplay = formatGrade(avgGrading);
    const avgGradingPercentage = clamp(
      (typeof avgGrading === 'number' && Number.isFinite(avgGrading)) ? avgGrading * 100 : 0,
      0,
      100
    );
    const avgGradingRounded = Math.round(avgGradingPercentage);

    return `
      <div class="overall-progress-card">
        <div class="overall-progress-card__header">
          <h2 class="overall-progress-card__title">Grade</h2>
          <div class="overall-progress-card__percentage">${avgGradingDisplay}</div>
        </div>
        <div class="overall-progress-card__bar">
          <div class="overall-progress-card__fill" style="width: ${avgGradingRounded}%; background-color: var(--vscode-debugIcon-continueForeground);"></div>
        </div>

        <div class="overall-progress-card__header" style="margin-top: 16px;">
          <h2 class="overall-progress-card__title">Overall Progress</h2>
          <div class="overall-progress-card__percentage">${percentageRounded}%</div>
        </div>
        <div class="overall-progress-card__bar">
          <div class="overall-progress-card__fill" style="width: ${percentageRounded}%;"></div>
        </div>
        <div class="overall-progress-card__stats">
          <div class="overall-progress-card__stat">
            <span>Submitted:</span>
            <span class="overall-progress-card__stat-value">${submitted} / ${total}</span>
          </div>
          <div class="overall-progress-card__stat">
            <span>Remaining:</span>
            <span class="overall-progress-card__stat-value">${remaining}</span>
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
          <h3 class="chart-card__title">Submissions by Type</h3>
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
      const avgGrading = ct.average_grading;
      const avgGradingDisplay = formatGrade(avgGrading);

      return `
        <div class="content-type-item">
          <div class="content-type-item__header">
            <span class="content-type-item__label">
              <span class="content-type-item__dot" style="background-color: ${color}"></span>
              ${escapeHtml(label)}
            </span>
            <span class="content-type-item__stats">${submitted} / ${total} (${percentage}%) | Grade: ${avgGradingDisplay}</span>
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
          <div class="content-tree-header">
            <span class="content-tree-header__spacer"></span>
            <div class="content-tree-header__columns">
              <span class="content-tree-header__column content-tree-header__column--tests" title="Test attempts / max allowed tests">Tests</span>
              <span class="content-tree-header__column content-tree-header__column--subs" title="Submission count / max allowed submissions">Subs</span>
              <span class="content-tree-header__column content-tree-header__column--correction" title="Correction status">●</span>
              <span class="content-tree-header__column content-tree-header__column--progress" title="Submission progress (units only)">Progress</span>
              <span class="content-tree-header__column content-tree-header__column--grade" title="Tutor-assigned grade (assignments) or average grade (units)">Grade</span>
              <span class="content-tree-header__column content-tree-header__column--result" title="Latest test result">Result</span>
              <span class="content-tree-header__column content-tree-header__column--status" title="Submission status (assignments) or completion percentage (units)">Status</span>
            </div>
          </div>
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
      const isSubmittable = node.submittable === true;
      const isSubmitted = node.submitted_assignments > 0;

      // Get grading display: for assignments use grading, for units use average_grading
      const gradingValue = isSubmittable ? node.grading : node.average_grading;
      const hasGrading = typeof gradingValue === 'number';
      const gradingDisplay = hasGrading ? `${Math.round(gradingValue * 100)}%` : '-';
      const gradingClass = hasGrading ? '' : 'content-tree-node__grading--empty';

      // Get latest test result display
      const resultValue = node.latest_result_grade;
      const hasResult = typeof resultValue === 'number';
      const resultDisplay = hasResult ? `${Math.round(resultValue * 100)}%` : '-';
      const resultClass = hasResult ? '' : 'content-tree-node__result--empty';

      // Get test runs and submissions counts
      const testRunsCount = node.test_runs_count;
      const maxTestRuns = node.max_test_runs;
      const submissionsCount = node.submissions_count;
      const maxSubmissions = node.max_submissions;

      // Get grading status (string: 'corrected', 'correction_necessary', 'improvement_possible', 'not_reviewed')
      // Match the corner badge colors from IconGenerator.ts
      const gradingStatus = node.status?.toLowerCase?.() || null;
      let cornerBadgeHtml = '';
      if (gradingStatus && gradingStatus !== 'not_reviewed') {
        const statusColor = gradingStatus === 'corrected' ? '#57cc5d'
          : gradingStatus === 'correction_necessary' ? '#fc4a4a'
          : '#fdba4d';
        cornerBadgeHtml = `<span class="content-tree-node__icon-badge" style="background-color: ${statusColor};"></span>`;
      }

      // Build tooltip text
      const tooltipParts = [];
      if (isSubmittable) {
        tooltipParts.push(`Submitted: ${isSubmitted ? 'Yes' : 'No'}`);
        if (hasGrading) {
          tooltipParts.push(`Grade: ${gradingDisplay}`);
        }
        if (hasResult) {
          tooltipParts.push(`Result: ${resultDisplay}`);
        }
        if (typeof testRunsCount === 'number') {
          tooltipParts.push(`Tests: ${testRunsCount}${typeof maxTestRuns === 'number' ? ` of ${maxTestRuns}` : ''}`);
        }
        if (typeof submissionsCount === 'number') {
          tooltipParts.push(`Submissions: ${submissionsCount}${typeof maxSubmissions === 'number' ? ` of ${maxSubmissions}` : ''}`);
        }
        if (gradingStatus && gradingStatus !== 'not_reviewed') {
          const statusText = gradingStatus === 'corrected' ? 'Corrected'
            : gradingStatus === 'correction_necessary' ? 'Correction Necessary'
            : 'Improvement Possible';
          tooltipParts.push(`Status: ${statusText}`);
        }
      } else {
        tooltipParts.push(`Submissions: ${node.submitted_assignments || 0} / ${node.max_assignments || 0} (${percentage}%)`);
        if (hasGrading) {
          tooltipParts.push(`Avg. Grade: ${gradingDisplay}`);
        }
        if (gradingStatus && gradingStatus !== 'not_reviewed') {
          const statusText = gradingStatus === 'corrected' ? 'Corrected'
            : gradingStatus === 'correction_necessary' ? 'Correction Necessary'
            : 'Improvement Possible';
          tooltipParts.push(`Status: ${statusText}`);
        }
      }
      const tooltip = escapeHtml(tooltipParts.join('\n'));

      // Status indicator circle (shown to the left of columns)
      const statusIndicatorHtml = (() => {
        if (!gradingStatus || gradingStatus === 'not_reviewed') {
          return '<span class="content-tree-node__status-indicator content-tree-node__status-indicator--empty"></span>';
        }
        const statusColor = gradingStatus === 'corrected' ? '#57cc5d'
          : gradingStatus === 'correction_necessary' ? '#fc4a4a'
          : '#fdba4d';
        const statusText = gradingStatus === 'corrected' ? 'Corrected'
          : gradingStatus === 'correction_necessary' ? 'Correction Necessary'
          : 'Improvement Possible';
        return `<span class="content-tree-node__status-indicator" style="background-color: ${statusColor};" title="${statusText}"></span>`;
      })();

      // Build tests column display (only for submittable items)
      const testsHtml = (() => {
        if (!isSubmittable) {
          return '<span class="content-tree-node__tests content-tree-node__tests--empty">-</span>';
        }
        if (typeof testRunsCount !== 'number') {
          return '<span class="content-tree-node__tests content-tree-node__tests--empty">-</span>';
        }
        const testsDisplay = typeof maxTestRuns === 'number'
          ? `${testRunsCount}/${maxTestRuns}`
          : `${testRunsCount}`;
        return `<span class="content-tree-node__tests">${testsDisplay}</span>`;
      })();

      // Build submissions column display (only for submittable items)
      const subsHtml = (() => {
        if (!isSubmittable) {
          return '<span class="content-tree-node__subs content-tree-node__subs--empty">-</span>';
        }
        if (typeof submissionsCount !== 'number') {
          return '<span class="content-tree-node__subs content-tree-node__subs--empty">-</span>';
        }
        const subsDisplay = typeof maxSubmissions === 'number'
          ? `${submissionsCount}/${maxSubmissions}`
          : `${submissionsCount}`;
        return `<span class="content-tree-node__subs">${subsDisplay}</span>`;
      })();

      // Both assignments and units use consistent column structure for alignment
      // Columns: tests + subs + status indicator + progress + grading + result + status
      const progressHtml = isSubmittable
        ? `<div class="content-tree-node__columns">
             ${testsHtml}
             ${subsHtml}
             ${statusIndicatorHtml}
             <div class="content-tree-node__bar-container"></div>
             <span class="content-tree-node__grading ${gradingClass}">${gradingDisplay}</span>
             <span class="content-tree-node__result ${resultClass}">${resultDisplay}</span>
             <span class="content-tree-node__check ${isSubmitted ? 'content-tree-node__check--done' : 'content-tree-node__check--pending'}">
               ${isSubmitted ? '✓' : '○'}
             </span>
           </div>`
        : `<div class="content-tree-node__columns">
             ${testsHtml}
             ${subsHtml}
             ${statusIndicatorHtml}
             <div class="content-tree-node__bar-container">
               <div class="content-tree-node__bar">
                 <div class="content-tree-node__fill" style="width: ${percentage}%;"></div>
               </div>
             </div>
             <span class="content-tree-node__grading ${gradingClass}">${gradingDisplay}</span>
             <span class="content-tree-node__result content-tree-node__result--empty">-</span>
             <span class="content-tree-node__percentage">${percentage}%</span>
           </div>`;

      // Icon styling: always filled with content type color
      const iconStyle = `background-color: ${color};`;

      // Icon HTML with optional corner badge for grading status
      const iconHtml = `<span class="content-tree-node__icon" style="${iconStyle}">${cornerBadgeHtml}</span>`;

      return `
        <div class="content-tree-node" id="${nodeId}">
          <div class="content-tree-node__row content-tree-node__row--depth-${Math.min(depth, 3)}" title="${tooltip}">
            <span class="content-tree-node__toggle ${hasChildren ? '' : 'content-tree-node__toggle--empty'}"
                  onclick="toggleNode('${nodeId}')">${hasChildren ? (node.expanded !== false ? '▼' : '▶') : ''}</span>
            ${iconHtml}
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

    const totalMax = gradings.total_max_assignments || 0;
    const totalSubmitted = gradings.total_submitted_assignments || 0;
    const remaining = totalMax - totalSubmitted;

    const labels = contentTypes.map(ct => ct.course_content_type_title || ct.course_content_type_slug);
    const values = contentTypes.map(ct => ct.submitted_assignments || 0);
    const colors = contentTypes.map(ct => ct.course_content_type_color || ComputorCharts.DEFAULT_PALETTE[0]);
    const segments = contentTypes.map(ct => ({
      kind: 'type',
      submitted: ct.submitted_assignments || 0,
      max: ct.max_assignments || 0,
      progressPercentage: ct.progress_percentage || 0
    }));

    // Add "Remaining" segment if there are incomplete assignments
    if (remaining > 0) {
      labels.push('Remaining');
      values.push(remaining);
      colors.push('rgba(100, 149, 237, 0.2)'); // Light blue to match unfilled progress bars
      segments.push({ kind: 'remaining', remaining });
    }

    donutChart = ComputorCharts.createDonutChart('donutChart', {
      labels,
      values,
      colors
    }, {
      cutout: '65%',
      legendPosition: 'bottom',
      legendLabelFormatter: ({ label, value, percentage, index }) => {
        const seg = segments[index];
        if (seg?.kind === 'type') {
          return `${label}: ${seg.submitted}/${seg.max} (${seg.progressPercentage}%)`;
        }
        return `${label}: ${value} (${percentage}%)`;
      },
      tooltipLabelFormatter: ({ label, value, percentage, index }) => {
        const seg = segments[index];
        if (seg?.kind === 'type') {
          return `${label}: ${seg.submitted}/${seg.max} submitted (${seg.progressPercentage}%)`;
        }
        return `${label}: ${value} (${percentage}%)`;
      }
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

  const COPY_ICON = '<svg viewBox="0 0 16 16"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 16 16"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>';

  function renderCopyableId(value, label) {
    const id = 'copy-btn-' + Math.random().toString(36).substr(2, 9);
    return `
      <div class="copyable-id">
        ${label ? `<span class="copyable-id__label">${escapeHtml(label)}</span>` : ''}
        <span class="copyable-id__value">${escapeHtml(value)}</span>
        <button class="copyable-id__btn" id="${id}" data-copy-value="${escapeHtml(value)}" title="Copy to clipboard">
          ${COPY_ICON}
        </button>
      </div>
    `;
  }

  function formatGrade(value) {
    if (typeof value !== 'number') return '-';
    const pct = (value * 100).toFixed(1).replace(/\\.0$/, '');
    return `${pct}%`;
  }

  function toNonNegativeInt(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }

  function clamp(value, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  // Global handlers
  window.handleRefresh = function() {
    vscode.postMessage({ command: 'refresh' });
  };

  window.copyWithFeedback = function(text, btnId) {
    // Use VS Code's clipboard API via message passing (navigator.clipboard doesn't work in webviews)
    vscode.postMessage({ command: 'copyToClipboard', data: { text, btnId } });
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
