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
    private displayTypes: Record<string, string> = {};

    constructor(
        private _context: vscode.ExtensionContext,
        private dtlvBridge: DtlvBridge
    ) {}

    async show(dbPath: string, entityId: number): Promise<void> {
        this.currentDbPath = dbPath;

        // Show loading state if panel exists
        if (this.panel) {
            this.panel.webview.postMessage({ command: 'loading', isLoading: true });
        }

        try {
            // Fetch entity data and display types in parallel
            const [entityResult, displayTypes] = await Promise.all([
                this.dtlvBridge.getEntity(dbPath, entityId),
                this.dtlvBridge.getDisplayTypes(dbPath)
            ]);

            if (!entityResult.success) {
                vscode.window.showErrorMessage(`Failed to load entity: ${entityResult.error}`);
                if (this.panel) {
                    this.panel.webview.postMessage({ command: 'loading', isLoading: false });
                }
                return;
            }

            this.currentEntity = entityResult.data as EntityData;
            this.displayTypes = displayTypes;

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
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load entity: ${error}`);
        } finally {
            // Hide loading state
            if (this.panel) {
                this.panel.webview.postMessage({ command: 'loading', isLoading: false });
            }
        }
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
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

        .code-block {
            background: var(--header-bg);
            padding: 8px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
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

        .loading-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            z-index: 1000;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 12px;
        }

        .loading-overlay.visible {
            display: flex;
        }

        .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid var(--vscode-progressBar-background);
            border-top-color: var(--vscode-button-background);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .loading-text {
            color: var(--text-color);
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="loading-overlay" id="loadingOverlay">
        <div class="spinner"></div>
        <div class="loading-text">Loading entity...</div>
    </div>
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
        let isNavigating = false;
        let lastNavigationTime = 0;
        const NAVIGATE_DEBOUNCE_MS = 500;

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'loading') {
                const overlay = document.getElementById('loadingOverlay');
                if (overlay) {
                    overlay.classList.toggle('visible', message.isLoading);
                }
            }
        });

        function navigate(entityId) {
            // Debounce navigation to prevent rapid successive calls
            const now = Date.now();
            if (isNavigating || (now - lastNavigationTime < NAVIGATE_DEBOUNCE_MS)) {
                console.log('Navigation ignored (debounced)');
                return;
            }

            isNavigating = true;
            lastNavigationTime = now;

            vscode.postMessage({ command: 'navigate', entityId });

            // Reset after debounce period
            setTimeout(() => {
                isNavigating = false;
            }, NAVIGATE_DEBOUNCE_MS);
        }

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
            const displayType = this.displayTypes[key] || this.displayTypes[':' + key] || '';
            const formattedValue = this.formatAttributeValue(value, isRef, key, displayType);
            return `<tr><th>${this.escapeHtml(key)}</th><td>${formattedValue}</td></tr>`;
        }).join('');
    }

    private isImageAttribute(key: string, displayType: string): boolean {
        if (displayType === 'image') return true;
        if (displayType && displayType !== 'image') return false;
        // Fallback to name-based detection
        const lowerKey = key.toLowerCase();
        return lowerKey.includes('photo') || lowerKey.includes('image') || lowerKey.includes('picture') || lowerKey.includes('avatar');
    }

    private isHyperlinkValue(value: string, displayType: string): boolean {
        if (displayType === 'hyperlink') return true;
        if (displayType && displayType !== 'hyperlink') return false;
        // Auto-detect URLs
        return value.startsWith('http://') || value.startsWith('https://');
    }

    private hexToBase64(hex: string): string {
        // Remove 0x prefix if present
        let cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;

        // Check for OLE wrapper and extract actual image data
        cleanHex = this.stripOleWrapper(cleanHex);

        // Convert hex to bytes then to base64
        const bytes = new Uint8Array(cleanHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        return btoa(binary);
    }

    private stripOleWrapper(hex: string): string {
        const lowerHex = hex.toLowerCase();

        // Look for BMP signature (42 4D = "BM")
        const bmpIndex = lowerHex.indexOf('424d');
        if (bmpIndex > 0) {
            return hex.slice(bmpIndex);
        }

        // Look for JPEG signature (FF D8 FF)
        const jpegIndex = lowerHex.indexOf('ffd8ff');
        if (jpegIndex > 0) {
            return hex.slice(jpegIndex);
        }

        // Look for PNG signature (89 50 4E 47)
        const pngIndex = lowerHex.indexOf('89504e47');
        if (pngIndex > 0) {
            return hex.slice(pngIndex);
        }

        // Look for GIF signature (47 49 46 38)
        const gifIndex = lowerHex.indexOf('47494638');
        if (gifIndex > 0) {
            return hex.slice(gifIndex);
        }

        return hex;
    }

    private detectImageType(hex: string): string {
        let cleanHex = hex.startsWith('0x') ? hex.slice(2).toLowerCase() : hex.toLowerCase();
        cleanHex = this.stripOleWrapper(cleanHex).toLowerCase();

        // Check magic bytes after stripping OLE
        if (cleanHex.startsWith('ffd8ff')) return 'jpeg';
        if (cleanHex.startsWith('89504e47')) return 'png';
        if (cleanHex.startsWith('47494638')) return 'gif';
        if (cleanHex.startsWith('424d')) return 'bmp';
        return 'bmp'; // default for OLE-wrapped data
    }

    private formatAttributeValue(value: unknown, isRef: boolean = false, key: string = '', displayType: string = ''): string {
        if (value === null || value === undefined) {
            return '<span class="value-null">nil</span>';
        }

        if (typeof value === 'string') {
            // Check if this is an image
            if (this.isImageAttribute(key, displayType) && value.startsWith('0x') && value.length > 100) {
                try {
                    const base64 = this.hexToBase64(value);
                    const imageType = this.detectImageType(value);
                    return `<img src="data:image/${imageType};base64,${base64}" style="max-width: 200px; max-height: 200px; border-radius: 4px;" />`;
                } catch {
                    // Fall through to normal string display
                }
            }
            // Check if this is a hyperlink
            if (this.isHyperlinkValue(value, displayType)) {
                return `<a href="${this.escapeHtml(value)}" class="entity-link" target="_blank">${this.escapeHtml(value)}</a>`;
            }
            // Check if this is an email
            if (displayType === 'email' || (!displayType && value.includes('@') && value.includes('.'))) {
                return `<a href="mailto:${this.escapeHtml(value)}" class="entity-link">${this.escapeHtml(value)}</a>`;
            }
            // Check if this is JSON
            if (displayType === 'json') {
                try {
                    const parsed = JSON.parse(value);
                    return `<pre>${this.escapeHtml(JSON.stringify(parsed, null, 2))}</pre>`;
                } catch {
                    // Not valid JSON
                }
            }
            // Check if this is code
            if (displayType === 'code') {
                return `<pre class="code-block">${this.escapeHtml(value)}</pre>`;
            }
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
