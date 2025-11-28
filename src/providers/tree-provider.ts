import * as vscode from 'vscode';
import { DtlvBridge, SchemaAttribute } from '../dtlv-bridge';

export type TreeItemType = 'database' | 'schema-folder' | 'schema-item' | 'entities-folder' | 'entity-namespace' | 'queries-folder' | 'open-database';

export class DatabaseTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: TreeItemType,
        public readonly dbPath?: string,
        public readonly data?: SchemaAttribute | { namespace: string; count: number }
    ) {
        super(label, collapsibleState);
        this.contextValue = itemType;
        this.setIcon();
        this.setTooltip();
    }

    private setIcon(): void {
        switch (this.itemType) {
            case 'database':
                this.iconPath = new vscode.ThemeIcon('database');
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
            case 'queries-folder':
                this.iconPath = new vscode.ThemeIcon('search');
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
            this.tooltip = this.dbPath;
            this.description = this.dbPath;
        }
    }
}

export class DatabaseTreeProvider implements vscode.TreeDataProvider<DatabaseTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DatabaseTreeItem | undefined | null | void> = new vscode.EventEmitter<DatabaseTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DatabaseTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private schemaCache: Map<string, SchemaAttribute[]> = new Map();
    private entityCountCache: Map<string, Array<{namespace: string; count: number}>> = new Map();

    constructor(private dtlvBridge: DtlvBridge) {}

    refresh(): void {
        this.schemaCache.clear();
        this.entityCountCache.clear();
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

        switch (element.itemType) {
            case 'database':
                return this.getDatabaseChildren(element.dbPath!);
            case 'schema-folder':
                return this.getSchemaItems(element.dbPath!);
            case 'entities-folder':
                return this.getEntityNamespaces(element.dbPath!);
            case 'queries-folder':
                return []; // TODO: Implement saved queries per database
            default:
                return [];
        }
    }

    private async getRootItems(): Promise<DatabaseTreeItem[]> {
        const items: DatabaseTreeItem[] = [];

        const databases = this.dtlvBridge.getOpenDatabases();

        for (const db of databases) {
            const item = new DatabaseTreeItem(
                db.name,
                vscode.TreeItemCollapsibleState.Collapsed,
                'database',
                db.path
            );
            items.push(item);
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

        // Schema folder
        items.push(new DatabaseTreeItem(
            'Schema',
            vscode.TreeItemCollapsibleState.Collapsed,
            'schema-folder',
            dbPath
        ));

        // Entities folder - try to get counts
        try {
            const entityCounts = await this.getEntityCountsCached(dbPath);
            const totalEntities = entityCounts.reduce((sum, ec) => sum + ec.count, 0);

            const entitiesItem = new DatabaseTreeItem(
                `Entities (${totalEntities})`,
                vscode.TreeItemCollapsibleState.Collapsed,
                'entities-folder',
                dbPath
            );
            items.push(entitiesItem);
        } catch {
            // If we can't get counts, still show folder
            items.push(new DatabaseTreeItem(
                'Entities',
                vscode.TreeItemCollapsibleState.Collapsed,
                'entities-folder',
                dbPath
            ));
        }

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
                return item;
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
                return item;
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
