import * as vscode from 'vscode';
import { CalvaBridge } from '../calva-bridge';

interface TransactionResult {
    txId?: number;
    tempids?: Record<string, number>;
    datomsCount?: number;
    error?: string;
}

export class TransactionPanel {
    private panel: vscode.WebviewPanel | undefined;
    private currentDbName: string = '';
    private lastResult: TransactionResult | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private calvaBridge: CalvaBridge
    ) {}

    async show(dbName: string): Promise<void> {
        this.currentDbName = dbName;

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
            case 'validate':
                await this.validateTransaction(message.txData as string);
                break;
        }
    }

    private async executeTransaction(txData: string): Promise<void> {
        try {
            const result = await this.calvaBridge.evaluate(
                `(datalevin-ext.core/transact! "${this.currentDbName}" "${txData.replace(/"/g, '\\"')}")`
            );

            if (result.success) {
                this.lastResult = result.value as TransactionResult;

                if (this.lastResult.error) {
                    vscode.window.showErrorMessage(`Transaction error: ${this.lastResult.error}`);
                } else {
                    vscode.window.showInformationMessage(
                        `Transaction successful. TX ID: ${this.lastResult.txId}, ` +
                        `${this.lastResult.datomsCount} datoms added.`
                    );
                    // Refresh explorer to show new data
                    vscode.commands.executeCommand('levin.refreshExplorer');
                }
            } else {
                this.lastResult = { error: result.error };
                vscode.window.showErrorMessage(`Transaction failed: ${result.error}`);
            }

            this.updateContent();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.lastResult = { error: errorMessage };
            vscode.window.showErrorMessage(`Transaction failed: ${errorMessage}`);
            this.updateContent();
        }
    }

    private async validateTransaction(txData: string): Promise<void> {
        try {
            // Try to parse the EDN to validate syntax
            const result = await this.calvaBridge.evaluate(
                `(clojure.edn/read-string "${txData.replace(/"/g, '\\"')}")`
            );

            if (result.success) {
                vscode.window.showInformationMessage('Transaction data is valid EDN');
            } else {
                vscode.window.showErrorMessage(`Invalid EDN: ${result.error}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Validation error: ${errorMessage}`);
        }
    }

    private updateContent(): void {
        if (!this.panel) {
            return;
        }

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

        .header h2 {
            margin: 0;
        }

        .actions {
            display: flex;
            gap: 8px;
        }

        button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button.secondary {
            background: var(--header-bg);
            color: var(--text-color);
            border: 1px solid var(--border-color);
        }

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

        .help h4 {
            margin: 0 0 8px 0;
        }

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
        <h2>Transaction: ${this.currentDbName}</h2>
        <div class="actions">
            <button class="secondary" onclick="validate()">Validate</button>
            <button onclick="transact()">Transact</button>
        </div>
    </div>

    <textarea id="txData" placeholder="Enter transaction data in EDN format...">
;; Add new entity
{:user/name "Alice"
 :user/email "alice@example.com"}

;; Update existing entity
;; {:db/id 42
;;  :post/title "Updated Title"}

;; Retract attribute
;; [:db/retract 42 :post/draft true]
</textarea>

    ${resultHtml}

    <div class="help">
        <h4>Transaction Examples</h4>

        <p><strong>Add new entity:</strong></p>
        <pre>{:user/name "John"
 :user/email "john@example.com"}</pre>

        <p><strong>Add multiple entities:</strong></p>
        <pre>[{:user/name "John"}
 {:user/name "Jane"}]</pre>

        <p><strong>Update existing entity:</strong></p>
        <pre>{:db/id 42
 :user/name "Updated Name"}</pre>

        <p><strong>Retract attribute:</strong></p>
        <pre>[:db/retract 42 :user/email "old@email.com"]</pre>

        <p><strong>Retract entity:</strong></p>
        <pre>[:db/retractEntity 42]</pre>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function transact() {
            const txData = document.getElementById('txData').value.trim();
            if (!txData) {
                alert('Please enter transaction data');
                return;
            }

            // Remove comments for processing
            const cleanData = txData
                .split('\\n')
                .filter(line => !line.trim().startsWith(';;'))
                .join('\\n');

            vscode.postMessage({
                command: 'transact',
                txData: cleanData
            });
        }

        function validate() {
            const txData = document.getElementById('txData').value.trim();
            if (!txData) {
                alert('Please enter transaction data');
                return;
            }

            // Remove comments for validation
            const cleanData = txData
                .split('\\n')
                .filter(line => !line.trim().startsWith(';;'))
                .join('\\n');

            vscode.postMessage({
                command: 'validate',
                txData: cleanData
            });
        }
    </script>
</body>
</html>`;
    }

    private renderResult(): string {
        if (!this.lastResult) {
            return '';
        }

        if (this.lastResult.error) {
            return `
                <div class="result error">
                    <strong>Error:</strong> ${this.escapeHtml(this.lastResult.error)}
                </div>
            `;
        }

        return `
            <div class="result success">
                <strong>Success!</strong><br>
                Transaction ID: ${this.lastResult.txId}<br>
                Datoms added: ${this.lastResult.datomsCount}
                ${this.lastResult.tempids && Object.keys(this.lastResult.tempids).length > 0 ?
                    `<br>Temp IDs resolved: ${JSON.stringify(this.lastResult.tempids)}` : ''}
            </div>
        `;
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
        this.panel?.dispose();
    }
}
