import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';

export class KvStorePanel {
    private panel: vscode.WebviewPanel | undefined;
    private currentDbPath: string = '';
    private currentDbi: string | undefined;
    private kvData: Array<[unknown, unknown]> = [];
    private dbiList: string[] = [];

    constructor(
        private _dtlvBridge: DtlvBridge,
        private context?: vscode.ExtensionContext
    ) {}

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

        // Show loading state
        this.panel.webview.html = this.getLoadingHtml();

        // Load DBI list with progress indicator
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Loading KV Store...',
            cancellable: false
        }, async () => {
            try {
                await this.loadDbiList();
                this.updateContent();

                // Add to recent databases
                if (this.context) {
                    this.addToRecentDatabases(dbPath);
                }

                if (this.dbiList.length === 0) {
                    vscode.window.showInformationMessage(`KV Store opened: ${dbPath} (empty - create a new DBI to get started)`);
                } else {
                    vscode.window.showInformationMessage(`KV Store opened: ${dbPath} (${this.dbiList.length} DBIs found)`);
                }
            } catch (error) {
                const errorMessage = String(error);

                // Check if it's a "database doesn't exist" error
                if (errorMessage.includes('No such file') || errorMessage.includes('does not exist') || errorMessage.includes('ENOENT')) {
                    const action = await vscode.window.showWarningMessage(
                        `Database does not exist at ${dbPath}. Would you like to create it?`,
                        'Create Database',
                        'Cancel'
                    );

                    if (action === 'Create Database') {
                        try {
                            // Initialize the KV store by creating a DBI
                            await this._dtlvBridge.createKvDatabase(dbPath, 'default');
                            await this.loadDbiList();
                            this.updateContent();

                            // Add to recent databases after successful creation
                            if (this.context) {
                                this.addToRecentDatabases(dbPath);
                            }

                            vscode.window.showInformationMessage(`Created KV Store at: ${dbPath}`);
                        } catch (createError) {
                            vscode.window.showErrorMessage(`Failed to create KV Store: ${createError}`);
                            this.updateContent();
                        }
                    } else {
                        this.updateContent();
                    }
                } else {
                    vscode.window.showErrorMessage(`Failed to open KV Store: ${error}`);
                    this.updateContent();
                }
            }
        });
    }

    private async loadDbiList(): Promise<void> {
        try {
            this.dbiList = await this._dtlvBridge.listKvDatabases(this.currentDbPath);
            console.log(`Loaded ${this.dbiList.length} DBIs:`, this.dbiList);
        } catch (error) {
            console.error('Failed to load DBI list:', error);
            this.dbiList = [];
            throw error; // Re-throw to be caught by the progress handler
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
            case 'exportDbi':
                await this.exportDbi();
                break;
            case 'importDbi':
                await this.importDbi();
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
            console.log(`Adding key-value to ${this.currentDbi}: ${key} = ${value}`);
            const result = await this._dtlvBridge.putKvValue(this.currentDbPath, this.currentDbi, key, value);
            console.log('putKvValue result:', result);

            await this.loadKvData(this.currentDbi);
            console.log('Loaded data after add:', this.kvData);

            this.updateContent();
            vscode.window.showInformationMessage('Key-value pair added');
        } catch (error) {
            console.error('Failed to add key-value:', error);
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

    private getLoadingHtml(): string {
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
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .loading {
            text-align: center;
        }
        .spinner {
            border: 4px solid var(--vscode-panel-border);
            border-top: 4px solid var(--vscode-button-background);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="loading">
        <div class="spinner"></div>
        <p>Loading KV Store...</p>
    </div>
</body>
</html>`;
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
        <button onclick="importDbi()" ${!this.currentDbi ? 'disabled' : ''}>Import</button>
        <button onclick="exportDbi()" ${!this.currentDbi ? 'disabled' : ''}>Export</button>
        <button onclick="refresh()">Refresh</button>
        <div style="flex: 1; text-align: right; padding-right: 8px; font-size: 12px; color: var(--vscode-descriptionForeground);">
            Database: ${this.escapeHtml(this.currentDbPath)}
        </div>
    </div>
    <div class="main-content">
        <div class="sidebar">
            <div class="sidebar-header">DBIs</div>
            ${dbiListHtml || '<div class="empty-state">No DBIs found. Click "New DBI" to create one.</div>'}
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

        function importDbi() {
            vscode.postMessage({ command: 'importDbi' });
        }

        function exportDbi() {
            vscode.postMessage({ command: 'exportDbi' });
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

    private async exportDbi(): Promise<void> {
        if (!this.currentDbi) {
            vscode.window.showWarningMessage('Please select a DBI first');
            return;
        }

        try {
            const result = await this._dtlvBridge.exportKvDbi(this.currentDbPath, this.currentDbi);

            if (!result.success || !result.data) {
                vscode.window.showErrorMessage(`Failed to export DBI: ${result.error}`);
                return;
            }

            // Convert result to EDN string
            const ednContent = this.formatEdnOutput(result.data);

            // Ask user where to save
            const saveUri = await vscode.window.showSaveDialog({
                filters: { 'EDN Files': ['edn'], 'All Files': ['*'] },
                defaultUri: vscode.Uri.file(`${this.currentDbi}.edn`),
                saveLabel: 'Export'
            });

            if (!saveUri) { return; }

            // Write file
            const buffer = Buffer.from(ednContent, 'utf-8');
            await vscode.workspace.fs.writeFile(saveUri, buffer);

            vscode.window.showInformationMessage(`Exported ${this.currentDbi} to ${saveUri.fsPath}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Export failed: ${error}`);
        }
    }

    private async importDbi(): Promise<void> {
        if (!this.currentDbi) {
            vscode.window.showWarningMessage('Please select a DBI first');
            return;
        }

        // Ask user to select file
        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false,
            filters: { 'EDN Files': ['edn'], 'All Files': ['*'] },
            title: 'Select EDN file to import'
        });

        if (!files || files.length === 0) { return; }

        try {
            // Read file content
            const fileContent = await vscode.workspace.fs.readFile(files[0]);
            const ednContent = Buffer.from(fileContent).toString('utf-8');

            if (!ednContent || ednContent.trim().length === 0) {
                vscode.window.showErrorMessage('File is empty');
                return;
            }

            // Import with progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Importing key-values...',
                cancellable: false
            }, async () => {
                const result = await this._dtlvBridge.importKvDbi(
                    this.currentDbPath,
                    this.currentDbi!,
                    ednContent.trim()
                );

                if (result.success) {
                    const count = (result.data as { count?: number })?.count || 0;
                    vscode.window.showInformationMessage(`Imported ${count} key-value pairs`);
                    await this.loadKvData(this.currentDbi!);
                    this.updateContent();
                } else {
                    vscode.window.showErrorMessage(`Import failed: ${result.error}`);
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Import failed: ${error}`);
        }
    }

    private formatEdnOutput(data: unknown): string {
        if (typeof data === 'string') {
            return data;
        }

        // Use stdout from the dtlv command which should already be in EDN format
        // If data is already a properly formatted EDN string from the result, use it
        return this.toEdnString(data, 0);
    }

    private toEdnString(value: unknown, indent: number = 0): string {
        const spaces = '  '.repeat(indent);
        const nextSpaces = '  '.repeat(indent + 1);

        if (value === null || value === undefined) {
            return 'nil';
        }

        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }

        if (typeof value === 'number') {
            return String(value);
        }

        if (typeof value === 'string') {
            // Check if it looks like a keyword
            if (value.startsWith(':')) {
                return value;
            }
            return `"${value.replace(/"/g, '\\"')}"`;
        }

        if (Array.isArray(value)) {
            if (value.length === 0) { return '[]'; }
            const items = value.map(v => this.toEdnString(v, indent + 1));
            return `[${items.join(' ')}]`;
        }

        if (typeof value === 'object') {
            const entries = Object.entries(value);
            if (entries.length === 0) { return '{}'; }

            const pairs = entries.map(([k, v]) => {
                const key = k.startsWith(':') ? k : `:${k}`;
                return `${nextSpaces}${key} ${this.toEdnString(v, indent + 1)}`;
            });

            return `{\n${pairs.join('\n')}\n${spaces}}`;
        }

        return String(value);
    }

    private addToRecentDatabases(dbPath: string): void {
        if (!this.context) { return; }

        const config = vscode.workspace.getConfiguration('levin');
        const recent = config.get<string[]>('recentDatabases', []);

        // Remove if exists, then add to front
        const filtered = recent.filter(p => p !== dbPath);
        filtered.unshift(dbPath);

        // Keep only last 10
        const updated = filtered.slice(0, 10);

        config.update('recentDatabases', updated, vscode.ConfigurationTarget.Global);
    }
}
