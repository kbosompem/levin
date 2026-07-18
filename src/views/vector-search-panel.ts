import * as vscode from 'vscode';
import { DtlvBridge, SchemaAttribute } from '../dtlv-bridge';

export class VectorSearchPanel {
    private panels: Map<string, vscode.WebviewPanel> = new Map();
    private vectorAttributes: SchemaAttribute[] = [];
    private allAttributes: SchemaAttribute[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private dtlvBridge: DtlvBridge
    ) {}

    async show(dbPath: string): Promise<void> {
        if (!dbPath) {
            vscode.window.showErrorMessage('No database path provided');
            return;
        }

        this.allAttributes = await this.dtlvBridge.getSchema(dbPath);
        this.vectorAttributes = this.allAttributes.filter(a => a.valueType === 'vec');

        if (this.vectorAttributes.length === 0) {
            vscode.window.showWarningMessage('No vector attributes found in this database schema.');
            return;
        }

        const dbName = dbPath.split('/').pop() || 'Unknown';
        let panel = this.panels.get(dbPath);

        if (!panel) {
            panel = vscode.window.createWebviewPanel(
                'levinVectorSearch',
                `Find Similar: ${dbName}`,
                vscode.ViewColumn.Active,
                { enableScripts: true, retainContextWhenHidden: true }
            );

            panel.onDidDispose(() => { this.panels.delete(dbPath); });
            panel.webview.onDidReceiveMessage(
                (msg) => this.handleMessage(msg, dbPath),
                undefined
            );

            this.panels.set(dbPath, panel);
        } else {
            panel.reveal(vscode.ViewColumn.Active);
        }

        panel.webview.html = this.getHtml(dbPath);

        // Load entities that have vector attributes
        this.loadEntities(dbPath);
    }

