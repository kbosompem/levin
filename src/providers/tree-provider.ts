import * as vscode from 'vscode';
import { CalvaBridge, SchemaAttribute, EntityCount } from '../calva-bridge';

export type TreeItemType = 'database' | 'schema-folder' | 'schema-item' | 'entities-folder' | 'entity-namespace' | 'queries-folder' | 'add-database';

export class DatabaseTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: TreeItemType,
        public readonly dbName?: string,
        public readonly data?: SchemaAttribute | EntityCount
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
            case 'add-database':
                this.iconPath = new vscode.ThemeIcon('add');
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
            const ns = this.data as EntityCount;
            this.description = `${ns.count} entities`;
        }
    }
}

export class DatabaseTreeProvider implements vscode.TreeDataProvider<DatabaseTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DatabaseTreeItem | undefined | null | void> = new vscode.EventEmitter<DatabaseTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DatabaseTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private schemaCache: Map<string, SchemaAttribute[]> = new Map();
    private entityCountCache: Map<string, EntityCount[]> = new Map();

    constructor(private calvaBridge: CalvaBridge) {}

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
            // Root level: show databases and "Add Database" item
            return this.getRootItems();
        }

        switch (element.itemType) {
            case 'database':
                return this.getDatabaseChildren(element.dbName!);
            case 'schema-folder':
                return this.getSchemaItems(element.dbName!);
            case 'entities-folder':
                return this.getEntityNamespaces(element.dbName!);
            case 'queries-folder':
                return []; // TODO: Implement saved queries
            default:
                return [];
        }
    }

    private async getRootItems(): Promise<DatabaseTreeItem[]> {
        const items: DatabaseTreeItem[] = [];

        try {
            const connections = await this.calvaBridge.getConnections();

            for (const conn of connections) {
                items.push(new DatabaseTreeItem(
                    conn.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'database',
                    conn.name
                ));
            }
        } catch {
            // No connections yet
        }

        // Add "Add Database" item
        const addItem = new DatabaseTreeItem(
            'Add Database...',
            vscode.TreeItemCollapsibleState.None,
            'add-database'
        );
        addItem.command = {
            command: 'levin.addDatabase',
            title: 'Add Database'
        };
        items.push(addItem);

        return items;
    }

    private async getDatabaseChildren(dbName: string): Promise<DatabaseTreeItem[]> {
        const items: DatabaseTreeItem[] = [];

        // Schema folder
        items.push(new DatabaseTreeItem(
            'Schema',
            vscode.TreeItemCollapsibleState.Collapsed,
            'schema-folder',
            dbName
        ));

        // Entities folder
        const entityCounts = await this.getEntityCountsCached(dbName);
        const totalEntities = entityCounts.reduce((sum, ec) => sum + ec.count, 0);

        const entitiesItem = new DatabaseTreeItem(
            `Entities (${totalEntities})`,
            vscode.TreeItemCollapsibleState.Collapsed,
            'entities-folder',
            dbName
        );
        items.push(entitiesItem);

        // Saved Queries folder
        items.push(new DatabaseTreeItem(
            'Saved Queries',
            vscode.TreeItemCollapsibleState.Collapsed,
            'queries-folder',
            dbName
        ));

        return items;
    }

    private async getSchemaItems(dbName: string): Promise<DatabaseTreeItem[]> {
        const schema = await this.getSchemaCached(dbName);

        return schema.map(attr => {
            const item = new DatabaseTreeItem(
                attr.attribute,
                vscode.TreeItemCollapsibleState.None,
                'schema-item',
                dbName,
                attr
            );
            item.command = {
                command: 'levin.showAttributeInfo',
                title: 'Show Attribute Info',
                arguments: [dbName, attr.attribute]
            };
            return item;
        });
    }

    private async getEntityNamespaces(dbName: string): Promise<DatabaseTreeItem[]> {
        const entityCounts = await this.getEntityCountsCached(dbName);

        return entityCounts.map(ec => {
            const item = new DatabaseTreeItem(
                `:${ec.namespace}`,
                vscode.TreeItemCollapsibleState.None,
                'entity-namespace',
                dbName,
                ec
            );
            item.command = {
                command: 'levin.browseNamespace',
                title: 'Browse Namespace',
                arguments: [dbName, ec.namespace]
            };
            return item;
        });
    }

    private async getSchemaCached(dbName: string): Promise<SchemaAttribute[]> {
        if (!this.schemaCache.has(dbName)) {
            const schema = await this.calvaBridge.getSchema(dbName);
            this.schemaCache.set(dbName, schema);
        }
        return this.schemaCache.get(dbName) || [];
    }

    private async getEntityCountsCached(dbName: string): Promise<EntityCount[]> {
        if (!this.entityCountCache.has(dbName)) {
            const counts = await this.calvaBridge.getEntityCounts(dbName);
            this.entityCountCache.set(dbName, counts);
        }
        return this.entityCountCache.get(dbName) || [];
    }
}
