import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { DtlvBridge, VectorOpts } from './dtlv-bridge';
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
import { KvStorePanel } from './views/kv-store-panel';
import { VectorSearchPanel } from './views/vector-search-panel';
import { CreateDatabasePanel } from './views/create-database-panel';
import { QueryHistoryProvider } from './providers/query-history-provider';
import { SavedQueriesProvider } from './providers/saved-queries-provider';
import { registerDiagnostics } from './providers/diagnostics-provider';
import { ConnectionStatusProvider } from './providers/connection-status';
import { registerPareditCommands } from './providers/paredit-commands';
import { DatalevinQueryFormattingProvider } from './providers/format-provider';
import { LevinNotebookSerializer } from './notebook/serializer';
import { LevinNotebookController } from './notebook/controller';
import { buildSampleDatabase } from './sample/sample-database';
import { playgroundFiles } from './sample/playground-files';
import { SAMPLE_DB_DIRNAME } from './sample/northwind-mini';
import { parseStatements, statementAtLine, resolveDbPath, isRunnable, parseRulesSpec, splitEdnVector, QueryStatement } from './utils/query-statements';
import { formatQueryError } from './utils/error-formatter';
import { jsonToEdn, looksLikeJson } from './utils/json-to-edn';
import * as nlq from './nlq';

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
let kvStorePanel: KvStorePanel | undefined;
let vectorSearchPanel: VectorSearchPanel | undefined;
let createDatabasePanel: CreateDatabasePanel | undefined;
let connectionStatus: ConnectionStatusProvider | undefined;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Levin extension is activating...');

    // Create output channel first so we can log errors
    outputChannel = vscode.window.createOutputChannel('Datalevin');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('Levin extension activation starting...');

    try {
        // Set extension path for NLQ module resolution
        nlq.setExtensionPath(context.extensionPath);

        // Initialize dtlv bridge
        dtlvBridge = new DtlvBridge(outputChannel);
        dtlvBridge.setStorageDir(context.globalStorageUri.fsPath);

        // Restore per-database vector opts (required to open vector DBs)
        dtlvBridge.loadVectorOpts(context.globalState.get<Record<string, VectorOpts>>('levin.vectorOpts', {}));
        dtlvBridge.onVectorOptsChanged = (dbPath, opts) => {
            const all = context.globalState.get<Record<string, VectorOpts>>('levin.vectorOpts', {});
            all[dbPath] = opts;
            void context.globalState.update('levin.vectorOpts', all);
        };

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

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            selector,
            new DatalevinQueryFormattingProvider()
        )
    );


    // Register commands
    registerCommands(context);
    registerPareditCommands(context);

    // Live query diagnostics (squiggles) + status-bar database pinning
    registerDiagnostics(context);
    connectionStatus = new ConnectionStatusProvider(context, dtlvBridge);
    context.subscriptions.push(connectionStatus);

    // Notebook support (.dtlvnb)
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer('levin-notebook', new LevinNotebookSerializer())
    );
    context.subscriptions.push(new LevinNotebookController(dtlvBridge, outputChannel));

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

        outputChannel.appendLine('Levin extension activated successfully');
        console.log('Levin extension activated successfully');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Levin extension activation FAILED: ${errorMessage}`);
        if (error instanceof Error && error.stack) {
            outputChannel.appendLine(error.stack);
        }
        outputChannel.show();
        vscode.window.showErrorMessage(`Levin extension failed to activate: ${errorMessage}`);
        throw error;
    }
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

    // Create Database command - opens the wizard panel
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.createDatabase', async () => {
            // First check if dtlv is installed
            const dtlvInstalled = await dtlvBridge.checkDtlvInstalled();
            if (!dtlvInstalled) {
                await dtlvBridge.promptInstallDtlv();
                return;
            }

            if (!createDatabasePanel) {
                createDatabasePanel = new CreateDatabasePanel(context, dtlvBridge, (dbPath: string) => {
                    openDatabase(context, dbPath);
                });
            }
            createDatabasePanel.show();
        })
    );

    // Vector Search command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.vectorSearch', async (item?: DatabaseTreeItem) => {
            const dbPath = item?.dbPath || await selectDatabase();
            if (!dbPath) { return; }

            if (!vectorSearchPanel) {
                vectorSearchPanel = new VectorSearchPanel(context, dtlvBridge);
            }
            vectorSearchPanel.show(dbPath);
        })
    );

    // Try Sample Playground command - builds the Mini-Northwind sample DB
    // and drops numbered playground query files next to it
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.trySampleDatabase', async () => {
            if (!await ensureDtlv()) { return; }
            await trySampleDatabase(context);
        })
    );

    // Pin a database to the active query file (status bar click)
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.pinDatabase', async () => {
            await connectionStatus?.pinDatabase();
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
            await runCurrentQuery();
        })
    );

    // Run All Queries command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.runAllQueries', async () => {
            await runAllQueries();
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
        vscode.commands.registerCommand('levin.runQueryAtLine', async (line: number) => {
            await runQueryAtLine(context, line);
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
        vscode.commands.registerCommand('levin.saveQuery', async (line?: number) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'datalevin-query') {
                // When invoked from a CodeLens, save just that statement;
                // otherwise save the whole document
                let queryText = editor.document.getText();
                if (line !== undefined) {
                    const statements = parseStatements(queryText);
                    const stmt = statementAtLine(statements.filter(s => s.kind !== 'other'), line);
                    if (stmt) {
                        queryText = stmt.text;
                    }
                }
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
        vscode.commands.registerCommand('levin.copyQueryAsClojure', async (line?: number) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const text = editor.document.getText();
            const statements = parseStatements(text);
            const stmt = line !== undefined
                ? statementAtLine(statements, line)
                : statements.find(s => isRunnable(s)) ?? null;

            // Parse the statement to extract components
            const dbPath = (stmt && resolveDbPath(statements, stmt)) || '/path/to/database';
            const queryPortion = stmt?.queryText || '[:find ?e :where [?e :db/id _]]';

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

    // Convert JSON to EDN: replace the selection, or clipboard -> clipboard
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.jsonToEdn', async () => {
            const editor = vscode.window.activeTextEditor;
            const selection = editor?.selection;
            const hasSelection = !!editor && !!selection && !selection.isEmpty;

            const input = hasSelection
                ? editor!.document.getText(selection!)
                : await vscode.env.clipboard.readText();

            if (!input || input.trim().length === 0) {
                vscode.window.showWarningMessage('Select some JSON, or copy JSON to the clipboard first');
                return;
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(input);
            } catch (error) {
                vscode.window.showErrorMessage(`Not valid JSON: ${error instanceof Error ? error.message : error}`);
                return;
            }

            const edn = jsonToEdn(parsed);

            if (hasSelection) {
                await editor!.edit(editBuilder => editBuilder.replace(selection!, edn));
            } else {
                await vscode.env.clipboard.writeText(edn);
                vscode.window.showInformationMessage('EDN copied to clipboard');
            }
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
                    filters: { 'Data Files (EDN, JSON)': ['edn', 'json'], 'All Files': ['*'] },
                    title: 'Select EDN or JSON file to import'
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
                    prompt: 'Enter URL to an EDN or JSON file',
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
                let content = ednContent!.trim();

                // JSON imports are converted to EDN first
                if (looksLikeJson(content)) {
                    try {
                        content = jsonToEdn(JSON.parse(content), { format: false });
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `Failed to convert JSON: ${error instanceof Error ? error.message : error}`
                        );
                        return;
                    }
                }

                let result;

                // If it starts with { and contains :db/valueType, it's likely Datomic schema format
                if (content.startsWith('{') && content.includes(':db/valueType')) {
                    // Convert and transact Datomic schema in one step
                    result = await dtlvBridge.transactDatomicSchema(dbPath, content);
                }
                // If it's a vector with :db/id and negative numbers, it's data with temp IDs
                else if (content.startsWith('[') && content.includes(':db/id') && /:db\/id\s+-\d/.test(content)) {
                    // Use special import method that reopens connection with schema
                    result = await dtlvBridge.importWithTempIds(dbPath, content);
                }
                // Otherwise, normal transact
                else {
                    result = await dtlvBridge.transact(dbPath, content);
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

    // NLQ: Generate Query command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.nlqGenerate', async (line: number) => {
            await nlqGenerateQuery(context, line, false);
        })
    );

    // NLQ: Generate and Run command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.nlqGenerateAndRun', async (line: number) => {
            await nlqGenerateQuery(context, line, true);
        })
    );

    // NLQ: Regenerate command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.nlqRegenerate', async (line: number) => {
            await nlqGenerateQuery(context, line, false);
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

/**
 * Build the Mini-Northwind sample playground: seeded database + numbered
 * .dtlv.edn tutorial files, then open the first one.
 */
async function trySampleDatabase(context: vscode.ExtensionContext): Promise<void> {
    // 1. Where should the playground live?
    interface LocationPick extends vscode.QuickPickItem { fsPath?: string }
    const workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
    const defaultDir = path.join(os.homedir(), 'levin-playground');
    const picks: LocationPick[] = [
        ...workspaceFolders.map(f => ({
            label: `$(folder) ${path.basename(f)}`,
            description: 'workspace folder',
            fsPath: f
        })),
        { label: '$(home) ~/levin-playground', description: defaultDir, fsPath: defaultDir },
        { label: '$(folder-opened) Browse…', description: 'choose a folder' }
    ];
    const picked = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Where should the sample playground live?'
    });
    if (!picked) { return; }

    let root = picked.fsPath;
    if (!root) {
        const chosen = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Choose playground folder'
        });
        if (!chosen || chosen.length === 0) { return; }
        root = chosen[0].fsPath;
    }

    const dbPath = path.join(root, SAMPLE_DB_DIRNAME);
    const dbUri = vscode.Uri.file(dbPath);

    // 2. Existing sample database?
    let exists = false;
    try {
        await vscode.workspace.fs.stat(dbUri);
        exists = true;
    } catch {
        exists = false;
    }

    let shouldBuild = true;
    if (exists) {
        const choice = await vscode.window.showQuickPick(
            [
                { label: 'Open existing', description: 'keep the current sample data', build: false },
                { label: 'Recreate', description: 'delete and rebuild the sample database', build: true }
            ],
            { placeHolder: `A sample database already exists at ${dbPath}` }
        );
        if (!choice) { return; }
        shouldBuild = choice.build;
        if (shouldBuild) {
            await vscode.workspace.fs.delete(dbUri, { recursive: true });
        }
    }

    // 3. Build database + write playground files
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Building sample playground…',
            cancellable: false
        }, async progress => {
            if (shouldBuild) {
                progress.report({ message: 'creating database and seeding data' });
                await buildSampleDatabase(dtlvBridge, dbPath);
            }
            progress.report({ message: 'writing playground files' });
            for (const file of playgroundFiles(dbPath)) {
                const target = vscode.Uri.file(path.join(root, file.name));
                await vscode.workspace.fs.writeFile(target, Buffer.from(file.content, 'utf8'));
            }
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Could not build sample playground: ${formatQueryError(message).summary}`);
        outputChannel.appendLine(`Sample playground build failed: ${message}`);
        return;
    }

    // 4. Register, open first file, celebrate
    openDatabase(context, dbPath);
    connectionStatus?.refresh();

    const doc = await vscode.workspace.openTextDocument(path.join(root, '01-basics.dtlv.edn'));
    await vscode.window.showTextDocument(doc);

    const action = await vscode.window.showInformationMessage(
        'Sample playground ready! Put the cursor in a query and press Ctrl+Enter to run it.',
        'Open Playground Folder'
    );
    if (action === 'Open Playground Folder') {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), { forceNewWindow: false });
    }
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

