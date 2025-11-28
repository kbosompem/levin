import * as vscode from 'vscode';
import { Settings } from '../config/settings';

interface QueryHistoryEntry {
    query: string;
    timestamp: number;
    dbName?: string;
}

export class QueryHistoryProvider implements vscode.TreeDataProvider<QueryHistoryItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<QueryHistoryItem | undefined | null | void> = new vscode.EventEmitter<QueryHistoryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<QueryHistoryItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private history: QueryHistoryEntry[] = [];
    private readonly storageKey = 'levin.queryHistory';
    private settings: Settings;

    constructor(private context: vscode.ExtensionContext) {
        this.settings = new Settings();
        this.loadHistory();
    }

    private loadHistory(): void {
        const stored = this.context.globalState.get<QueryHistoryEntry[]>(this.storageKey);
        if (stored) {
            this.history = stored;
        }
    }

    private saveHistory(): void {
        this.context.globalState.update(this.storageKey, this.history);
    }

    addQuery(queryText: string): void {
        // Extract db name from query
        const dbMatch = queryText.match(/:db\s+"([^"]+)"/);
        const dbName = dbMatch?.[1];

        // Check if this query already exists
        const existingIndex = this.history.findIndex(h => h.query === queryText);
        if (existingIndex !== -1) {
            // Move to top
            this.history.splice(existingIndex, 1);
        }

        // Add to beginning
        this.history.unshift({
            query: queryText,
            timestamp: Date.now(),
            dbName
        });

        // Trim to max size
        if (this.history.length > this.settings.queryHistorySize) {
            this.history = this.history.slice(0, this.settings.queryHistorySize);
        }

        this.saveHistory();
        this._onDidChangeTreeData.fire();
    }

    clearHistory(): void {
        this.history = [];
        this.saveHistory();
        this._onDidChangeTreeData.fire();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: QueryHistoryItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: QueryHistoryItem): QueryHistoryItem[] {
        if (element) {
            return [];
        }

        return this.history.map((entry, index) => {
            const item = new QueryHistoryItem(entry, index);
            return item;
        });
    }
}

export class QueryHistoryItem extends vscode.TreeItem {
    constructor(
        public readonly entry: QueryHistoryEntry,
        public readonly index: number
    ) {
        // Create a short preview of the query
        const preview = entry.query
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 50);

        super(preview, vscode.TreeItemCollapsibleState.None);

        this.description = this.formatTimestamp(entry.timestamp);
        this.tooltip = entry.query;
        this.iconPath = new vscode.ThemeIcon('history');

        this.command = {
            command: 'levin.runSavedQuery',
            title: 'Run Query',
            arguments: [entry.query]
        };
    }

    private formatTimestamp(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now.getTime() - timestamp;

        if (diff < 60000) {
            return 'just now';
        } else if (diff < 3600000) {
            const mins = Math.floor(diff / 60000);
            return `${mins}m ago`;
        } else if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000);
            return `${hours}h ago`;
        } else {
            return date.toLocaleDateString();
        }
    }
}
