import * as vscode from 'vscode';
import { CalvaBridge } from '../calva-bridge';
import { formatValue } from '../utils/formatters';

interface QueryResult {
    total: number;
    truncated: boolean;
    results: unknown[][];
    error?: string;
}

export class ResultsPanel {
    private panel: vscode.WebviewPanel | undefined;
    private currentResults: QueryResult | undefined;
    private currentDbName: string = '';
    private currentView: 'table' | 'tree' | 'raw' = 'table';
    private currentPage: number = 0;
    private pageSize: number = 50;

    constructor(private calvaBridge: CalvaBridge) {}

    show(results: unknown, dbName: string): void {
        this.currentResults = results as QueryResult;
        this.currentDbName = dbName;
        this.currentPage = 0;

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'levinResults',
                'Query Results',
                vscode.ViewColumn.Beside,
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

        this.updateContent();
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }): Promise<void> {
        switch (message.command) {
            case 'setView':
                this.currentView = message.view as 'table' | 'tree' | 'raw';
                this.updateContent();
                break;
            case 'nextPage':
                this.currentPage++;
                this.updateContent();
                break;
            case 'prevPage':
                if (this.currentPage > 0) {
                    this.currentPage--;
                    this.updateContent();
                }
                break;
            case 'inspectEntity':
                vscode.commands.executeCommand('levin.showEntity', this.currentDbName, message.entityId);
                break;
            case 'export':
                await this.exportResults(message.format as string);
                break;
        }
    }

    private updateContent(): void {
        if (!this.panel || !this.currentResults) {
            return;
        }

        this.panel.webview.html = this.getHtml();
    }

    private getHtml(): string {
        const results = this.currentResults!;

        if (results.error) {
            return this.getErrorHtml(results.error);
        }

        const startIndex = this.currentPage * this.pageSize;
        const endIndex = Math.min(startIndex + this.pageSize, results.results.length);
        const pageResults = results.results.slice(startIndex, endIndex);
        const totalPages = Math.ceil(results.results.length / this.pageSize);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Query Results</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --header-bg: var(--vscode-editorGroupHeader-tabsBackground);
            --hover-bg: var(--vscode-list-hoverBackground);
            --link-color: var(--vscode-textLink-foreground);
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--text-color);
            background-color: var(--bg-color);
            margin: 0;
            padding: 16px;
        }

        .toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border-color);
        }

        .view-buttons {
            display: flex;
            gap: 8px;
        }

        .view-buttons button {
            padding: 4px 12px;
            border: 1px solid var(--border-color);
            background: var(--header-bg);
            color: var(--text-color);
            cursor: pointer;
            border-radius: 4px;
        }

        .view-buttons button.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .stats {
            color: var(--vscode-descriptionForeground);
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }

        th, td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }

        th {
            background: var(--header-bg);
            font-weight: 600;
            position: sticky;
            top: 0;
        }

        tr:hover {
            background: var(--hover-bg);
        }

        .entity-link {
            color: var(--link-color);
            cursor: pointer;
            text-decoration: underline;
        }

        .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 16px;
            margin-top: 16px;
            padding-top: 8px;
            border-top: 1px solid var(--border-color);
        }

        .pagination button {
            padding: 4px 12px;
            border: 1px solid var(--border-color);
            background: var(--header-bg);
            color: var(--text-color);
            cursor: pointer;
            border-radius: 4px;
        }

        .pagination button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        pre {
            background: var(--header-bg);
            padding: 16px;
            border-radius: 4px;
            overflow-x: auto;
        }

        .tree-node {
            padding: 4px 0;
        }

        .tree-node-key {
            color: var(--vscode-symbolIcon-fieldForeground);
        }

        .tree-node-value {
            color: var(--vscode-symbolIcon-stringForeground);
        }

        .export-buttons {
            display: flex;
            gap: 8px;
        }

        .export-buttons button {
            padding: 4px 8px;
            font-size: 12px;
            border: 1px solid var(--border-color);
            background: var(--header-bg);
            color: var(--text-color);
            cursor: pointer;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="view-buttons">
            <button class="${this.currentView === 'table' ? 'active' : ''}" onclick="setView('table')">Table</button>
            <button class="${this.currentView === 'tree' ? 'active' : ''}" onclick="setView('tree')">Tree</button>
            <button class="${this.currentView === 'raw' ? 'active' : ''}" onclick="setView('raw')">Raw</button>
        </div>
        <div class="stats">
            ${results.total} results${results.truncated ? ' (truncated)' : ''}
        </div>
        <div class="export-buttons">
            <button onclick="exportAs('csv')">CSV</button>
            <button onclick="exportAs('json')">JSON</button>
            <button onclick="exportAs('edn')">EDN</button>
        </div>
    </div>

    <div class="content">
        ${this.renderContent(pageResults)}
    </div>

    ${totalPages > 1 ? `
    <div class="pagination">
        <button onclick="prevPage()" ${this.currentPage === 0 ? 'disabled' : ''}>Previous</button>
        <span>Page ${this.currentPage + 1} of ${totalPages}</span>
        <button onclick="nextPage()" ${this.currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
    </div>
    ` : ''}

    <script>
        const vscode = acquireVsCodeApi();

        function setView(view) {
            vscode.postMessage({ command: 'setView', view });
        }

        function nextPage() {
            vscode.postMessage({ command: 'nextPage' });
        }

        function prevPage() {
            vscode.postMessage({ command: 'prevPage' });
        }

        function inspectEntity(id) {
            vscode.postMessage({ command: 'inspectEntity', entityId: id });
        }

        function exportAs(format) {
            vscode.postMessage({ command: 'export', format });
        }
    </script>
</body>
</html>`;
    }

    private renderContent(results: unknown[][]): string {
        switch (this.currentView) {
            case 'table':
                return this.renderTable(results);
            case 'tree':
                return this.renderTree(results);
            case 'raw':
                return this.renderRaw(results);
            default:
                return this.renderTable(results);
        }
    }

    private renderTable(results: unknown[][]): string {
        if (results.length === 0) {
            return '<p>No results</p>';
        }

        const firstRow = results[0];
        const colCount = Array.isArray(firstRow) ? firstRow.length : 1;

        let html = '<table><thead><tr>';

        // Generate column headers
        for (let i = 0; i < colCount; i++) {
            html += `<th>Column ${i + 1}</th>`;
        }
        html += '</tr></thead><tbody>';

        // Generate rows
        for (const row of results) {
            html += '<tr>';
            const rowArray = Array.isArray(row) ? row : [row];
            for (const cell of rowArray) {
                const formatted = formatValue(cell);
                const isEntityId = typeof cell === 'number' && Number.isInteger(cell);

                if (isEntityId) {
                    html += `<td><span class="entity-link" onclick="inspectEntity(${cell})">${formatted}</span></td>`;
                } else {
                    html += `<td>${this.escapeHtml(formatted)}</td>`;
                }
            }
            html += '</tr>';
        }

        html += '</tbody></table>';
        return html;
    }

    private renderTree(results: unknown[][]): string {
        let html = '<div class="tree">';

        for (let i = 0; i < results.length; i++) {
            const row = results[i];
            html += `<div class="tree-node">`;
            html += `<strong>Result ${i + 1}</strong>`;

            if (Array.isArray(row)) {
                for (let j = 0; j < row.length; j++) {
                    html += `<div class="tree-node" style="margin-left: 16px;">`;
                    html += `<span class="tree-node-key">[${j}]</span>: `;
                    html += `<span class="tree-node-value">${this.escapeHtml(formatValue(row[j]))}</span>`;
                    html += `</div>`;
                }
            } else {
                html += `<div class="tree-node" style="margin-left: 16px;">`;
                html += `<span class="tree-node-value">${this.escapeHtml(formatValue(row))}</span>`;
                html += `</div>`;
            }

            html += `</div>`;
        }

        html += '</div>';
        return html;
    }

    private renderRaw(results: unknown[][]): string {
        const ednStr = this.toEdn(results);
        return `<pre>${this.escapeHtml(ednStr)}</pre>`;
    }

    private getErrorHtml(error: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
        }
        .error {
            padding: 16px;
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
            background: var(--vscode-inputValidation-errorBackground);
        }
    </style>
</head>
<body>
    <div class="error">
        <h3>Query Error</h3>
        <p>${this.escapeHtml(error)}</p>
    </div>
</body>
</html>`;
    }

    private escapeHtml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private toEdn(data: unknown): string {
        if (data === null || data === undefined) {
            return 'nil';
        }
        if (typeof data === 'string') {
            return `"${data.replace(/"/g, '\\"')}"`;
        }
        if (typeof data === 'number' || typeof data === 'boolean') {
            return String(data);
        }
        if (Array.isArray(data)) {
            return '[' + data.map(d => this.toEdn(d)).join(' ') + ']';
        }
        if (typeof data === 'object') {
            const entries = Object.entries(data);
            return '{' + entries.map(([k, v]) => `:${k} ${this.toEdn(v)}`).join(' ') + '}';
        }
        return String(data);
    }

    async exportResults(format?: string): Promise<void> {
        if (!this.currentResults) {
            return;
        }

        const formatChoice = format || await vscode.window.showQuickPick(['CSV', 'JSON', 'EDN'], {
            placeHolder: 'Select export format'
        });

        if (!formatChoice) {
            return;
        }

        let content: string;
        let extension: string;

        switch (formatChoice.toLowerCase()) {
            case 'csv':
                content = this.toCsv(this.currentResults.results);
                extension = 'csv';
                break;
            case 'json':
                content = JSON.stringify(this.currentResults.results, null, 2);
                extension = 'json';
                break;
            case 'edn':
                content = this.toEdn(this.currentResults.results);
                extension = 'edn';
                break;
            default:
                return;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`results.${extension}`),
            filters: {
                [formatChoice.toUpperCase()]: [extension]
            }
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
            vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
        }
    }

    private toCsv(data: unknown[][]): string {
        const lines: string[] = [];

        for (const row of data) {
            const rowArray = Array.isArray(row) ? row : [row];
            const cells = rowArray.map(cell => {
                const str = formatValue(cell);
                // Escape quotes and wrap in quotes if contains comma
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            });
            lines.push(cells.join(','));
        }

        return lines.join('\n');
    }

    dispose(): void {
        this.panel?.dispose();
    }
}