async function runCurrentQuery(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }
    if (!await ensureDtlv()) { return; }

    const statements = parseStatements(editor.document.getText());
    const stmt = statementAtLine(statements.filter(isRunnable), editor.selection.active.line);
    if (!stmt) {
        vscode.window.showWarningMessage('No query statement found in this file');
        return;
    }
    await executeStatement(stmt, statements);
}

async function runAllQueries(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }
    if (!await ensureDtlv()) { return; }

    const statements = parseStatements(editor.document.getText());
    const runnable = statements.filter(isRunnable);
    if (runnable.length === 0) {
        vscode.window.showWarningMessage('No runnable queries found in this file');
        return;
    }

    for (let i = 0; i < runnable.length; i++) {
        outputChannel.appendLine(`Run All: executing statement ${i + 1}/${runnable.length}`);
        const success = await executeStatement(runnable[i], statements);
        if (!success) {
            vscode.window.showErrorMessage(`Run All stopped: statement ${i + 1} of ${runnable.length} failed`);
            return;
        }
    }
    vscode.window.showInformationMessage(`Ran ${runnable.length} statement${runnable.length === 1 ? '' : 's'} successfully`);
}

async function runQueryAtLine(context: vscode.ExtensionContext, line: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }
    if (!await ensureDtlv()) { return; }

    const statements = parseStatements(editor.document.getText());
    const stmt = statementAtLine(statements.filter(isRunnable), line);
    if (!stmt) {
        vscode.window.showWarningMessage('No query block found at this location');
        return;
    }
    await executeStatement(stmt, statements);
}

