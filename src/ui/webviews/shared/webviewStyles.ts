export const SHARED_STYLES = `
  body {
    font-family: var(--vscode-font-family);
    padding: 20px;
    color: var(--vscode-foreground);
    background-color: var(--vscode-editor-background);
    margin: 0;
  }

  .header {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .header h1 {
    margin: 0 0 4px 0;
    font-size: 22px;
    color: var(--vscode-foreground);
  }
  .header p {
    margin: 0;
    color: var(--vscode-descriptionForeground);
    font-size: 13px;
  }

  .section {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    padding: 16px 20px;
    border-radius: 6px;
    margin-bottom: 16px;
  }
  .section h2 {
    margin: 0 0 12px 0;
    font-size: 16px;
    color: var(--vscode-foreground);
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .info-row:last-child {
    border-bottom: none;
  }
  .label {
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    font-size: 13px;
    min-width: 140px;
  }
  .value {
    color: var(--vscode-foreground);
    font-size: 13px;
    text-align: right;
    word-break: break-all;
  }

  .code {
    background: var(--vscode-textCodeBlock-background);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
    font-size: 12px;
  }

  .badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
  }
  .badge-success {
    background: rgba(16, 124, 16, 0.2);
    color: #4caf50;
  }
  .badge-warning {
    background: rgba(255, 165, 0, 0.2);
    color: #FFA500;
  }
  .badge-error {
    background: rgba(209, 52, 56, 0.2);
    color: #d13438;
  }
  .badge-info {
    background: rgba(0, 120, 212, 0.2);
    color: #0078d4;
  }
  .badge-muted {
    background: rgba(128, 128, 128, 0.2);
    color: var(--vscode-descriptionForeground);
  }

  .status-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 12px;
    color: white;
  }

  .color-swatch {
    display: inline-block;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 1px solid var(--vscode-panel-border);
    vertical-align: middle;
    margin-right: 6px;
  }

  /* Form styles */
  .form-group {
    margin-bottom: 14px;
  }
  .form-group label {
    display: block;
    margin-bottom: 4px;
    font-weight: 500;
    font-size: 13px;
    color: var(--vscode-foreground);
  }
  .form-group .hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 2px;
  }
  input, textarea, select {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.35)));
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border-radius: 4px;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    box-sizing: border-box;
  }
  input:focus, textarea:focus, select:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
  }
  textarea {
    resize: vertical;
    min-height: 60px;
  }
  input[type="color"] {
    width: 40px;
    height: 30px;
    padding: 2px;
    cursor: pointer;
  }
  .color-input-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .color-input-row input[type="text"] {
    flex: 1;
  }
  input[type="number"] {
    width: 100px;
  }

  /* Buttons */
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
    flex-wrap: wrap;
  }
  button, .btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 14px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 13px;
    font-family: var(--vscode-font-family);
  }
  button:hover, .btn:hover {
    background: var(--vscode-button-hoverBackground);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  .btn-danger {
    background: #d13438;
    color: white;
  }
  .btn-danger:hover {
    background: #a52a2d;
  }

  /* Empty / Error states */
  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--vscode-descriptionForeground);
  }

  /* Links */
  a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
`;
