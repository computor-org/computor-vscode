import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { escapeHtml } from './shared/webviewHelpers';
import { notify } from '../../utils/notify';

interface MetaYamlEditorData {
  filePath: string;
  exampleDir: string;
  exampleTitle?: string;
  languages?: { code: string; name: string }[];
}

export class MetaYamlEditorWebviewProvider extends BaseWebviewProvider {
  private fileWatcher: vscode.FileSystemWatcher | undefined;

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
    const excludeDirs = new Set(['content', '.git', 'node_modules']);
    const excludeFiles = new Set(['meta.yaml', 'test.yaml']);
    try {
      const scanDir = (dir: string, prefix: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) { continue; }
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            if (!prefix && excludeDirs.has(entry.name)) { continue; }
            scanDir(path.join(dir, entry.name), rel);
          } else {
            if (!prefix && excludeFiles.has(entry.name)) { continue; }
            results.push(rel);
          }
        }
      };
      if (fs.existsSync(exampleDir)) {
        scanDir(exampleDir, '');
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

    const existingData = this.parseMetaYaml(data.filePath);
    const exampleFiles = this.listExampleFiles(data.exampleDir);

    this.setupFileWatcher(data.exampleDir);

    return this.renderPage({
      title: 'Meta Editor',
      headerHtml: `<h1>Example Configuration</h1>
    <p>${escapeHtml(data.exampleTitle || '')} &mdash; meta.yaml</p>`,
      bodyHtml: '<div id="app"></div>',
      cssFiles: ['meta-yaml-editor.css'],
      scriptFiles: ['meta-yaml-editor.js'],
      initialState: {
        meta: existingData || null,
        filePath: data.filePath,
        exampleDir: data.exampleDir,
        exampleTitle: data.exampleTitle || path.basename(data.exampleDir),
        exampleFiles,
        languages: data.languages || []
      }
    });
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
      notify.info('meta.yaml saved successfully');
      if (this.panel) {
        this.panel.webview.postMessage({ command: 'saved' });
      }
    } catch (error) {
      notify.error(`Failed to save meta.yaml: ${error}`);
    }
  }

  private setupFileWatcher(exampleDir: string): void {
    this.disposeFileWatcher();
    const pattern = new vscode.RelativePattern(exampleDir, '**/*');
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    const sendUpdate = () => {
      if (this.panel) {
        const files = this.listExampleFiles(exampleDir);
        this.panel.webview.postMessage({ command: 'updateFiles', files });
      }
    };

    this.fileWatcher.onDidCreate(sendUpdate);
    this.fileWatcher.onDidDelete(sendUpdate);
  }

  private disposeFileWatcher(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = undefined;
    }
  }

  protected override onPanelDisposed(): void {
    this.disposeFileWatcher();
  }

  private async handleOpenFile(filePath: string): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
    } catch (error) {
      notify.error(`Failed to open file: ${error}`);
    }
  }
}
