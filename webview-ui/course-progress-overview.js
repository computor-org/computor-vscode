/**
 * Course Progress Overview Webview
 * Displays course-wide student progress visualizations
 */

(function() {
  'use strict';

  const vscode = window.vscodeApi || acquireVsCodeApi();
  const state = window.__INITIAL_STATE__ || { course: null, students: [] };

  let histogramChart = null;
  let contentTypeChart = null;
  let studentTable = null;

  function init() {
    render();
    setupMessageHandler();
  }

  function setupMessageHandler() {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'updateData':
          if (message.data?.students) {
            state.students = message.data.students;
            updateCharts();
            updateTable();
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

    if (!state.course) {
      app.innerHTML = renderEmptyState('No Course Selected', 'Select a course to view progress overview.');
      return;
    }

    app.innerHTML = `
      <div class="course-progress-overview">
        ${renderHeader()}
        ${renderStatCards()}
        ${renderCharts()}
        ${renderStudentsSection()}
        <div class="loading-overlay loading-overlay--hidden" id="loadingOverlay">
          <div class="loading-spinner"></div>
        </div>
      </div>
    `;

    initCharts();
    initTable();
  }

  function renderHeader() {
    const course = state.course;
    return `
      <header class="course-progress-header">
        <div>
          <h1 class="course-progress-header__title">${escapeHtml(course.title || course.path)}</h1>
          <p class="course-progress-header__subtitle">Student Progress Overview</p>
        </div>
      </header>
    `;
  }

  function renderStatCards() {
    const students = state.students || [];
    const stats = calculateStats(students);

    return `
      <div class="computor-stat-cards">
        ${createStatCardHtml('Total Students', stats.total, null, ComputorCharts.ThemeColors.info)}
        ${createStatCardHtml('Average Progress', stats.avgProgress + '%', null, ComputorCharts.ThemeColors.primary)}
        ${createStatCardHtml('Completed', stats.completed, '100% progress', ComputorCharts.ThemeColors.success)}
        ${createStatCardHtml('At Risk', stats.atRisk, '<25% progress', ComputorCharts.ThemeColors.error)}
        ${createStatCardHtml('Inactive', stats.inactive, '>14 days', ComputorCharts.ThemeColors.warning)}
      </div>
    `;
  }

  function createStatCardHtml(title, value, subtitle, color) {
    return `
      <div class="computor-stat-card" style="border-left-color: ${color}">
        <div class="computor-stat-card__content">
          <div class="computor-stat-card__title">${escapeHtml(title)}</div>
          <div class="computor-stat-card__value">${escapeHtml(String(value))}</div>
          ${subtitle ? `<div class="computor-stat-card__subtitle">${escapeHtml(subtitle)}</div>` : ''}
        </div>
      </div>
    `;
  }

  function renderCharts() {
    return `
      <div class="charts-row">
        <div class="chart-card">
          <h3 class="chart-card__title">Progress Distribution</h3>
          <div class="chart-card__canvas">
            <canvas id="histogramChart"></canvas>
          </div>
        </div>
        <div class="chart-card">
          <h3 class="chart-card__title">Content Type Completion</h3>
          <div class="chart-card__canvas">
            <canvas id="contentTypeChart"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  function renderStudentsSection() {
    return `
      <section class="students-section">
        <div class="students-section__header">
          <h2 class="students-section__title">
            Students
            <span class="students-section__count">(${state.students?.length || 0})</span>
          </h2>
        </div>
        <div id="studentTableContainer"></div>
      </section>
    `;
  }

  function renderEmptyState(title, description) {
    return `
      <div class="empty-state">
        <div class="empty-state__icon">📊</div>
        <div class="empty-state__title">${escapeHtml(title)}</div>
        <div class="empty-state__description">${escapeHtml(description)}</div>
      </div>
    `;
  }

  function calculateStats(students) {
    if (!students || students.length === 0) {
      return { total: 0, avgProgress: 0, completed: 0, atRisk: 0, inactive: 0 };
    }

    const total = students.length;
    const sumProgress = students.reduce((sum, s) => sum + (s.overall_progress_percentage || 0), 0);
    const avgProgress = Math.round(sumProgress / total);
    const completed = students.filter(s => s.overall_progress_percentage >= 100).length;
    const atRisk = students.filter(s => s.overall_progress_percentage < 25).length;
    const inactive = students.filter(s => {
      if (!s.latest_submission_at) return true;
      return ComputorCharts.getDaysSince(s.latest_submission_at) > 14;
    }).length;

    return { total, avgProgress, completed, atRisk, inactive };
  }

  function initCharts() {
    const students = state.students || [];

    // Histogram
    const histogramData = buildHistogramData(students);
    histogramChart = ComputorCharts.createHistogram('histogramChart', histogramData, {
      xAxisLabel: 'Progress Range',
      yAxisLabel: 'Students',
      color: ComputorCharts.ThemeColors.primary
    });

    // Content Type Chart
    const contentTypeData = buildContentTypeData(students);
    if (contentTypeData.labels.length > 0) {
      contentTypeChart = ComputorCharts.createBarChart('contentTypeChart', {
        labels: contentTypeData.labels,
        datasets: [{
          label: 'Average Progress',
          values: contentTypeData.values,
          color: contentTypeData.colors
        }]
      }, {
        horizontal: true,
        maxValue: 100,
        xAxisLabel: 'Average Progress %'
      });
    }
  }

  function buildHistogramData(students) {
    const buckets = Array(10).fill(0);
    const labels = ['0-10%', '10-20%', '20-30%', '30-40%', '40-50%', '50-60%', '60-70%', '70-80%', '80-90%', '90-100%'];

    students.forEach(s => {
      const bucket = Math.min(Math.floor((s.overall_progress_percentage || 0) / 10), 9);
      buckets[bucket]++;
    });

    return { labels, values: buckets };
  }

  function buildContentTypeData(students) {
    const typeMap = new Map();

    students.forEach(s => {
      (s.by_content_type || []).forEach(ct => {
        const existing = typeMap.get(ct.course_content_type_slug) || {
          sum: 0,
          count: 0,
          color: ct.course_content_type_color,
          title: ct.course_content_type_title
        };
        existing.sum += ct.progress_percentage || 0;
        existing.count++;
        typeMap.set(ct.course_content_type_slug, existing);
      });
    });

    const labels = [];
    const values = [];
    const colors = [];

    typeMap.forEach((data, slug) => {
      labels.push(data.title || slug);
      values.push(Math.round(data.sum / data.count));
      colors.push(data.color || ComputorCharts.ThemeColors.primary);
    });

    return { labels, values, colors };
  }

  function initTable() {
    const container = document.getElementById('studentTableContainer');
    if (!container) return;

    const students = state.students || [];

    studentTable = ComputorCharts.createDataTable({
      columns: [
        {
          key: 'name',
          label: 'Student',
          render: (val, row) => {
            const name = [row.given_name, row.family_name].filter(Boolean).join(' ') || 'Unknown';
            return `
              <div class="student-name">${escapeHtml(name)}</div>
              ${row.username ? `<div class="student-username">@${escapeHtml(row.username)}</div>` : ''}
            `;
          }
        },
        {
          key: 'overall_progress_percentage',
          label: 'Overall Progress',
          width: '180px',
          render: (val) => {
            const percentage = val || 0;
            const progressBar = ComputorCharts.createProgressBar(percentage, { size: 'sm' });
            return progressBar.outerHTML;
          }
        },
        {
          key: 'by_content_type',
          label: 'By Type',
          width: '200px',
          sortable: false,
          render: (val) => renderContentTypeProgress(val)
        },
        {
          key: 'latest_submission_at',
          label: 'Last Active',
          width: '120px',
          render: (val, row) => {
            const relative = ComputorCharts.formatRelativeDate(val);
            const days = ComputorCharts.getDaysSince(val);
            let statusClass = 'active';
            if (days > 14) statusClass = 'inactive';
            else if (days > 7) statusClass = 'warning';

            return `
              <div class="activity-status activity-status--${statusClass}">
                <span class="activity-dot"></span>
                <span>${escapeHtml(relative)}</span>
              </div>
            `;
          }
        }
      ],
      data: students.map(s => ({
        ...s,
        name: [s.given_name, s.family_name].filter(Boolean).join(' ') || s.username || 'Unknown'
      })),
      defaultSort: 'overall_progress_percentage',
      defaultSortDirection: 'desc',
      onRowClick: (row) => {
        vscode.postMessage({
          command: 'showStudentDetails',
          data: {
            courseMemberId: row.course_member_id,
            studentName: row.name
          }
        });
      },
      emptyMessage: 'No students found in this course.'
    });

    container.appendChild(studentTable);
  }

  function renderContentTypeProgress(contentTypes) {
    if (!contentTypes || contentTypes.length === 0) {
      return '<span style="color: var(--vscode-descriptionForeground)">—</span>';
    }

    return contentTypes.map(ct => {
      const label = ct.course_content_type_title || ct.course_content_type_slug;
      const percentage = ct.progress_percentage || 0;

      return `
        <div class="content-type-row">
          <span class="content-type-label">${escapeHtml(label)}</span>
          <div class="content-type-bar">
            <div class="content-type-bar__fill" style="width: ${percentage}%;"></div>
          </div>
          <span class="content-type-value">${percentage}%</span>
        </div>
      `;
    }).join('');
  }

  function updateCharts() {
    const students = state.students || [];

    // Update histogram
    if (histogramChart) {
      const histogramData = buildHistogramData(students);
      histogramChart.data.datasets[0].data = histogramData.values;
      histogramChart.update();
    }

    // Update content type chart
    if (contentTypeChart) {
      const contentTypeData = buildContentTypeData(students);
      contentTypeChart.data.labels = contentTypeData.labels;
      contentTypeChart.data.datasets[0].data = contentTypeData.values;
      contentTypeChart.update();
    }

    // Update stat cards
    const statCardsContainer = document.querySelector('.computor-stat-cards');
    if (statCardsContainer) {
      const stats = calculateStats(students);
      statCardsContainer.innerHTML = `
        ${createStatCardHtml('Total Students', stats.total, null, ComputorCharts.ThemeColors.info)}
        ${createStatCardHtml('Average Progress', stats.avgProgress + '%', null, ComputorCharts.ThemeColors.primary)}
        ${createStatCardHtml('Completed', stats.completed, '100% progress', ComputorCharts.ThemeColors.success)}
        ${createStatCardHtml('At Risk', stats.atRisk, '<25% progress', ComputorCharts.ThemeColors.error)}
        ${createStatCardHtml('Inactive', stats.inactive, '>14 days', ComputorCharts.ThemeColors.warning)}
      `;
    }
  }

  function updateTable() {
    if (studentTable && studentTable.updateData) {
      const students = state.students || [];
      studentTable.updateData(students.map(s => ({
        ...s,
        name: [s.given_name, s.family_name].filter(Boolean).join(' ') || s.username || 'Unknown'
      })));
    }
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

  window.handleSearch = function(query) {
    if (studentTable && typeof studentTable.filter === 'function') {
      studentTable.filter(query);
    }
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
