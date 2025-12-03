/**
 * Computor Charts - Reusable Chart Components
 * Built on Chart.js, styled for VS Code themes
 *
 * Usage:
 *   const chart = ComputorCharts.createBarChart('canvasId', data, options);
 *   chart.destroy(); // cleanup when done
 */

(function() {
  'use strict';

  // VS Code theme color extraction
  const ThemeColors = {
    get foreground() {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-foreground').trim() || '#cccccc';
    },
    get background() {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
    },
    get border() {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-panel-border').trim() || '#454545';
    },
    get primary() {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-button-background').trim() || '#0e639c';
    },
    get success() {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-debugIcon-continueForeground').trim() || '#89d185';
    },
    get warning() {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-editorWarning-foreground').trim() || '#cca700';
    },
    get error() {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-editorError-foreground').trim() || '#f14c4c';
    },
    get info() {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-editorInfo-foreground').trim() || '#3794ff';
    },
    get muted() {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-descriptionForeground').trim() || '#858585';
    },
    get gridLines() {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-editorWidget-border').trim() || '#454545';
    }
  };

  // Default color palette for charts (accessible, VS Code friendly)
  const DEFAULT_PALETTE = [
    '#4fc3f7', // light blue
    '#81c784', // green
    '#ffb74d', // orange
    '#f06292', // pink
    '#ba68c8', // purple
    '#4db6ac', // teal
    '#ff8a65', // coral
    '#a1887f', // brown
    '#90a4ae', // blue grey
    '#aed581'  // light green
  ];

  // Base chart configuration for VS Code theme
  function getBaseConfig() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 300
      },
      plugins: {
        legend: {
          labels: {
            color: ThemeColors.foreground,
            font: {
              family: 'var(--vscode-font-family)',
              size: 12
            },
            padding: 16,
            usePointStyle: true
          }
        },
        tooltip: {
          backgroundColor: ThemeColors.background,
          titleColor: ThemeColors.foreground,
          bodyColor: ThemeColors.foreground,
          borderColor: ThemeColors.border,
          borderWidth: 1,
          padding: 12,
          cornerRadius: 4,
          titleFont: {
            family: 'var(--vscode-font-family)',
            size: 13,
            weight: '600'
          },
          bodyFont: {
            family: 'var(--vscode-font-family)',
            size: 12
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: ThemeColors.muted,
            font: {
              family: 'var(--vscode-font-family)',
              size: 11
            }
          },
          grid: {
            color: ThemeColors.gridLines,
            lineWidth: 0.5
          },
          border: {
            color: ThemeColors.border
          }
        },
        y: {
          ticks: {
            color: ThemeColors.muted,
            font: {
              family: 'var(--vscode-font-family)',
              size: 11
            }
          },
          grid: {
            color: ThemeColors.gridLines,
            lineWidth: 0.5
          },
          border: {
            color: ThemeColors.border
          }
        }
      }
    };
  }

  /**
   * Create a histogram chart for distribution data
   * @param {string|HTMLCanvasElement} canvas - Canvas element or ID
   * @param {Object} data - { labels: string[], values: number[] }
   * @param {Object} options - Chart options
   */
  function createHistogram(canvas, data, options = {}) {
    const ctx = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!ctx) {
      console.error('ComputorCharts: Canvas not found:', canvas);
      return null;
    }

    const config = getBaseConfig();
    const barColor = options.color || ThemeColors.primary;

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [{
          label: options.label || 'Count',
          data: data.values,
          backgroundColor: barColor,
          borderColor: barColor,
          borderWidth: 0,
          borderRadius: 4,
          barPercentage: 0.9,
          categoryPercentage: 0.9
        }]
      },
      options: {
        ...config,
        plugins: {
          ...config.plugins,
          legend: {
            display: options.showLegend !== false ? false : options.showLegend
          },
          title: options.title ? {
            display: true,
            text: options.title,
            color: ThemeColors.foreground,
            font: {
              family: 'var(--vscode-font-family)',
              size: 14,
              weight: '600'
            },
            padding: { bottom: 16 }
          } : { display: false }
        },
        scales: {
          ...config.scales,
          y: {
            ...config.scales.y,
            beginAtZero: true,
            ticks: {
              ...config.scales.y.ticks,
              stepSize: options.stepSize || undefined
            },
            title: options.yAxisLabel ? {
              display: true,
              text: options.yAxisLabel,
              color: ThemeColors.muted
            } : { display: false }
          },
          x: {
            ...config.scales.x,
            title: options.xAxisLabel ? {
              display: true,
              text: options.xAxisLabel,
              color: ThemeColors.muted
            } : { display: false }
          }
        },
        onClick: options.onClick
      }
    });
  }

  /**
   * Create a bar chart (horizontal or vertical)
   * @param {string|HTMLCanvasElement} canvas - Canvas element or ID
   * @param {Object} data - { labels: string[], datasets: [{ label, values, color? }] }
   * @param {Object} options - Chart options
   */
  function createBarChart(canvas, data, options = {}) {
    const ctx = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!ctx) {
      console.error('ComputorCharts: Canvas not found:', canvas);
      return null;
    }

    const config = getBaseConfig();
    const datasets = data.datasets.map((ds, i) => ({
      label: ds.label,
      data: ds.values,
      backgroundColor: ds.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
      borderColor: ds.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
      borderWidth: 0,
      borderRadius: 4,
      barPercentage: options.barPercentage || 0.8,
      categoryPercentage: options.categoryPercentage || 0.9
    }));

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: datasets
      },
      options: {
        ...config,
        indexAxis: options.horizontal ? 'y' : 'x',
        plugins: {
          ...config.plugins,
          legend: {
            display: datasets.length > 1,
            position: options.legendPosition || 'top',
            labels: config.plugins.legend.labels
          },
          title: options.title ? {
            display: true,
            text: options.title,
            color: ThemeColors.foreground,
            font: {
              family: 'var(--vscode-font-family)',
              size: 14,
              weight: '600'
            },
            padding: { bottom: 16 }
          } : { display: false }
        },
        scales: {
          x: {
            ...config.scales.x,
            stacked: options.stacked || false,
            beginAtZero: true,
            max: options.maxValue,
            title: options.xAxisLabel ? {
              display: true,
              text: options.xAxisLabel,
              color: ThemeColors.muted
            } : { display: false }
          },
          y: {
            ...config.scales.y,
            stacked: options.stacked || false,
            beginAtZero: true,
            max: options.maxValue,
            title: options.yAxisLabel ? {
              display: true,
              text: options.yAxisLabel,
              color: ThemeColors.muted
            } : { display: false }
          }
        },
        onClick: options.onClick
      }
    });
  }

  /**
   * Create a donut/pie chart
   * @param {string|HTMLCanvasElement} canvas - Canvas element or ID
   * @param {Object} data - { labels: string[], values: number[], colors?: string[] }
   * @param {Object} options - Chart options
   */
  function createDonutChart(canvas, data, options = {}) {
    const ctx = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!ctx) {
      console.error('ComputorCharts: Canvas not found:', canvas);
      return null;
    }

    const colors = data.colors || data.labels.map((_, i) => DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]);

    return new Chart(ctx, {
      type: options.pie ? 'pie' : 'doughnut',
      data: {
        labels: data.labels,
        datasets: [{
          data: data.values,
          backgroundColor: colors,
          borderColor: ThemeColors.background,
          borderWidth: 2,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: options.pie ? 0 : (options.cutout || '60%'),
        animation: {
          duration: 300
        },
        plugins: {
          legend: {
            display: options.showLegend !== false,
            position: options.legendPosition || 'right',
            labels: {
              color: ThemeColors.foreground,
              font: {
                family: 'var(--vscode-font-family)',
                size: 12
              },
              padding: 12,
              usePointStyle: true,
              generateLabels: function(chart) {
                const data = chart.data;
                if (data.labels.length && data.datasets.length) {
                  const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                  return data.labels.map((label, i) => {
                    const value = data.datasets[0].data[i];
                    const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                    return {
                      text: `${label}: ${percentage}%`,
                      fillStyle: data.datasets[0].backgroundColor[i],
                      strokeStyle: data.datasets[0].backgroundColor[i],
                      hidden: false,
                      index: i,
                      pointStyle: 'circle'
                    };
                  });
                }
                return [];
              }
            }
          },
          tooltip: {
            backgroundColor: ThemeColors.background,
            titleColor: ThemeColors.foreground,
            bodyColor: ThemeColors.foreground,
            borderColor: ThemeColors.border,
            borderWidth: 1,
            padding: 12,
            cornerRadius: 4,
            callbacks: {
              label: function(context) {
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const value = context.raw;
                const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                return `${context.label}: ${value} (${percentage}%)`;
              }
            }
          },
          title: options.title ? {
            display: true,
            text: options.title,
            color: ThemeColors.foreground,
            font: {
              family: 'var(--vscode-font-family)',
              size: 14,
              weight: '600'
            },
            padding: { bottom: 16 }
          } : { display: false }
        },
        onClick: options.onClick
      }
    });
  }

  /**
   * Create a line chart
   * @param {string|HTMLCanvasElement} canvas - Canvas element or ID
   * @param {Object} data - { labels: string[], datasets: [{ label, values, color? }] }
   * @param {Object} options - Chart options
   */
  function createLineChart(canvas, data, options = {}) {
    const ctx = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!ctx) {
      console.error('ComputorCharts: Canvas not found:', canvas);
      return null;
    }

    const config = getBaseConfig();
    const datasets = data.datasets.map((ds, i) => ({
      label: ds.label,
      data: ds.values,
      borderColor: ds.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
      backgroundColor: (ds.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]) + '20',
      borderWidth: 2,
      fill: options.fill !== false,
      tension: options.tension || 0.3,
      pointRadius: options.showPoints !== false ? 4 : 0,
      pointHoverRadius: 6,
      pointBackgroundColor: ds.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
      pointBorderColor: ThemeColors.background,
      pointBorderWidth: 2
    }));

    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: datasets
      },
      options: {
        ...config,
        plugins: {
          ...config.plugins,
          legend: {
            display: datasets.length > 1,
            position: options.legendPosition || 'top',
            labels: config.plugins.legend.labels
          },
          title: options.title ? {
            display: true,
            text: options.title,
            color: ThemeColors.foreground,
            font: {
              family: 'var(--vscode-font-family)',
              size: 14,
              weight: '600'
            },
            padding: { bottom: 16 }
          } : { display: false }
        },
        scales: {
          ...config.scales,
          y: {
            ...config.scales.y,
            beginAtZero: options.beginAtZero !== false
          }
        },
        onClick: options.onClick
      }
    });
  }

  /**
   * Create a summary stat card (HTML element, not a chart)
   * @param {Object} options - { title, value, subtitle?, icon?, color?, trend? }
   * @returns {HTMLElement}
   */
  function createStatCard(options) {
    const card = document.createElement('div');
    card.className = 'computor-stat-card';
    if (options.color) {
      card.style.borderLeftColor = options.color;
    }

    const content = document.createElement('div');
    content.className = 'computor-stat-card__content';

    const titleEl = document.createElement('div');
    titleEl.className = 'computor-stat-card__title';
    titleEl.textContent = options.title;
    content.appendChild(titleEl);

    const valueEl = document.createElement('div');
    valueEl.className = 'computor-stat-card__value';
    valueEl.textContent = options.value;
    if (options.valueColor) {
      valueEl.style.color = options.valueColor;
    }
    content.appendChild(valueEl);

    if (options.subtitle) {
      const subtitleEl = document.createElement('div');
      subtitleEl.className = 'computor-stat-card__subtitle';
      subtitleEl.textContent = options.subtitle;
      content.appendChild(subtitleEl);
    }

    if (options.trend) {
      const trendEl = document.createElement('div');
      trendEl.className = `computor-stat-card__trend computor-stat-card__trend--${options.trend.direction}`;
      trendEl.textContent = `${options.trend.direction === 'up' ? '↑' : '↓'} ${options.trend.value}`;
      content.appendChild(trendEl);
    }

    card.appendChild(content);

    if (options.icon) {
      const iconEl = document.createElement('div');
      iconEl.className = 'computor-stat-card__icon';
      iconEl.innerHTML = options.icon;
      card.appendChild(iconEl);
    }

    return card;
  }

  /**
   * Create an inline progress bar (HTML element)
   * @param {number} percentage - 0-100
   * @param {Object} options - { color?, showLabel?, size?, animated? }
   * @returns {HTMLElement}
   */
  function createProgressBar(percentage, options = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = `computor-progress ${options.size === 'sm' ? 'computor-progress--sm' : ''}`;

    const bar = document.createElement('div');
    bar.className = 'computor-progress__bar';

    const fill = document.createElement('div');
    fill.className = 'computor-progress__fill';
    if (options.animated) {
      fill.classList.add('computor-progress__fill--animated');
    }
    fill.style.width = `${Math.min(100, Math.max(0, percentage))}%`;

    if (options.color) {
      fill.style.backgroundColor = options.color;
    } else {
      // Auto color based on percentage
      if (percentage >= 80) {
        fill.style.backgroundColor = ThemeColors.success;
      } else if (percentage >= 50) {
        fill.style.backgroundColor = ThemeColors.warning;
      } else if (percentage >= 25) {
        fill.style.backgroundColor = ThemeColors.primary;
      } else {
        fill.style.backgroundColor = ThemeColors.error;
      }
    }

    bar.appendChild(fill);
    wrapper.appendChild(bar);

    if (options.showLabel !== false) {
      const label = document.createElement('span');
      label.className = 'computor-progress__label';
      label.textContent = `${Math.round(percentage)}%`;
      wrapper.appendChild(label);
    }

    return wrapper;
  }

  /**
   * Create a sortable data table
   * @param {Object} config - { columns: [{key, label, sortable?, render?}], data: [], onRowClick? }
   * @returns {HTMLElement}
   */
  function createDataTable(config) {
    const container = document.createElement('div');
    container.className = 'computor-table-container';

    const table = document.createElement('table');
    table.className = 'computor-table';

    // State
    let sortKey = config.defaultSort || null;
    let sortDirection = config.defaultSortDirection || 'asc';
    let currentData = [...config.data];

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    config.columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.dataset.key = col.key;

      if (col.sortable !== false) {
        th.className = 'computor-table__sortable';
        th.addEventListener('click', () => {
          if (sortKey === col.key) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            sortKey = col.key;
            sortDirection = 'asc';
          }
          sortAndRender();
        });
      }

      if (col.width) {
        th.style.width = col.width;
      }
      if (col.align) {
        th.style.textAlign = col.align;
      }

      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    function sortAndRender() {
      // Update header sort indicators
      headerRow.querySelectorAll('th').forEach(th => {
        th.classList.remove('computor-table__sorted-asc', 'computor-table__sorted-desc');
        if (th.dataset.key === sortKey) {
          th.classList.add(`computor-table__sorted-${sortDirection}`);
        }
      });

      // Sort data
      if (sortKey) {
        currentData.sort((a, b) => {
          let aVal = a[sortKey];
          let bVal = b[sortKey];

          // Handle null/undefined
          if (aVal == null) aVal = '';
          if (bVal == null) bVal = '';

          // Numeric comparison
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
          }

          // String comparison
          const strA = String(aVal).toLowerCase();
          const strB = String(bVal).toLowerCase();
          if (sortDirection === 'asc') {
            return strA.localeCompare(strB);
          } else {
            return strB.localeCompare(strA);
          }
        });
      }

      renderBody();
    }

    function renderBody() {
      tbody.innerHTML = '';

      if (currentData.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = config.columns.length;
        emptyCell.className = 'computor-table__empty';
        emptyCell.textContent = config.emptyMessage || 'No data available';
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
        return;
      }

      currentData.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.dataset.index = index;

        if (config.onRowClick) {
          tr.className = 'computor-table__clickable';
          tr.addEventListener('click', () => config.onRowClick(row, index));
        }

        config.columns.forEach(col => {
          const td = document.createElement('td');
          if (col.align) {
            td.style.textAlign = col.align;
          }

          if (col.render) {
            const rendered = col.render(row[col.key], row, index);
            if (rendered instanceof HTMLElement) {
              td.appendChild(rendered);
            } else {
              td.innerHTML = rendered;
            }
          } else {
            td.textContent = row[col.key] ?? '';
          }

          tr.appendChild(td);
        });

        tbody.appendChild(tr);
      });
    }

    container.appendChild(table);

    // Initial render
    sortAndRender();

    // Return container with update method
    container.updateData = (newData) => {
      currentData = [...newData];
      sortAndRender();
    };

    container.setSort = (key, direction) => {
      sortKey = key;
      sortDirection = direction || 'asc';
      sortAndRender();
    };

    return container;
  }

  /**
   * Format a date relative to now (e.g., "3 days ago")
   * @param {string|Date} date - ISO date string or Date object
   * @returns {string}
   */
  function formatRelativeDate(date) {
    if (!date) return 'Never';

    const now = new Date();
    const then = new Date(date);
    const diffMs = now - then;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  }

  /**
   * Get days since a date
   * @param {string|Date} date - ISO date string or Date object
   * @returns {number}
   */
  function getDaysSince(date) {
    if (!date) return Infinity;
    const now = new Date();
    const then = new Date(date);
    return Math.floor((now - then) / (1000 * 60 * 60 * 24));
  }

  // Export to window
  window.ComputorCharts = {
    // Chart creators
    createHistogram,
    createBarChart,
    createDonutChart,
    createLineChart,

    // UI components
    createStatCard,
    createProgressBar,
    createDataTable,

    // Utilities
    formatRelativeDate,
    getDaysSince,

    // Theme access
    ThemeColors,
    DEFAULT_PALETTE
  };

})();
