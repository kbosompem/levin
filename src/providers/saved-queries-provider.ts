import * as vscode from 'vscode';

interface SavedQuery {
    name: string;
    query: string;
    createdAt: number;
}

export class SavedQueriesProvider implements vscode.TreeDataProvider<SavedQueryItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SavedQueryItem | undefined | null | void> = new vscode.EventEmitter<SavedQueryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SavedQueryItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private savedQueries: SavedQuery[] = [];
    private readonly storageKey = 'levin.savedQueries';

    constructor(private context: vscode.ExtensionContext) {
        this.loadQueries();
    }

    private loadQueries(): void {
        const stored = this.context.globalState.get<SavedQuery[]>(this.storageKey);
        if (stored) {
            this.savedQueries = stored;
        }
    }

    private saveQueries(): void {
        this.context.globalState.update(this.storageKey, this.savedQueries);
    }

    async addQuery(name: string, queryText: string): Promise<void> {
        // Check if name already exists
        const existingIndex = this.savedQueries.findIndex(q => q.name === name);
        if (existingIndex !== -1) {
            // Update existing
            this.savedQueries[existingIndex] = {
                name,
                query: queryText,
                createdAt: Date.now()
            };
        } else {
            // Add new
            this.savedQueries.push({
                name,
                query: queryText,
                createdAt: Date.now()
            });
        }

        // Sort by name
        this.savedQueries.sort((a, b) => a.name.localeCompare(b.name));

        this.saveQueries();
        this._onDidChangeTreeData.fire();
    }

    async removeQuery(name: string): Promise<void> {
        this.savedQueries = this.savedQueries.filter(q => q.name !== name);
        this.saveQueries();
        this._onDidChangeTreeData.fire();
    }

    getQuery(name: string): SavedQuery | undefined {
        return this.savedQueries.find(q => q.name === name);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SavedQueryItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SavedQueryItem): SavedQueryItem[] {
        if (element) {
            return [];
        }

        return this.savedQueries.map(query => new SavedQueryItem(query));
    }
}

export class SavedQueryItem extends vscode.TreeItem {
    constructor(public readonly savedQuery: SavedQuery) {
        super(savedQuery.name, vscode.TreeItemCollapsibleState.None);

        // Extract db name for description
        const dbMatch = savedQuery.query.match(/:db\s+"([^"]+)"/);
        this.description = dbMatch?.[1] || '';

        this.tooltip = savedQuery.query;
        this.iconPath = new vscode.ThemeIcon('bookmark');
        this.contextValue = 'savedQuery';

        this.command = {
            command: 'levin.runSavedQuery',
            title: 'Run Query',
            arguments: [savedQuery.query]
        };
    }
}