    private async loadEntities(dbPath: string): Promise<void> {
        const panel = this.panels.get(dbPath);
        if (!panel) { return; }

        // Find a "label" attribute for display — first string attr in same namespace as the vec attr
        for (const vecAttr of this.vectorAttributes) {
            const vecNs = vecAttr.attribute.includes('/') ? vecAttr.attribute.split('/')[0].replace(':', '') : '';
            const labelAttr = this.allAttributes.find(a => {
                const ns = a.attribute.includes('/') ? a.attribute.split('/')[0].replace(':', '') : '';
                return ns === vecNs && a.valueType === 'string' && a.attribute !== vecAttr.attribute;
            });

            const labelAttrName = labelAttr ? labelAttr.attribute.replace(/^:/, '') : null;
            const vecAttrName = vecAttr.attribute.replace(/^:/, '');

            // Query entities that have this vector attribute, pull a label for display
            const code = labelAttrName
                ? `(let [results (datalevin.core/q '[:find ?e ?label
                       :where
                       [?e :${vecAttrName} _]
                       [?e :${labelAttrName} ?label]] @conn)]
                    {:attribute "${vecAttrName}"
                     :labelAttribute "${labelAttrName}"
                     :entities (vec (sort-by second (take 200 results)))})`
                : `(let [results (datalevin.core/q '[:find ?e
                       :where
                       [?e :${vecAttrName} _]] @conn)]
                    {:attribute "${vecAttrName}"
                     :entities (vec (take 200 (map (fn [[e]] [e (str "Entity " e)]) results)))})`;

            const result = await this.dtlvBridge.runCode_public(dbPath, code);

            if (result.success && result.data) {
                panel.webview.postMessage({
                    command: 'entitiesLoaded',
                    data: result.data
                });
            }
        }
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }, dbPath: string): Promise<void> {
        const panel = this.panels.get(dbPath);
        if (!panel) { return; }

        switch (message.command) {
            case 'findSimilar': {
                const entityId = message.entityId as number;
                const attribute = message.attribute as string;
                const top = (message.top as number) || 10;

                // Get the entity's vector, then search for neighbors
                // Pull all non-vec attributes for display in results
                const nonVecAttrs = this.allAttributes
                    .filter(a => a.valueType !== 'vec')
                    .map(a => a.attribute.startsWith(':') ? a.attribute : `:${a.attribute}`);
                const pullAttrs = nonVecAttrs.length > 0 ? nonVecAttrs.join(' ') : '*';

                const code = `
                    (let [db @conn
                          vec (get (datalevin.core/pull db [:${attribute}] ${entityId}) :${attribute})
                          neighbors (when vec
                                     (datalevin.core/q '[:find ?e ?dist
                                                         :in $ ?q
                                                         :where
                                                         [(vec-neighbors $ :${attribute} ?q {:top ${top + 1} :display :refs+dists}) [[?e _ _ ?dist]]]]
                                                       db vec))
                          ;; Remove the source entity itself
                          filtered (remove (fn [[e _]] (= e ${entityId})) neighbors)
                          results (take ${top} (sort-by second filtered))
                          ;; Pull display attributes for each result
                          enriched (mapv (fn [[e dist]]
                                          (let [entity (datalevin.core/pull db '[${pullAttrs}] e)]
                                            {:eid e
                                             :distance dist
                                             :attrs (into {} (remove (fn [[k v]] (or (= k :db/id) (nil? v))) entity))}))
                                        results)]
                      {:source ${entityId}
                       :attribute "${attribute}"
                       :total (count enriched)
                       :results enriched})
                `.trim();

                const result = await this.dtlvBridge.runCode_public(dbPath, code);

                panel.webview.postMessage({
                    command: 'searchResults',
                    success: result.success,
                    data: result.data,
                    error: result.error
                });
                break;
            }
        }
    }

    private getHtml(_dbPath: string): string {
        const attrOptions = this.vectorAttributes.map(a => {
            return `<option value="${this.escapeHtml(a.attribute.replace(/^:/, ''))}">${this.escapeHtml(a.attribute)}</option>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Find Similar</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --header-bg: var(--vscode-editorGroupHeader-tabsBackground);
            --input-bg: var(--vscode-input-background);
            --input-border: var(--vscode-input-border);
        }
        body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--text-color); background: var(--bg-color); margin: 0; padding: 16px; }
        .section { margin-bottom: 24px; padding: 16px; border: 1px solid var(--border-color); border-radius: 4px; }
        .section h3 { margin: 0 0 12px 0; }
        .form-row { display: flex; gap: 16px; margin-bottom: 12px; align-items: flex-end; }
        .form-group { display: flex; flex-direction: column; gap: 4px; }
        .form-group label { font-size: 12px; color: var(--vscode-descriptionForeground); }
        input, select { padding: 6px 8px; background: var(--input-bg); border: 1px solid var(--input-border); color: var(--text-color); border-radius: 4px; }
        button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .entity-list { max-height: 300px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; }
        .entity-item { padding: 8px 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); }
        .entity-item:last-child { border-bottom: none; }
        .entity-item:hover { background: var(--header-bg); }
        .entity-item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
        .entity-id { font-size: 11px; opacity: 0.6; }
        .entity-label { font-weight: 500; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color); }
        th { background: var(--header-bg); }
        .distance-bar { display: inline-block; height: 8px; background: var(--vscode-progressBar-background); border-radius: 4px; min-width: 4px; }
        .status { padding: 8px; margin-top: 8px; border-radius: 4px; }
        .status.error { background: var(--vscode-inputValidation-errorBackground); }
        .status.info { color: var(--vscode-descriptionForeground); }
        .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--text-color); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .filter-input { width: 100%; margin-bottom: 8px; box-sizing: border-box; }
        .empty-state { padding: 24px; text-align: center; color: var(--vscode-descriptionForeground); }
    </style>
</head>
<body>
    <div class="section">
        <h3>Find Similar Entities</h3>
        <p style="margin: 0 0 12px 0; color: var(--vscode-descriptionForeground); font-size: 12px;">
            Select an entity to find others with similar vector embeddings.
        </p>
        <div class="form-row">
            <div class="form-group">
                <label>Vector Attribute</label>
                <select id="attribute">${attrOptions}</select>
            </div>
            <div class="form-group">
                <label>Results</label>
                <input type="number" id="topK" value="10" min="1" max="100" style="width: 70px;" />
            </div>
        </div>
        <input type="text" class="filter-input" id="entityFilter" placeholder="Filter entities..." oninput="filterEntities()" />
        <div class="entity-list" id="entityList">
            <div class="empty-state" id="loadingState"><span class="spinner"></span>Loading entities...</div>
        </div>
        <div id="status"></div>
    </div>

    <div class="section" id="resultsSection" style="display: none;">
        <h3>Similar to: <span id="sourceName"></span></h3>
        <div id="resultCount" style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 8px;"></div>
        <table>
            <thead><tr id="resultsHeader"></tr></thead>
            <tbody id="resultsBody"></tbody>
        </table>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let entities = [];
        let selectedEntityId = null;

        function filterEntities() {
            const filter = document.getElementById('entityFilter').value.toLowerCase();
            const items = document.querySelectorAll('.entity-item');
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(filter) ? '' : 'none';
            });
        }

        function selectEntity(eid, label) {
            selectedEntityId = eid;
            document.querySelectorAll('.entity-item').forEach(el => el.classList.remove('selected'));
            const el = document.querySelector('[data-eid="' + eid + '"]');
            if (el) el.classList.add('selected');

            // Auto-search on selection
            const attribute = document.getElementById('attribute').value;
            const top = parseInt(document.getElementById('topK').value) || 10;

            document.getElementById('sourceName').textContent = label;
            showStatus('<span class="spinner"></span>Finding similar...', 'info');
            document.getElementById('resultsSection').style.display = 'block';
            document.getElementById('resultsBody').textContent = '';

            vscode.postMessage({ command: 'findSimilar', entityId: eid, attribute, top });
        }

        function showStatus(msg, type) {
            const el = document.getElementById('status');
            el.innerHTML = msg;
            el.className = 'status ' + type;
            el.style.display = 'block';
        }

        window.addEventListener('message', event => {
            const msg = event.data;

            if (msg.command === 'entitiesLoaded') {
                const data = msg.data;
                entities = data.entities || [];
                const list = document.getElementById('entityList');
                list.textContent = '';

                if (entities.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'empty-state';
                    empty.textContent = 'No entities with vector data found.';
                    list.appendChild(empty);
                    return;
                }

                entities.forEach(([eid, label]) => {
                    const item = document.createElement('div');
                    item.className = 'entity-item';
                    item.setAttribute('data-eid', eid);

                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'entity-label';
                    labelSpan.textContent = label || ('Entity ' + eid);

                    const idSpan = document.createElement('span');
                    idSpan.className = 'entity-id';
                    idSpan.textContent = '#' + eid;

                    item.appendChild(labelSpan);
                    item.appendChild(idSpan);
                    item.addEventListener('click', () => selectEntity(eid, label || ('Entity ' + eid)));
                    list.appendChild(item);
                });
            }

            if (msg.command === 'searchResults') {
                document.getElementById('status').style.display = 'none';

                if (!msg.success) {
                    showStatus('Error: ' + (msg.error || 'Unknown error'), 'error');
                    return;
                }

                const data = msg.data;
                const results = data.results || [];

                document.getElementById('resultCount').textContent = results.length + ' similar entities found';

                // Collect all attribute keys from results
                const attrKeys = new Set();
                results.forEach(r => {
                    if (r.attrs) Object.keys(r.attrs).forEach(k => attrKeys.add(k));
                });
                const columns = Array.from(attrKeys).sort();

                // Build header
                const header = document.getElementById('resultsHeader');
                header.textContent = '';
                ['Distance', ...columns].forEach(col => {
                    const th = document.createElement('th');
                    th.textContent = col;
                    header.appendChild(th);
                });

                // Find max distance for bar scaling
                const maxDist = results.length > 0 ? Math.max(...results.map(r => r.distance || 0), 0.001) : 1;

                // Build body
                const body = document.getElementById('resultsBody');
                body.textContent = '';
                results.forEach(r => {
                    const tr = document.createElement('tr');

                    // Distance cell with visual bar
                    const distTd = document.createElement('td');
                    const dist = typeof r.distance === 'number' ? r.distance : 0;
                    const barWidth = Math.max(4, Math.round((1 - dist / maxDist) * 80));
                    const bar = document.createElement('span');
                    bar.className = 'distance-bar';
                    bar.style.width = barWidth + 'px';
                    distTd.appendChild(bar);
                    const distText = document.createTextNode(' ' + dist.toFixed(4));
                    distTd.appendChild(distText);
                    tr.appendChild(distTd);

                    // Attribute cells
                    columns.forEach(col => {
                        const td = document.createElement('td');
                        const val = r.attrs ? r.attrs[col] : null;
                        td.textContent = val !== null && val !== undefined ? String(val) : '-';
                        tr.appendChild(td);
                    });

                    body.appendChild(tr);
                });
            }
        });
    </script>
</body>
</html>`;
    }

    private escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    dispose(): void {
        for (const panel of this.panels.values()) {
            panel.dispose();
        }
        this.panels.clear();
    }
}
