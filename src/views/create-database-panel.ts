import * as vscode from 'vscode';
import * as path from 'path';
import { DtlvBridge, CreateDatabaseOptions } from '../dtlv-bridge';

interface Template {
    name: string;
    description: string;
    schema: string;
    options: Partial<CreateDatabaseOptions>;
}

const BUILT_IN_TEMPLATES: Template[] = [
    {
        name: 'Empty',
        description: 'Blank database with no schema',
        schema: '{}',
        options: {}
    },
    {
        name: 'User Management',
        description: 'Users with email, name, role, and timestamps',
        schema: `{:user/email {:db/valueType :db.type/string :db/unique :db.unique/identity}
 :user/name {:db/valueType :db.type/string}
 :user/role {:db/valueType :db.type/keyword}
 :user/active {:db/valueType :db.type/boolean}}`,
        options: { autoEntityTime: true }
    },
    {
        name: 'Blog / CMS',
        description: 'Posts with title, body (fulltext), author, tags',
        schema: `{:post/title {:db/valueType :db.type/string :db/fulltext true}
 :post/body {:db/valueType :db.type/string :db/fulltext true}
 :post/slug {:db/valueType :db.type/string :db/unique :db.unique/identity}
 :post/author {:db/valueType :db.type/ref}
 :post/tags {:db/valueType :db.type/keyword :db/cardinality :db.cardinality/many}
 :post/published {:db/valueType :db.type/boolean}
 :author/name {:db/valueType :db.type/string}
 :author/email {:db/valueType :db.type/string :db/unique :db.unique/identity}}`,
        options: { autoEntityTime: true }
    },
    {
        name: 'RAG / Embeddings',
        description: 'Documents with content (fulltext), vector embeddings, and source tracking',
        schema: `{:doc/id {:db/valueType :db.type/string :db/unique :db.unique/identity}
 :doc/title {:db/valueType :db.type/string :db/fulltext true}
 :doc/content {:db/valueType :db.type/string :db/fulltext true}
 :doc/embedding {:db/valueType :db.type/vec}
 :doc/source {:db/valueType :db.type/string}
 :doc/chunk-index {:db/valueType :db.type/long}}`,
        options: {
            autoEntityTime: true,
            vectorOpts: { dimensions: 1536, metricType: 'cosine' }
        }
    },
    {
        name: 'E-Commerce',
        description: 'Products, orders, and customers',
        schema: `{:product/name {:db/valueType :db.type/string :db/fulltext true}
 :product/sku {:db/valueType :db.type/string :db/unique :db.unique/identity}
 :product/price {:db/valueType :db.type/double}
 :product/category {:db/valueType :db.type/ref}
 :product/in-stock {:db/valueType :db.type/boolean}
 :category/name {:db/valueType :db.type/string :db/unique :db.unique/identity}
 :customer/email {:db/valueType :db.type/string :db/unique :db.unique/identity}
 :customer/name {:db/valueType :db.type/string}
 :order/customer {:db/valueType :db.type/ref}
 :order/items {:db/valueType :db.type/ref :db/cardinality :db.cardinality/many :db/isComponent true}
 :order/total {:db/valueType :db.type/double}
 :order/status {:db/valueType :db.type/keyword}
 :order-item/product {:db/valueType :db.type/ref}
 :order-item/quantity {:db/valueType :db.type/long}
 :order-item/price {:db/valueType :db.type/double}}`,
        options: { autoEntityTime: true }
    }
];

