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

const emptyValue = '<em>—</em>';

/**
 * Wraps a run of infoRow()s so they flow into columns. Detail rows are grid
 * items, so they need this parent — a bare run of them stacks one per line.
 */
export function detailGrid(content: string): string {
  return `<div class="detail-grid">${content}</div>`;
}

/**
 * One read-only fact: label above value, sized by .detail-grid. `wide` gives
 * the item the full row, for values that don't fit a column (descriptions,
 * URLs, ids).
 */
export function infoRow(label: string, value: string, options?: { wide?: boolean }): string {
  return `<div class="detail-item${options?.wide ? ' wide' : ''}">
    <span class="detail-label">${escapeHtml(label)}</span>
    <span class="detail-value">${value}</span>
  </div>`;
}

export function infoRowText(label: string, value: string | undefined | null, options?: { wide?: boolean }): string {
  return infoRow(label, escapeHtml(value) || emptyValue, options);
}

/**
 * Identifiers, paths and version tags. These stay in a normal column — long
 * values wrap inside it (.detail-value sets overflow-wrap), which reads better
 * than giving every id a full row and breaking the grid rhythm.
 */
export function infoRowCode(label: string, value: string | undefined | null, options?: { wide?: boolean }): string {
  return infoRow(label, value ? `<span class="code">${escapeHtml(value)}</span>` : emptyValue, options);
}

export function section(title: string, content: string): string {
  return `<div class="section">
    <h2>${escapeHtml(title)}</h2>
    ${content}
  </div>`;
}

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'muted';

export function badge(text: string, variant: BadgeVariant = 'info'): string {
  return `<span class="badge badge-${variant}">${escapeHtml(text)}</span>`;
}

/**
 * Course-content deployment statuses, mapped to the design-system badge
 * variants rather than to hex. base.css owns the actual colours, so these
 * follow the user's theme instead of being three fixed values.
 */
const DEPLOYMENT_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  pending: 'warning',
  deployed: 'success',
  failed: 'error',
  deploying: 'info',
  unassigned: 'muted'
};

export function deploymentStatusVariant(status: string): BadgeVariant {
  return DEPLOYMENT_STATUS_VARIANTS[status] || 'muted';
}

/** Deployment status as a themed badge, e.g. badge('DEPLOYED', 'success'). */
export function deploymentBadge(status: string): string {
  return badge(status.toUpperCase(), deploymentStatusVariant(status));
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
