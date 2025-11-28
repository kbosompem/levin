import * as vscode from 'vscode';
import { DtlvBridge, SchemaAttribute } from '../dtlv-bridge';

export class SchemaEditor {
    private panel: vscode.WebviewPanel | undefined;
    private currentDbPath: string = '';
    private schema: SchemaAttribute[] = [];

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

        // Fetch current schema
        this.schema = await this.dtlvBridge.getSchema(dbPath);

        const dbName = dbPath.split('/').pop() || 'Unknown';

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'levinSchema',
                `Schema: ${dbName}`,
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
            this.panel.title = `Schema: ${dbName}`;
        }

        this.updateContent();
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }): Promise<void> {
        switch (message.command) {
            case 'addAttribute':
                await this.addAttribute(message.attribute as NewAttribute);
                break;
            case 'refresh':
                await this.refresh();
                break;
        }
    }

    private async addAttribute(attr: NewAttribute): Promise<void> {
        const fullAttribute = `${attr.namespace}/${attr.name}`;

        const result = await this.dtlvBridge.addSchema(this.currentDbPath, {
            attribute: fullAttribute,
            valueType: attr.valueType,
            cardinality: attr.cardinality,
            index: attr.index,
            unique: attr.unique || undefined,
            fulltext: attr.fulltext,
            isComponent: attr.isComponent
        });

        if (result.success) {
            vscode.window.showInformationMessage(`Added attribute :${fullAttribute}`);
            await this.refresh();
        } else {
            vscode.window.showErrorMessage(`Failed to add attribute: ${result.error}`);
        }
    }

    private async refresh(): Promise<void> {
        this.schema = await this.dtlvBridge.getSchema(this.currentDbPath);
        this.updateContent();
    }

    private updateContent(): void {
        if (!this.panel) { return; }
        this.panel.webview.html = this.getHtml();
    }

    private getHtml(): string {
        const namespaces = [...new Set(this.schema.map(s => {
            const parts = s.attribute.split('/');
            return parts.length > 1 ? parts[0].replace(':', '') : 'db';
        }))].sort();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Schema Editor</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --header-bg: var(--vscode-editorGroupHeader-tabsBackground);
            --input-bg: var(--vscode-input-background);
            --input-border: var(--vscode-input-border);
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--text-color);
            background-color: var(--bg-color);
            margin: 0;
            padding: 16px;
        }

        .section {
            margin-bottom: 24px;
            padding: 16px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
        }

        .section h3 { margin: 0 0 16px 0; }

        .form-row {
            display: flex;
            gap: 16px;
            margin-bottom: 12px;
            align-items: center;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .form-group label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        input, select {
            padding: 6px 8px;
            background: var(--input-bg);
            border: 1px solid var(--input-border);
            color: var(--text-color);
            border-radius: 4px;
        }

        input[type="checkbox"] { width: 16px; height: 16px; }

        .checkbox-group {
            display: flex;
            gap: 16px;
            align-items: center;
        }

        .checkbox-group label {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }

        button:hover { background: var(--vscode-button-hoverBackground); }

        table { width: 100%; border-collapse: collapse; }

        th, td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }

        th { background: var(--header-bg); }

        .filter-row { margin-bottom: 12px; }

        .tag {
            display: inline-block;
            padding: 2px 6px;
            background: var(--header-bg);
            border-radius: 4px;
            font-size: 11px;
            margin-right: 4px;
        }
    </style>
