import * as vscode from 'vscode';
import { DtlvBridge } from './dtlv-bridge';
import { DatabaseTreeProvider, DatabaseTreeItem } from './providers/tree-provider';
import { QueryCompletionProvider } from './providers/completion-provider';
import { QueryCodeLensProvider } from './providers/codelens-provider';
import { QueryHoverProvider } from './providers/hover-provider';
import { ResultsPanel } from './views/results-panel';
import { EntityInspector } from './views/entity-inspector';
import { SchemaEditor } from './views/schema-editor';
import { TransactionPanel } from './views/transaction-panel';
import { QueryHistoryProvider } from './providers/query-history-provider';
import { SavedQueriesProvider } from './providers/saved-queries-provider';

let dtlvBridge: DtlvBridge;
let databaseTreeProvider: DatabaseTreeProvider;
let queryHistoryProvider: QueryHistoryProvider;
let savedQueriesProvider: SavedQueriesProvider;
let resultsPanel: ResultsPanel | undefined;
let entityInspector: EntityInspector | undefined;
let schemaEditor: SchemaEditor | undefined;
let transactionPanel: TransactionPanel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Levin extension is activating...');

    // Initialize dtlv bridge
    dtlvBridge = new DtlvBridge();

    // Check if dtlv is installed
    const dtlvInstalled = await dtlvBridge.checkDtlvInstalled();
    if (!dtlvInstalled) {
        await dtlvBridge.promptInstallDtlv();
    }

    // Initialize tree providers
    databaseTreeProvider = new DatabaseTreeProvider(dtlvBridge);
    queryHistoryProvider = new QueryHistoryProvider(context);
    savedQueriesProvider = new SavedQueriesProvider(context);

    // Register tree views
    const databaseTreeView = vscode.window.createTreeView('levin.databases', {
        treeDataProvider: databaseTreeProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(databaseTreeView);

    const historyTreeView = vscode.window.createTreeView('levin.history', {
        treeDataProvider: queryHistoryProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(historyTreeView);

    const savedQueriesTreeView = vscode.window.createTreeView('levin.savedQueries', {
        treeDataProvider: savedQueriesProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(savedQueriesTreeView);

    // Register language providers for .dtlv.edn files
    const selector: vscode.DocumentSelector = { language: 'datalevin-query' };

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            selector,
            new QueryCompletionProvider(dtlvBridge),
            ':', '?', '['
        )
    );

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            selector,
            new QueryCodeLensProvider()
        )
    );

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            selector,
            new QueryHoverProvider(dtlvBridge)
        )
    );

    // Register commands
    registerCommands(context);

    // Load recently opened databases
    loadRecentDatabases(context);

    console.log('Levin extension activated successfully');
}

