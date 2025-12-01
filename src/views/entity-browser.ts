import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';

interface EntityRow {
    id: number;
    preview: string;
    namespace?: string;
}

export class EntityBrowser {
    private panel: vscode.WebviewPanel | undefined;
    private currentDbPath: string = '';
    private entities: EntityRow[] = [];
    private filteredEntities: EntityRow[] = [];
    private namespaces: string[] = [];
    private currentPage: number = 1;
    private pageSize: number = 25;
    private namespaceFilter: string = '';

    constructor(
        private _context: vscode.ExtensionContext,
        private dtlvBridge: DtlvBridge
    ) {}

    async show(dbPath: string): Promise<void> {
        if (!dbPath) {
            vscode.window.showErrorMessage('No database path provided');
            return;
        }

        this.currentDbPath = dbPath;
        this.currentPage = 1;
        this.namespaceFilter = '';

        const dbName = dbPath.split('/').pop() || 'Unknown';

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'levinEntities',
                `Entities: ${dbName}`,
                vscode.ViewColumn.Active,
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
            this.panel.title = `Entities: ${dbName}`;
        }

        await this.loadEntities();
        this.updateContent();
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }): Promise<void> {
        switch (message.command) {
            case 'changePage':
                this.currentPage = message.page as number;
                this.updateContent();
                break;
            case 'changePageSize':
                this.pageSize = message.pageSize as number;
                this.currentPage = 1;
                this.updateContent();
                break;
            case 'filterNamespace':
                this.namespaceFilter = message.namespace as string;
                this.currentPage = 1;
                this.applyFilter();
                this.updateContent();
                break;
            case 'inspectEntity':
                vscode.commands.executeCommand('levin.showEntity', this.currentDbPath, message.entityId as number);
                break;
            case 'refresh':
                await this.loadEntities();
                this.updateContent();
                break;
        }
    }

    private async loadEntities(): Promise<void> {
        // Query all entities with their first non-db attribute for preview
        const result = await this.dtlvBridge.queryEntitiesWithPreview(this.currentDbPath);

        if (result.success && result.data) {
            this.entities = result.data as EntityRow[];
            this.namespaces = [...new Set(this.entities.map(e => e.namespace).filter(Boolean))] as string[];
            this.namespaces.sort();
            this.applyFilter();
        } else {
            this.entities = [];
            this.filteredEntities = [];
            this.namespaces = [];
        }
    }

    private applyFilter(): void {
        if (this.namespaceFilter) {
            this.filteredEntities = this.entities.filter(e => e.namespace === this.namespaceFilter);
        } else {
            this.filteredEntities = [...this.entities];
        }
    }

    private updateContent(): void {
        if (!this.panel) { return; }
        this.panel.webview.html = this.getHtml();
    }

    private getHtml(): string {
        const totalPages = Math.ceil(this.filteredEntities.length / this.pageSize);
        const startIdx = (this.currentPage - 1) * this.pageSize;
        const endIdx = Math.min(startIdx + this.pageSize, this.filteredEntities.length);
        const pageEntities = this.filteredEntities.slice(startIdx, endIdx);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Entity Browser</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --header-bg: var(--vscode-editorGroupHeader-tabsBackground);
            --input-bg: var(--vscode-input-background);
            --input-border: var(--vscode-input-border);
            --link-color: var(--vscode-textLink-foreground);
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
            gap: 16px;
            align-items: center;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }

        .toolbar-group {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        select, button {
            padding: 6px 10px;
            background: var(--input-bg);
            border: 1px solid var(--input-border);
            color: var(--text-color);
            border-radius: 4px;
        }

        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
        }

        button:hover { background: var(--vscode-button-hoverBackground); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }

        .stats {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }

        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }

        th, td {
            padding: 8px 12px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }

        th { background: var(--header-bg); font-weight: 600; }

        .entity-link {
            color: var(--link-color);
            cursor: pointer;
            text-decoration: none;
        }

        .entity-link:hover { text-decoration: underline; }

        .preview {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            max-width: 400px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .namespace-tag {
            display: inline-block;
            padding: 2px 6px;
            background: var(--header-bg);
            border-radius: 4px;
            font-size: 11px;
        }

        .pagination {
            display: flex;
            gap: 8px;
            align-items: center;
            justify-content: center;
        }

        .pagination input {
            width: 60px;
            padding: 4px 8px;
            background: var(--input-bg);
            border: 1px solid var(--input-border);
            color: var(--text-color);
            border-radius: 4px;
            text-align: center;
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-group">
            <label>Namespace:</label>
            <select id="namespaceFilter" onchange="filterNamespace()">
                <option value="">All</option>
                ${this.namespaces.map(ns => `<option value="${ns}" ${ns === this.namespaceFilter ? 'selected' : ''}>${ns}</option>`).join('')}
            </select>
        </div>
        <div class="toolbar-group">
            <label>Show:</label>
            <select id="pageSize" onchange="changePageSize()">
                ${[10, 25, 50, 100].map(size => `<option value="${size}" ${size === this.pageSize ? 'selected' : ''}>${size}</option>`).join('')}
            </select>
        </div>
        <div class="toolbar-group">
            <button onclick="refresh()">Refresh</button>
        </div>
        <div class="stats">
            Showing ${startIdx + 1}-${endIdx} of ${this.filteredEntities.length} entities
        </div>
    </div>

    ${pageEntities.length > 0 ? `
    <table>
        <thead>
            <tr>
                <th>Entity ID</th>
                <th>Namespace</th>
                <th>Preview</th>
            </tr>
        </thead>
        <tbody>
            ${pageEntities.map(entity => `
                <tr>
                    <td><a class="entity-link" onclick="inspectEntity(${entity.id})">${entity.id}</a></td>
                    <td>${entity.namespace ? `<span class="namespace-tag">${this.escapeHtml(entity.namespace)}</span>` : '-'}</td>
                    <td class="preview">${this.escapeHtml(entity.preview || '-')}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>

    <div class="pagination">
        <button onclick="changePage(1)" ${this.currentPage === 1 ? 'disabled' : ''}>First</button>
        <button onclick="changePage(${this.currentPage - 1})" ${this.currentPage === 1 ? 'disabled' : ''}>Prev</button>
        <span>Page</span>
        <input type="number" id="pageInput" value="${this.currentPage}" min="1" max="${totalPages}" onchange="jumpToPage()" />
        <span>of ${totalPages}</span>
        <button onclick="changePage(${this.currentPage + 1})" ${this.currentPage >= totalPages ? 'disabled' : ''}>Next</button>
        <button onclick="changePage(${totalPages})" ${this.currentPage >= totalPages ? 'disabled' : ''}>Last</button>
    </div>
    ` : `
    <div class="empty-state">
        <p>No entities found${this.namespaceFilter ? ` in namespace "${this.namespaceFilter}"` : ''}.</p>
    </div>
    `}

    <script>
        const vscode = acquireVsCodeApi();

        function changePage(page) {
            vscode.postMessage({ command: 'changePage', page });
        }

        function changePageSize() {
            const pageSize = parseInt(document.getElementById('pageSize').value);
            vscode.postMessage({ command: 'changePageSize', pageSize });
        }

        function filterNamespace() {
            const namespace = document.getElementById('namespaceFilter').value;
            vscode.postMessage({ command: 'filterNamespace', namespace });
        }

        function inspectEntity(entityId) {
            vscode.postMessage({ command: 'inspectEntity', entityId });
        }

        function jumpToPage() {
            const page = parseInt(document.getElementById('pageInput').value);
            if (page > 0) {
                vscode.postMessage({ command: 'changePage', page });
            }
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
    </script>
</body>
</html>`;
    }

    private escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    dispose(): void {
        this.panel?.dispose();
    }
}
