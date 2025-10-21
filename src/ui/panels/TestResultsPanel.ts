import * as vscode from 'vscode';

interface ResultsTreeNode {
    label: string;
    isTest?: boolean;
    passed?: boolean;
    collapsibleState?: vscode.TreeItemCollapsibleState;
    children?: ResultsTreeNode[];
    description?: string;
    toolTip?: string | vscode.MarkdownString | undefined;
    themeIcon?: vscode.ThemeIcon | undefined;
    message?: string;
}

export class TestResultsTreeDataProvider implements vscode.TreeDataProvider<ResultsTreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<ResultsTreeNode | undefined | null | void> = new vscode.EventEmitter<ResultsTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ResultsTreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private testResults: any) {
    }

    refresh(testResults: any): void {
        this.testResults = testResults;
        this._onDidChangeTreeData.fire();
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

        treeItem.command = { 
            command: "computor.results.panel.update", 
            title: "Click", 
            arguments: [element] 
        };

        return treeItem;
    }

    getChildren(element?: any): any[] {
        if (!element) {
            return this.convertToNodes(this.testResults);
        }
        return element.children || [];
    }

    convertToNodes(data: Record<string, any>): ResultsTreeNode[] {
        // Handle error field in the result payload
        if (!Array.isArray(data) && 'error' in data && typeof data.error === 'string') {
            const errorChildren: ResultsTreeNode[] = [
                {
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
                    label: `Tests: ${passed} passed, ${failed} failed, ${total} total`,
                    themeIcon: new vscode.ThemeIcon('graph-line')
                });
            }

            // Add result value if available
            if ('result_value' in data) {
                const percentage = Math.round((data.result_value ?? 0) * 100);
                errorChildren.push({
                    label: `Result: ${percentage}%`,
                    themeIcon: new vscode.ThemeIcon('symbol-numeric')
                });
            }

            return [{
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
            return data.map((item) => {
                const totalSubtests = item.tests ? item.tests.length : 0;
                const passedSubtests = item.tests ? item.tests.filter((subtest: any) => subtest.result === 'PASSED').length : 0;
                const allSubtestsPassed = totalSubtests === passedSubtests;
                const failed = !allSubtestsPassed;
    
                let treeValue: ResultsTreeNode = {
                    label: item.name ? item.name : 'Unnamed Item',
                    description: totalSubtests > 0 ? `[${passedSubtests}/${totalSubtests}]` : '',
                    passed: item.result === 'PASSED' && allSubtestsPassed,
                    isTest: true,
                    toolTip: undefined,
                    collapsibleState: item.tests && item.tests.length > 0
                        ? (failed ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
                        : vscode.TreeItemCollapsibleState.None,
                    children: item.tests ? this.convertToNodes(item.tests) : undefined
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
            const treeItems: Array<any> = [];

            if ('type' in data) {
                let labelHead = data.type;
                let descriptionHead: any = undefined;
                let toolTipHead: any = undefined;

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

                const childrenHead: Array<ResultsTreeNode> = [];

                if ('environment' in data) {
                    const subs = Object.entries(data.environment).map(([key, value]) => {
                        if (typeof value === "object") {
                            return { label: `${key}: ${JSON.stringify(value)}` };
                        } else {
                            return { label: `${key}: ${value}` };
                        }
                    });

                    childrenHead.push({
                        label: 'Environment',
                        description: undefined,
                        toolTip: 'Environment',
                        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                        children: subs
                    });
                }

                if ('summary' in data) {
                    const subs = Object.entries(data.summary).map(([key, value]) => {
                        return { 
                            label: `${key}: ${value}`, 
                            themeIcon: new vscode.ThemeIcon('debug-console-evaluation-input') 
                        };
                    });

                    childrenHead.push({
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
                    label: labelHead,
                    description: descriptionHead,
                    toolTip: toolTipHead,
                    children: childrenHead,
                    collapsibleState: collapsibleState,
                    themeIcon: new vscode.ThemeIcon('debug-console'),
                } as ResultsTreeNode);
            }

            if ('tests' in data) {
                let labelIdentifier = "";
                let toolTipIdentifier: any = undefined;
                let messageIdentifier: any = undefined;

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
                    label: labelIdentifier,
                    description: `[${passedTests}/${totalTests}]`,
                    passed: allTestsPassed,
                    toolTip: toolTipIdentifier,
                    collapsibleState: tests.length > 0
                        ? (failed ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
                        : vscode.TreeItemCollapsibleState.None,
                    children: this.convertToNodes(tests),
                    message: messageIdentifier
                } as ResultsTreeNode);
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
        // Update tree provider if it exists
        // if (this.testResultsTreeProvider && testResults !== undefined) {
        //     this.testResultsTreeProvider.refresh(testResults);
        // }
        
        // Update webview content
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

    // public setTreeProvider(provider: TestResultsTreeDataProvider): void {
    //     this.testResultsTreeProvider = provider;
    // }

    private buildMessage(value: any): { label: string; message: string } {
        let message = "No test results available";
        let label = "Test Results";
        
        if (value !== undefined) {
            if ('message' in value) {
                message = value.message;
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
                html += `<li><strong>${key}:</strong> ${value}</li>`;
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
                html += `<span class="test-name">${test.name || 'Unnamed Test'}</span>`;
                
                if (test.resultMessage) {
                    html += `<div class="test-message">${test.resultMessage}</div>`;
                }
                
                html += '</li>';
            }
            
            html += '</ul>';
            html += '</div>';
        }
        
        html += '</div>';
        return html;
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
                    white-space: pre-wrap;
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