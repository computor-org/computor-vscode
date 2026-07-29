import * as vscode from 'vscode';
import { ResultArtifactInfo } from '../../types/generated/common';
import { escapeHtml } from '../webviews/shared/webviewHelpers';
import { renderWebviewPage } from '../webviews/shared/webviewPage';

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
    private resultFingerprint: string | undefined;

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
        const fingerprint = this.fingerprint(testResults);
        // The results view is also refreshed with the payload it already shows
        // (tree selection, view becoming visible again). Only a genuinely new
        // result should reset the details panel.
        const isNewResult = fingerprint !== this.resultFingerprint;

        this.testResults = testResults;
        this.resultFingerprint = fingerprint;
        this._onDidChangeTreeData.fire();

        if (isNewResult) {
            // Refreshing rebuilds every node, so the tree drops its selection.
            // Drop ours too, otherwise the previous run's detail stays on
            // screen and looks like failures survived a passing run (#281).
            this.selectedNodeId = undefined;
        }

        if (!this.panelProvider) {
            return;
        }

        const selectedNode = this.selectedNodeId
            ? this.findNodeById(this.convertToNodes(this.testResults), this.selectedNodeId)
            : undefined;

        if (selectedNode) {
            this.panelProvider.showDetails(selectedNode);
        } else {
            this.selectedNodeId = undefined;
            this.panelProvider.clearDetails(this.hasResults());
        }
    }

    private hasResults(): boolean {
        return !!this.testResults
            && typeof this.testResults === 'object'
            && Object.keys(this.testResults).length > 0;
    }

    private fingerprint(testResults: any): string {
        try {
            return JSON.stringify(testResults ?? null);
        } catch {
            return String(testResults);
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
                    // Concatenating onto an unset tooltip used to render a
                    // literal "undefined 1.2.3"; the details view shows this
                    // text, so build it defensively.
                    toolTipHead = toolTipHead ? `${toolTipHead} ${data.version}` : `${data.version}`;
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

/** What the details view currently shows: one Result Tree entry, or a hint. */
interface ResultDetails {
    label: string;
    /** Already-escaped HTML for the body. */
    body: string;
}

/**
 * The "Result Details" view. It shows the details of the entry selected in the
 * "Result Tree" — nothing else. It deliberately does not render the whole
 * result: that would duplicate the tree standing right next to it, and the
 * duplicate is what went stale in issues #280 and #281.
 */
export class TestResultsPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'computor.testResultsPanel';
    private view?: vscode.WebviewView;
    private details: ResultDetails;

    constructor(private readonly extensionUri: vscode.Uri) {
        this.details = this.emptyDetails(false);
    }

    /** Show the details of the Result Tree entry the user just selected. */
    public showDetails(node: any): void {
        this.details = this.buildDetails(node);
        this.postDetails();
    }

    /**
     * Nothing is selected: prompt for a selection when a result is loaded,
     * otherwise say there is nothing to show.
     */
    public clearDetails(hasResults: boolean): void {
        this.details = this.emptyDetails(hasResults);
        this.postDetails();
    }

    private postDetails(): void {
        // No-op while the view is hidden; the webview asks for the current
        // details again as soon as it is (re-)created, see getHtmlContent().
        void this.view?.webview.postMessage({
            command: 'resultsUpdate',
            data: this.details
        });
    }

    private emptyDetails(hasResults: boolean): ResultDetails {
        return {
            label: 'Result Details',
            body: hasResults
                ? '<span class="no-results">Select an entry in the Result Tree to see its details.</span>'
                : '<span class="no-results">No test results available</span>'
        };
    }

    private buildDetails(node: any): ResultDetails {
        if (!node || typeof node !== 'object') {
            return this.emptyDetails(true);
        }

        const label = typeof node.label === 'string' && node.label ? node.label : 'Result Details';
        const parts: string[] = [];

        if (typeof node.passed === 'boolean') {
            parts.push(node.passed
                ? '<div class="detail-status passed">✅ Passed</div>'
                : '<div class="detail-status failed">❌ Failed</div>');
        }

        if (typeof node.description === 'string' && node.description.trim()) {
            parts.push(`<div class="detail-meta">${escapeHtml(node.description.trim())}</div>`);
        }

        // `toolTip` may be a MarkdownString on some nodes; only plain text is
        // meaningful here, and it is the same text as `message` when both exist.
        const message = typeof node.message === 'string' && node.message
            ? node.message
            : (typeof node.toolTip === 'string' ? node.toolTip : undefined);

        if (message && message !== node.description) {
            parts.push(`<div class="detail-message">${escapeHtml(message)}</div>`);
        }

        if (parts.length === 0) {
            parts.push('<span class="no-results">No further details for this entry.</span>');
        }

        return { label, body: parts.join('') };
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

        webviewView.webview.onDidReceiveMessage(message => {
            if (message?.command === 'ready') {
                this.postDetails();
            }
        });

        webviewView.onDidDispose(() => {
            if (this.view === webviewView) {
                this.view = undefined;
            }
        });
    }

    private getHtmlContent(): string {
        if (!this.view) {
            return '';
        }
        return renderWebviewPage(this.view.webview, this.extensionUri, {
            title: 'Result Details',
            bodyHtml: `
            <div class="header" id="header">${escapeHtml(this.details.label)}</div>
            <div class="content" id="content">${this.details.body}</div>`,
            cssFiles: ['student/test-results.css'],
            inlineScript: `
                ComputorWebview.onCommand('resultsUpdate', (data) => {
                    document.getElementById('header').textContent = data.label;
                    document.getElementById('content').innerHTML = data.body;
                });
                // Collapsing this view (or hiding the Results panel) tears the
                // webview down and later reloads it from the HTML captured at
                // resolve time, and messages posted meanwhile are dropped. Ask
                // for the current details on every load so the view can never
                // resurrect an older render (issues #280, #281).
                ComputorWebview.post('ready');`
        });
    }

}