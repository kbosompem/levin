import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';
import { formatValue } from '../utils/formatters';

interface EntityRef {
    id: number;
    attribute: string;
    namespace?: string;
    preview?: string;
}

interface EntityData {
    eid: number;
    attributes: Record<string, unknown>;
    refAttributes: string[];
    references: EntityRef[];
}

export class EntityInspector {
    private panel: vscode.WebviewPanel | undefined;
    private currentEntity: EntityData | undefined;
    private currentDbPath: string = '';
    private history: Array<{ dbPath: string; eid: number }> = [];

    constructor(
        private _context: vscode.ExtensionContext,
        private dtlvBridge: DtlvBridge
    ) {}

    async show(dbPath: string, entityId: number): Promise<void> {
        this.currentDbPath = dbPath;

        // Fetch entity data
        const result = await this.dtlvBridge.getEntity(dbPath, entityId);

        if (!result.success) {
            vscode.window.showErrorMessage(`Failed to load entity: ${result.error}`);
            return;
        }

        this.currentEntity = result.data as EntityData;

        // Add to history
        this.history.push({ dbPath, eid: entityId });
        if (this.history.length > 50) {
            this.history.shift();
        }

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'levinEntity',
                `Entity ${entityId}`,
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
            this.panel.title = `Entity ${entityId}`;
        }

