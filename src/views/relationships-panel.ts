import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';

interface RefTarget {
    attribute: string;
    source: string;
    targets: string[];
    cardinality: string;
}

interface RelationshipEdge {
    from: string;
    to: string;
    attribute: string;
    cardinality: string;
}

interface PanelState {
    panel: vscode.WebviewPanel;
    refTargets: RefTarget[];
    edges: RelationshipEdge[];
    namespaces: string[];
}

export class RelationshipsPanel {
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
                'levinRelationships',
                `Relationships: ${dbName}`,
                vscode.ViewColumn.Active,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            state = {
                panel,
                refTargets: [],
                edges: [],
                namespaces: []
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

        await this.loadRefAttributes(dbPath);
        this.updateContent(dbPath);
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }, dbPath: string): Promise<void> {
        switch (message.command) {
            case 'refresh':
                await this.loadRefAttributes(dbPath);
                this.updateContent(dbPath);
                break;
            case 'queryAttribute':
                await this.openQueryForAttribute(message.attribute as string, dbPath);
                break;
        }
    }

    private async loadRefAttributes(dbPath: string): Promise<void> {
        const state = this.panels.get(dbPath);
        if (!state) return;

        // Use data-driven discovery to find actual ref targets
        const result = await this.dtlvBridge.discoverRefTargets(dbPath);

        if (result.success && result.data) {
            state.refTargets = result.data as RefTarget[];

            // Build edges from actual data relationships
            state.edges = [];
            const nsSet = new Set<string>();

            for (const ref of state.refTargets) {
                if (ref.source) {
                    nsSet.add(ref.source);
                }

                // Create edge for each discovered target
                for (const target of ref.targets) {
                    nsSet.add(target);
                    state.edges.push({
                        from: ref.source || 'unknown',
                        to: target,
                        attribute: ref.attribute,
                        cardinality: ref.cardinality
                    });
                }

                // If no targets discovered (no data), show as unknown
                if (ref.targets.length === 0 && ref.source) {
                    state.edges.push({
                        from: ref.source,
                        to: '?',
                        attribute: ref.attribute,
                        cardinality: ref.cardinality
                    });
                    nsSet.add('?');
                }
            }

            state.namespaces = Array.from(nsSet).sort();
        } else {
            state.refTargets = [];
            state.edges = [];
            state.namespaces = [];
        }
    }

    private async openQueryForAttribute(attribute: string, dbPath: string): Promise<void> {
        // Open a new query to show entities with this ref attribute
        const content = `{:db "${dbPath}"
 :query [:find ?e ?ref
         :where
         [?e ${attribute} ?ref]]
 :limit 50}`;

        const doc = await vscode.workspace.openTextDocument({
            language: 'datalevin-query',
            content
        });

        await vscode.window.showTextDocument(doc);
    }

    private updateContent(dbPath: string): void {
        const state = this.panels.get(dbPath);
        if (!state) return;
        state.panel.webview.html = this.getHtml(state);
    }

    private getHtml(state: PanelState): string {
        // Group by source namespace for the list view
        const grouped: Record<string, RefTarget[]> = {};
        for (const ref of state.refTargets) {
            const ns = ref.source || 'unknown';
            if (!grouped[ns]) { grouped[ns] = []; }
            grouped[ns].push(ref);
        }

        const groupedNamespaces = Object.keys(grouped).sort();

        // Generate SVG network diagram
        const svgDiagram = this.generateNetworkDiagram(state);

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

        h2, h3 { margin: 0; }

        button {
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }

        button:hover { background: var(--vscode-button-hoverBackground); }

        .tabs {
            display: flex;
            gap: 0;
            margin-bottom: 16px;
            border-bottom: 1px solid var(--border-color);
        }

        .tab {
            padding: 8px 16px;
            cursor: pointer;
            border: none;
            background: none;
            color: var(--text-color);
            border-bottom: 2px solid transparent;
        }

        .tab.active {
            border-bottom-color: var(--link-color);
            color: var(--link-color);
        }

        .tab:hover { background: var(--header-bg); }

        .tab-content { display: none; }
        .tab-content.active { display: block; }

        .diagram-container {
            background: var(--header-bg);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 24px;
            overflow: auto;
        }

        .diagram-container svg {
            display: block;
            margin: 0 auto;
        }

        .node {
            cursor: pointer;
        }

        .node rect {
            fill: var(--vscode-button-background);
            stroke: var(--border-color);
            stroke-width: 2;
            rx: 6;
        }

        .node:hover rect {
            fill: var(--vscode-button-hoverBackground);
        }

        .node text {
            fill: var(--vscode-button-foreground);
            font-size: 12px;
            font-weight: 600;
        }

        .edge {
            stroke: #888;
            stroke-width: 2;
            fill: none;
        }

        .edge-many {
            stroke-dasharray: 5,3;
        }

        .edge-label {
            fill: #888;
            font-size: 10px;
        }

        .arrowhead {
            fill: #888;
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

        .arrow {
            color: var(--vscode-descriptionForeground);
            margin: 0 8px;
        }

        .target-ns {
            font-weight: 500;
            color: var(--link-color);
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .legend {
            display: flex;
            gap: 16px;
            margin-top: 8px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .legend-line {
            width: 24px;
            height: 2px;
            background: var(--border-color);
        }

        .legend-line.dashed {
            background: repeating-linear-gradient(90deg, var(--border-color) 0, var(--border-color) 5px, transparent 5px, transparent 8px);
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>Entity Relationships</h2>
        <button onclick="refresh()">Refresh</button>
    </div>

    <div class="tabs">
        <button class="tab active" onclick="showTab('diagram')">Diagram</button>
        <button class="tab" onclick="showTab('list')">List View</button>
    </div>

    <div id="diagram" class="tab-content active">
        ${state.edges.length > 0 ? `
        <div class="diagram-container">
            ${svgDiagram}
        </div>
        <div class="legend">
            <div class="legend-item"><div class="legend-line"></div> one-to-one</div>
            <div class="legend-item"><div class="legend-line dashed"></div> one-to-many</div>
        </div>
        ` : `
        <div class="empty-state">
            <p>No relationships found.</p>
        </div>
        `}
    </div>

    <div id="list" class="tab-content">
        ${state.refTargets.length > 0 ? groupedNamespaces.map(ns => `
            <div class="namespace-section">
                <div class="namespace-header">${ns}</div>
                <ul class="ref-list">
                    ${grouped[ns].map(ref => {
                        const targetDisplay = ref.targets.length > 0 ? ref.targets.join(', ') : '? (no data)';
                        return `
                        <li class="ref-item">
                            <span class="ref-name">
                                <a class="ref-link" onclick="queryAttribute('${this.escapeHtml(ref.attribute)}')">${this.escapeHtml(ref.attribute)}</a>
                            </span>
                            <span class="arrow">→</span>
                            <span class="target-ns">${targetDisplay}</span>
                            ${ref.cardinality === 'many' ? '<span class="tag cardinality-many">many</span>' : ''}
                        </li>
                    `;}).join('')}
                </ul>
            </div>
        `).join('') : `
            <div class="empty-state">
                <p>No reference attributes found.</p>
            </div>
        `}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function queryAttribute(attribute) {
            vscode.postMessage({ command: 'queryAttribute', attribute });
        }

        function showTab(tabId) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelector(\`[onclick="showTab('\${tabId}')"]\`).classList.add('active');
            document.getElementById(tabId).classList.add('active');
        }
    </script>
</body>
</html>`;
    }

    private generateNetworkDiagram(state: PanelState): string {
        if (state.namespaces.length === 0) return '';

        const nodeWidth = 100;
        const nodeHeight = 36;
        const padding = 60;

        // Position nodes in a circle
        const numNodes = state.namespaces.length;
        const radius = Math.max(120, numNodes * 30);
        const centerX = radius + padding + nodeWidth / 2;
        const centerY = radius + padding + nodeHeight / 2;

        const nodePositions: Record<string, { x: number; y: number }> = {};

        state.namespaces.forEach((ns, i) => {
            const angle = (2 * Math.PI * i) / numNodes - Math.PI / 2;
            nodePositions[ns] = {
                x: centerX + radius * Math.cos(angle) - nodeWidth / 2,
                y: centerY + radius * Math.sin(angle) - nodeHeight / 2
            };
        });

        const svgWidth = 2 * (radius + padding + nodeWidth);
        const svgHeight = 2 * (radius + padding + nodeHeight);

        // Generate edges (curved paths)
        const edgesSvg = state.edges.map((edge, idx) => {
            const fromPos = nodePositions[edge.from];
            const toPos = nodePositions[edge.to];

            if (!fromPos || !toPos) return '';

            const strokeStyle = edge.cardinality === 'many' ? 'stroke-dasharray: 5,3;' : '';

            // Self-referential edge
            if (edge.from === edge.to) {
                const x = fromPos.x + nodeWidth / 2;
                const y = fromPos.y;
                const loopRadius = 25;
                return `
                    <path d="M ${x - 15} ${y} C ${x - 15} ${y - loopRadius * 2}, ${x + 15} ${y - loopRadius * 2}, ${x + 15} ${y}"
                          style="stroke: #888; stroke-width: 2; fill: none; ${strokeStyle}"
                          marker-end="url(#arrowhead)" />
                `;
            }

            const fromCenterX = fromPos.x + nodeWidth / 2;
            const fromCenterY = fromPos.y + nodeHeight / 2;
            const toCenterX = toPos.x + nodeWidth / 2;
            const toCenterY = toPos.y + nodeHeight / 2;

            // Calculate control point for curved line
            const midX = (fromCenterX + toCenterX) / 2;
            const midY = (fromCenterY + toCenterY) / 2;
            const dx = toCenterX - fromCenterX;
            const dy = toCenterY - fromCenterY;
            const perpX = -dy * 0.2;
            const perpY = dx * 0.2;
            const ctrlX = midX + perpX;
            const ctrlY = midY + perpY;

            // Calculate arrow endpoint on target node edge
            const angle = Math.atan2(toCenterY - ctrlY, toCenterX - ctrlX);
            const endX = toCenterX - (nodeWidth / 2 + 5) * Math.cos(angle);
            const endY = toCenterY - (nodeHeight / 2 + 5) * Math.sin(angle);

            return `
                <path d="M ${fromCenterX} ${fromCenterY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}"
                      style="stroke: #888; stroke-width: 2; fill: none; ${strokeStyle}"
                      marker-end="url(#arrowhead)" />
            `;
        }).join('');

        // Generate nodes
        const nodesSvg = state.namespaces.map(ns => {
            const pos = nodePositions[ns];
            return `
                <g class="node" onclick="queryNamespace('${ns}')">
                    <rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" />
                    <text x="${pos.x + nodeWidth / 2}" y="${pos.y + nodeHeight / 2 + 4}" text-anchor="middle">${ns}</text>
                </g>
            `;
        }).join('');

        return `
            <svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
                <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon fill="#888" points="0 0, 10 3.5, 0 7" />
                    </marker>
                </defs>
                ${edgesSvg}
                ${nodesSvg}
            </svg>
        `;
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
