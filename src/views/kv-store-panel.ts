import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';

export class KvStorePanel {
    private panel: vscode.WebviewPanel | undefined;
    private currentDbPath: string = '';
    private currentDbi: string | undefined;
    private kvData: Array<[unknown, unknown]> = [];
    private dbiList: string[] = [];

    constructor(private _dtlvBridge: DtlvBridge) {}

    async show(dbPath: string): Promise<void> {
        this.currentDbPath = dbPath;

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'levinKvStore',
                'Key-Value Store',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            this.panel.webview.onDidReceiveMessage(
                this.handleMessage.bind(this),
                undefined
            );
        }

        await this.loadDbiList();
        this.updateContent();
    }

    private async loadDbiList(): Promise<void> {
        try {
            this.dbiList = await this._dtlvBridge.listKvDatabases(this.currentDbPath);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load DBI list: ${error}`);
            this.dbiList = [];
        }
    }

    private async loadKvData(dbiName: string): Promise<void> {
        try {
            this.kvData = await this._dtlvBridge.getKvRange(this.currentDbPath, dbiName);
            this.currentDbi = dbiName;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load KV data: ${error}`);
            this.kvData = [];
        }
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }): Promise<void> {
        switch (message.command) {
            case 'selectDbi':
                await this.loadKvData(message.dbiName as string);
                this.updateContent();
                break;
            case 'createDbi':
                await this.createDbi();
                break;
            case 'refresh':
                await this.loadDbiList();
                if (this.currentDbi) {
                    await this.loadKvData(this.currentDbi);
                }
                this.updateContent();
                break;
            case 'addKeyValue':
                await this.addKeyValue();
                break;
            case 'deleteKey':
                await this.deleteKey(message.key as string);
                break;
            case 'editValue':
                await this.editValue(message.key as string, message.value as string);
                break;
        }
    }

    private async createDbi(): Promise<void> {
        const dbiName = await vscode.window.showInputBox({
            prompt: 'Enter new DBI name',
            placeHolder: 'my-table',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'DBI name is required';
                }
                if (this.dbiList.includes(value)) {
                    return 'DBI already exists';
                }
                return null;
            }
        });

        if (!dbiName) { return; }

        try {
            await this._dtlvBridge.createKvDatabase(this.currentDbPath, dbiName);
            vscode.window.showInformationMessage(`DBI "${dbiName}" created`);
            await this.loadDbiList();
            this.updateContent();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create DBI: ${error}`);
        }
    }

    private async addKeyValue(): Promise<void> {
        if (!this.currentDbi) {
            vscode.window.showWarningMessage('Please select a DBI first');
            return;
        }

        const key = await vscode.window.showInputBox({
            prompt: 'Enter key (EDN format, e.g., :my-key or "string-key" or 123)',
            placeHolder: ':my-key'
        });

        if (!key) { return; }

        const value = await vscode.window.showInputBox({
            prompt: 'Enter value (EDN format, e.g., {:foo "bar"} or [1 2 3])',
            placeHolder: '{:foo "bar"}'
        });

        if (!value) { return; }

        try {
            await this._dtlvBridge.putKvValue(this.currentDbPath, this.currentDbi, key, value);
            vscode.window.showInformationMessage('Key-value pair added');
            await this.loadKvData(this.currentDbi);
            this.updateContent();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add key-value: ${error}`);
        }
    }

    private async deleteKey(key: string): Promise<void> {
        if (!this.currentDbi) { return; }

        const confirm = await vscode.window.showWarningMessage(
            `Delete key ${key}?`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') { return; }

        try {
            await this._dtlvBridge.deleteKvKey(this.currentDbPath, this.currentDbi, key);
            vscode.window.showInformationMessage('Key deleted');
            await this.loadKvData(this.currentDbi);
            this.updateContent();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete key: ${error}`);
        }
    }

    private async editValue(key: string, currentValue: string): Promise<void> {
        if (!this.currentDbi) { return; }

        const newValue = await vscode.window.showInputBox({
            prompt: `Edit value for key ${key}`,
            value: currentValue,
            placeHolder: '{:foo "bar"}'
        });

        if (!newValue) { return; }

        try {
            await this._dtlvBridge.putKvValue(this.currentDbPath, this.currentDbi, key, newValue);
            vscode.window.showInformationMessage('Value updated');
            await this.loadKvData(this.currentDbi);
            this.updateContent();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update value: ${error}`);
        }
    }

    private updateContent(): void {
        if (!this.panel) { return; }
        this.panel.webview.html = this.getHtml();
    }

    private getHtml(): string {
        const dbiListHtml = this.dbiList.map(dbi => {
            const isActive = dbi === this.currentDbi;
            return `<div class="dbi-item ${isActive ? 'active' : ''}" onclick="selectDbi('${dbi}')">
                ${dbi}
            </div>`;
        }).join('');

        const kvTableHtml = this.kvData.length > 0 ? `
            <table class="kv-table">
                <thead>
                    <tr>
                        <th>Key</th>
                        <th>Value</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.kvData.map(([key, value]) => {
                        const keyStr = this.formatEdn(key);
                        const valueStr = this.formatEdn(value);
                        return `<tr>
                            <td class="key-cell"><code>${this.escapeHtml(keyStr)}</code></td>
                            <td class="value-cell"><pre>${this.escapeHtml(valueStr)}</pre></td>
                            <td class="actions-cell">
                                <button onclick="editValue('${this.escapeJs(keyStr)}', '${this.escapeJs(valueStr)}')">Edit</button>
                                <button onclick="deleteKey('${this.escapeJs(keyStr)}')">Delete</button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        ` : `<div class="empty-state">No key-value pairs in this DBI</div>`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Key-Value Store</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        .toolbar {
            display: flex;
            gap: 8px;
            padding: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editorGroupHeader-tabsBackground);
        }

        .toolbar button {
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            border-radius: 2px;
        }

        .toolbar button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .main-content {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        .sidebar {
            width: 250px;
            border-right: 1px solid var(--vscode-panel-border);
            overflow-y: auto;
            background: var(--vscode-sideBar-background);
        }

        .sidebar-header {
            padding: 12px;
            font-weight: bold;
            background: var(--vscode-sideBarSectionHeader-background);
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .dbi-item {
            padding: 8px 12px;
            cursor: pointer;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .dbi-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .dbi-item.active {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .content {
            flex: 1;
            overflow: auto;
            padding: 16px;
        }

        .kv-table {
            width: 100%;
            border-collapse: collapse;
        }

        .kv-table th {
            text-align: left;
            padding: 8px;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: bold;
        }

        .kv-table td {
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            vertical-align: top;
        }

        .key-cell code {
            color: var(--vscode-textLink-foreground);
            font-family: var(--vscode-editor-font-family);
        }

        .value-cell pre {
            margin: 0;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            white-space: pre-wrap;
            word-wrap: break-word;
        }

        .actions-cell {
            white-space: nowrap;
        }

        .actions-cell button {
            padding: 4px 8px;
            margin-right: 4px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            cursor: pointer;
            border-radius: 2px;
            font-size: 12px;
        }

        .actions-cell button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .empty-state {
            padding: 40px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }

        .no-dbi-selected {
            padding: 40px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button onclick="createDbi()">New DBI</button>
        <button onclick="addKeyValue()" ${!this.currentDbi ? 'disabled' : ''}>Add Key-Value</button>
        <button onclick="refresh()">Refresh</button>
    </div>
    <div class="main-content">
        <div class="sidebar">
            <div class="sidebar-header">DBIs</div>
            ${dbiListHtml || '<div class="empty-state">No DBIs found</div>'}
        </div>
        <div class="content">
            ${this.currentDbi ? kvTableHtml : '<div class="no-dbi-selected">Select a DBI to view its contents</div>'}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function selectDbi(dbiName) {
            vscode.postMessage({ command: 'selectDbi', dbiName });
        }

        function createDbi() {
            vscode.postMessage({ command: 'createDbi' });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function addKeyValue() {
            vscode.postMessage({ command: 'addKeyValue' });
        }

        function deleteKey(key) {
            vscode.postMessage({ command: 'deleteKey', key });
        }

        function editValue(key, value) {
            vscode.postMessage({ command: 'editValue', key, value });
        }
    </script>
</body>
</html>`;
    }

    private formatEdn(value: unknown): string {
        if (typeof value === 'string') {
            return value;
        }
        return JSON.stringify(value, null, 2);
    }

    private escapeHtml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private escapeJs(str: string): string {
        return str
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
    }
}
