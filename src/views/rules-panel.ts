import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';

interface Rule {
    eid: number;
    name: string;
    body: string;
    description: string;
}

interface PanelState {
    panel: vscode.WebviewPanel;
    dbPath: string;
}

export class RulesPanel {
    private panels: Map<string, PanelState> = new Map();

    constructor(
        private context: vscode.ExtensionContext,
        private dtlvBridge: DtlvBridge
    ) {}

    async show(dbPath: string): Promise<void> {
        const dbName = dbPath.split('/').pop() || dbPath;
        const panelKey = dbPath;

        // Check if panel already exists for this database
        const existing = this.panels.get(panelKey);
        if (existing) {
            existing.panel.reveal();
            await this.updateContent(existing.panel, dbPath);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'levinRules',
            `Rules: ${dbName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panels.set(panelKey, { panel, dbPath });

        panel.onDidDispose(() => {
            this.panels.delete(panelKey);
        });

        panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'saveRule':
                        await this.saveRule(dbPath, message.name, message.body, message.description);
                        await this.updateContent(panel, dbPath);
                        break;
                    case 'deleteRule':
                        await this.deleteRule(dbPath, message.name);
                        await this.updateContent(panel, dbPath);
                        break;
                    case 'refresh':
                        await this.updateContent(panel, dbPath);
                        break;
                    case 'copyRule':
                        await vscode.env.clipboard.writeText(message.body);
                        vscode.window.showInformationMessage('Rule copied to clipboard');
                        break;
                    case 'insertInQuery':
                        await this.insertRuleInQuery(message.name, message.body);
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        await this.updateContent(panel, dbPath);
    }

    private async updateContent(panel: vscode.WebviewPanel, dbPath: string): Promise<void> {
        const result = await this.dtlvBridge.getRules(dbPath);
        const rules: Rule[] = result.success ? (result.data as Rule[]) || [] : [];
        panel.webview.html = this.getHtml(rules, dbPath);
    }

    private async saveRule(dbPath: string, name: string, body: string, description?: string): Promise<void> {
        const result = await this.dtlvBridge.saveRule(dbPath, name, body, description);
        if (result.success) {
            vscode.window.showInformationMessage(`Rule "${name}" saved`);
        } else {
            vscode.window.showErrorMessage(`Failed to save rule: ${result.error}`);
        }
    }

    private async deleteRule(dbPath: string, name: string): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            `Delete rule "${name}"?`,
            { modal: true },
            'Delete'
        );
        if (confirm === 'Delete') {
            const result = await this.dtlvBridge.deleteRule(dbPath, name);
            if (result.success) {
                vscode.window.showInformationMessage(`Rule "${name}" deleted`);
            } else {
                vscode.window.showErrorMessage(`Failed to delete rule: ${result.error}`);
            }
        }
    }

    private async insertRuleInQuery(name: string, _body: string): Promise<void> {
        // Insert rule reference in active query editor
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.fileName.endsWith('.dtlv.edn')) {
            const text = editor.document.getText();
            // Check if :in clause exists with % already
            if (text.includes(':in') && text.includes('%')) {
                vscode.window.showInformationMessage(`Query already has rules. Add "${name}" to your rule list.`);
            } else if (text.includes(':in')) {
                // Add % to existing :in clause
                vscode.window.showInformationMessage(`Add "%" to your :in clause and use rule "${name}"`);
            } else {
                vscode.window.showInformationMessage(`Add ":in $ %" to use rules. Rule: ${name}`);
            }
        } else {
            vscode.window.showInformationMessage(`Rule "${name}" - use with :in $ % in queries`);
        }
    }

    private getHtml(rules: Rule[], dbPath: string): string {
        const dbName = dbPath.split('/').pop() || dbPath;
        const rulesHtml = rules.map(rule => `
            <div class="rule-card" data-name="${this.escapeHtml(rule.name)}">
                <div class="rule-header">
                    <span class="rule-name">${this.escapeHtml(rule.name)}</span>
                    <div class="rule-actions">
                        <button class="btn-small" onclick="copyRule('${this.escapeHtml(rule.name)}')">Copy</button>
                        <button class="btn-small" onclick="editRule('${this.escapeHtml(rule.name)}')">Edit</button>
                        <button class="btn-small btn-danger" onclick="deleteRule('${this.escapeHtml(rule.name)}')">Delete</button>
                    </div>
                </div>
                ${rule.description ? `<div class="rule-desc">${this.escapeHtml(rule.description)}</div>` : ''}
                <pre class="rule-body">${this.escapeHtml(rule.body)}</pre>
            </div>
        `).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rules: ${this.escapeHtml(dbName)}</title>
    <style>
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --border: var(--vscode-panel-border);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --card-bg: var(--vscode-editorGroupHeader-tabsBackground);
            --accent: var(--vscode-textLink-foreground);
            --danger: var(--vscode-errorForeground);
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--fg);
            background: var(--bg);
            margin: 0;
            padding: 16px;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border);
        }

        .header h2 { margin: 0; }

        .actions { display: flex; gap: 8px; }

        button {
            padding: 6px 14px;
            border: none;
            background: var(--button-bg);
            color: var(--button-fg);
            cursor: pointer;
            border-radius: 4px;
            font-size: 13px;
        }

        button:hover { opacity: 0.9; }

        .btn-small {
            padding: 4px 10px;
            font-size: 12px;
            background: var(--card-bg);
            color: var(--fg);
            border: 1px solid var(--border);
        }

        .btn-danger { color: var(--danger); }
        .btn-danger:hover { background: var(--danger); color: white; }

        .rule-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
        }

        .rule-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .rule-name {
            font-weight: 600;
            font-size: 14px;
            color: var(--accent);
        }

        .rule-actions { display: flex; gap: 6px; }

        .rule-desc {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-bottom: 8px;
        }

        .rule-body {
            background: var(--bg);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            margin: 0;
            white-space: pre-wrap;
        }

        .form-section {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 16px;
        }

        .form-section h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
        }

        .form-row {
            margin-bottom: 12px;
        }

        .form-row label {
            display: block;
            margin-bottom: 4px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        input, textarea {
            width: 100%;
            padding: 8px;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--border);
            border-radius: 4px;
            font-family: inherit;
            font-size: 13px;
            box-sizing: border-box;
        }

        textarea {
            font-family: var(--vscode-editor-font-family);
            min-height: 150px;
            resize: vertical;
        }

        .form-actions {
            display: flex;
            gap: 8px;
            margin-top: 12px;
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .example {
            background: var(--card-bg);
            border: 1px dashed var(--border);
            border-radius: 6px;
            padding: 16px;
            margin-top: 20px;
        }

        .example h4 {
            margin: 0 0 8px 0;
            font-size: 13px;
        }

        .example pre {
            background: var(--bg);
            padding: 10px;
            border-radius: 4px;
            font-size: 11px;
            overflow-x: auto;
            margin: 8px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>Datalog Rules</h2>
        <div class="actions">
            <button onclick="toggleForm()">+ New Rule</button>
            <button onclick="refresh()">Refresh</button>
        </div>
    </div>

    <div id="newRuleForm" class="form-section" style="display: none;">
        <h3 id="formTitle">New Rule</h3>
        <div class="form-row">
            <label>Name</label>
            <input type="text" id="ruleName" placeholder="e.g., played, slam-finals">
        </div>
        <div class="form-row">
            <label>Description (optional)</label>
            <input type="text" id="ruleDesc" placeholder="What does this rule do?">
        </div>
        <div class="form-row">
            <label>Rule Body (EDN)</label>
            <textarea id="ruleBody" placeholder="[[(rule-name ?arg1 ?arg2)
  [?e :attr ?arg1]
  [?e :other ?arg2]]]"></textarea>
        </div>
        <div class="form-actions">
            <button onclick="saveRule()">Save Rule</button>
            <button class="btn-small" onclick="cancelEdit()">Cancel</button>
        </div>
    </div>

    <div id="rulesList">
        ${rules.length > 0 ? rulesHtml : `
            <div class="empty-state">
                <p>No rules stored yet.</p>
                <p>Click "+ New Rule" to create your first rule.</p>
            </div>
        `}
    </div>

    ${rules.length === 0 ? `
    <div class="example">
        <h4>Example Rules</h4>
        <p>Rules let you define reusable query patterns:</p>
        <pre>[[(played ?p1 ?p2)
  [?e :winner_name ?p1]
  [?e :loser_name ?p2]]
 [(played ?p2 ?p1)
  [?e :winner_name ?p1]
  [?e :loser_name ?p2]]]</pre>
        <p>Use in queries with <code>:in $ %</code>:</p>
        <pre>[:find ?tournament
 :in $ %
 :where (played "Roger Federer" "Novak Djokovic" ?tournament)]</pre>
    </div>
    ` : ''}

    <script>
        const vscode = acquireVsCodeApi();
        let editingRule = null;
        const rules = ${JSON.stringify(rules)};

        function toggleForm() {
            const form = document.getElementById('newRuleForm');
            if (form.style.display === 'none') {
                form.style.display = 'block';
                document.getElementById('formTitle').textContent = 'New Rule';
                document.getElementById('ruleName').value = '';
                document.getElementById('ruleDesc').value = '';
                document.getElementById('ruleBody').value = '';
                editingRule = null;
            } else {
                form.style.display = 'none';
            }
        }

        function cancelEdit() {
            document.getElementById('newRuleForm').style.display = 'none';
            editingRule = null;
        }

        function editRule(name) {
            const rule = rules.find(r => r.name === name);
            if (rule) {
                document.getElementById('newRuleForm').style.display = 'block';
                document.getElementById('formTitle').textContent = 'Edit Rule';
                document.getElementById('ruleName').value = rule.name;
                document.getElementById('ruleDesc').value = rule.description || '';
                document.getElementById('ruleBody').value = rule.body;
                editingRule = name;
            }
        }

        function saveRule() {
            const name = document.getElementById('ruleName').value.trim();
            const body = document.getElementById('ruleBody').value.trim();
            const description = document.getElementById('ruleDesc').value.trim();

            if (!name) {
                alert('Please enter a rule name');
                return;
            }
            if (!body) {
                alert('Please enter the rule body');
                return;
            }

            vscode.postMessage({
                command: 'saveRule',
                name,
                body,
                description: description || undefined
            });
        }

        function deleteRule(name) {
            vscode.postMessage({ command: 'deleteRule', name });
        }

        function copyRule(name) {
            const rule = rules.find(r => r.name === name);
            if (rule) {
                vscode.postMessage({ command: 'copyRule', body: rule.body });
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
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    dispose(): void {
        this.panels.forEach(state => state.panel.dispose());
        this.panels.clear();
    }
}
