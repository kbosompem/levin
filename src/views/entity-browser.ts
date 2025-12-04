import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';

interface EntityRow {
    id: number;
    preview: string;
    namespace?: string;
}

interface PanelState {
    panel: vscode.WebviewPanel;
    entities: EntityRow[];
    filteredEntities: EntityRow[];
    namespaces: string[];
    currentPage: number;
    pageSize: number;
    namespaceFilter: string;
}

export class EntityBrowser {
    private panels: Map<string, PanelState> = new Map();

    constructor(
        private _context: vscode.ExtensionContext,
        private dtlvBridge: DtlvBridge
    ) {}

    async show(dbPath: string): Promise<void> {
        if (!dbPath) {
            vscode.window.showErrorMessage('No database path provided');
            return;
        }

        const dbName = dbPath.split('/').pop() || 'Unknown';

        let state = this.panels.get(dbPath);

        if (!state) {
            const panel = vscode.window.createWebviewPanel(
                'levinEntities',
                `Entities: ${dbName}`,
                vscode.ViewColumn.Active,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            state = {
                panel,
                entities: [],
                filteredEntities: [],
                namespaces: [],
                currentPage: 1,
                pageSize: 25,
                namespaceFilter: ''
            };

            panel.onDidDispose(() => {
                this.panels.delete(dbPath);
            });

            panel.webview.onDidReceiveMessage(
                (msg) => this.handleMessage(msg, dbPath),
                undefined
            );

            this.panels.set(dbPath, state);
        } else {
            state.panel.reveal(vscode.ViewColumn.Active);
        }

        await this.loadEntities(dbPath);
        this.updateContent(dbPath);
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }, dbPath: string): Promise<void> {
        const state = this.panels.get(dbPath);
        if (!state) return;

        switch (message.command) {
            case 'changePage':
                state.currentPage = message.page as number;
                this.updateContent(dbPath);
                break;
            case 'changePageSize':
                state.pageSize = message.pageSize as number;
                state.currentPage = 1;
                this.updateContent(dbPath);
                break;
            case 'filterNamespace':
                state.namespaceFilter = message.namespace as string;
                state.currentPage = 1;
                this.applyFilter(dbPath);
                this.updateContent(dbPath);
                break;
            case 'inspectEntity':
                vscode.commands.executeCommand('levin.showEntity', dbPath, message.entityId as number);
                break;
            case 'refresh':
                await this.loadEntities(dbPath);
                this.updateContent(dbPath);
                break;
        }
    }

    private async loadEntities(dbPath: string): Promise<void> {
        const state = this.panels.get(dbPath);
        if (!state) return;

        // Show loading state
        state.panel.webview.postMessage({ command: 'loading', isLoading: true });

        try {
            // Query all entities with their first non-db attribute for preview
            const result = await this.dtlvBridge.queryEntitiesWithPreview(dbPath);

            if (result.success && result.data) {
                state.entities = result.data as EntityRow[];
                state.namespaces = [...new Set(state.entities.map(e => e.namespace).filter(Boolean))] as string[];
                state.namespaces.sort();
                this.applyFilter(dbPath);
            } else {
                state.entities = [];
                state.filteredEntities = [];
                state.namespaces = [];
                vscode.window.showErrorMessage(`Failed to load entities: ${result.error || 'Unknown error'}`);
            }
        } catch (error) {
            state.entities = [];
            state.filteredEntities = [];
            state.namespaces = [];
            vscode.window.showErrorMessage(`Failed to load entities: ${error}`);
        } finally {
            // Hide loading state
            state.panel.webview.postMessage({ command: 'loading', isLoading: false });
        }
    }

    private applyFilter(dbPath: string): void {
        const state = this.panels.get(dbPath);
        if (!state) return;

        if (state.namespaceFilter) {
            state.filteredEntities = state.entities.filter(e => e.namespace === state.namespaceFilter);
        } else {
            state.filteredEntities = [...state.entities];
        }
    }