/**
 * Check that dtlv is installed, prompting for install otherwise
 */
async function ensureDtlv(): Promise<boolean> {
    const dtlvInstalled = await dtlvBridge.checkDtlvInstalled();
    if (!dtlvInstalled) {
        await dtlvBridge.promptInstallDtlv();
    }
    return dtlvInstalled;
}

/**
 * Execute a single parsed statement. Returns true on success.
 */
async function executeStatement(stmt: QueryStatement, statements: QueryStatement[]): Promise<boolean> {
    try {
        const pin = vscode.window.activeTextEditor
            ? connectionStatus?.getPinned(vscode.window.activeTextEditor.document.uri)
            : undefined;
        let dbPath = resolveDbPath(statements, stmt, pin);

        if (!dbPath) {
            // No :db anywhere - ask the user (e.g. for bare queries)
            dbPath = (await selectDatabase()) ?? null;
            if (!dbPath) {
                vscode.window.showErrorMessage('Must specify :db with database path');
                return false;
            }
        }

        if (stmt.transactText) {
            return await executeTransaction(dbPath, stmt.transactText);
        }
        if (stmt.solveText) {
            return await executeSolve(dbPath, stmt);
        }
        if (stmt.queryText) {
            return await executeDatalogQuery(dbPath, stmt.queryText, stmt.limit ?? 50, stmt.text, {
                rules: stmt.rulesText ? parseRulesSpec(stmt.rulesText) : undefined,
                args: stmt.argsText ? splitEdnVector(stmt.argsText) : undefined
            });
        }

        vscode.window.showErrorMessage('Must specify either :query, :transact, or :solve');
        return false;
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to execute: ${error}`);
        return false;
    }
}

/**
 * Execute raw query text (saved queries, NLQ blocks): parse and run the
 * first runnable statement in it.
 */
async function executeQuery(context: vscode.ExtensionContext, queryText: string): Promise<void> {
    if (!await ensureDtlv()) { return; }

    const statements = parseStatements(queryText);
    const stmt = statements.find(isRunnable);
    if (!stmt) {
        vscode.window.showErrorMessage('Must specify either :query or :transact');
        return;
    }
    await executeStatement(stmt, statements);
}

async function executeTransaction(dbPath: string, txData: string): Promise<boolean> {
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Executing transaction...',
        cancellable: false
    }, async () => {
        const result = await dtlvBridge.transact(dbPath, txData);
        outputChannel.appendLine(`Transaction executed. Success: ${result.success}`);

        if (result.success) {
            const data = result.data as { txId?: number; datomsCount?: number };
            vscode.window.showInformationMessage(
                `Transaction successful! TX ID: ${data.txId}, ${data.datomsCount} datoms added.`
            );
            // Refresh the explorer to show new data
            vscode.commands.executeCommand('levin.refreshExplorer');
            return true;
        } else {
            // Show the error inline in the results panel
            if (!resultsPanel) {
                resultsPanel = new ResultsPanel(dtlvBridge);
            }
            resultsPanel.showError(result.error || 'Unknown error', dbPath, txData);
            vscode.window.showErrorMessage(`Transaction failed: ${formatQueryError(result.error || '').summary}`);
            return false;
        }
    });
}

async function executeSolve(dbPath: string, stmt: QueryStatement): Promise<boolean> {
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Solving...',
        cancellable: false
    }, async () => {
        const result = await dtlvBridge.solve(dbPath, {
            solveText: stmt.solveText!,
            pickText: stmt.pickText,
            suchThatText: stmt.suchThatText,
            maximizeText: stmt.maximizeText,
            minimizeText: stmt.minimizeText,
            limit: stmt.limit
        });

        if (!resultsPanel) {
            resultsPanel = new ResultsPanel(dtlvBridge);
        }

        if (result.success) {
            queryHistoryProvider.addQuery(stmt.text);
            const data = result.data as { findVars?: string[] };
            const syntheticQuery = `[:find ?solution ${(data?.findVars ?? []).join(' ')} :where]`;
            resultsPanel.show(result.data, dbPath, syntheticQuery);
            return true;
        }

        resultsPanel.showError(result.error || 'Unknown error', dbPath, stmt.text);
        vscode.window.showErrorMessage(`Solve failed: ${formatQueryError(result.error || '').summary}`);
        return false;
    });
}

async function executeDatalogQuery(
    dbPath: string,
    queryPortion: string,
    limit: number,
    historyText?: string,
    inputs?: { rules?: string[] | 'all'; args?: string[] }
): Promise<boolean> {
    // Show progress
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Running query...',
        cancellable: false
    }, async () => {
        const result = await dtlvBridge.runQuery(dbPath, queryPortion, limit, inputs);
        outputChannel.appendLine(`Query executed. Success: ${result.success}, Results: ${(result.data as {results?: unknown[]})?.results?.length ?? 0}`);

        if (result.success) {
            // Add to history (full statement text, so it can be re-run with its :db)
            queryHistoryProvider.addQuery(historyText ?? queryPortion);

            // Show results panel
            if (!resultsPanel) {
                resultsPanel = new ResultsPanel(dtlvBridge);
            }
            outputChannel.appendLine(`Showing results with query: ${queryPortion.substring(0, 100)}...`);
            resultsPanel.show(result.data, dbPath, queryPortion);
            return true;
        } else {
            // Show the error inline in the results panel, query called out
            if (!resultsPanel) {
                resultsPanel = new ResultsPanel(dtlvBridge);
            }
            resultsPanel.showError(result.error || 'Unknown error', dbPath, queryPortion);

            // Also show a brief notification
            vscode.window.showErrorMessage(`Query failed: ${formatQueryError(result.error || '').summary}`);
            return false;
        }
    });
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

/**
 * Generate a Datalevin query from natural language using the NLQ model
 */
async function nlqGenerateQuery(
    context: vscode.ExtensionContext,
    line: number,
    runAfterGenerate: boolean
): Promise<void> {
    outputChannel.appendLine(`[NLQ] nlqGenerateQuery called with line=${line}, runAfterGenerate=${runAfterGenerate}`);

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        outputChannel.appendLine('[NLQ] No active editor');
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    outputChannel.appendLine(`[NLQ] Active editor: ${editor.document.uri.fsPath}`);

    // Model will be downloaded on first use if not available
    // The loadModel function in model-runner handles the download prompt

    // Extract the NLQ block at the given line
    const document = editor.document;
    const text = document.getText();
    outputChannel.appendLine(`[NLQ] Document text length: ${text.length}`);

    // Find the NLQ block containing this line
    const nlqBlock = extractNlqBlockAtLine(document, line);
    if (!nlqBlock) {
        outputChannel.appendLine(`[NLQ] No NLQ block found at line ${line}`);
        vscode.window.showWarningMessage('No NLQ block found at this location');
        return;
    }

    outputChannel.appendLine(`[NLQ] Found block: ${nlqBlock.text.substring(0, 100)}...`);

    // Parse the block to get nlq, notes, and db
    const parsed = nlq.parseNlqBlock(nlqBlock.text);
    outputChannel.appendLine(`[NLQ] Parsed result: ${JSON.stringify(parsed)}`);
    if (!parsed || !parsed.nlq) {
        outputChannel.appendLine('[NLQ] Could not parse NLQ block');
        vscode.window.showWarningMessage('Could not parse NLQ block');
        return;
    }

    // Get the database path from the block or ask user
    const dbMatch = nlqBlock.text.match(/:db\s+"([^"]+)"/);
    let dbPath = dbMatch?.[1];
    outputChannel.appendLine(`[NLQ] Database path from block: ${dbPath}`);

    if (!dbPath) {
        // Try to get from currently selected database or ask user
        dbPath = await selectDatabase();
        outputChannel.appendLine(`[NLQ] Database path from selection: ${dbPath}`);
        if (!dbPath) {
            vscode.window.showErrorMessage('Please specify a database with :db "path"');
            return;
        }
    }

    // Build the prompt with schema and rules context
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Generating Datalevin query...',
        cancellable: false
    }, async () => {
        try {
            outputChannel.appendLine('[NLQ] Getting schema context...');
            // Get schema context
            const schemaContext = await nlq.getSchemaContext(dtlvBridge, dbPath!);
            outputChannel.appendLine(`[NLQ] Schema context length: ${schemaContext?.length || 0}`);

            outputChannel.appendLine('[NLQ] Getting rules context...');
            // Get rules context
            const rulesContext = await nlq.getRulesContext(dtlvBridge, dbPath!);
            outputChannel.appendLine(`[NLQ] Rules context length: ${rulesContext?.length || 0}`);

            // Build the prompt
            const prompt = nlq.buildPrompt(parsed.nlq!, {
                schema: schemaContext,
                rules: rulesContext,
                notes: parsed.notes
            });

            outputChannel.appendLine(`[NLQ] Built prompt (${prompt.length} chars):\n${prompt}`);

            // Generate the query
            outputChannel.appendLine('[NLQ] Calling nlq.generateQuery...');
            const generatedQuery = await nlq.generateQuery(context, prompt);

            outputChannel.appendLine(`[NLQ] Generated Query: ${generatedQuery}`);

            // Update the document with the generated query
            const newBlockText = nlq.formatNlqBlock(
                parsed.nlq!,
                generatedQuery,
                parsed.notes
            );

            // Add :db back if it was in the original
            let finalBlock = newBlockText;
            if (dbMatch) {
                // Insert :db after the opening brace
                finalBlock = finalBlock.replace('{', `{:db "${dbPath}"\n `);
            }

            // Replace the old block with the new one
            const startPos = document.positionAt(nlqBlock.start);
            const endPos = document.positionAt(nlqBlock.end);
            const range = new vscode.Range(startPos, endPos);

            await editor.edit(editBuilder => {
                editBuilder.replace(range, finalBlock);
            });

            // Run the query if requested
            if (runAfterGenerate) {
                // Give the document a moment to update
                await new Promise(resolve => setTimeout(resolve, 100));

                // Execute the query
                const updatedBlock = extractNlqBlockAtLine(editor.document, line);
                if (updatedBlock) {
                    await executeQuery(context, updatedBlock.text);
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine(`NLQ Error: ${message}`);
            vscode.window.showErrorMessage(`Failed to generate query: ${message}`);
        }
    });
}

/**
 * Extract an NLQ block (map with :nlq key) at or containing the given line
 */
function extractNlqBlockAtLine(
    document: vscode.TextDocument,
    line: number
): { text: string; start: number; end: number } | null {
    const statements = parseStatements(document.getText()).filter(s => s.kind === 'nlq');

    const containing = statements.find(s => line >= s.startLine && line <= s.endLine);
    const stmt = containing ?? statements.find(s => s.startLine >= line) ?? null;

    return stmt ? { text: stmt.text, start: stmt.start, end: stmt.end } : null;
}

export function deactivate(): void {
    console.log('Levin extension deactivated');
    dtlvBridge?.dispose();
    nlq.disposeModel();
}
