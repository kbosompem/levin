import * as vscode from 'vscode';
import { DtlvBridge, QueryResult } from '../dtlv-bridge';

export class TransactionPanel {
    private panel: vscode.WebviewPanel | undefined;
    private currentDbPath: string = '';
    private lastResult: QueryResult | undefined;

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
                'levinTransaction',
                `Transaction: ${dbName}`,
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
            this.panel.title = `Transaction: ${dbName}`;
        }

        this.updateContent();
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }): Promise<void> {
        switch (message.command) {
            case 'transact':
                await this.executeTransaction(message.txData as string);
                break;
        }
    }

    private async executeTransaction(txData: string): Promise<void> {
        try {
            const result = await this.dtlvBridge.transact(this.currentDbPath, txData);
            this.lastResult = result;

            if (result.success) {
                const data = result.data as { txId?: number; datomsCount?: number };
                vscode.window.showInformationMessage(
                    `Transaction successful. TX ID: ${data.txId}, ${data.datomsCount} datoms added.`
                );
                vscode.commands.executeCommand('levin.refreshExplorer');
            } else {
                vscode.window.showErrorMessage(`Transaction failed: ${result.error}`);
            }

            this.updateContent();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.lastResult = { success: false, error: errorMessage };
            vscode.window.showErrorMessage(`Transaction failed: ${errorMessage}`);
            this.updateContent();
        }
    }

    private updateContent(): void {
        if (!this.panel) { return; }
        this.panel.webview.html = this.getHtml();
    }

    private getHtml(): string {
        const resultHtml = this.lastResult ? this.renderResult() : '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transaction Panel</title>
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

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }

        .header h2 { margin: 0; }

        button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }

        button:hover { background: var(--vscode-button-hoverBackground); }

        textarea {
            width: 100%;
            height: 300px;
            padding: 12px;
            background: var(--input-bg);
            border: 1px solid var(--input-border);
            color: var(--text-color);
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            border-radius: 4px;
            resize: vertical;
        }

        .help {
            margin-top: 16px;
            padding: 12px;
            background: var(--header-bg);
            border-radius: 4px;
        }

        .help h4 { margin: 0 0 8px 0; }

        .help pre {
            margin: 8px 0;
            padding: 8px;
            background: var(--bg-color);
            border-radius: 4px;
            overflow-x: auto;
        }

        .result {
            margin-top: 16px;
            padding: 12px;
            border-radius: 4px;
        }

        .result.success {
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
        }

        .result.error {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>Transaction: ${this.currentDbPath.split('/').pop()}</h2>
        <button onclick="transact()">Transact</button>
    </div>

    <textarea id="txData" placeholder="Enter transaction data in EDN format...">[
;; Add new entity
{:user/name "Alice"
 :user/email "alice@example.com"}
]</textarea>

    ${resultHtml}

    <div class="help">
        <h4>Transaction Examples</h4>

        <p><strong>Add new entity:</strong></p>
        <pre>[{:user/name "John"
  :user/email "john@example.com"}]</pre>

        <p><strong>Update existing entity:</strong></p>
        <pre>[{:db/id 42
  :user/name "Updated Name"}]</pre>

        <p><strong>Retract attribute:</strong></p>
        <pre>[[:db/retract 42 :user/email "old@email.com"]]</pre>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function transact() {
            const txData = document.getElementById('txData').value.trim();
            if (!txData) {
                alert('Please enter transaction data');
                return;
            }

            // Remove comments
            const cleanData = txData
                .split('\\n')
                .filter(line => !line.trim().startsWith(';;'))
                .join('\\n');

            vscode.postMessage({ command: 'transact', txData: cleanData });
        }
    </script>
</body>
</html>`;
    }

    private renderResult(): string {
        if (!this.lastResult) { return ''; }

        if (!this.lastResult.success) {
            return `<div class="result error">
                <strong>Error:</strong> ${this.escapeHtml(this.lastResult.error || 'Unknown error')}
            </div>`;
        }

        const data = this.lastResult.data as { txId?: number; datomsCount?: number; tempids?: Record<string, number> };
        return `<div class="result success">
            <strong>Success!</strong><br>
            Transaction ID: ${data.txId}<br>
            Datoms added: ${data.datomsCount}
            ${data.tempids && Object.keys(data.tempids).length > 0 ?
                `<br>Temp IDs resolved: ${JSON.stringify(data.tempids)}` : ''}
        </div>`;
    }

    private escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    dispose(): void {
        this.panel?.dispose();
    }
}
