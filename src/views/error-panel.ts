import * as vscode from 'vscode';

export class ErrorPanel {
    private panel: vscode.WebviewPanel | undefined;

    show(error: string, context?: string): void {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'levinError',
                'Query Error',
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
            this.panel.reveal(vscode.ViewColumn.Active);
            this.panel.title = 'Query Error';
        }

        this.updateContent(error, context);
    }

    private handleMessage(message: { command: string; [key: string]: unknown }): void {
        switch (message.command) {
            case 'copyError':
                if (message.error) {
                    vscode.env.clipboard.writeText(message.error as string);
                    vscode.window.showInformationMessage('Error copied to clipboard');
                }
                break;
        }
    }

    private updateContent(error: string, context?: string): void {
        if (!this.panel) return;

        // Parse error to extract key information
        const parsed = this.parseError(error);

        this.panel.webview.html = this.getHtml(parsed, context);
    }

    private parseError(error: string): { type: string; message: string; stackTrace: string[] } {
        const lines = error.split('\n');

        // Try to extract exception type
        const exceptionMatch = error.match(/([a-zA-Z.]+Exception[a-zA-Z]*)/);
        const type = exceptionMatch ? exceptionMatch[1] : 'Error';

        // Try to extract main message (first meaningful line)
        let message = '';
        const messageMatch = error.match(/:\s*"([^"]+)"/);
        if (messageMatch) {
            message = messageMatch[1];
        } else {
            // Fallback: use first line that's not just whitespace
            message = lines.find(l => l.trim().length > 0) || error;
        }

        // Extract stack trace (lines that look like stack frames)
        const stackTrace = lines.filter(line =>
            line.includes('at ') ||
            line.includes('.clj:') ||
            line.includes('.java:') ||
            line.match(/^\s+[a-zA-Z]/)
        ).slice(0, 20); // Limit to 20 lines

        return { type, message, stackTrace };
    }

    private getHtml(error: { type: string; message: string; stackTrace: string[] }, context?: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Query Error</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --error-color: var(--vscode-errorForeground);
            --header-bg: var(--vscode-editorGroupHeader-tabsBackground);
            --code-bg: var(--vscode-textCodeBlock-background);
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--text-color);
            background-color: var(--bg-color);
            margin: 0;
            padding: 16px;
            line-height: 1.6;
        }

        .error-icon {
            color: var(--error-color);
            font-size: 48px;
            margin-bottom: 16px;
        }

        .error-type {
            color: var(--error-color);
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .error-message {
            font-size: 14px;
            margin-bottom: 24px;
            padding: 12px;
            background: var(--code-bg);
            border-left: 4px solid var(--error-color);
            border-radius: 4px;
        }

        .context-section {
            margin-bottom: 24px;
        }

        .section-title {
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-symbolIcon-fieldForeground);
        }

        .context-code {
            background: var(--code-bg);
            padding: 12px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            overflow-x: auto;
            white-space: pre-wrap;
        }

        .stack-trace {
            background: var(--code-bg);
            padding: 12px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            overflow-x: auto;
            max-height: 400px;
            overflow-y: auto;
        }

        .stack-trace-line {
            padding: 2px 0;
            color: var(--vscode-descriptionForeground);
        }

        .stack-trace-line:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .actions {
            display: flex;
            gap: 12px;
            margin-top: 24px;
        }

        button {
            padding: 8px 16px;
            border: 1px solid var(--border-color);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            border-radius: 4px;
            font-size: 13px;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .help-section {
            margin-top: 32px;
            padding-top: 16px;
            border-top: 1px solid var(--border-color);
        }

        .help-list {
            list-style: none;
            padding-left: 0;
        }

        .help-list li {
            padding: 8px 0;
            padding-left: 20px;
            position: relative;
        }

        .help-list li:before {
            content: "→";
            position: absolute;
            left: 0;
            color: var(--vscode-symbolIcon-fieldForeground);
        }
    </style>
</head>
<body>
    <div class="error-icon">⚠️</div>
    <div class="error-type">${this.escapeHtml(error.type)}</div>
    <div class="error-message">${this.escapeHtml(error.message)}</div>

    ${context ? `
    <div class="context-section">
        <div class="section-title">Query Context</div>
        <div class="context-code">${this.escapeHtml(context)}</div>
    </div>
    ` : ''}

    ${error.stackTrace.length > 0 ? `
    <div class="context-section">
        <div class="section-title">Stack Trace</div>
        <div class="stack-trace">
            ${error.stackTrace.map(line =>
                `<div class="stack-trace-line">${this.escapeHtml(line)}</div>`
            ).join('')}
        </div>
    </div>
    ` : ''}

    <div class="actions">
        <button onclick="copyError()">Copy Error</button>
    </div>

    <div class="help-section">
        <div class="section-title">Common Solutions</div>
        <ul class="help-list">
            <li>Check that your query syntax is correct for Datalog</li>
            <li>Verify that all attributes referenced exist in the schema</li>
            <li>Ensure the database connection is active</li>
            <li>For pull expressions, use correct syntax: <code>(pull ?var [*])</code></li>
            <li>Check that entity IDs referenced in the query exist</li>
        </ul>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        const fullError = ${JSON.stringify(error.message + '\n\n' + error.stackTrace.join('\n'))};

        function copyError() {
            vscode.postMessage({
                command: 'copyError',
                error: fullError
            });
        }
    </script>
</body>
</html>`;
    }

    private escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    dispose(): void {
        this.panel?.dispose();
    }
}
