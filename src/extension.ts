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
import { EntityBrowser } from './views/entity-browser';
import { RelationshipsPanel } from './views/relationships-panel';
import { RulesPanel } from './views/rules-panel';
import { ErrorPanel } from './views/error-panel';
import { KvStorePanel } from './views/kv-store-panel';
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
let entityBrowser: EntityBrowser | undefined;
let relationshipsPanel: RelationshipsPanel | undefined;
let rulesPanel: RulesPanel | undefined;
let errorPanel: ErrorPanel | undefined;
let kvStorePanel: KvStorePanel | undefined;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Levin extension is activating...');

    // Create output channel
    outputChannel = vscode.window.createOutputChannel('Datalevin');
    context.subscriptions.push(outputChannel);

    // Initialize dtlv bridge
    dtlvBridge = new DtlvBridge(outputChannel);

    // Check if dtlv is installed
    const dtlvInstalled = await dtlvBridge.checkDtlvInstalled();
    if (!dtlvInstalled) {
        await dtlvBridge.promptInstallDtlv();
    }

    // Initialize tree providers
    databaseTreeProvider = new DatabaseTreeProvider(dtlvBridge, context);
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

    // Watch for configuration changes to detect databases opened in other instances
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('levin.recentDatabases')) {
                // Configuration changed, reload databases from shared config
                loadRecentDatabases(context);
                databaseTreeProvider.refresh();
            }
        })
    );

    console.log('Levin extension activated successfully');
}