function registerCommands(context: vscode.ExtensionContext): void {
    // Open Database command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.openDatabase', async () => {
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Open Database',
                title: 'Select Datalevin Database Folder'
            };

            const result = await vscode.window.showOpenDialog(options);

            if (result && result[0]) {
                const dbPath = result[0].fsPath;
                openDatabase(context, dbPath);
            }
        })
    );

    // Create Database command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.createDatabase', async () => {
            // First check if dtlv is installed
            const dtlvInstalled = await dtlvBridge.checkDtlvInstalled();
            if (!dtlvInstalled) {
                await dtlvBridge.promptInstallDtlv();
                return;
            }

            const options: vscode.OpenDialogOptions = {
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Parent Folder',
                title: 'Select folder to create database in'
            };

            const result = await vscode.window.showOpenDialog(options);

            if (result && result[0]) {
                const parentPath = result[0].fsPath;

                const dbName = await vscode.window.showInputBox({
                    prompt: 'Enter database name',
                    placeHolder: 'my-database',
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) {
                            return 'Database name is required';
                        }
                        if (/[<>:"/\\|?*]/.test(value)) {
                            return 'Invalid characters in database name';
                        }
                        return null;
                    }
                });

                if (dbName) {
                    const dbPath = `${parentPath}/${dbName}`;
                    const createResult = await dtlvBridge.createDatabase(dbPath);

                    if (createResult.success) {
                        openDatabase(context, dbPath);
                        vscode.window.showInformationMessage(`Created database: ${dbName}`);
                    } else {
                        vscode.window.showErrorMessage(`Failed to create database: ${createResult.error}`);
                    }
                }
            }
        })
    );

    // Close Database command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.closeDatabase', async (item?: DatabaseTreeItem) => {
            const dbPath = item?.dbPath || await selectDatabase();
            if (dbPath) {
                dtlvBridge.closeDatabase(dbPath);
                removeFromRecentDatabases(context, dbPath);
                databaseTreeProvider.refresh();
                vscode.window.showInformationMessage(`Closed database`);
            }
        })
    );

    // New Query command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.newQuery', async (item?: DatabaseTreeItem) => {
            const dbPath = item?.dbPath || await selectDatabase();
            if (dbPath) {
                await createNewQuery(dbPath);
            }
        })
    );

    // Run Query command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.runQuery', async () => {
            await runCurrentQuery(context);
        })
    );

    // Show Entity command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.showEntity', async (dbPath?: string, entityId?: number) => {
            if (!dbPath || entityId === undefined) {
                const input = await vscode.window.showInputBox({
                    prompt: 'Enter entity ID',
                    placeHolder: '42'
                });
                if (!input) { return; }
                entityId = parseInt(input, 10);
                dbPath = await selectDatabase();
            }
            if (dbPath && entityId !== undefined) {
                await showEntityInspector(context, dbPath, entityId);
            }
        })
    );

    // Refresh Explorer command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.refreshExplorer', () => {
            databaseTreeProvider.refresh();
        })
    );

    // Export Results command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.exportResults', async () => {
            if (resultsPanel) {
                await resultsPanel.exportResults();
            } else {
                vscode.window.showWarningMessage('No results to export');
            }
        })
    );

    // Copy Path command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.copyPath', async (item?: DatabaseTreeItem) => {
            if (item?.dbPath) {
                await vscode.env.clipboard.writeText(item.dbPath);
                vscode.window.showInformationMessage('Path copied to clipboard');
            }
        })
    );

    // Internal command for running query from CodeLens
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.runQueryAtLine', async (_line: number) => {
            await runCurrentQuery(context);
        })
    );

    // Edit Schema command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.editSchema', async (item?: DatabaseTreeItem) => {
            const dbPath = item?.dbPath || await selectDatabase();
            if (dbPath) {
                await showSchemaEditor(context, dbPath);
            }
        })
    );

    // Show Transaction Panel command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.showTransactionPanel', async (item?: DatabaseTreeItem) => {
            const dbPath = item?.dbPath || await selectDatabase();
            if (dbPath) {
                await showTransactionPanel(context, dbPath);
            }
        })
    );

    // Save Query command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.saveQuery', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'datalevin-query') {
                const queryText = editor.document.getText();
                const name = await vscode.window.showInputBox({
                    prompt: 'Enter a name for this query',
                    placeHolder: 'My Query'
                });
                if (name) {
                    await savedQueriesProvider.addQuery(name, queryText);
                    vscode.window.showInformationMessage(`Query saved as "${name}"`);
                }
            }
        })
    );

    // Run Saved Query command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.runSavedQuery', async (queryText: string) => {
            await executeQuery(context, queryText);
        })
    );

    // Delete Saved Query command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.deleteSavedQuery', async (name: string) => {
            await savedQueriesProvider.removeQuery(name);
        })
    );
}

function openDatabase(context: vscode.ExtensionContext, dbPath: string): void {
    dtlvBridge.openDatabase(dbPath);
    addToRecentDatabases(context, dbPath);
    databaseTreeProvider.refresh();
}

function loadRecentDatabases(_context: vscode.ExtensionContext): void {
    const config = vscode.workspace.getConfiguration('levin');
    const recent = config.get<string[]>('recentDatabases', []);

    for (const dbPath of recent) {
        dtlvBridge.openDatabase(dbPath);
    }

    if (recent.length > 0) {
        databaseTreeProvider.refresh();
    }
}

function addToRecentDatabases(context: vscode.ExtensionContext, dbPath: string): void {
    const config = vscode.workspace.getConfiguration('levin');
    const recent = config.get<string[]>('recentDatabases', []);

    // Remove if exists, then add to front
    const filtered = recent.filter(p => p !== dbPath);
    filtered.unshift(dbPath);

    // Keep only last 10
    const updated = filtered.slice(0, 10);

    config.update('recentDatabases', updated, vscode.ConfigurationTarget.Global);
}

