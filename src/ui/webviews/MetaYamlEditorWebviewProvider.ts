import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { escapeHtml } from './shared/webviewHelpers';

interface MetaYamlEditorData {
  filePath: string;
  exampleDir: string;
  exampleTitle?: string;
  languages?: { code: string; name: string }[];
}

export class MetaYamlEditorWebviewProvider extends BaseWebviewProvider {
  constructor(context: vscode.ExtensionContext) {
    super(context, 'computor.metaYamlEditor');
  }

  private parseMetaYaml(filePath: string): Record<string, unknown> | undefined {
    if (!fs.existsSync(filePath)) { return undefined; }
    try {
      const yaml = require('js-yaml');
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private saveMetaYaml(filePath: string, data: Record<string, unknown>): void {
    const yaml = require('js-yaml');
    const content = yaml.dump(data, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
      quotingType: "'",
      forceQuotes: false
    });
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf8');
  }

  private listExampleFiles(exampleDir: string): string[] {
    const results: string[] = [];
    const contentDir = path.join(exampleDir, 'content');
    try {
      const scanDir = (dir: string, prefix: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) { continue; }
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            scanDir(path.join(dir, entry.name), rel);
          } else {
            results.push(rel);
          }
        }
      };
      if (fs.existsSync(contentDir)) {
        scanDir(contentDir, '');
      }
    } catch {
      // Directory might not exist
    }
    return results;
  }

  protected async getWebviewContent(data?: MetaYamlEditorData): Promise<string> {
    if (!data || !this.panel) {
      return this.getBaseHtml('Meta Editor', '<p>No data available</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const existingData = this.parseMetaYaml(data.filePath);
    const exampleFiles = this.listExampleFiles(data.exampleDir);

    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'meta-yaml-editor.js');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'meta-yaml-editor.css');

    const initialState = JSON.stringify({
      meta: existingData || null,
      filePath: data.filePath,
      exampleDir: data.exampleDir,
      exampleTitle: data.exampleTitle || path.basename(data.exampleDir),
      exampleFiles,
      languages: data.languages || []
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Meta Editor</title>
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
  <div class="header">
    <h1>Example Configuration</h1>
    <p>${escapeHtml(data.exampleTitle || '')} &mdash; meta.yaml</p>
  </div>
  <div id="app"></div>
  <script nonce="${nonce}">
    window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
    window.__INITIAL_STATE__ = ${initialState};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'save':
        await this.handleSave(message.data);
        break;
      case 'openFile':
        await this.handleOpenFile(message.data.filePath);
        break;
    }
  }

  private async handleSave(data: { filePath: string; meta: Record<string, unknown> }): Promise<void> {
    try {
      this.saveMetaYaml(data.filePath, data.meta);
      vscode.window.showInformationMessage('meta.yaml saved successfully');
      if (this.panel) {
        this.panel.webview.postMessage({ command: 'saved' });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save meta.yaml: ${error}`);
    }
  }

  private async handleOpenFile(filePath: string): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  }
}
