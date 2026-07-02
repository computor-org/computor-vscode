const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
};

export function escapeHtml(text: string | undefined | null): string {
  if (!text) { return ''; }
  return String(text).replace(/[&<>"']/g, (m) => HTML_ESCAPE_MAP[m] || m);
}

export function infoRow(label: string, value: string): string {
  return `<div class="info-row">
    <span class="label">${escapeHtml(label)}</span>
    <span class="value">${value}</span>
  </div>`;
}

export function infoRowText(label: string, value: string | undefined | null): string {
  return infoRow(label, escapeHtml(value) || '<em style="opacity:0.5">—</em>');
}

export function infoRowCode(label: string, value: string | undefined | null): string {
  return infoRow(label, value ? `<span class="code">${escapeHtml(value)}</span>` : '<em style="opacity:0.5">—</em>');
}

export function section(title: string, content: string): string {
  return `<div class="section">
    <h2>${escapeHtml(title)}</h2>
    ${content}
  </div>`;
}

export function badge(text: string, variant: 'success' | 'warning' | 'error' | 'info' | 'muted' = 'info'): string {
  return `<span class="badge badge-${variant}">${escapeHtml(text)}</span>`;
}

/** Colors for course-content deployment statuses (badges, icons). */
export const DEPLOYMENT_STATUS_COLORS: Record<string, string> = {
  pending: '#FFA500',
  deployed: '#107c10',
  failed: '#d13438',
  deploying: '#0078d4',
  unassigned: '#666666'
};

export function deploymentStatusColor(status: string): string {
  return DEPLOYMENT_STATUS_COLORS[status] || DEPLOYMENT_STATUS_COLORS.unassigned!;
}

export function statusBadge(text: string, color: string): string {
  return `<span class="status-badge" style="background-color:${escapeHtml(color)}">${escapeHtml(text)}</span>`;
}

export function colorSwatch(color: string): string {
  return `<span class="color-swatch" style="background-color:${escapeHtml(color)}"></span>`;
}

export function formGroup(label: string, inputHtml: string, hint?: string): string {
  return `<div class="form-group">
    <label>${escapeHtml(label)}</label>
    ${inputHtml}
    ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}
  </div>`;
}

export function textInput(name: string, value: string | undefined | null, options?: {
  type?: string;
  placeholder?: string;
  required?: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  readonly?: boolean;
}): string {
  const type = options?.type || 'text';
  const attrs = [
    `type="${type}"`,
    `name="${escapeHtml(name)}"`,
    `id="${escapeHtml(name)}"`,
    `value="${escapeHtml(value)}"`,
  ];
  if (options?.placeholder) { attrs.push(`placeholder="${escapeHtml(options.placeholder)}"`); }
  if (options?.required) { attrs.push('required'); }
  if (options?.pattern) { attrs.push(`pattern="${escapeHtml(options.pattern)}"`); }
  if (options?.min !== undefined) { attrs.push(`min="${options.min}"`); }
  if (options?.max !== undefined) { attrs.push(`max="${options.max}"`); }
  if (options?.readonly) { attrs.push('readonly'); }
  return `<input ${attrs.join(' ')}>`;
}

export function textareaInput(name: string, value: string | undefined | null, options?: {
  placeholder?: string;
  rows?: number;
}): string {
  const rows = options?.rows || 3;
  return `<textarea name="${escapeHtml(name)}" id="${escapeHtml(name)}" rows="${rows}"${options?.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : ''}>${escapeHtml(value)}</textarea>`;
}

export function selectInput(name: string, options: { value: string; label: string }[], selectedValue: string | undefined | null): string {
  const optionsHtml = options.map(o =>
    `<option value="${escapeHtml(o.value)}"${o.value === selectedValue ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
  ).join('\n');
  return `<select name="${escapeHtml(name)}" id="${escapeHtml(name)}">${optionsHtml}</select>`;
}