function registerCommands(context: vscode.ExtensionContext): void {
    // Open Database command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.openDatabase', async () => {
            // First ask: KV Store or Datalog Database
            const dbTypeChoice = await vscode.window.showQuickPick([
                { label: '$(database) Key-Value Store', description: 'Simple key-value storage', value: 'kv' },
                { label: '$(symbol-namespace) Datalog Database', description: 'Entity-attribute-value store with queries', value: 'datalog' }
            ], {
                placeHolder: 'Select database type'
            });

            if (!dbTypeChoice) { return; }

            // Then ask: Local or Remote
            const locationChoice = await vscode.window.showQuickPick([
                { label: '$(folder) Local Database', value: 'local' },
                { label: '$(remote) Remote Server', value: 'remote' }
            ], {
                placeHolder: 'Select database location'
            });

            if (!locationChoice) { return; }

            if (dbTypeChoice.value === 'kv') {
                // KV Store path
                let dbPath: string | undefined;

                if (locationChoice.value === 'local') {
                    const result = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: 'Open KV Database',
                        title: 'Select Datalevin KV Database Folder'
                    });

                    if (result && result[0]) {
                        dbPath = result[0].fsPath;
                    }
                } else {
                    // Remote server
                    dbPath = await vscode.window.showInputBox({
                        prompt: 'Enter Datalevin server URI',
                        placeHolder: 'dtlv://username:password@host:port/database',
                        validateInput: (value) => {
                            if (!value || value.trim().length === 0) {
                                return 'Server URI is required';
                            }
                            if (!value.startsWith('dtlv://')) {
                                return 'URI must start with dtlv://';
                            }
                            return null;
                        }
                    });
                }

                if (dbPath) {
                    await showKvStore(context, dbPath);
                }
            } else {
                // Datalog Database path
                if (locationChoice.value === 'local') {
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
                } else {
                    // Remote server
                    const serverUri = await vscode.window.showInputBox({
                        prompt: 'Enter Datalevin server URI',
                        placeHolder: 'dtlv://username:password@host:port/database',
                        validateInput: (value) => {
                            if (!value || value.trim().length === 0) {
                                return 'Server URI is required';
                            }
                            if (!value.startsWith('dtlv://')) {
                                return 'URI must start with dtlv://';
                            }
                            return null;
                        }
                    });

                    if (serverUri) {
                        openDatabase(context, serverUri);
                    }
                }
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
            const dbPath = extractDbPath(item) || await selectDatabase();
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
            const dbPath = extractDbPath(item) || await selectDatabase();
            if (dbPath) {
                await createNewQuery(dbPath);
            }
        })
    );

    // Open Query Node command - opens new query or activates last unsaved query
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.openQueryNode', async (item?: DatabaseTreeItem) => {
            const dbPath = extractDbPath(item);
            if (!dbPath) { return; }

            // Try to find an existing unsaved query document for this database
            const existingDoc = vscode.workspace.textDocuments.find(doc => {
                return doc.languageId === 'datalevin-query' &&
                       doc.isUntitled &&
                       doc.getText().includes(`:db "${dbPath}"`);
            });

            if (existingDoc) {
                // Activate the existing unsaved query
                await vscode.window.showTextDocument(existingDoc);
            } else {
                // Create a new query
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
            // Reload databases from shared config (picks up changes from other instances)
            loadRecentDatabases(context);
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
            const dbPath = extractDbPath(item);
            const finalDbPath = dbPath || await selectDatabase();
            if (finalDbPath) {
                await showSchemaEditor(context, finalDbPath);
            } else {
                vscode.window.showErrorMessage('Could not determine database path');
            }
        })
    );

    // Browse Entities command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.browseEntities', async (item?: DatabaseTreeItem) => {
            const dbPath = extractDbPath(item);
            const finalDbPath = dbPath || await selectDatabase();
            if (finalDbPath) {
                await showEntityBrowser(context, finalDbPath);
            } else {
                vscode.window.showErrorMessage('Could not determine database path');
            }
        })
    );

    // Show Relationships command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.showRelationships', async (item?: DatabaseTreeItem) => {
            const dbPath = extractDbPath(item);
            const finalDbPath = dbPath || await selectDatabase();
            if (finalDbPath) {
                await showRelationshipsPanel(context, finalDbPath);
            } else {
                vscode.window.showErrorMessage('Could not determine database path');
            }
        })
    );

    // Show Rules command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.showRules', async (item?: DatabaseTreeItem) => {
            const dbPath = extractDbPath(item);
            const finalDbPath = dbPath || await selectDatabase();
            if (finalDbPath) {
                await showRulesPanel(context, finalDbPath);
            } else {
                vscode.window.showErrorMessage('Could not determine database path');
            }
        })
    );

    // Show Transaction Panel command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.showTransactionPanel', async (item?: DatabaseTreeItem) => {
            const dbPath = extractDbPath(item) || await selectDatabase();
            if (dbPath) {
                await showTransactionPanel(context, dbPath);
            }
        })
    );

    // Show KV Store command (redirects to openDatabase for better UX)
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.showKvStore', async () => {
            // Simply call openDatabase command which now handles KV stores
            vscode.commands.executeCommand('levin.openDatabase');
        })
    );

    // Open KV Store command (for tree item)
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.openKvStore', async (item?: DatabaseTreeItem) => {
            const dbPath = extractDbPath(item) || await selectDatabase();
            if (dbPath) {
                await showKvStore(context, dbPath);
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
                if (!name) { return; }

                // Ask for folder (optional)
                const existingFolders = savedQueriesProvider.getFolders();
                const folderItems = [
                    { label: '$(files) No Folder', description: 'Save without a folder', folder: undefined },
                    { label: '$(new-folder) New Folder...', description: 'Create a new folder', folder: '__new__' },
                    ...existingFolders.map(f => ({ label: `$(folder) ${f}`, folder: f }))
                ];

                const selectedFolder = await vscode.window.showQuickPick(folderItems, {
                    placeHolder: 'Select a folder (optional)'
                });

                let folder: string | undefined = undefined;
                if (selectedFolder) {
                    if (selectedFolder.folder === '__new__') {
                        // Create new folder
                        folder = await vscode.window.showInputBox({
                            prompt: 'Enter folder name',
                            placeHolder: 'My Folder'
                        });
                        if (!folder) { return; }
                    } else {
                        folder = selectedFolder.folder;
                    }
                }

                const savedPath = await savedQueriesProvider.addQuery(name, queryText, undefined, folder);
                if (savedPath) {
                    // Close the current unsaved editor
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    // Open the saved file
                    const doc = await vscode.workspace.openTextDocument(savedPath);
                    await vscode.window.showTextDocument(doc);
                    vscode.window.showInformationMessage(`Query saved as "${name}"`);
                } else {
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
        vscode.commands.registerCommand('levin.deleteSavedQuery', async (item?: { savedQuery?: { name: string } }) => {
            const name = item?.savedQuery?.name;
            if (name) {
                await savedQueriesProvider.removeQuery(name);
                vscode.window.showInformationMessage(`Deleted query "${name}"`);
            }
        })
    );

    // Open Saved Query in editor
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.openSavedQuery', async (item?: { savedQuery?: { name: string; query: string } }) => {
            const queryText = item?.savedQuery?.query;
            if (queryText) {
                const doc = await vscode.workspace.openTextDocument({
                    language: 'datalevin-query',
                    content: queryText
                });
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Open Saved Query File (for queries saved to disk)
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.openSavedQueryFile', async (item?: { savedQuery?: { filePath?: string } }) => {
            const filePath = item?.savedQuery?.filePath;
            if (filePath) {
                const doc = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Copy Query as Clojure
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.copyQueryAsClojure', async (_line?: number) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const queryText = editor.document.getText();

            // Parse the query to extract components
            const dbMatch = queryText.match(/:db\s+"([^"]+)"/);
            const dbPath = dbMatch?.[1] || '/path/to/database';

            const queryPortionMatch = queryText.match(/:query\s+(\[[\s\S]*?\])(?=\s*:|\s*\})/);
            const queryPortion = queryPortionMatch?.[1] || '[:find ?e :where [?e :db/id _]]';

            // Generate Clojure code
            const clojureCode = `(require '[datalevin.core :as d])

(def conn (d/get-conn "${dbPath}"))

(d/q '${queryPortion}
     @conn)

(d/close conn)`;

            await vscode.env.clipboard.writeText(clojureCode);
            vscode.window.showInformationMessage('Query copied as Clojure code');
        })
    );

    // Show Output command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.showOutput', () => {
            outputChannel.show();
        })
    );

    // Import Data command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.importData', async (item?: DatabaseTreeItem) => {
            const dbPath = extractDbPath(item) || await selectDatabase();
            if (!dbPath) { return; }

            const source = await vscode.window.showQuickPick([
                { label: '$(file) Import from File', value: 'file' },
                { label: '$(globe) Import from URL', value: 'url' }
            ], {
                placeHolder: 'Select import source'
            });

            if (!source) { return; }

            let ednContent: string | undefined;

            if (source.value === 'file') {
                const files = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectMany: false,
                    filters: { 'EDN Files': ['edn'], 'All Files': ['*'] },
                    title: 'Select EDN file to import'
                });

                if (!files || files.length === 0) { return; }

                try {
                    const fileContent = await vscode.workspace.fs.readFile(files[0]);
                    ednContent = Buffer.from(fileContent).toString('utf-8');
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to read file: ${error}`);
                    return;
                }
            } else {
                const url = await vscode.window.showInputBox({
                    prompt: 'Enter URL to EDN file',
                    placeHolder: 'https://example.com/data.edn',
                    validateInput: (value) => {
                        if (!value) { return 'URL is required'; }
                        if (!value.startsWith('http://') && !value.startsWith('https://')) {
                            return 'URL must start with http:// or https://';
                        }
                        return null;
                    }
                });

                if (!url) { return; }

                try {
                    ednContent = await fetchUrl(url);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to fetch URL: ${error}`);
                    return;
                }
            }

            if (!ednContent || ednContent.trim().length === 0) {
                vscode.window.showErrorMessage('No content to import');
                return;
            }

            // Import the data
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Importing data...',
                cancellable: false
            }, async () => {
                // Check content type and handle appropriately
                const trimmed = ednContent!.trim();
                let result;

                // If it starts with { and contains :db/valueType, it's likely Datomic schema format
                if (trimmed.startsWith('{') && trimmed.includes(':db/valueType')) {
                    // Convert and transact Datomic schema in one step
                    result = await dtlvBridge.transactDatomicSchema(dbPath, trimmed);
                }
                // If it's a vector with :db/id and negative numbers, it's data with temp IDs
                else if (trimmed.startsWith('[') && trimmed.includes(':db/id') && /:db\/id\s+-\d/.test(trimmed)) {
                    // Use special import method that reopens connection with schema
                    result = await dtlvBridge.importWithTempIds(dbPath, trimmed);
                }
                // Otherwise, normal transact
                else {
                    result = await dtlvBridge.transact(dbPath, trimmed);
                }

                if (result.success) {
                    const data = result.data as { datomsCount?: number };
                    vscode.window.showInformationMessage(
                        `Import successful! ${data.datomsCount || 0} datoms added.`
                    );
                    databaseTreeProvider.refresh();
                } else {
                    vscode.window.showErrorMessage(`Import failed: ${result.error}`);
                }
            });
        })
    );

    // Create Database Folder command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.createDatabaseFolder', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Enter folder name',
                placeHolder: 'My Databases'
            });
            if (!name) { return; }

            const colors = [
                { label: '🔴 Red', value: 'charts.red' },
                { label: '🟠 Orange', value: 'charts.orange' },
                { label: '🟡 Yellow', value: 'charts.yellow' },
                { label: '🟢 Green', value: 'charts.green' },
                { label: '🔵 Blue', value: 'charts.blue' },
                { label: '🟣 Purple', value: 'charts.purple' },
                { label: '🟤 Pink', value: 'charts.pink' },
                { label: '⚪ Default', value: '' }
            ];

            const selectedColor = await vscode.window.showQuickPick(colors, {
                placeHolder: 'Select a color for the folder'
            });

            const color = selectedColor?.value || '';
            databaseTreeProvider.addFolder(name, color);
            vscode.window.showInformationMessage(`Created folder "${name}"`);
        })
    );

    // Add Database to Folder command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.addDatabaseToFolder', async (item?: DatabaseTreeItem) => {
            const dbPath = extractDbPath(item) || await selectDatabase();
            if (!dbPath) { return; }

            const folders = databaseTreeProvider.getFolders();
            if (folders.length === 0) {
                const createNew = await vscode.window.showInformationMessage(
                    'No folders exist. Create one?',
                    'Create Folder'
                );
                if (createNew) {
                    vscode.commands.executeCommand('levin.createDatabaseFolder');
                }
                return;
            }

            const folderItems = folders.map(f => ({ label: f.name, folder: f }));
            const selected = await vscode.window.showQuickPick(folderItems, {
                placeHolder: 'Select folder'
            });

            if (selected) {
                databaseTreeProvider.addDatabaseToFolder(selected.folder.name, dbPath);
                vscode.window.showInformationMessage(`Added database to folder "${selected.folder.name}"`);
            }
        })
    );

    // Remove Database from Folder command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.removeDatabaseFromFolder', async (item?: DatabaseTreeItem) => {
            const dbPath = extractDbPath(item);
            if (!dbPath) { return; }

            const folders = databaseTreeProvider.getFolders();
            const folderWithDb = folders.find(f => f.databases.includes(dbPath));

            if (folderWithDb) {
                databaseTreeProvider.removeDatabaseFromFolder(folderWithDb.name, dbPath);
                vscode.window.showInformationMessage(`Removed database from folder "${folderWithDb.name}"`);
            }
        })
    );

    // Move Folder Up command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.moveFolderUp', async (item?: DatabaseTreeItem) => {
            if (item?.itemType === 'db-folder' && item.label) {
                databaseTreeProvider.moveFolderUp(item.label);
            }
        })
    );

    // Move Folder Down command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.moveFolderDown', async (item?: DatabaseTreeItem) => {
            if (item?.itemType === 'db-folder' && item.label) {
                databaseTreeProvider.moveFolderDown(item.label);
            }
        })
    );

    // Delete Folder command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.deleteFolder', async (item?: DatabaseTreeItem) => {
            if (item?.itemType === 'db-folder' && item.label) {
                const confirm = await vscode.window.showWarningMessage(
                    `Delete folder "${item.label}"? Databases will not be deleted.`,
                    'Delete', 'Cancel'
                );
                if (confirm === 'Delete') {
                    databaseTreeProvider.removeFolder(item.label);
                    vscode.window.showInformationMessage(`Deleted folder "${item.label}"`);
                }
            }
        })
    );

    // Export Folders command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.exportFolders', async () => {
            const json = databaseTreeProvider.exportFolders();
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('database-folders.json'),
                filters: {
                    'JSON Files': ['json'],
                    'All Files': ['*']
                }
            });

            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf8'));
                vscode.window.showInformationMessage('Folders exported successfully');
            }
        })
    );

    // Import Folders command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.importFolders', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectMany: false,
                filters: {
                    'JSON Files': ['json'],
                    'All Files': ['*']
                }
            });

            if (uris && uris.length > 0) {
                try {
                    const fileContent = await vscode.workspace.fs.readFile(uris[0]);
                    const json = Buffer.from(fileContent).toString('utf-8');
                    databaseTreeProvider.importFolders(json);
                    vscode.window.showInformationMessage('Folders imported successfully');
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to import folders: ${error}`);
                }
            }
        })
    );
}

/**
 * Fetch content from a URL
 */
async function fetchUrl(url: string): Promise<string> {
    const https = await import('https');
    const http = await import('http');

    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;

        client.get(url, (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302) {
                if (res.headers.location) {
                    fetchUrl(res.headers.location).then(resolve).catch(reject);
                    return;
                }
            }

            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        }).on('error', reject);
    });
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

/**
 * Extract dbPath from a tree item passed by VS Code context menu.
 * VS Code may serialize tree items differently, so we check multiple properties.
 */
function extractDbPath(item?: DatabaseTreeItem): string | undefined {
    if (!item) { return undefined; }

    const anyItem = item as unknown as Record<string, unknown>;

    // Direct property (if preserved)
    if (item.dbPath) { return item.dbPath; }

    // From id property (format: "itemType:/path/to/db")
    if (typeof anyItem.id === 'string') {
        const colonIndex = anyItem.id.indexOf(':');
        if (colonIndex > 0) {
            return anyItem.id.slice(colonIndex + 1);
        }
    }

    // From description (set for database items)
    if (typeof anyItem.description === 'string' && anyItem.description.startsWith('/')) {
        return anyItem.description;
    }

    // From tooltip
    if (typeof anyItem.tooltip === 'string' && anyItem.tooltip.startsWith('/')) {
        return anyItem.tooltip;
    }

    return undefined;
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
                // Show error in dedicated error panel
                if (!errorPanel) {
                    errorPanel = new ErrorPanel();
                }
                errorPanel.show(result.error || 'Unknown error', queryPortion);

                // Also show a brief notification
                vscode.window.showErrorMessage('Query failed - see error panel for details');
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

async function showEntityBrowser(
    context: vscode.ExtensionContext,
    dbPath: string
): Promise<void> {
    if (!entityBrowser) {
        entityBrowser = new EntityBrowser(context, dtlvBridge);
    }
    await entityBrowser.show(dbPath);
}

async function showRelationshipsPanel(
    context: vscode.ExtensionContext,
    dbPath: string
): Promise<void> {
    if (!relationshipsPanel) {
        relationshipsPanel = new RelationshipsPanel(context, dtlvBridge);
    }
    await relationshipsPanel.show(dbPath);
}

async function showRulesPanel(
    context: vscode.ExtensionContext,
    dbPath: string
): Promise<void> {
    if (!rulesPanel) {
        rulesPanel = new RulesPanel(context, dtlvBridge);
    }
    await rulesPanel.show(dbPath);
}

async function showKvStore(
    context: vscode.ExtensionContext,
    dbPath: string
): Promise<void> {
    if (!kvStorePanel) {
        kvStorePanel = new KvStorePanel(dtlvBridge, context);
    }
    // Register KV database with the bridge so it appears in the tree
    dtlvBridge.openDatabase(dbPath);
    addToRecentDatabases(context, dbPath);
    databaseTreeProvider.refresh();
    await kvStorePanel.show(dbPath);
}

export function deactivate(): void {
    console.log('Levin extension deactivated');
}
