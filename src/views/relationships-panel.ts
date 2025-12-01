import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';

interface RefAttribute {
    attribute: string;
    cardinality: string;
    isComponent: boolean;
}

export class RelationshipsPanel {
    private panel: vscode.WebviewPanel | undefined;
    private currentDbPath: string = '';
    private refAttributes: RefAttribute[] = [];

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

        const dbName = dbPath.split('/').pop() || 'Unknown';

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'levinRelationships',
                `Relationships: ${dbName}`,
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
            this.panel.title = `Relationships: ${dbName}`;
        }

        await this.loadRefAttributes();
        this.updateContent();
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }): Promise<void> {
        switch (message.command) {
            case 'refresh':
                await this.loadRefAttributes();
                this.updateContent();
                break;
            case 'queryAttribute':
                await this.openQueryForAttribute(message.attribute as string);
                break;
        }
    }

    private async loadRefAttributes(): Promise<void> {
        const result = await this.dtlvBridge.getRefAttributes(this.currentDbPath);

        if (result.success && result.data) {
            this.refAttributes = result.data as RefAttribute[];
        } else {
            this.refAttributes = [];
        }
    }

    private async openQueryForAttribute(attribute: string): Promise<void> {
        // Open a new query to show entities with this ref attribute
        const content = `{:db "${this.currentDbPath}"
 :query [:find ?e ?ref
         :where
         [?e :${attribute} ?ref]]
 :limit 50}`;

        const doc = await vscode.workspace.openTextDocument({
            language: 'datalevin-query',
            content
        });

        await vscode.window.showTextDocument(doc);
    }

    private updateContent(): void {
        if (!this.panel) { return; }
        this.panel.webview.html = this.getHtml();
    }

    private getHtml(): string {
        // Group by namespace
        const grouped: Record<string, RefAttribute[]> = {};
        for (const attr of this.refAttributes) {
            const parts = attr.attribute.split('/');
            const ns = parts.length > 1 ? parts[0].replace(':', '') : 'db';
            if (!grouped[ns]) { grouped[ns] = []; }
            grouped[ns].push(attr);
        }

        const namespaces = Object.keys(grouped).sort();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Relationships</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --header-bg: var(--vscode-editorGroupHeader-tabsBackground);
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
        }

        h2 { margin: 0; }

        button {
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }

        button:hover { background: var(--vscode-button-hoverBackground); }

        .description {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 24px;
        }

        .namespace-section {
            margin-bottom: 24px;
        }

        .namespace-header {
            font-weight: 600;
            padding: 8px 12px;
            background: var(--header-bg);
            border-radius: 4px;
            margin-bottom: 8px;
        }

        .ref-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .ref-item {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color);
        }

        .ref-item:last-child { border-bottom: none; }

        .ref-name {
            flex: 1;
            font-family: monospace;
        }

        .ref-link {
            color: var(--link-color);
            cursor: pointer;
        }

        .ref-link:hover { text-decoration: underline; }

        .tag {
            display: inline-block;
            padding: 2px 6px;
            background: var(--header-bg);
            border-radius: 4px;
            font-size: 11px;
            margin-left: 8px;
        }

        .tag.cardinality-many { background: #2d5a27; }
        .tag.component { background: #5a4427; }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .arrow {
            color: var(--vscode-descriptionForeground);
            margin: 0 8px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>Reference Attributes</h2>
        <button onclick="refresh()">Refresh</button>
    </div>

    <p class="description">
        These attributes define relationships between entities (type: <code>ref</code>).
        Click on an attribute to query entities using that relationship.
    </p>

    ${this.refAttributes.length > 0 ? namespaces.map(ns => `
        <div class="namespace-section">
            <div class="namespace-header">${ns}</div>
            <ul class="ref-list">
                ${grouped[ns].map(attr => `
                    <li class="ref-item">
                        <span class="ref-name">
                            <a class="ref-link" onclick="queryAttribute('${this.escapeHtml(attr.attribute)}')">${this.escapeHtml(attr.attribute)}</a>
                        </span>
                        <span class="arrow">→</span>
                        <span>entity ref</span>
                        ${attr.cardinality === 'many' ? '<span class="tag cardinality-many">many</span>' : ''}
                        ${attr.isComponent ? '<span class="tag component">component</span>' : ''}
                    </li>
                `).join('')}
            </ul>
        </div>
    `).join('') : `
        <div class="empty-state">
            <p>No reference attributes found.</p>
            <p>Reference attributes have <code>:db/valueType :db.type/ref</code> and define relationships between entities.</p>
        </div>
    `}

    <script>
        const vscode = acquireVsCodeApi();

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function queryAttribute(attribute) {
            vscode.postMessage({ command: 'queryAttribute', attribute });
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
