import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';
import { formatValue, toEdn, flattenTree, extractFindColumns, computeEntityColumns, compareCellValues } from '../utils/formatters';
import { formatQueryError, FriendlyError } from '../utils/error-formatter';
import { highlightQueryToHtml, findSuspiciousClauses } from '../utils/query-highlighter';

interface QueryResult {
    total: number;
    truncated: boolean;
    results: unknown[][];
    error?: string;
}

export class ResultsPanel {
    private panel: vscode.WebviewPanel | undefined;
    private currentResults: QueryResult | undefined;
    private errorState: FriendlyError | null = null;
    private currentDbPath: string = '';
    private currentQuery: string = '';
    private columnNames: string[] = [];
    /** Per-column flags: which columns hold entity ids (linkable to the inspector) */
    private entityColumns: boolean[] = [];
    private currentView: 'table' | 'tree' | 'raw' = 'table';
    private currentPage: number = 0;
    private pageSize: number = 50;
    private sortColumn: number | null = null;
    private sortDirection: 'asc' | 'desc' = 'asc';

    constructor(private _dtlvBridge: DtlvBridge) {}

    show(results: unknown, dbPath: string, query?: string): void {
        this.currentResults = results as QueryResult;
        this.errorState = null;
        this.currentDbPath = dbPath;
        this.currentQuery = query || '';
        this.columnNames = query ? extractFindColumns(query) : [];
        this.entityColumns = query ? computeEntityColumns(query) : [];
        this.currentPage = 0;
        this.sortColumn = null;
        this.sortDirection = 'asc';

        // Title includes db name and run time so consecutive runs are distinguishable
        const dbName = dbPath.split('/').filter(Boolean).pop() || dbPath;
        const runTime = new Date().toLocaleTimeString('en-GB');
        const title = `Results: ${dbName} (${runTime})`;

        this.ensurePanel(title);
        this.updateContent();
    }

    /**
     * Show a failed execution inline: friendly summary and hint with the
     * offending query called out, full stack trace tucked away.
     */
    showError(error: string, dbPath: string, query?: string): void {
        this.errorState = formatQueryError(error);
        this.currentDbPath = dbPath;
        this.currentQuery = query || '';
        this.columnNames = [];
        this.entityColumns = [];

        const dbName = dbPath.split('/').filter(Boolean).pop() || dbPath;
        const runTime = new Date().toLocaleTimeString('en-GB');
        const title = `Error: ${dbName} (${runTime})`;

        this.ensurePanel(title);
        this.updateContent();
    }

