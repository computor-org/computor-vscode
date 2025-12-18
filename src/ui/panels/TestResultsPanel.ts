import * as vscode from 'vscode';
import { ResultArtifactInfo } from '../../types/generated/common';

interface ResultsTreeNode {
    id: string;
    label: string;
    isTest?: boolean;
    passed?: boolean;
    collapsibleState?: vscode.TreeItemCollapsibleState;
    children?: ResultsTreeNode[];
    description?: string;
    toolTip?: string | vscode.MarkdownString | undefined;
    themeIcon?: vscode.ThemeIcon | undefined;
    message?: string;
    isArtifact?: boolean;
    artifactInfo?: ResultArtifactInfo;
    resultId?: string;
}

export interface ResultWithArtifacts {
    resultId?: string;
    result_artifacts?: ResultArtifactInfo[];
    [key: string]: any;
}

export class TestResultsTreeDataProvider implements vscode.TreeDataProvider<ResultsTreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<ResultsTreeNode | undefined | null | void> = new vscode.EventEmitter<ResultsTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ResultsTreeNode | undefined | null | void> = this._onDidChangeTreeData.event;
    private selectedNodeId: string | undefined;
    private panelProvider: TestResultsPanelProvider | undefined;
    private resultArtifacts: ResultArtifactInfo[] = [];
    private currentResultId: string | undefined;

    constructor(private testResults: any) {
    }

    setResultArtifacts(resultId: string, artifacts: ResultArtifactInfo[]): void {
        this.currentResultId = resultId;
        this.resultArtifacts = artifacts || [];
    }

    clearResultArtifacts(): void {
        this.currentResultId = undefined;
        this.resultArtifacts = [];
    }

    setPanelProvider(panelProvider: TestResultsPanelProvider): void {
        this.panelProvider = panelProvider;
    }

    setSelectedNodeId(nodeId: string): void {
        this.selectedNodeId = nodeId;
    }

    refresh(testResults: any): void {
        this.testResults = testResults;
        this._onDidChangeTreeData.fire();

        if (this.panelProvider) {
            const nodes = this.convertToNodes(this.testResults);
            const selectedNode = this.selectedNodeId
                ? this.findNodeById(nodes, this.selectedNodeId)
                : undefined;

            if (selectedNode) {
                this.panelProvider.updateTestResults(selectedNode);
            } else {
                this.panelProvider.clearResults();
            }
        }
    }

    private findNodeById(nodes: ResultsTreeNode[], id: string): ResultsTreeNode | undefined {
        for (const node of nodes) {
            if (node.id === id) {
                return node;
            }
            if (node.children) {
                const found = this.findNodeById(node.children, id);
                if (found) {
                    return found;
                }
            }
        }
        return undefined;
    }

    getTreeItem(element: ResultsTreeNode): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(
            element.label,
            element.children && element.children.length > 0
                ? element.collapsibleState
                : vscode.TreeItemCollapsibleState.None
        );

        if (element.description) {
            treeItem.description = element.description;
        }

        if (element.passed !== undefined) {
            treeItem.iconPath = element.passed
                ? new vscode.ThemeIcon('check', new vscode.ThemeColor('terminal.ansiGreen'))
                : new vscode.ThemeIcon('x', new vscode.ThemeColor('errorForeground'));
        } else if (element.themeIcon !== undefined) {
            treeItem.iconPath = element.themeIcon;
        }

        if (element.toolTip) {
            treeItem.tooltip = element.toolTip;
        }

        if (element.isArtifact && element.artifactInfo && element.resultId) {
            treeItem.command = {
                command: "computor.results.artifact.open",
                title: "Open Artifact",
                arguments: [element.resultId, element.artifactInfo]
            };
            treeItem.contextValue = 'resultArtifact';
        } else {
            treeItem.command = {
                command: "computor.results.panel.update",
                title: "Click",
                arguments: [element]
            };
        }

        return treeItem;
    }

    getChildren(element?: any): any[] {
        if (!element) {
            const nodes: ResultsTreeNode[] = [];

            if (this.resultArtifacts.length > 0 && this.currentResultId) {
                const artifactsNode = this.createArtifactsNode();
                nodes.push(artifactsNode);
            }

            nodes.push(...this.convertToNodes(this.testResults));
            return nodes;
        }
        return element.children || [];
    }

    private createArtifactsNode(): ResultsTreeNode {
        const artifactChildren: ResultsTreeNode[] = this.resultArtifacts.map(artifact => ({
            id: `artifact/${artifact.id}`,
            label: artifact.filename,
            description: this.formatFileSize(artifact.file_size),
            toolTip: this.getFileTypeDescription(artifact.filename, artifact.content_type),
            themeIcon: this.getFileIcon(artifact.filename),
            isArtifact: true,
            artifactInfo: artifact,
            resultId: this.currentResultId
        }));

        return {
            id: 'artifacts',
            label: 'Artifacts',
            description: `(${this.resultArtifacts.length})`,
            toolTip: 'Test result artifacts - click to download and open',
            themeIcon: new vscode.ThemeIcon('package'),
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            children: artifactChildren
        };
    }

    private getFileExtension(filename: string): string {
        return filename.toLowerCase().split('.').pop() || '';
    }

    private getFileTypeDescription(filename: string, contentType?: string | null): string {
        const ext = this.getFileExtension(filename);

        const fileTypes: Record<string, string> = {
            'png': 'PNG Image',
            'jpg': 'JPEG Image',
            'jpeg': 'JPEG Image',
            'gif': 'GIF Image',
            'bmp': 'Bitmap Image',
            'webp': 'WebP Image',
            'svg': 'SVG Vector Image',
            'ico': 'Icon File',
            'pdf': 'PDF Document',
            'txt': 'Text File',
            'json': 'JSON File',
            'xml': 'XML File',
            'html': 'HTML File',
            'css': 'CSS Stylesheet',
            'js': 'JavaScript File',
            'ts': 'TypeScript File',
            'py': 'Python File',
            'java': 'Java File',
            'c': 'C Source File',
            'cpp': 'C++ Source File',
            'h': 'C/C++ Header File',
            'md': 'Markdown File',
            'yaml': 'YAML File',
            'yml': 'YAML File',
            'csv': 'CSV File',
            'log': 'Log File',
            'zip': 'ZIP Archive',
            'tar': 'TAR Archive',
            'gz': 'GZip Archive',
            'rar': 'RAR Archive',
            '7z': '7-Zip Archive'
        };

        if (fileTypes[ext]) {
            return fileTypes[ext]!;
        }

        if (contentType) {
            return contentType;
        }

        return ext ? `${ext.toUpperCase()} File` : 'File';
    }

    private getFileIcon(filename: string): vscode.ThemeIcon {
        const ext = this.getFileExtension(filename);

        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'];
        const codeExtensions = ['js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php'];
        const dataExtensions = ['json', 'xml', 'yaml', 'yml', 'csv'];
        const archiveExtensions = ['zip', 'tar', 'gz', 'rar', '7z'];

        if (imageExtensions.includes(ext)) {
            return new vscode.ThemeIcon('file-media');
        } else if (codeExtensions.includes(ext)) {
            return new vscode.ThemeIcon('file-code');
        } else if (dataExtensions.includes(ext)) {
            return new vscode.ThemeIcon('file-code');
        } else if (archiveExtensions.includes(ext)) {
            return new vscode.ThemeIcon('file-zip');
        } else if (ext === 'pdf') {
            return new vscode.ThemeIcon('file-pdf');
        } else if (ext === 'md') {
            return new vscode.ThemeIcon('markdown');
        } else if (ext === 'txt' || ext === 'log') {
            return new vscode.ThemeIcon('file-text');
        }

        return new vscode.ThemeIcon('file');
    }

    private formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        } else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        } else {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }
    }

    convertToNodes(data: Record<string, any>, parentPath: string = ''): ResultsTreeNode[] {
        // Handle error field in the result payload
        if (!Array.isArray(data) && 'error' in data && typeof data.error === 'string') {
            const errorId = parentPath ? `${parentPath}/error` : 'error';
            const errorChildren: ResultsTreeNode[] = [
                {
                    id: `${errorId}/message`,
                    label: data.error,
                    themeIcon: new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'))
                }
            ];

            // Add test statistics if available
            if ('passed' in data || 'failed' in data || 'total' in data) {
                const passed = data.passed ?? 0;
                const failed = data.failed ?? 0;
                const total = data.total ?? (passed + failed);
                errorChildren.push({
                    id: `${errorId}/stats`,
                    label: `Tests: ${passed} passed, ${failed} failed, ${total} total`,
                    themeIcon: new vscode.ThemeIcon('graph-line')
                });
            }

            // Add result value if available
            if ('result_value' in data) {
                const percentage = Math.round((data.result_value ?? 0) * 100);
                errorChildren.push({
                    id: `${errorId}/result`,
                    label: `Result: ${percentage}%`,
                    themeIcon: new vscode.ThemeIcon('symbol-numeric')
                });
            }

            return [{
                id: errorId,
                label: 'Test Execution Error',
                description: undefined,
                passed: false,
                isTest: false,
                toolTip: data.error,
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                themeIcon: new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground')),
                message: data.error,
                children: errorChildren
            }];
        }

        if (Array.isArray(data)) {
            return data.map((item, index) => {
                const itemName = item.name ? item.name : `item-${index}`;
                const itemId = parentPath ? `${parentPath}/${itemName}` : itemName;
                const totalSubtests = item.tests ? item.tests.length : 0;
                const passedSubtests = item.tests ? item.tests.filter((subtest: any) => subtest.result === 'PASSED').length : 0;
                const allSubtestsPassed = totalSubtests === passedSubtests;
                const failed = !allSubtestsPassed;

                const treeValue: ResultsTreeNode = {
                    id: itemId,
                    label: item.name ? item.name : 'Unnamed Item',
                    description: totalSubtests > 0 ? `[${passedSubtests}/${totalSubtests}]` : '',
                    passed: item.result === 'PASSED' && allSubtestsPassed,
                    isTest: true,
                    toolTip: undefined,
                    collapsibleState: item.tests && item.tests.length > 0
                        ? (failed ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
                        : vscode.TreeItemCollapsibleState.None,
                    children: item.tests ? this.convertToNodes(item.tests, itemId) : undefined
                };

                if ("type" in item && "result" in item && "name" in item && "summary" in item) {
                    treeValue.description += " " + item.type;
                }

                if ("resultMessage" in item) {
                    treeValue.toolTip = item.resultMessage;
                    treeValue.message = item.resultMessage;
                }

                return treeValue;
            });
        } else {
            const treeItems: ResultsTreeNode[] = [];

            if ('type' in data) {
                const headId = parentPath ? `${parentPath}/${data.type}` : data.type;
                let labelHead = data.type;
                let descriptionHead: string | undefined = undefined;
                let toolTipHead: string | undefined = undefined;

                if ('timestamp' in data) {
                    // Convert UTC timestamp to local time
                    try {
                        const date = new Date(data.timestamp);
                        descriptionHead = date.toLocaleString();
                    } catch (e) {
                        // Fallback to raw timestamp if parsing fails
                        descriptionHead = `${data.timestamp}`;
                    }
                }

                if ('description' in data) {
                    toolTipHead = data.description;
                }

                if ('version' in data) {
                    toolTipHead += ` ${data.version}`;
                }

                const childrenHead: ResultsTreeNode[] = [];

                if ('environment' in data) {
                    const envId = `${headId}/environment`;
                    const subs = Object.entries(data.environment).map(([key, value], idx) => {
                        if (typeof value === "object") {
                            return { id: `${envId}/${key}`, label: `${key}: ${JSON.stringify(value)}` };
                        } else {
                            return { id: `${envId}/${key}`, label: `${key}: ${value}` };
                        }
                    });

                    childrenHead.push({
                        id: envId,
                        label: 'Environment',
                        description: undefined,
                        toolTip: 'Environment',
                        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                        children: subs
                    });
                }

                if ('summary' in data) {
                    const summaryId = `${headId}/summary`;
                    const subs = Object.entries(data.summary).map(([key, value]) => {
                        return {
                            id: `${summaryId}/${key}`,
                            label: `${key}: ${value}`,
                            themeIcon: new vscode.ThemeIcon('debug-console-evaluation-input')
                        };
                    });

                    childrenHead.push({
                        id: summaryId,
                        label: 'Summary',
                        description: undefined,
                        toolTip: 'Summary',
                        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                        themeIcon: new vscode.ThemeIcon('bracket-dot'),
                        children: subs
                    });
                }

                let collapsibleState = vscode.TreeItemCollapsibleState.None;

                if (childrenHead.length > 0) {
                    collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                }

                treeItems.push({
                    id: headId,
                    label: labelHead,
                    description: descriptionHead,
                    toolTip: toolTipHead,
                    children: childrenHead,
                    collapsibleState: collapsibleState,
                    themeIcon: new vscode.ThemeIcon('debug-console'),
                });
            }

            if ('tests' in data) {
                const testName = 'name' in data ? data.name : 'tests';
                const testsId = parentPath ? `${parentPath}/${testName}` : testName;
                let labelIdentifier = "";
                let toolTipIdentifier: string | undefined = undefined;
                let messageIdentifier: string | undefined = undefined;

                if ('resultMessage' in data) {
                    toolTipIdentifier = data.resultMessage;
                    messageIdentifier = data.resultMessage;
                }

                if ('name' in data) {
                    labelIdentifier = data.name;
                }

                const tests = data.tests;
                const totalTests = tests.length;
                const passedTests = tests.filter((test: { result: string; }) => test.result === 'PASSED').length;
                const allTestsPassed = totalTests === passedTests;
                const failed = !allTestsPassed;

                treeItems.push({
                    id: testsId,
                    label: labelIdentifier,
                    description: `[${passedTests}/${totalTests}]`,
                    passed: allTestsPassed,
                    toolTip: toolTipIdentifier,
                    collapsibleState: tests.length > 0
                        ? (failed ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
                        : vscode.TreeItemCollapsibleState.None,
                    children: this.convertToNodes(tests, testsId),
                    message: messageIdentifier
                });
            }

            return treeItems;
        }
    }
}

export class TestResultsPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'computor.testResultsPanel';
    private view?: vscode.WebviewView;
    private value?: any;
    //private testResultsTreeProvider?: TestResultsTreeDataProvider;

    constructor(private readonly extensionUri: vscode.Uri) {
        this.value = this.buildMessage(undefined);
    }

    public updateTestResults(testResults: any): void {
        this.value = this.buildMessage(testResults);
        if (this.view) {
            this.view.webview.postMessage({
                message: "results-update",
                data: {
                    message: this.value.message,
                    label: this.value.label
                }
            });
        }
    }

    public clearResults(): void {
        this.value = this.buildMessage(undefined);
        if (this.view) {
            this.view.webview.postMessage({
                message: "results-update",
                data: {
                    message: this.value.message,
                    label: this.value.label
                }
            });
        }
    }

    // public setTreeProvider(provider: TestResultsTreeDataProvider): void {
    //     this.testResultsTreeProvider = provider;
    // }

    private buildMessage(value: any): { label: string; message: string } {
        let message = "No test results available";
        let label = "Test Results";

        if (value !== undefined) {
            if ('message' in value) {
                message = this.escapeHtml(value.message);
            } else if (value.result_json) {
                // Parse the test results
                try {
                    const results = typeof value.result_json === 'string' 
                        ? JSON.parse(value.result_json) 
                        : value.result_json;
                    
                    message = this.formatTestResults(results);
                    label = results.name || "Test Results";
                } catch (error) {
                    message = "Error parsing test results";
                    console.error('Error parsing test results:', error);
                }
            } else if (typeof value === 'object') {
                // message = `<pre>${JSON.stringify(value, null, 2)}</pre>`;
                message = '-';
            }
            
            if ('label' in value) {
                label = value.label;
            }
        }

        return { label, message };
    }

    private formatTestResults(results: any): string {
        let html = '<div class="test-results">';

        // Summary section
        if (results.summary) {
            html += '<div class="summary">';
            html += '<h3>Summary</h3>';
            html += '<ul>';
            for (const [key, value] of Object.entries(results.summary)) {
                html += `<li><strong>${this.escapeHtml(String(key))}:</strong> ${this.escapeHtml(String(value))}</li>`;
            }
            html += '</ul>';
            html += '</div>';
        }

        // Test details
        if (results.tests && Array.isArray(results.tests)) {
            html += '<div class="tests">';
            html += '<h3>Test Results</h3>';
            html += '<ul class="test-list">';

            for (const test of results.tests) {
                const passed = test.result === 'PASSED';
                const icon = passed ? '✅' : '❌';
                const className = passed ? 'passed' : 'failed';

                html += `<li class="test-item ${className}">`;
                html += `<span class="test-icon">${icon}</span>`;
                html += `<span class="test-name">${this.escapeHtml(test.name || 'Unnamed Test')}</span>`;

                if (test.resultMessage) {
                    html += `<div class="test-message">${this.formatMessage(test.resultMessage)}</div>`;
                }

                html += '</li>';
            }

            html += '</ul>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    private escapeHtml(text: string): string {
        const div = { textContent: text } as any;
        const escaped = div.textContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        return escaped;
    }

    private formatMessage(message: string): string {
        // Escape HTML - newlines will be preserved by CSS white-space: pre
        return this.escapeHtml(message);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent();

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'refresh':
                        // Refresh test results
                        break;
                }
            },
            undefined,
            []
        );
    }

    private getHtmlContent(): string {
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view?.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    margin: 0;
                    padding: 12px;
                }
                
                .header {
                    font-size: 14px;
                    font-weight: bold;
                    margin-bottom: 12px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                
                .content {
                    padding: 8px 0;
                    white-space: pre-wrap;
                    font-family: var(--vscode-editor-font-family);
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                }
                
                .test-results {
                    font-family: var(--vscode-editor-font-family);
                }
                
                .summary {
                    margin-bottom: 16px;
                }
                
                .summary h3, .tests h3 {
                    font-size: 13px;
                    font-weight: bold;
                    margin: 8px 0;
                }
                
                .summary ul, .test-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                
                .summary li {
                    padding: 2px 0;
                }
                
                .test-item {
                    padding: 4px 0;
                    margin: 2px 0;
                    display: flex;
                    align-items: flex-start;
                }
                
                .test-item.passed {
                    color: var(--vscode-testing-iconPassed);
                }
                
                .test-item.failed {
                    color: var(--vscode-testing-iconFailed);
                }
                
                .test-icon {
                    margin-right: 8px;
                    flex-shrink: 0;
                }
                
                .test-name {
                    font-weight: 500;
                }
                
                .test-message {
                    margin-top: 4px;
                    margin-left: 24px;
                    font-size: 12px;
                    opacity: 0.8;
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                    white-space: pre;
                    font-family: var(--vscode-editor-font-family);
                }
                
                pre {
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                    overflow: auto;
                }
                
                .no-results {
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                }
            </style>
        </head>
        <body>
            <div class="header" id="header">${this.value?.label || 'Test Results'}</div>
            <div class="content" id="content">${this.value?.message || '<span class="no-results">No test results available</span>'}</div>
            
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.message === 'results-update') {
                        document.getElementById('header').innerText = message.data.label;
                        document.getElementById('content').innerHTML = message.data.message;
                    }
                });
            </script>
        </body>
        </html>`;
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}