        this.updateContent();
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }): Promise<void> {
        switch (message.command) {
            case 'navigate':
                await this.show(this.currentDbPath, message.entityId as number);
                break;
            case 'back':
                if (this.history.length > 1) {
                    this.history.pop(); // Remove current
                    const prev = this.history.pop();
                    if (prev) {
                        await this.show(prev.dbPath, prev.eid);
                    }
                }
                break;
            case 'copyEdn':
                await this.copyEntityAsEdn();
                break;
            case 'refresh':
                if (this.currentEntity) {
                    await this.show(this.currentDbPath, this.currentEntity.eid);
                }
                break;
        }
    }

    private updateContent(): void {
        if (!this.panel || !this.currentEntity) {
            return;
        }

        this.panel.webview.html = this.getHtml();
    }

    private getHtml(): string {
        const entity = this.currentEntity!;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Entity ${entity.eid}</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --header-bg: var(--vscode-editorGroupHeader-tabsBackground);
            --hover-bg: var(--vscode-list-hoverBackground);
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

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border-color);
        }

        .header h2 { margin: 0; }

        .actions { display: flex; gap: 8px; }

        .actions button {
            padding: 4px 12px;
            border: 1px solid var(--border-color);
            background: var(--header-bg);
            color: var(--text-color);
            cursor: pointer;
            border-radius: 4px;
        }

        .actions button:hover { background: var(--hover-bg); }
        .actions button:disabled { opacity: 0.5; cursor: not-allowed; }

        table { width: 100%; border-collapse: collapse; }

        th, td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }

        th {
            width: 200px;
            color: var(--vscode-symbolIcon-fieldForeground);
            font-weight: normal;
        }

        .entity-link {
            color: var(--link-color);
            cursor: pointer;
            text-decoration: underline;
        }

        pre {
            background: var(--header-bg);
            padding: 8px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 0;
        }

        .value-string { color: var(--vscode-symbolIcon-stringForeground); }
        .value-number { color: var(--vscode-symbolIcon-numberForeground); }
        .value-boolean { color: var(--vscode-symbolIcon-booleanForeground); }

        .references-section {
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid var(--border-color);
        }

        .references-section h3 {
            margin: 0 0 8px 0;
            font-size: 14px;
        }

        .section-desc {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin: 0 0 12px 0;
        }

        .refs-table th {
            background: var(--header-bg);
            font-weight: 600;
            width: auto;
        }

        .refs-table .attr-name {
            font-family: monospace;
            color: var(--vscode-symbolIcon-fieldForeground);
        }

        .ns-tag {
            display: inline-block;
            padding: 2px 6px;
            background: var(--header-bg);
            border-radius: 4px;
            font-size: 11px;
        }

        .preview {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>Entity ${entity.eid}</h2>
        <div class="actions">
            <button onclick="goBack()" ${this.history.length <= 1 ? 'disabled' : ''}>Back</button>
            <button onclick="refresh()">Refresh</button>
            <button onclick="copyEdn()">Copy EDN</button>
        </div>
    </div>

    <table>
        ${this.renderAttributes(entity.attributes, entity.refAttributes)}
    </table>

    ${entity.references.length > 0 ? `
    <div class="references-section">
        <h3>References (${entity.references.length})</h3>
        <p class="section-desc">Entities this entity depends on:</p>
        <table class="refs-table">
            <thead>
                <tr>
                    <th>Via</th>
                    <th>Entity</th>
                    <th>Type</th>
                    <th>Preview</th>
                </tr>
            </thead>
            <tbody>
                ${entity.references.map(ref => `
                    <tr>
                        <td class="attr-name">${this.escapeHtml(ref.attribute)}</td>
                        <td><span class="entity-link" onclick="navigate(${ref.id})">${ref.id}</span></td>
                        <td>${ref.namespace ? `<span class="ns-tag">${this.escapeHtml(ref.namespace)}</span>` : '-'}</td>
                        <td class="preview">${ref.preview ? this.escapeHtml(ref.preview) : '-'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    ` : ''}

    <script>
        const vscode = acquireVsCodeApi();
        function navigate(entityId) { vscode.postMessage({ command: 'navigate', entityId }); }
        function goBack() { vscode.postMessage({ command: 'back' }); }
        function copyEdn() { vscode.postMessage({ command: 'copyEdn' }); }
        function refresh() { vscode.postMessage({ command: 'refresh' }); }
    </script>
</body>
</html>`;
    }

    private renderAttributes(attrs: Record<string, unknown>, refAttributes: string[]): string {
        const entries = Object.entries(attrs);
        entries.sort((a, b) => a[0].localeCompare(b[0]));

        const refAttrSet = new Set(refAttributes);

        return entries.map(([key, value]) => {
            const isRef = refAttrSet.has(key) || refAttrSet.has(':' + key);
            const formattedValue = this.formatAttributeValue(value, isRef);
            return `<tr><th>${this.escapeHtml(key)}</th><td>${formattedValue}</td></tr>`;
        }).join('');
    }

    private formatAttributeValue(value: unknown, isRef: boolean = false): string {
        if (value === null || value === undefined) {
            return '<span class="value-null">nil</span>';
        }

        if (typeof value === 'string') {
            return `<span class="value-string">"${this.escapeHtml(value)}"</span>`;
        }

        if (typeof value === 'number') {
            // Only make clickable if this is a ref attribute
            if (isRef && Number.isInteger(value) && value > 0) {
                return `<span class="entity-link" onclick="navigate(${value})">${value}</span>`;
            }
            return `<span class="value-number">${value}</span>`;
        }

        if (typeof value === 'boolean') {
            return `<span class="value-boolean">${value}</span>`;
        }

        if (Array.isArray(value)) {
            if (value.length === 0) { return '[]'; }
            const items = value.map(v => this.formatAttributeValue(v, isRef)).join(', ');
            return `[${items}]`;
        }

        if (typeof value === 'object') {
            return `<pre>${this.escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
        }

        return this.escapeHtml(formatValue(value));
    }

    private async copyEntityAsEdn(): Promise<void> {
        if (!this.currentEntity) { return; }

        const edn = this.toEdn(this.currentEntity.attributes);
        await vscode.env.clipboard.writeText(edn);
        vscode.window.showInformationMessage('Entity EDN copied to clipboard');
    }

    private toEdn(data: unknown): string {
        if (data === null || data === undefined) { return 'nil'; }
        if (typeof data === 'string') { return `"${data.replace(/"/g, '\\"')}"`; }
        if (typeof data === 'number' || typeof data === 'boolean') { return String(data); }
        if (Array.isArray(data)) { return '[' + data.map(d => this.toEdn(d)).join(' ') + ']'; }
        if (typeof data === 'object') {
            const entries = Object.entries(data);
            return '{' + entries.map(([k, v]) => `${k} ${this.toEdn(v)}`).join('\n ') + '}';
        }
        return String(data);
    }

    private escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    dispose(): void {
        this.panel?.dispose();
    }
}
