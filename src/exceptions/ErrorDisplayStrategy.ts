import * as vscode from 'vscode';
import { BackendErrorDefinition } from './types';

/**
 * Strategy for displaying errors to users
 */
export interface ErrorDisplayStrategy {
  /**
   * Display an error to the user
   * @param error The error definition from the catalog
   * @param additionalContext Optional additional context to include
   */
  display(error: BackendErrorDefinition, additionalContext?: string): void;
}

/**
 * Display errors as simple VS Code notifications
 */
export class NotificationDisplayStrategy implements ErrorDisplayStrategy {
  display(error: BackendErrorDefinition, additionalContext?: string): void {
    const message = this.formatMessage(error, additionalContext);

    switch (error.severity) {
      case 'info':
        vscode.window.showInformationMessage(message);
        break;
      case 'warning':
        vscode.window.showWarningMessage(message);
        break;
      case 'error':
      case 'critical':
        vscode.window.showErrorMessage(message);
        break;
    }
  }

  private formatMessage(error: BackendErrorDefinition, additionalContext?: string): string {
    let message = error.message.plain;

    if (additionalContext) {
      message = `${message}\n${additionalContext}`;
    }

    return message;
  }
}

/**
 * Display errors with action buttons (Retry, Details, etc.)
 */
export class InteractiveDisplayStrategy implements ErrorDisplayStrategy {
  constructor(
    private onRetry?: () => Promise<void>,
    private onShowDetails?: (error: BackendErrorDefinition) => void
  ) {}

  async display(error: BackendErrorDefinition, additionalContext?: string): Promise<void> {
    const message = this.formatMessage(error, additionalContext);
    const actions: string[] = [];

    // Add retry button for retryable errors
    if (this.onRetry && this.isRetryable(error)) {
      actions.push('Retry');
    }

    // Always add details button
    if (this.onShowDetails) {
      actions.push('Show Details');
    }

    let selectedAction: string | undefined;

    switch (error.severity) {
      case 'info':
        selectedAction = await vscode.window.showInformationMessage(message, ...actions);
        break;
      case 'warning':
        selectedAction = await vscode.window.showWarningMessage(message, ...actions);
        break;
      case 'error':
      case 'critical':
        selectedAction = await vscode.window.showErrorMessage(message, ...actions);
        break;
    }

    await this.handleAction(selectedAction, error);
  }

  private async handleAction(action: string | undefined, error: BackendErrorDefinition): Promise<void> {
    if (!action) {
      return;
    }

    if (action === 'Retry' && this.onRetry) {
      try {
        await this.onRetry();
      } catch (retryError) {
        vscode.window.showErrorMessage(`Retry failed: ${retryError}`);
      }
    } else if (action === 'Show Details' && this.onShowDetails) {
      this.onShowDetails(error);
    }
  }

  private formatMessage(error: BackendErrorDefinition, additionalContext?: string): string {
    let message = error.message.plain;

    if (additionalContext) {
      message = `${message}\n\n${additionalContext}`;
    }

    return message;
  }

  private isRetryable(error: BackendErrorDefinition): boolean {
    // Retry for network/service errors or rate limits
    return (
      error.category === 'external_service' ||
      error.category === 'database' ||
      error.category === 'rate_limit' ||
      error.retry_after !== null
    );
  }
}

/**
 * Display errors in a markdown document (detailed view)
 */
export class DetailedMarkdownDisplayStrategy implements ErrorDisplayStrategy {
  async display(error: BackendErrorDefinition, additionalContext?: string): Promise<void> {
    const markdown = this.formatMarkdown(error, additionalContext);

    const doc = await vscode.workspace.openTextDocument({
      content: markdown,
      language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside
    });
  }

  private formatMarkdown(error: BackendErrorDefinition, additionalContext?: string): string {
    const parts = [
      `# ${error.title}`,
      '',
      `**Error Code:** \`${error.code}\`  `,
      `**HTTP Status:** ${error.http_status}  `,
      `**Category:** ${error.category}  `,
      `**Severity:** ${error.severity}  `,
      '',
      '## Message',
      '',
      error.message.markdown,
      ''
    ];

    if (error.retry_after) {
      parts.push(`**Retry After:** ${error.retry_after} seconds`, '');
    }

    if (additionalContext) {
      parts.push('## Additional Context', '', additionalContext, '');
    }

    parts.push(
      '---',
      '',
      `*Generated from backend error catalog*`
    );

    return parts.join('\n');
  }
}

/**
 * Factory to create appropriate display strategy based on context
 */
export class ErrorDisplayStrategyFactory {
  static createStrategy(
    type: 'notification' | 'interactive' | 'detailed',
    options?: {
      onRetry?: () => Promise<void>;
      onShowDetails?: (error: BackendErrorDefinition) => void;
    }
  ): ErrorDisplayStrategy {
    switch (type) {
      case 'notification':
        return new NotificationDisplayStrategy();
      case 'interactive':
        return new InteractiveDisplayStrategy(options?.onRetry, options?.onShowDetails);
      case 'detailed':
        return new DetailedMarkdownDisplayStrategy();
      default:
        return new NotificationDisplayStrategy();
    }
  }
}
