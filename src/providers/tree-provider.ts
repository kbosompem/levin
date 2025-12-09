import * as vscode from 'vscode';
import { DtlvBridge, SchemaAttribute } from '../dtlv-bridge';

export type TreeItemType = 'database' | 'db-folder' | 'schema-folder' | 'schema-item' | 'entities-folder' | 'entity-namespace' | 'relationships-folder' | 'rules-folder' | 'kv-store-folder' | 'queries-folder' | 'query-node' | 'open-database';

export interface DatabaseFolder {
    name: string;
    color: string; // ThemeIcon color like 'charts.red', 'charts.blue', etc.
    databases: string[]; // Array of database paths
    order?: number; // For custom ordering
}

export class DatabaseTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: TreeItemType,
        public readonly dbPath?: string,
        public readonly data?: SchemaAttribute | { namespace: string; count: number } | DatabaseFolder,
        public readonly isRemote?: boolean,
        public readonly folderColor?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = itemType;
        // Set id to include dbPath - this is reliably preserved by VS Code
        if (dbPath) {
            this.id = `${itemType}:${dbPath}`;
        } else if (itemType === 'db-folder') {
            this.id = `${itemType}:${label}`;
        }
        this.setIcon();
        this.setTooltip();
    }

    private setIcon(): void {
        switch (this.itemType) {
            case 'database':
                this.iconPath = new vscode.ThemeIcon(this.isRemote ? 'remote' : 'database');
                break;
            case 'db-folder':
                this.iconPath = new vscode.ThemeIcon('folder', this.folderColor ? new vscode.ThemeColor(this.folderColor) : undefined);
                break;
            case 'schema-folder':
                this.iconPath = new vscode.ThemeIcon('symbol-structure');
                break;
            case 'schema-item':
                this.iconPath = new vscode.ThemeIcon('symbol-field');
                break;
            case 'entities-folder':
                this.iconPath = new vscode.ThemeIcon('symbol-class');
                break;
            case 'entity-namespace':
                this.iconPath = new vscode.ThemeIcon('symbol-namespace');
                break;
            case 'relationships-folder':
                this.iconPath = new vscode.ThemeIcon('git-merge');
                break;
            case 'rules-folder':
                this.iconPath = new vscode.ThemeIcon('symbol-function');
                break;
            case 'kv-store-folder':
                this.iconPath = new vscode.ThemeIcon('key');
                break;
            case 'queries-folder':
                this.iconPath = new vscode.ThemeIcon('search');
                break;
            case 'query-node':
                this.iconPath = new vscode.ThemeIcon('file-code');
                break;
            case 'open-database':
                this.iconPath = new vscode.ThemeIcon('folder-opened');
                break;
        }
    }

    private setTooltip(): void {
        if (this.itemType === 'schema-item' && this.data) {
            const attr = this.data as SchemaAttribute;
            const parts = [attr.valueType || 'unknown', attr.cardinality || 'one'];
            if (attr.index) { parts.push('indexed'); }
            if (attr.unique) { parts.push(attr.unique); }
            if (attr.fulltext) { parts.push('fulltext'); }
            this.tooltip = parts.join(', ');
            this.description = parts.join(', ');
        } else if (this.itemType === 'entity-namespace' && this.data) {
            const ns = this.data as { namespace: string; count: number };
            this.description = `${ns.count} entities`;
        } else if (this.itemType === 'database' && this.dbPath) {
            // For remote URIs, hide credentials in display
            const displayPath = this.sanitizeDbPath(this.dbPath);
            this.tooltip = displayPath;
            this.description = displayPath;
        }
    }

    /**
     * Sanitize database path to hide credentials for remote URIs
     * dtlv://user:pass@host:port/db -> host:port/db
     */
    private sanitizeDbPath(dbPath: string): string {
        if (dbPath.startsWith('dtlv://')) {
            // Parse remote URI and show only host:port/dbname
            const match = dbPath.match(/dtlv:\/\/(?:[^@]+@)?(.+)/);
            return match ? match[1] : dbPath;
        }
        return dbPath;
    }
}

