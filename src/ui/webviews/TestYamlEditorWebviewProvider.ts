import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { escapeHtml } from './shared/webviewHelpers';
import blockRegistryJson from '../../data/block-registry.json';

interface TestYamlEditorData {
  filePath: string;
  exampleDir: string;
  exampleTitle?: string;
}

interface BlockRegistryLanguage {
  id: string;
  name: string;
  description?: string;
  file_extensions: string[];
  icon?: string;
  test_types: BlockRegistryTestType[];
  qualifications?: BlockRegistryQualification[];
  defaults?: Record<string, unknown>;
  config_fields?: BlockRegistryField[];
}

interface BlockRegistryTestType {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category?: string;
  qualifications: string[];
  default_qualification?: string;
  collection_fields?: BlockRegistryField[];
  test_fields?: BlockRegistryField[];
  example?: Record<string, unknown>;
}

interface BlockRegistryQualification {
  id: string;
  name: string;
  description: string;
  category?: string;
  uses_value?: boolean;
  uses_pattern?: boolean;
  uses_tolerance?: boolean;
  uses_line_number?: boolean;
  uses_count?: boolean;
  extra_fields?: BlockRegistryField[];
  example?: Record<string, unknown>;
}

interface BlockRegistryField {
  name: string;
  type: string;
  description: string;
  required?: boolean;
  default?: unknown;
  enum_values?: string[] | null;
  array_item_type?: string | null;
  min_value?: number | null;
  max_value?: number | null;
  min_length?: number | null;
  max_length?: number | null;
  pattern?: string | null;
  placeholder?: string | null;
  examples?: unknown[] | null;
}

interface BlockRegistry {
  version: string;
  languages: BlockRegistryLanguage[];
}

export class TestYamlEditorWebviewProvider extends BaseWebviewProvider {
  private blockRegistry: BlockRegistry | undefined;

  constructor(context: vscode.ExtensionContext) {
    super(context, 'computor.testYamlEditor');
  }

  private loadBlockRegistry(): BlockRegistry {
    if (this.blockRegistry) { return this.blockRegistry; }
    this.blockRegistry = blockRegistryJson as unknown as BlockRegistry;
    return this.blockRegistry;
  }

  private detectLanguage(exampleDir: string): string | undefined {
    const registry = this.loadBlockRegistry();
    const files = this.listFilesRecursive(exampleDir);

    for (const lang of registry.languages) {
      for (const ext of lang.file_extensions) {
        if (files.some(f => f.endsWith(ext))) {
          return lang.id;
        }
      }
    }
    return undefined;
  }

  private listFilesRecursive(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) { continue; }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.listFilesRecursive(fullPath));
        } else {
          results.push(entry.name);
        }
      }
    } catch {
      // Directory might not exist yet
    }
    return results;
  }

  private parseTestYaml(filePath: string): Record<string, unknown> | undefined {
    if (!fs.existsSync(filePath)) { return undefined; }
    try {
      const yaml = require('js-yaml');
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private saveTestYaml(filePath: string, data: Record<string, unknown>): void {
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

  protected async getWebviewContent(data?: TestYamlEditorData): Promise<string> {
    if (!data || !this.panel) {
      return this.getBaseHtml('Test Editor', '<p>No data available</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const registry = this.loadBlockRegistry();
    const existingData = this.parseTestYaml(data.filePath);
    const detectedLanguage = existingData?.type as string
      || this.detectLanguage(data.exampleDir);

    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'test-yaml-editor.js');
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'test-yaml-editor.css');

    const initialState = JSON.stringify({
      registry,
      testSuite: existingData || null,
      detectedLanguage: detectedLanguage || null,
      filePath: data.filePath,
      exampleTitle: data.exampleTitle || path.basename(data.exampleDir)
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Test Editor</title>
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
  <div class="header">
    <h1>Test Configuration</h1>
    <p>${escapeHtml(data.exampleTitle || '')} &mdash; test.yaml</p>
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

  private async handleSave(data: { filePath: string; testSuite: Record<string, unknown> }): Promise<void> {
    try {
      this.saveTestYaml(data.filePath, data.testSuite);
      vscode.window.showInformationMessage('test.yaml saved successfully');
      if (this.panel) {
        this.panel.webview.postMessage({ command: 'saved' });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save test.yaml: ${error}`);
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