    private updateContent(dbPath: string): void {
        const state = this.panels.get(dbPath);
        if (!state) return;
        state.panel.webview.html = this.getHtml(state);
    }

    private getHtml(state: PanelState): string {
        const totalPages = Math.ceil(state.filteredEntities.length / state.pageSize);
        const startIdx = (state.currentPage - 1) * state.pageSize;
        const endIdx = Math.min(startIdx + state.pageSize, state.filteredEntities.length);
        const pageEntities = state.filteredEntities.slice(startIdx, endIdx);

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

        .loading-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 16px;
        }

        .loading-overlay.visible {
            display: flex;
        }

        .spinner {
            width: 48px;
            height: 48px;
            border: 4px solid var(--vscode-progressBar-background);
            border-top-color: var(--vscode-button-background);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .loading-text {
            color: var(--text-color);
            font-size: 14px;
        }

        .loading-details {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            max-width: 400px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="loading-overlay" id="loadingOverlay">
        <div class="spinner"></div>
        <div class="loading-text">Loading entities...</div>
        <div class="loading-details">This may take a minute for large databases or remote connections</div>
    </div>
    <div class="toolbar">
        <div class="toolbar-group">
            <label>Namespace:</label>
            <select id="namespaceFilter" onchange="filterNamespace()">
                <option value="">All</option>
                ${state.namespaces.map(ns => `<option value="${ns}" ${ns === state.namespaceFilter ? 'selected' : ''}>${ns}</option>`).join('')}
            </select>
        </div>
        <div class="toolbar-group">
            <label>Show:</label>
            <select id="pageSize" onchange="changePageSize()">
                ${[10, 25, 50, 100].map(size => `<option value="${size}" ${size === state.pageSize ? 'selected' : ''}>${size}</option>`).join('')}
            </select>
        </div>
        <div class="toolbar-group">
            <button onclick="refresh()">Refresh</button>
        </div>
        <div class="stats">
            Showing ${startIdx + 1}-${endIdx} of ${state.filteredEntities.length} entities
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
        <button onclick="changePage(1)" ${state.currentPage === 1 ? 'disabled' : ''}>First</button>
        <button onclick="changePage(${state.currentPage - 1})" ${state.currentPage === 1 ? 'disabled' : ''}>Prev</button>
        <span>Page</span>
        <input type="number" id="pageInput" value="${state.currentPage}" min="1" max="${totalPages}" onchange="jumpToPage()" />
        <span>of ${totalPages}</span>
        <button onclick="changePage(${state.currentPage + 1})" ${state.currentPage >= totalPages ? 'disabled' : ''}>Next</button>
        <button onclick="changePage(${totalPages})" ${state.currentPage >= totalPages ? 'disabled' : ''}>Last</button>
    </div>
    ` : `
    <div class="empty-state">
        <p>No entities found${state.namespaceFilter ? ` in namespace "${state.namespaceFilter}"` : ''}.</p>
    </div>
    `}

    <script>
        const vscode = acquireVsCodeApi();
        let isEntityClickInProgress = false;
        let lastEntityClickTime = 0;
        const CLICK_DEBOUNCE_MS = 500;

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'loading') {
                const overlay = document.getElementById('loadingOverlay');
                if (overlay) {
                    overlay.classList.toggle('visible', message.isLoading);
                }
            }
        });

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
            // Debounce clicks to prevent rapid successive calls
            const now = Date.now();
            if (isEntityClickInProgress || (now - lastEntityClickTime < CLICK_DEBOUNCE_MS)) {
                console.log('Entity click ignored (debounced)');
                return;
            }

            isEntityClickInProgress = true;
            lastEntityClickTime = now;

            vscode.postMessage({ command: 'inspectEntity', entityId });

            // Reset after debounce period
            setTimeout(() => {
                isEntityClickInProgress = false;
            }, CLICK_DEBOUNCE_MS);
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
        for (const state of this.panels.values()) {
            state.panel.dispose();
        }
        this.panels.clear();
    }
}
