import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface SavedQuery {
    name: string;
    query: string;
    createdAt: number;
    filePath?: string; // Path to the saved .dtlv.edn file
    folder?: string; // Optional folder name for organization
}

interface QueryFolder {
    name: string;
    queries: SavedQuery[];
}

export class SavedQueriesProvider implements vscode.TreeDataProvider<SavedQueryItem | FolderItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SavedQueryItem | FolderItem | undefined | null | void> = new vscode.EventEmitter<SavedQueryItem | FolderItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SavedQueryItem | FolderItem | undefined | null | void> = this._onDidChangeTreeData.event;

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

    async addQuery(name: string, queryText: string, filePath?: string, folder?: string): Promise<string | undefined> {
        // Check if name already exists
        const existingIndex = this.savedQueries.findIndex(q => q.name === name);

        // If no filePath provided, try to save to workspace
        let savedPath = filePath;
        if (!savedPath) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                // Create .levin/queries directory (with optional subfolder)
                let levinDir = path.join(workspaceFolders[0].uri.fsPath, '.levin', 'queries');
                if (folder) {
                    levinDir = path.join(levinDir, folder);
                }
                if (!fs.existsSync(levinDir)) {
                    fs.mkdirSync(levinDir, { recursive: true });
                }

                // Sanitize name for filename
                const sanitizedName = name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
                savedPath = path.join(levinDir, `${sanitizedName}.dtlv.edn`);

                // Write the file
                fs.writeFileSync(savedPath, queryText, 'utf-8');
            }
        }

        if (existingIndex !== -1) {
            // Update existing
            this.savedQueries[existingIndex] = {
                name,
                query: queryText,
                createdAt: Date.now(),
                filePath: savedPath,
                folder
            };
        } else {
            // Add new
            this.savedQueries.push({
                name,
                query: queryText,
                createdAt: Date.now(),
                filePath: savedPath,
                folder
            });
        }

        // Sort by folder, then name
        this.savedQueries.sort((a, b) => {
            const folderA = a.folder || '';
            const folderB = b.folder || '';
            if (folderA !== folderB) {
                return folderA.localeCompare(folderB);
            }
            return a.name.localeCompare(b.name);
        });

        this.saveQueries();
        this._onDidChangeTreeData.fire();

        return savedPath;
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

    getTreeItem(element: SavedQueryItem | FolderItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SavedQueryItem | FolderItem): (SavedQueryItem | FolderItem)[] {
        if (element) {
            // If element is a folder, return its queries
            if (element instanceof FolderItem) {
                return element.queries.map(query => new SavedQueryItem(query));
            }
            return [];
        }

        // Group queries by folder
        const folderMap = new Map<string, SavedQuery[]>();
        const unfoldered: SavedQuery[] = [];

        for (const query of this.savedQueries) {
            if (query.folder) {
                if (!folderMap.has(query.folder)) {
                    folderMap.set(query.folder, []);
                }
                folderMap.get(query.folder)!.push(query);
            } else {
                unfoldered.push(query);
            }
        }

        const items: (SavedQueryItem | FolderItem)[] = [];

        // Add folders
        const sortedFolders = Array.from(folderMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [folderName, queries] of sortedFolders) {
            items.push(new FolderItem(folderName, queries));
        }

        // Add unfoldered queries
        for (const query of unfoldered) {
            items.push(new SavedQueryItem(query));
        }

        return items;
    }

    getFolders(): string[] {
        const folders = new Set<string>();
        for (const query of this.savedQueries) {
            if (query.folder) {
                folders.add(query.folder);
            }
        }
        return Array.from(folders).sort();
    }
}

export class FolderItem extends vscode.TreeItem {
    constructor(
        public readonly folderName: string,
        public readonly queries: SavedQuery[]
    ) {
        super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'queryFolder';
        this.description = `${queries.length} ${queries.length === 1 ? 'query' : 'queries'}`;
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

        // If query has a file path, open the file; otherwise open in editor
        this.command = {
            command: savedQuery.filePath ? 'levin.openSavedQueryFile' : 'levin.openSavedQuery',
            title: 'Open Query',
            arguments: [this]
        };
    }
}