function removeFromRecentDatabases(context: vscode.ExtensionContext, dbPath: string): void {
    const config = vscode.workspace.getConfiguration('levin');
    const recent = config.get<string[]>('recentDatabases', []);
    const updated = recent.filter(p => p !== dbPath);
    config.update('recentDatabases', updated, vscode.ConfigurationTarget.Global);
}

async function selectDatabase(): Promise<string | undefined> {
    const databases = dtlvBridge.getOpenDatabases();

    if (databases.length === 0) {
        const action = await vscode.window.showErrorMessage(
            'No databases open. Open a database first.',
            'Open Database'
        );
        if (action === 'Open Database') {
            vscode.commands.executeCommand('levin.openDatabase');
        }
        return undefined;
    }

    if (databases.length === 1) {
        return databases[0].path;
    }

    const items = databases.map(db => ({
        label: db.name,
        description: db.path
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a database'
    });

    return selected?.description;
}

async function createNewQuery(dbPath: string): Promise<void> {
    const _dbName = dbPath.split('/').pop() || dbPath;

    const content = `{:db "${dbPath}"
 :query [:find ?e
         :where
         [?e :db/id _]]
 :limit 50}`;

    const doc = await vscode.workspace.openTextDocument({
        language: 'datalevin-query',
        content
    });

    await vscode.window.showTextDocument(doc);
}

async function runCurrentQuery(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const queryText = editor.document.getText();
    await executeQuery(context, queryText);
}

async function executeQuery(context: vscode.ExtensionContext, queryText: string): Promise<void> {
    // Check dtlv is installed
    const dtlvInstalled = await dtlvBridge.checkDtlvInstalled();
    if (!dtlvInstalled) {
        await dtlvBridge.promptInstallDtlv();
        return;
    }

    try {
        // Parse the query to extract components
        const dbMatch = queryText.match(/:db\s+"([^"]+)"/);
        const dbPath = dbMatch?.[1];

        if (!dbPath) {
            vscode.window.showErrorMessage('Query must specify :db with database path');
            return;
        }

        // Extract the query portion
        const queryPortionMatch = queryText.match(/:query\s+(\[[\s\S]*?\])(?=\s*:|\s*\})/);
        const queryPortion = queryPortionMatch?.[1] || '[:find ?e :where [?e :db/id _]]';

        // Extract limit
        const limitMatch = queryText.match(/:limit\s+(\d+)/);
        const limit = limitMatch ? parseInt(limitMatch[1], 10) : 50;

        // Show progress
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Running query...',
            cancellable: false
        }, async () => {
            const result = await dtlvBridge.runQuery(dbPath, queryPortion, limit);

            if (result.success) {
                // Add to history
                queryHistoryProvider.addQuery(queryText);

                // Show results panel
                if (!resultsPanel) {
                    resultsPanel = new ResultsPanel(dtlvBridge);
                }
                resultsPanel.show(result.data, dbPath);
            } else {
                vscode.window.showErrorMessage(`Query error: ${result.error}`);
            }
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to execute query: ${error}`);
    }
}

async function showEntityInspector(
    context: vscode.ExtensionContext,
    dbPath: string,
    entityId: number
): Promise<void> {
    if (!entityInspector) {
        entityInspector = new EntityInspector(context, dtlvBridge);
    }
    await entityInspector.show(dbPath, entityId);
}

async function showSchemaEditor(
    context: vscode.ExtensionContext,
    dbPath: string
): Promise<void> {
    if (!schemaEditor) {
        schemaEditor = new SchemaEditor(context, dtlvBridge);
    }
    await schemaEditor.show(dbPath);
}

async function showTransactionPanel(
    context: vscode.ExtensionContext,
    dbPath: string
): Promise<void> {
    if (!transactionPanel) {
        transactionPanel = new TransactionPanel(context, dtlvBridge);
    }
    await transactionPanel.show(dbPath);
}

export function deactivate(): void {
    console.log('Levin extension deactivated');
}