</head>
<body>
    <div class="section">
        <h3>New Attribute</h3>
        <div class="form-row">
            <div class="form-group">
                <label>Namespace</label>
                <input type="text" id="namespace" list="namespaces" placeholder="user" />
                <datalist id="namespaces">
                    ${namespaces.map(ns => `<option value="${ns}">`).join('')}
                </datalist>
            </div>
            <div class="form-group">
                <label>Name</label>
                <input type="text" id="name" placeholder="attribute-name" />
            </div>
        </div>

        <div class="form-row">
            <div class="form-group">
                <label>Value Type</label>
                <select id="valueType">
                    <option value="string">string</option>
                    <option value="long">long</option>
                    <option value="double">double</option>
                    <option value="boolean">boolean</option>
                    <option value="instant">instant</option>
                    <option value="uuid">uuid</option>
                    <option value="ref">ref</option>
                    <option value="bytes">bytes</option>
                </select>
            </div>
            <div class="form-group">
                <label>Cardinality</label>
                <select id="cardinality">
                    <option value="one">one</option>
                    <option value="many">many</option>
                </select>
            </div>
        </div>

        <div class="form-row">
            <div class="checkbox-group">
                <label><input type="checkbox" id="index" /> Indexed</label>
                <label><input type="checkbox" id="unique-value" /> Unique Value</label>
                <label><input type="checkbox" id="unique-identity" /> Unique Identity</label>
                <label><input type="checkbox" id="fulltext" /> Fulltext</label>
                <label><input type="checkbox" id="isComponent" /> Is Component</label>
            </div>
        </div>

        <div class="form-row">
            <button onclick="addAttribute()">Add Attribute</button>
        </div>
    </div>

    <div class="section">
        <h3>Existing Attributes (${this.schema.length})</h3>
        <div class="filter-row">
            <input type="text" id="filter" placeholder="Filter attributes..." oninput="filterAttributes()" style="width: 300px;" />
        </div>
        <table id="schemaTable">
            <thead>
                <tr>
                    <th>Attribute</th>
                    <th>Type</th>
                    <th>Properties</th>
                </tr>
            </thead>
            <tbody>
                ${this.schema.map(attr => `
                    <tr data-attribute="${this.escapeHtml(attr.attribute)}">
                        <td><code>${this.escapeHtml(attr.attribute)}</code></td>
                        <td>${attr.valueType || 'unknown'}, ${attr.cardinality || 'one'}</td>
                        <td>
                            ${attr.index ? '<span class="tag">indexed</span>' : ''}
                            ${attr.unique ? `<span class="tag">${attr.unique}</span>` : ''}
                            ${attr.fulltext ? '<span class="tag">fulltext</span>' : ''}
                            ${attr.isComponent ? '<span class="tag">component</span>' : ''}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function addAttribute() {
            const namespace = document.getElementById('namespace').value.trim();
            const name = document.getElementById('name').value.trim();
            const valueType = document.getElementById('valueType').value;
            const cardinality = document.getElementById('cardinality').value;
            const index = document.getElementById('index').checked;
            const uniqueValue = document.getElementById('unique-value').checked;
            const uniqueIdentity = document.getElementById('unique-identity').checked;
            const fulltext = document.getElementById('fulltext').checked;
            const isComponent = document.getElementById('isComponent').checked;

            if (!namespace || !name) {
                alert('Please enter namespace and name');
                return;
            }

            let unique = null;
            if (uniqueIdentity) { unique = 'identity'; }
            else if (uniqueValue) { unique = 'value'; }

            vscode.postMessage({
                command: 'addAttribute',
                attribute: { namespace, name, valueType, cardinality, index, unique, fulltext, isComponent }
            });

            document.getElementById('namespace').value = '';
            document.getElementById('name').value = '';
            document.getElementById('index').checked = false;
            document.getElementById('unique-value').checked = false;
            document.getElementById('unique-identity').checked = false;
            document.getElementById('fulltext').checked = false;
            document.getElementById('isComponent').checked = false;
        }

        function filterAttributes() {
            const filter = document.getElementById('filter').value.toLowerCase();
            const rows = document.querySelectorAll('#schemaTable tbody tr');
            rows.forEach(row => {
                const attr = row.getAttribute('data-attribute').toLowerCase();
                row.style.display = attr.includes(filter) ? '' : 'none';
            });
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

interface NewAttribute {
    namespace: string;
    name: string;
    valueType: string;
    cardinality: string;
    index: boolean;
    unique: string | null;
    fulltext: boolean;
    isComponent: boolean;
}