export class CreateDatabasePanel {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private dtlvBridge: DtlvBridge,
        private onCreated: (dbPath: string) => void
    ) {}

    show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'levinCreateDatabase',
            'Create Database',
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        this.panel.onDidDispose(() => { this.panel = undefined; });
        this.panel.webview.onDidReceiveMessage(
            (msg) => this.handleMessage(msg),
            undefined
        );

        this.panel.webview.html = this.getHtml();
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }): Promise<void> {
        switch (message.command) {
            case 'selectFolder': {
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: 'Select Parent Folder',
                    title: 'Select folder to create database in'
                });
                if (uris && uris[0]) {
                    this.panel?.webview.postMessage({
                        command: 'folderSelected',
                        path: uris[0].fsPath
                    });
                }
                break;
            }
            case 'importSchema': {
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectMany: false,
                    filters: { 'EDN Files': ['edn'], 'All Files': ['*'] },
                    title: 'Select Schema File'
                });
                if (uris && uris[0]) {
                    const content = Buffer.from(await vscode.workspace.fs.readFile(uris[0])).toString('utf-8');
                    this.panel?.webview.postMessage({
                        command: 'schemaImported',
                        content: content
                    });
                }
                break;
            }
            case 'create': {
                const dbName = message.dbName as string;
                const parentPath = message.parentPath as string;
                const schema = message.schema as string;
                const autoEntityTime = message.autoEntityTime as boolean;
                const validateData = message.validateData as boolean;
                const closedSchema = message.closedSchema as boolean;
                const hasVectorOpts = message.hasVectorOpts as boolean;
                const vectorDimensions = message.vectorDimensions as number;
                const vectorMetricType = message.vectorMetricType as string;
                const vectorQuantization = message.vectorQuantization as string;
                const vectorConnectivity = message.vectorConnectivity as number;
                const vectorExpansionAdd = message.vectorExpansionAdd as number;
                const vectorExpansionSearch = message.vectorExpansionSearch as number;

                if (!dbName || !parentPath) {
                    vscode.window.showErrorMessage('Database name and location are required');
                    return;
                }

                const dbPath = path.join(parentPath, dbName);

                const options: CreateDatabaseOptions = {};
                if (schema && schema.trim() !== '{}' && schema.trim() !== '') {
                    options.schema = schema;
                }
                if (autoEntityTime) { options.autoEntityTime = true; }
                if (validateData) { options.validateData = true; }
                if (closedSchema) { options.closedSchema = true; }
                if (hasVectorOpts && vectorDimensions > 0) {
                    options.vectorOpts = {
                        dimensions: vectorDimensions,
                        metricType: vectorMetricType || undefined,
                        quantization: vectorQuantization || undefined,
                        connectivity: vectorConnectivity || undefined,
                        expansionAdd: vectorExpansionAdd || undefined,
                        expansionSearch: vectorExpansionSearch || undefined
                    };
                }

                this.panel?.webview.postMessage({ command: 'creating' });

                const result = await this.dtlvBridge.createDatabase(dbPath, options);

                if (result.success) {
                    vscode.window.showInformationMessage(`Created database: ${dbName}`);
                    this.panel?.dispose();
                    this.onCreated(dbPath);
                } else {
                    this.panel?.webview.postMessage({
                        command: 'createError',
                        error: result.error
                    });
                    vscode.window.showErrorMessage(`Failed to create database: ${result.error}`);
                }
                break;
            }
        }
    }

    private getHtml(): string {
        const templatesJson = JSON.stringify(BUILT_IN_TEMPLATES);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Database</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --header-bg: var(--vscode-editorGroupHeader-tabsBackground);
            --input-bg: var(--vscode-input-background);
            --input-border: var(--vscode-input-border);
        }
        body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--text-color); background: var(--bg-color); margin: 0; padding: 16px; max-width: 800px; }
        .section { margin-bottom: 24px; padding: 16px; border: 1px solid var(--border-color); border-radius: 4px; }
        .section h3 { margin: 0 0 16px 0; display: flex; align-items: center; gap: 8px; }
        .step-badge { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 12px; font-weight: bold; }
        .form-row { display: flex; gap: 16px; margin-bottom: 12px; align-items: flex-end; }
        .form-group { display: flex; flex-direction: column; gap: 4px; flex: 1; }
        .form-group label { font-size: 12px; color: var(--vscode-descriptionForeground); }
        .form-group .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
        input, select, textarea { padding: 6px 8px; background: var(--input-bg); border: 1px solid var(--input-border); color: var(--text-color); border-radius: 4px; font-family: var(--vscode-editor-font-family); }
        textarea { min-height: 120px; resize: vertical; width: 100%; box-sizing: border-box; }
        input[type="checkbox"] { width: 16px; height: 16px; }
        button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .checkbox-row { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
        .checkbox-row label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
        .template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
        .template-card { padding: 12px; border: 2px solid var(--border-color); border-radius: 6px; cursor: pointer; transition: border-color 0.2s; }
        .template-card:hover { border-color: var(--vscode-focusBorder); }
        .template-card.selected { border-color: var(--vscode-button-background); background: var(--header-bg); }
        .template-card h4 { margin: 0 0 4px 0; }
        .template-card p { margin: 0; font-size: 11px; color: var(--vscode-descriptionForeground); }
        .collapsible { cursor: pointer; user-select: none; }
        .collapsible::before { content: '\\25B6 '; font-size: 10px; }
        .collapsible.open::before { content: '\\25BC '; }
        .collapsible-content { display: none; margin-top: 12px; }
        .collapsible-content.open { display: block; }
        .preview-box { background: var(--header-bg); border: 1px solid var(--border-color); border-radius: 4px; padding: 12px; font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre-wrap; overflow-x: auto; max-height: 300px; overflow-y: auto; }
        .create-bar { position: sticky; bottom: 0; background: var(--bg-color); padding: 16px 0; border-top: 1px solid var(--border-color); display: flex; gap: 12px; align-items: center; }
        .status { padding: 8px; border-radius: 4px; margin-top: 8px; }
        .status.error { background: var(--vscode-inputValidation-errorBackground); }
        .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--text-color); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <!-- Step 1: Name & Location -->
    <div class="section">
        <h3><span class="step-badge">1</span> Database Name &amp; Location</h3>
        <div class="form-row">
            <div class="form-group">
                <label>Database Name</label>
                <input type="text" id="dbName" placeholder="my-database" />
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Parent Folder</label>
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="parentPath" placeholder="Select a folder..." readonly style="flex: 1;" />
                    <button class="secondary" onclick="selectFolder()">Browse...</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Step 2: Template -->
    <div class="section">
        <h3><span class="step-badge">2</span> Template (Optional)</h3>
        <div class="template-grid" id="templateGrid"></div>
    </div>

    <!-- Step 3: Options -->
    <div class="section">
        <h3><span class="step-badge">3</span> Database Options</h3>
        <div class="checkbox-row">
            <label><input type="checkbox" id="autoEntityTime" /> Auto Entity Timestamps</label>
            <label><input type="checkbox" id="validateData" /> Validate Data</label>
            <label><input type="checkbox" id="closedSchema" /> Closed Schema</label>
        </div>
        <div style="margin-top: 4px;">
            <span class="form-group hint">Auto Entity Timestamps: adds :db/created-at and :db/updated-at automatically</span>
        </div>

        <div style="margin-top: 16px;">
            <span class="collapsible" id="vectorOptsToggle" onclick="toggleSection('vectorOpts')">Vector Configuration</span>
            <div class="collapsible-content" id="vectorOpts">
                <div class="form-row">
                    <div class="form-group" style="flex: 0 0 120px;">
                        <label>Dimensions</label>
                        <input type="number" id="vecDimensions" placeholder="e.g. 1536" min="1" />
                    </div>
                    <div class="form-group" style="flex: 0 0 150px;">
                        <label>Metric Type</label>
                        <select id="vecMetricType">
                            <option value="">Default (euclidean)</option>
                            <option value="euclidean">Euclidean</option>
                            <option value="cosine">Cosine</option>
                            <option value="dot-product">Dot Product</option>
                            <option value="haversine">Haversine</option>
                            <option value="divergence">Divergence</option>
                            <option value="pearson">Pearson</option>
                            <option value="jaccard">Jaccard</option>
                            <option value="hamming">Hamming</option>
                            <option value="tanimoto">Tanimoto</option>
                            <option value="sorensen">Sorensen</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex: 0 0 120px;">
                        <label>Quantization</label>
                        <select id="vecQuantization">
                            <option value="">Default (float)</option>
                            <option value="float">float</option>
                            <option value="double">double</option>
                            <option value="float16">float16</option>
                            <option value="int8">int8</option>
                            <option value="byte">byte</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group" style="flex: 0 0 120px;">
                        <label>Connectivity</label>
                        <input type="number" id="vecConnectivity" placeholder="16" min="5" max="48" />
                        <span class="hint">HNSW M (5-48)</span>
                    </div>
                    <div class="form-group" style="flex: 0 0 140px;">
                        <label>Expansion (Add)</label>
                        <input type="number" id="vecExpansionAdd" placeholder="128" min="1" />
                        <span class="hint">efConstruction</span>
                    </div>
                    <div class="form-group" style="flex: 0 0 140px;">
                        <label>Expansion (Search)</label>
                        <input type="number" id="vecExpansionSearch" placeholder="64" min="1" />
                        <span class="hint">ef parameter</span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Step 4: Schema -->
    <div class="section">
        <h3><span class="step-badge">4</span> Initial Schema</h3>
        <div style="margin-bottom: 8px;">
            <button class="secondary" onclick="importSchema()">Import from File</button>
        </div>
        <div class="form-group">
            <label>Schema (EDN map format)</label>
            <textarea id="schemaEditor" placeholder='{:namespace/attr {:db/valueType :db.type/string}}'>{}</textarea>
        </div>
    </div>

    <!-- Step 5: Preview & Create -->
    <div class="section">
        <h3><span class="step-badge">5</span> Review</h3>
        <div class="preview-box" id="preview"></div>
        <div id="status"></div>
    </div>

    <div class="create-bar">
        <button id="createBtn" onclick="createDatabase()" style="padding: 10px 32px; font-size: 14px;">Create Database</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const templates = ${templatesJson};
        let selectedTemplate = null;

        // Build template grid using safe DOM methods
        const grid = document.getElementById('templateGrid');
        templates.forEach((t, i) => {
            const card = document.createElement('div');
            card.className = 'template-card';
            const heading = document.createElement('h4');
            heading.textContent = t.name;
            const desc = document.createElement('p');
            desc.textContent = t.description;
            card.appendChild(heading);
            card.appendChild(desc);
            card.onclick = () => selectTemplate(i, card);
            grid.appendChild(card);
        });

        function selectTemplate(index, card) {
            document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));

            if (selectedTemplate === index) {
                selectedTemplate = null;
                document.getElementById('schemaEditor').value = '{}';
                document.getElementById('autoEntityTime').checked = false;
                document.getElementById('validateData').checked = false;
                document.getElementById('closedSchema').checked = false;
                clearVectorOpts();
            } else {
                selectedTemplate = index;
                card.classList.add('selected');
                const t = templates[index];
                document.getElementById('schemaEditor').value = t.schema;
                document.getElementById('autoEntityTime').checked = !!t.options.autoEntityTime;
                document.getElementById('validateData').checked = !!t.options.validateData;
                document.getElementById('closedSchema').checked = !!t.options.closedSchema;
                if (t.options.vectorOpts) {
                    const vo = t.options.vectorOpts;
                    document.getElementById('vecDimensions').value = vo.dimensions || '';
                    document.getElementById('vecMetricType').value = vo.metricType || '';
                    document.getElementById('vecQuantization').value = vo.quantization || '';
                    document.getElementById('vecConnectivity').value = vo.connectivity || '';
                    document.getElementById('vecExpansionAdd').value = vo.expansionAdd || '';
                    document.getElementById('vecExpansionSearch').value = vo.expansionSearch || '';
                    // Open the collapsible
                    document.getElementById('vectorOptsToggle').classList.add('open');
                    document.getElementById('vectorOpts').classList.add('open');
                } else {
                    clearVectorOpts();
                }
            }
            updatePreview();
        }

        function clearVectorOpts() {
            document.getElementById('vecDimensions').value = '';
            document.getElementById('vecMetricType').value = '';
            document.getElementById('vecQuantization').value = '';
            document.getElementById('vecConnectivity').value = '';
            document.getElementById('vecExpansionAdd').value = '';
            document.getElementById('vecExpansionSearch').value = '';
        }

        function selectFolder() {
            vscode.postMessage({ command: 'selectFolder' });
        }

        function importSchema() {
            vscode.postMessage({ command: 'importSchema' });
        }

        function toggleSection(id) {
            const el = document.getElementById(id);
            const trigger = document.getElementById(id + 'Toggle');
            el.classList.toggle('open');
            trigger.classList.toggle('open');
        }

        function getFormData() {
            const dbName = document.getElementById('dbName').value.trim();
            const parentPath = document.getElementById('parentPath').value.trim();
            const schema = document.getElementById('schemaEditor').value.trim();
            const autoEntityTime = document.getElementById('autoEntityTime').checked;
            const validateData = document.getElementById('validateData').checked;
            const closedSchema = document.getElementById('closedSchema').checked;
            const vecDimensions = parseInt(document.getElementById('vecDimensions').value) || 0;
            const vecMetricType = document.getElementById('vecMetricType').value;
            const vecQuantization = document.getElementById('vecQuantization').value;
            const vecConnectivity = parseInt(document.getElementById('vecConnectivity').value) || 0;
            const vecExpansionAdd = parseInt(document.getElementById('vecExpansionAdd').value) || 0;
            const vecExpansionSearch = parseInt(document.getElementById('vecExpansionSearch').value) || 0;
            const hasVectorOpts = vecDimensions > 0;

            return { dbName, parentPath, schema, autoEntityTime, validateData, closedSchema,
                     hasVectorOpts, vectorDimensions: vecDimensions, vectorMetricType: vecMetricType,
                     vectorQuantization: vecQuantization, vectorConnectivity: vecConnectivity,
                     vectorExpansionAdd: vecExpansionAdd, vectorExpansionSearch: vecExpansionSearch };
        }

        function updatePreview() {
            const d = getFormData();
            let preview = '';

            if (d.dbName && d.parentPath) {
                preview += 'Database: ' + d.parentPath + '/' + d.dbName + '\\n\\n';
            } else {
                preview += 'Database: (select name and folder)\\n\\n';
            }

            preview += 'Schema:\\n' + (d.schema || '{}') + '\\n\\n';

            const opts = [];
            if (d.autoEntityTime) opts.push(':auto-entity-time? true');
            if (d.validateData) opts.push(':validate-data? true');
            if (d.closedSchema) opts.push(':closed-schema? true');
            if (d.hasVectorOpts) {
                let vo = ':vector-opts {:dimensions ' + d.vectorDimensions;
                if (d.vectorMetricType) vo += ' :metric-type :' + d.vectorMetricType;
                if (d.vectorQuantization) vo += ' :quantization :' + d.vectorQuantization;
                if (d.vectorConnectivity) vo += ' :connectivity ' + d.vectorConnectivity;
                if (d.vectorExpansionAdd) vo += ' :expansion-add ' + d.vectorExpansionAdd;
                if (d.vectorExpansionSearch) vo += ' :expansion-search ' + d.vectorExpansionSearch;
                vo += '}';
                opts.push(vo);
            }
            preview += 'Options: ' + (opts.length > 0 ? '{' + opts.join(' ') + '}' : '{}');

            document.getElementById('preview').textContent = preview;
        }

        function createDatabase() {
            const d = getFormData();
            if (!d.dbName) { alert('Please enter a database name'); return; }
            if (!d.parentPath) { alert('Please select a parent folder'); return; }
            const btn = document.getElementById('createBtn');
            btn.disabled = true;
            btn.textContent = 'Creating...';
            vscode.postMessage({ command: 'create', ...d });
        }

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.command) {
                case 'folderSelected':
                    document.getElementById('parentPath').value = msg.path;
                    updatePreview();
                    break;
                case 'schemaImported':
                    document.getElementById('schemaEditor').value = msg.content;
                    updatePreview();
                    break;
                case 'creating': {
                    const btn = document.getElementById('createBtn');
                    btn.disabled = true;
                    btn.textContent = 'Creating...';
                    break;
                }
                case 'createError': {
                    const btn = document.getElementById('createBtn');
                    btn.disabled = false;
                    btn.textContent = 'Create Database';
                    const status = document.getElementById('status');
                    status.className = 'status error';
                    status.textContent = 'Error: ' + msg.error;
                    status.style.display = 'block';
                    break;
                }
            }
        });

        // Update preview on input changes
        ['dbName', 'schemaEditor', 'autoEntityTime', 'validateData', 'closedSchema',
         'vecDimensions', 'vecMetricType', 'vecQuantization', 'vecConnectivity',
         'vecExpansionAdd', 'vecExpansionSearch'].forEach(id => {
            const el = document.getElementById(id);
            el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', updatePreview);
        });

        updatePreview();
    </script>
</body>
</html>`;
    }

    dispose(): void {
        this.panel?.dispose();
    }
}