export class DatabaseTreeProvider implements vscode.TreeDataProvider<DatabaseTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DatabaseTreeItem | undefined | null | void> = new vscode.EventEmitter<DatabaseTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DatabaseTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private schemaCache: Map<string, SchemaAttribute[]> = new Map();
    private entityCountCache: Map<string, Array<{namespace: string; count: number}>> = new Map();

    // Store tree items by ID for reliable lookup
    private treeItemsById: Map<string, DatabaseTreeItem> = new Map();

    // Database folders
    private folders: DatabaseFolder[] = [];
    private readonly foldersStorageKey = 'levin.databaseFolders';

    constructor(
        private dtlvBridge: DtlvBridge,
        private context?: vscode.ExtensionContext
    ) {
        this.loadFolders();
    }

    private loadFolders(): void {
        if (this.context) {
            const stored = this.context.globalState.get<DatabaseFolder[]>(this.foldersStorageKey);
            if (stored) {
                this.folders = stored;
            }
        }
    }

    private saveFolders(): void {
        if (this.context) {
            this.context.globalState.update(this.foldersStorageKey, this.folders);
        }
    }

    addFolder(name: string, color: string): void {
        const order = this.folders.length;
        this.folders.push({ name, color, databases: [], order });
        this.saveFolders();
        this.refresh();
    }

    removeFolder(name: string): void {
        this.folders = this.folders.filter(f => f.name !== name);
        this.saveFolders();
        this.refresh();
    }

    addDatabaseToFolder(folderName: string, dbPath: string): void {
        const folder = this.folders.find(f => f.name === folderName);
        if (folder && !folder.databases.includes(dbPath)) {
            folder.databases.push(dbPath);
            this.saveFolders();
            this.refresh();
        }
    }

    removeDatabaseFromFolder(folderName: string, dbPath: string): void {
        const folder = this.folders.find(f => f.name === folderName);
        if (folder) {
            folder.databases = folder.databases.filter(p => p !== dbPath);
            this.saveFolders();
            this.refresh();
        }
    }

    moveFolderUp(folderName: string): void {
        const index = this.folders.findIndex(f => f.name === folderName);
        if (index > 0) {
            [this.folders[index - 1], this.folders[index]] = [this.folders[index], this.folders[index - 1]];
            this.folders.forEach((f, i) => f.order = i);
            this.saveFolders();
            this.refresh();
        }
    }

    moveFolderDown(folderName: string): void {
        const index = this.folders.findIndex(f => f.name === folderName);
        if (index >= 0 && index < this.folders.length - 1) {
            [this.folders[index], this.folders[index + 1]] = [this.folders[index + 1], this.folders[index]];
            this.folders.forEach((f, i) => f.order = i);
            this.saveFolders();
            this.refresh();
        }
    }

    exportFolders(): string {
        return JSON.stringify(this.folders, null, 2);
    }

    importFolders(json: string): void {
        try {
            const imported = JSON.parse(json) as DatabaseFolder[];
            this.folders = imported;
            this.saveFolders();
            this.refresh();
        } catch (error) {
            throw new Error(`Invalid folder data: ${error}`);
        }
    }

    getFolders(): DatabaseFolder[] {
        return this.folders;
    }

    refresh(): void {
        this.schemaCache.clear();
        this.entityCountCache.clear();
        this.treeItemsById.clear();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DatabaseTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: DatabaseTreeItem): Promise<DatabaseTreeItem[]> {
        if (!element) {
            // Root level: show databases and "Open Database" item
            return this.getRootItems();
        }

        // Look up the original tree item by ID
        const id = typeof element.id === 'string' ? element.id : undefined;
        const storedItem = id ? this.treeItemsById.get(id) : undefined;

        // Use stored item if available, otherwise try to extract from element
        const itemType = storedItem?.itemType || element.itemType || element.contextValue as TreeItemType;
        const dbPath = storedItem?.dbPath || element.dbPath || this.extractDbPathFromId(id);

        console.log('getChildren:', { id, itemType, dbPath, hasStoredItem: !!storedItem });

        if (!dbPath) {
            console.log('No dbPath found');
            return [];
        }

        switch (itemType) {
            case 'database':
                return this.getDatabaseChildren(dbPath);
            case 'db-folder':
                // Return databases in this folder
                const folderData = element.data as DatabaseFolder;
                return this.getDatabasesInFolder(folderData);
            case 'schema-folder':
                return this.getSchemaItems(dbPath);
            case 'entities-folder':
                return this.getEntityNamespaces(dbPath);
            case 'queries-folder':
                return [];
            default:
                console.log('No match for itemType:', itemType);
                return [];
        }
    }

    private getDatabasesInFolder(folder: DatabaseFolder): DatabaseTreeItem[] {
        const databases = this.dtlvBridge.getOpenDatabases();
        return folder.databases
            .filter(dbPath => databases.some(db => db.path === dbPath))
            .map(dbPath => {
                const db = databases.find(d => d.path === dbPath)!;
                const item = new DatabaseTreeItem(
                    db.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'database',
                    db.path,
                    undefined,
                    db.isRemote
                );
                return this.registerItem(item);
            });
    }

    private extractDbPathFromId(id?: string): string | undefined {
        if (!id) return undefined;
        // ID format: "itemType:dbPath"
        const colonIndex = id.indexOf(':');
        if (colonIndex > 0) {
            return id.slice(colonIndex + 1);
        }
        return undefined;
    }

    private registerItem(item: DatabaseTreeItem): DatabaseTreeItem {
        if (item.id) {
            // Check for conflicts and warn (but still register)
            if (this.treeItemsById.has(item.id)) {
                console.log(`TreeItem ID ${item.id} already registered, overwriting`);
            }
            this.treeItemsById.set(item.id, item);
        }
        return item;
    }

    // Clear items for a specific database path
    clearItemsForDb(dbPath: string): void {
        for (const [id, _item] of this.treeItemsById) {
            if (id.includes(dbPath)) {
                this.treeItemsById.delete(id);
            }
        }
    }

    private async getRootItems(): Promise<DatabaseTreeItem[]> {
        const items: DatabaseTreeItem[] = [];

        const databases = this.dtlvBridge.getOpenDatabases();

        // Sort folders by order
        const sortedFolders = [...this.folders].sort((a, b) => (a.order || 0) - (b.order || 0));

        // Track which databases are in folders
        const databasesInFolders = new Set<string>();

        // Add folders
        for (const folder of sortedFolders) {
            const item = new DatabaseTreeItem(
                folder.name,
                vscode.TreeItemCollapsibleState.Collapsed,
                'db-folder',
                undefined,
                folder,
                undefined,
                folder.color
            );
            items.push(this.registerItem(item));
            folder.databases.forEach(db => databasesInFolders.add(db));
        }

        // Add databases not in folders
        for (const db of databases) {
            if (!databasesInFolders.has(db.path)) {
                const item = new DatabaseTreeItem(
                    db.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'database',
                    db.path,
                    undefined,
                    db.isRemote
                );
                items.push(this.registerItem(item));
            }
        }

        // Add "Open Database" item
        const openItem = new DatabaseTreeItem(
            'Open Database...',
            vscode.TreeItemCollapsibleState.None,
            'open-database'
        );
        openItem.command = {
            command: 'levin.openDatabase',
            title: 'Open Database'
        };
        items.push(openItem);

        return items;
    }

    private async getDatabaseChildren(dbPath: string): Promise<DatabaseTreeItem[]> {
        const items: DatabaseTreeItem[] = [];

        // Query node - clicking opens a new query tab or activates the last unsaved query
        const queryNode = new DatabaseTreeItem(
            'Query',
            vscode.TreeItemCollapsibleState.None,
            'query-node',
            dbPath
        );
        queryNode.command = {
            command: 'levin.openQueryNode',
            title: 'Open Query',
            arguments: [queryNode]
        };
        items.push(this.registerItem(queryNode));

        // Schema folder - clicking opens Schema Editor panel
        const schemaFolder = new DatabaseTreeItem(
            'Schema',
            vscode.TreeItemCollapsibleState.None,
            'schema-folder',
            dbPath
        );
        schemaFolder.command = {
            command: 'levin.editSchema',
            title: 'View Schema',
            arguments: [schemaFolder]
        };
        items.push(this.registerItem(schemaFolder));

        // Entities folder - clicking opens Entity Browser panel
        const entitiesItem = new DatabaseTreeItem(
            'Entities',
            vscode.TreeItemCollapsibleState.None,
            'entities-folder',
            dbPath
        );
        entitiesItem.command = {
            command: 'levin.browseEntities',
            title: 'Browse Entities',
            arguments: [entitiesItem]
        };
        items.push(this.registerItem(entitiesItem));

        // Relationships folder - clicking opens Relationships panel
        const relationshipsItem = new DatabaseTreeItem(
            'Relationships',
            vscode.TreeItemCollapsibleState.None,
            'relationships-folder',
            dbPath
        );
        relationshipsItem.command = {
            command: 'levin.showRelationships',
            title: 'View Relationships',
            arguments: [relationshipsItem]
        };
        items.push(this.registerItem(relationshipsItem));

        // Rules folder - clicking opens Rules panel
        const rulesItem = new DatabaseTreeItem(
            'Rules',
            vscode.TreeItemCollapsibleState.None,
            'rules-folder',
            dbPath
        );
        rulesItem.command = {
            command: 'levin.showRules',
            title: 'Manage Rules',
            arguments: [rulesItem]
        };
        items.push(this.registerItem(rulesItem));

        // Key-Value Store - clicking opens KV Store panel
        const kvStoreItem = new DatabaseTreeItem(
            'Key-Value Store',
            vscode.TreeItemCollapsibleState.None,
            'kv-store-folder',
            dbPath
        );
        kvStoreItem.command = {
            command: 'levin.openKvStore',
            title: 'Open Key-Value Store',
            arguments: [kvStoreItem]
        };
        items.push(this.registerItem(kvStoreItem));

        return items;
    }

    private async getSchemaItems(dbPath: string): Promise<DatabaseTreeItem[]> {
        try {
            const schema = await this.getSchemaCached(dbPath);

            return schema.map(attr => {
                const item = new DatabaseTreeItem(
                    attr.attribute,
                    vscode.TreeItemCollapsibleState.None,
                    'schema-item',
                    dbPath,
                    attr
                );
                return this.registerItem(item);
            });
        } catch (error) {
            console.error('Failed to load schema:', error);
            return [];
        }
    }

    private async getEntityNamespaces(dbPath: string): Promise<DatabaseTreeItem[]> {
        try {
            const entityCounts = await this.getEntityCountsCached(dbPath);

            return entityCounts.map(ec => {
                const item = new DatabaseTreeItem(
                    `:${ec.namespace}`,
                    vscode.TreeItemCollapsibleState.None,
                    'entity-namespace',
                    dbPath,
                    ec
                );
                return this.registerItem(item);
            });
        } catch (error) {
            console.error('Failed to load entity counts:', error);
            return [];
        }
    }

    private async getSchemaCached(dbPath: string): Promise<SchemaAttribute[]> {
        if (!this.schemaCache.has(dbPath)) {
            const schema = await this.dtlvBridge.getSchema(dbPath);
            this.schemaCache.set(dbPath, schema);
        }
        return this.schemaCache.get(dbPath) || [];
    }

    private async getEntityCountsCached(dbPath: string): Promise<Array<{namespace: string; count: number}>> {
        if (!this.entityCountCache.has(dbPath)) {
            const counts = await this.dtlvBridge.getEntityCounts(dbPath);
            this.entityCountCache.set(dbPath, counts);
        }
        return this.entityCountCache.get(dbPath) || [];
    }
}
