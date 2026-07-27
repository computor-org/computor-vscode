import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { escapeHtml } from './shared/webviewHelpers';
import { ClientErrorDefinition } from '../../exceptions/client-error-types';
import { clientErrorCatalog } from '../../exceptions/ClientErrorCatalog';
import { notify } from '../../utils/notify';

export interface ErrorPageContext {
  repositoryPath?: string;
  errorMessage?: string;
}

type ActionHandler = (errorCode: string, context?: ErrorPageContext) => Promise<void>;

interface ErrorPageData {
  errorDef: ClientErrorDefinition;
  context?: ErrorPageContext;
}

export class ErrorPageWebviewProvider extends BaseWebviewProvider {
  private actionHandlers = new Map<string, ActionHandler>();
  private errorContext?: ErrorPageContext;

  constructor(context: vscode.ExtensionContext) {
    super(context, 'computor.errorPage');
  }

  registerActionHandler(actionId: string, handler: ActionHandler): void {
    this.actionHandlers.set(actionId, handler);
  }

  async showError(errorCode: string, context?: ErrorPageContext): Promise<void> {
    this.errorContext = context;
    const errorDef = clientErrorCatalog.getError(errorCode);
    if (!errorDef) {
      notify.error(`Unknown error code: ${errorCode}`);
      return;
    }
    await this.show(errorDef.title, { errorDef, context });
  }

  protected async getWebviewContent(data?: ErrorPageData): Promise<string> {
    if (!data?.errorDef || !this.panel) {
      return this.getBaseHtml('Error', '<p>No error information available.</p>');
    }

    const { errorDef } = data;

    const headerHtml = `
      <h1>${escapeHtml(errorDef.title)}</h1>
      <p>${escapeHtml(errorDef.summary)}</p>`;

    const actionsHtml = errorDef.actions.map(action => {
      const btnClass = action.style === 'primary' ? '' :
                       action.style === 'danger' ? 'btn-danger' : 'btn-secondary';
      return `<button class="${btnClass}" data-action="${escapeHtml(action.id)}"
                title="${escapeHtml(action.tooltip || '')}">${escapeHtml(action.label)}</button>`;
    }).join('\n');

    const initialState = JSON.stringify({
      description: errorDef.description,
      errorCode: errorDef.code
    });

    const bodyHtml = `
  <div class="section">
    <div id="error-content"></div>
  </div>
  <div class="actions">
    ${actionsHtml}
  </div>`;

    const inlineScript = `
    const state = ${initialState};

    if (typeof marked !== 'undefined' && marked.parse) {
      document.getElementById('error-content').innerHTML = marked.parse(state.description);
    } else {
      document.getElementById('error-content').textContent = state.description;
    }

    document.querySelectorAll('[data-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        vscode.postMessage({
          command: 'action',
          data: { actionId: this.dataset.action, errorCode: state.errorCode }
        });
      });
    });`;

    return this.renderPage({
      title: errorDef.title,
      headerHtml,
      bodyHtml,
      inlineStyles: ERROR_PAGE_STYLES,
      scriptFiles: ['vendor/marked.min.js'],
      inlineScript
    });
  }

  protected async handleMessage(message: any): Promise<void> {
    if (!message || message.command !== 'action') {
      return;
    }

    const { actionId, errorCode } = message.data || {};

    if (actionId === 'DISMISS') {
      this.panel?.dispose();
      return;
    }

    const handler = this.actionHandlers.get(actionId);
    if (handler) {
      await handler(errorCode, this.errorContext);
    }
  }
}

const ERROR_PAGE_STYLES = `
  #error-content h2 {
    margin-top: 24px;
    font-size: 16px;
  }
  #error-content h3 {
    margin-top: 16px;
    font-size: 14px;
  }
  #error-content code {
    background: var(--vscode-textCodeBlock-background);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
    font-size: 12px;
  }
  #error-content pre {
    background: var(--vscode-textCodeBlock-background);
    padding: 12px 16px;
    border-radius: 6px;
    overflow-x: auto;
  }
  #error-content pre code {
    padding: 0;
    background: none;
  }
  #error-content ul, #error-content ol {
    padding-left: 24px;
  }
  #error-content li {
    margin: 4px 0;
  }
  #error-content blockquote {
    border-left: 4px solid var(--vscode-textBlockQuote-border);
    padding: 8px 16px;
    margin: 12px 0;
    background: var(--vscode-textBlockQuote-background);
  }
  #error-content p {
    line-height: 1.6;
  }
`;