    private ensurePanel(title: string): void {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'levinResults',
                title,
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
        } else {
            // Reveal existing panel
            this.panel.title = title;
            this.panel.reveal(vscode.ViewColumn.Beside);
        }
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
            case 'sort':
                this.applySort(message.column as number);
                break;
            case 'inspectEntity':
                vscode.commands.executeCommand('levin.showEntity', this.currentDbPath, message.entityId);
                break;
            case 'export':
                await this.exportResults(message.format as string);
                break;
            case 'copyError':
                if (message.error) {
                    vscode.env.clipboard.writeText(message.error as string);
                    vscode.window.showInformationMessage('Error copied to clipboard');
                }
                break;
        }
    }

    private updateContent(): void {
        if (!this.panel) {
            return;
        }

        this.panel.webview.html = this.getHtml();
    }

    /** Click-to-sort: same column toggles direction, new column starts asc. */
    private applySort(column: number): void {
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }
        this.updateContent();
    }

    /** The fetched rows in display order (sorted copy when a sort is active). */
    private sortedResults(rows: unknown[][]): unknown[][] {
        if (this.sortColumn === null) {
            return rows;
        }
        const col = this.sortColumn;
        const dir = this.sortDirection === 'asc' ? 1 : -1;
        return [...rows].sort((ra, rb) =>
            dir * compareCellValues(this.cellAt(ra, col), this.cellAt(rb, col))
        );
    }

    private cellAt(row: unknown, col: number): unknown {
        if (Array.isArray(row)) {
            return row[col];
        }
        if (row !== null && typeof row === 'object') {
            const key = this.columnNames[col];
            if (key) {
                const obj = row as Record<string, unknown>;
                return obj[key] ?? obj[`:${key}`] ?? obj[key.replace(/^:/, '')];
            }
        }
        return row;
    }

    private getHtml(): string {
        if (this.errorState) {
            return this.getErrorViewHtml(this.errorState);
        }

        const results = this.currentResults!;

        if (results.error) {
            return this.getErrorViewHtml(formatQueryError(String(results.error)));
        }

        // Handle case where results might be missing or malformed
        if (!results.results || !Array.isArray(results.results)) {
            return this.getErrorViewHtml(formatQueryError('No results returned or invalid result format'));
        }

        const sorted = this.sortedResults(results.results);
        const startIndex = this.currentPage * this.pageSize;
        const endIndex = Math.min(startIndex + this.pageSize, sorted.length);
        const pageResults = sorted.slice(startIndex, endIndex);
        const totalPages = Math.ceil(sorted.length / this.pageSize);

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

        * { box-sizing: border-box; }

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

        .view-buttons { display: flex; gap: 8px; }

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

        .stats { color: var(--vscode-descriptionForeground); }

        table { width: 100%; border-collapse: collapse; }

        th, td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }

        th { background: var(--header-bg); font-weight: 600; position: sticky; top: 0; }

        tr:hover { background: var(--hover-bg); }

        .entity-link {
            color: var(--link-color);
            cursor: pointer;
            text-decoration: underline;
        }

        th.sortable {
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
        }

        th.sortable:hover {
            background: var(--hover-bg);
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

        .pagination button:disabled { opacity: 0.5; cursor: not-allowed; }

        pre {
            background: var(--header-bg);
            padding: 16px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
        }

        .tree-node { padding: 4px 0; }
        .tree-node-key { color: var(--vscode-symbolIcon-fieldForeground); }
        .tree-node-value { color: var(--vscode-symbolIcon-stringForeground); }

        .export-buttons { display: flex; gap: 8px; }

        .export-buttons button {
            padding: 4px 8px;
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
        function setView(view) { vscode.postMessage({ command: 'setView', view }); }
        function nextPage() { vscode.postMessage({ command: 'nextPage' }); }
        function prevPage() { vscode.postMessage({ command: 'prevPage' }); }
        function inspectEntity(id) { vscode.postMessage({ command: 'inspectEntity', entityId: id }); }
        function sortByColumn(col) { vscode.postMessage({ command: 'sort', column: col }); }
        function exportAs(format) { vscode.postMessage({ command: 'export', format }); }
    </script>
</body>
</html>`;
    }

    private renderContent(results: unknown[][]): string {
        switch (this.currentView) {
            case 'table': return this.renderTable(results);
            case 'tree': return this.renderTree(results);
            case 'raw': return this.renderRaw(results);
            default: return this.renderTable(results);
        }
    }

    /**
     * Cell text for the table view: nested values (pull maps, vectors) as
     * full EDN, scalars via the compact formatter.
     */
    private formatCell(value: unknown): string {
        if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
            return toEdn(value);
        }
        return formatValue(value);
    }

    private sortableHeader(label: string, col: number): string {
        const indicator = this.sortColumn === col
            ? (this.sortDirection === 'asc' ? ' ▲' : ' ▼')
            : '';
        return `<th class="sortable" onclick="sortByColumn(${col})" title="Click to sort">${this.escapeHtml(label)}${indicator}</th>`;
    }

    private renderTable(results: unknown[][]): string {
        if (results.length === 0) {
            return '<p>No results</p>';
        }

        const firstRow = results[0];

        // Check if results are maps (from :keys/:strs/:syms) or tuples
        const isMapResult = firstRow && typeof firstRow === 'object' && !Array.isArray(firstRow);

        let html = '<table><thead><tr>';

        if (isMapResult) {
            // For map results, use column names or object keys
            const keys = this.columnNames.length > 0
                ? this.columnNames
                : Object.keys(firstRow as object);
            for (let j = 0; j < keys.length; j++) {
                html += this.sortableHeader(String(keys[j]), j);
            }
            html += '</tr></thead><tbody>';

            for (const row of results) {
                html += '<tr>';
                const rowObj = row as unknown as Record<string, unknown>;
                const keys = this.columnNames.length > 0
                    ? this.columnNames
                    : Object.keys(rowObj);
                for (let j = 0; j < keys.length; j++) {
                    const key = keys[j];
                    // Handle both keyword keys (:key) and plain keys (key)
                    const value = rowObj[key] ?? rowObj[`:${key}`] ?? rowObj[key.replace(/^:/, '')];
                    const formatted = this.formatCell(value);
                    // Only entity columns (and :db/id in pull maps) are links -
                    // not every integer that happens to appear in a cell
                    const isEntityColumn = this.entityColumns[j] === true ||
                        key === 'db/id' || key === ':db/id';
                    const isEntityId = isEntityColumn &&
                        typeof value === 'number' && Number.isInteger(value);

                    if (isEntityId) {
                        html += `<td><span class="entity-link" onclick="inspectEntity(${value})">${formatted}</span></td>`;
                    } else {
                        html += `<td>${this.escapeHtml(formatted)}</td>`;
                    }
                }
                html += '</tr>';
            }
        } else {
            // For tuple results (arrays)
            const colCount = Array.isArray(firstRow) ? firstRow.length : 1;

            for (let i = 0; i < colCount; i++) {
                // Use extracted column name if available, otherwise fall back to generic name
                const colName = this.columnNames[i] || `Column ${i + 1}`;
                html += this.sortableHeader(colName, i);
            }
            html += '</tr></thead><tbody>';

            for (const row of results) {
                html += '<tr>';
                const rowArray = Array.isArray(row) ? row : [row];
                for (let j = 0; j < rowArray.length; j++) {
                    const cell = rowArray[j];
                    const formatted = this.formatCell(cell);
                    const isEntityId = this.entityColumns[j] === true &&
                        typeof cell === 'number' && Number.isInteger(cell);

                    if (isEntityId) {
                        html += `<td><span class="entity-link" onclick="inspectEntity(${cell})">${formatted}</span></td>`;
                    } else {
                        html += `<td>${this.escapeHtml(formatted)}</td>`;
                    }
                }
                html += '</tr>';
            }
        }

        html += '</tbody></table>';
        return html;
    }

    private renderTree(results: unknown[][]): string {
        let html = '<div class="tree">';

        for (let i = 0; i < results.length; i++) {
            const row = results[i];
            html += `<div class="tree-node"><strong>Result ${i + 1}</strong>`;

            // Each result may be a tuple (columns) or a single value; every
            // nested map/vector is expanded recursively (pull results).
            if (Array.isArray(row)) {
                for (let j = 0; j < row.length; j++) {
                    const colName = this.columnNames[j] || `[${j}]`;
                    html += this.renderTreeRows(colName, row[j], 1);
                }
            } else {
                html += this.renderTreeRows(null, row, 1);
            }

            html += `</div>`;
        }

        html += '</div>';
        return html;
    }

    private renderTreeRows(key: string | null, value: unknown, depth: number): string {
        const rows = flattenTree(value, key, depth);
        let html = '';
        for (const row of rows) {
            const keyHtml = row.key !== null
                ? `<span class="tree-node-key">${this.escapeHtml(row.key)}</span>: `
                : '';
            const textHtml = row.container
                ? `<span class="tree-node-summary">${this.escapeHtml(row.text)}</span>`
                : `<span class="tree-node-value">${this.escapeHtml(row.text)}</span>`;
            html += `<div class="tree-node" style="margin-left: ${row.depth * 16}px;">${keyHtml}${textHtml}</div>`;
        }
        return html;
    }

    private renderRaw(results: unknown[][]): string {
        const ednStr = toEdn(results);
        return `<pre>${this.escapeHtml(ednStr)}</pre>`;
    }

    private getErrorViewHtml(error: FriendlyError): string {
        const marks = this.currentQuery ? findSuspiciousClauses(this.currentQuery) : [];
        const queryHtml = this.currentQuery
            ? highlightQueryToHtml(this.currentQuery, marks)
            : '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Query Error</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --header-bg: var(--vscode-editorGroupHeader-tabsBackground);
            --error-color: var(--vscode-errorForeground);
            --code-bg: var(--vscode-textCodeBlock-background);
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--text-color);
            background-color: var(--bg-color);
            margin: 0;
            padding: 16px;
            line-height: 1.6;
        }

        .error-banner {
            padding: 12px 16px;
            margin-bottom: 16px;
            border-left: 4px solid var(--error-color);
            background: var(--code-bg);
            border-radius: 4px;
        }

        .error-type {
            color: var(--error-color);
            font-weight: 600;
            margin-bottom: 4px;
        }

        .error-summary { word-break: break-word; }

        .hint-box {
            padding: 12px 16px;
            margin-bottom: 16px;
            border-left: 4px solid var(--vscode-symbolIcon-fieldForeground);
            background: var(--code-bg);
            border-radius: 4px;
        }

        .section-title {
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-symbolIcon-fieldForeground);
        }

        .query-code {
            background: var(--header-bg);
            padding: 16px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            white-space: pre-wrap;
            margin-bottom: 16px;
        }

        .tok-keyword { color: var(--vscode-symbolIcon-keywordForeground); }
        .tok-variable { color: var(--vscode-symbolIcon-variableForeground); }
        .tok-string { color: var(--vscode-symbolIcon-stringForeground); }
        .tok-number { color: var(--vscode-symbolIcon-numberForeground); }
        .tok-comment { color: var(--vscode-descriptionForeground); font-style: italic; }

        .clause-mark {
            text-decoration: underline wavy var(--error-color);
            text-underline-offset: 3px;
            cursor: help;
        }

        details { margin-bottom: 16px; }

        details summary {
            cursor: pointer;
            font-weight: 600;
            color: var(--vscode-symbolIcon-fieldForeground);
            padding: 4px 0;
        }

        .raw-error {
            background: var(--header-bg);
            padding: 12px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: calc(var(--vscode-editor-font-size) * 0.85);
            overflow-x: auto;
            max-height: 400px;
            overflow-y: auto;
            white-space: pre;
            color: var(--vscode-descriptionForeground);
        }

        button {
            padding: 6px 14px;
            border: 1px solid var(--border-color);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            border-radius: 4px;
        }

        button:hover { background: var(--vscode-button-hoverBackground); }
    </style>
</head>
<body>
    <div class="error-banner">
        <div class="error-type">Query failed: ${this.escapeHtml(error.type)}</div>
        <div class="error-summary">${this.escapeHtml(error.summary)}</div>
    </div>

    ${error.hint ? `
    <div class="hint-box">💡 ${this.escapeHtml(error.hint)}</div>
    ` : ''}

    ${queryHtml ? `
    <div class="section-title">Query</div>
    <pre class="query-code">${queryHtml}</pre>
    ` : ''}

    <details>
        <summary>Full error details</summary>
        <div class="raw-error">${this.escapeHtml(error.raw)}</div>
    </details>

    <button onclick="copyError()">Copy Full Error</button>

    <script>
        const vscode = acquireVsCodeApi();
        const fullError = ${JSON.stringify(error.raw)};
        function copyError() { vscode.postMessage({ command: 'copyError', error: fullError }); }
    </script>
</body>
</html>`;
    }

    private escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    async exportResults(format?: string): Promise<void> {
        if (!this.currentResults) { return; }

        const formatChoice = format || await vscode.window.showQuickPick(['CSV', 'JSON', 'EDN'], {
            placeHolder: 'Select export format'
        });

        if (!formatChoice) { return; }

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
                content = toEdn(this.currentResults.results);
                extension = 'edn';
                break;
            default:
                return;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`results.${extension}`),
            filters: { [formatChoice.toUpperCase()]: [extension] }
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
            vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
        }
    }

    private toCsv(data: unknown[][]): string {
        const lines: string[] = [];

        // Add header row if we have column names
        if (this.columnNames.length > 0 && data.length > 0) {
            const firstRow = data[0];
            const colCount = Array.isArray(firstRow) ? firstRow.length : 1;
            const headers: string[] = [];
            for (let i = 0; i < colCount; i++) {
                const colName = this.columnNames[i] || `Column ${i + 1}`;
                if (colName.includes(',') || colName.includes('"') || colName.includes('\n')) {
                    headers.push(`"${colName.replace(/"/g, '""')}"`);
                } else {
                    headers.push(colName);
                }
            }
            lines.push(headers.join(','));
        }

        for (const row of data) {
            const rowArray = Array.isArray(row) ? row : [row];
            const cells = rowArray.map(cell => {
                const str = formatValue(cell);
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
