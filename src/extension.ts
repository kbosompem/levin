import * as vscode from 'vscode';
import { CalvaBridge } from './calva-bridge';
import { EnvParser } from './config/env-parser';
import { Settings } from './config/settings';
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

let calvaBridge: CalvaBridge;
let databaseTreeProvider: DatabaseTreeProvider;
let queryHistoryProvider: QueryHistoryProvider;
let savedQueriesProvider: SavedQueriesProvider;
let resultsPanel: ResultsPanel | undefined;
let entityInspector: EntityInspector | undefined;
let schemaEditor: SchemaEditor | undefined;
let transactionPanel: TransactionPanel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Levin extension is activating...');

    // Initialize Calva bridge
    calvaBridge = new CalvaBridge();
    const calvaInitialized = await calvaBridge.initialize();

    if (!calvaInitialized) {
        vscode.window.showErrorMessage(
            'Levin requires Calva extension. Please install Calva first.',
            'Install Calva'
        ).then(selection => {
            if (selection === 'Install Calva') {
                vscode.commands.executeCommand(
                    'workbench.extensions.installExtension',
                    'betterthantomorrow.calva'
                );
            }
        });
        return;
    }

    // Initialize tree providers
    databaseTreeProvider = new DatabaseTreeProvider(calvaBridge);
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
            new QueryCompletionProvider(calvaBridge),
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
            new QueryHoverProvider(calvaBridge)
        )
    );

    // Register commands
    registerCommands(context);

    // Check for .env file and prompt jack-in
    await checkForDatabases(context);

    console.log('Levin extension activated successfully');
}

function registerCommands(context: vscode.ExtensionContext): void {
    // Jack In command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.jackIn', async () => {
            await handleJackIn();
        })
    );

    // New Query command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.newQuery', async (item?: DatabaseTreeItem) => {
            const dbName = item?.dbName || await selectDatabase();
            if (dbName) {
                await createNewQuery(dbName);
            }
        })
    );

    // Run Query command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.runQuery', async () => {
            await runCurrentQuery();
        })
    );

    // Show Entity command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.showEntity', async (dbName?: string, entityId?: number) => {
            if (!dbName || entityId === undefined) {
                const input = await vscode.window.showInputBox({
                    prompt: 'Enter entity ID',
                    placeHolder: '42'
                });
                if (!input) { return; }
                entityId = parseInt(input, 10);
                dbName = await selectDatabase();
            }
            if (dbName && entityId !== undefined) {
                await showEntityInspector(context, dbName, entityId);
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

    // Disconnect Database command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.disconnect', async (item?: DatabaseTreeItem) => {
            const dbName = item?.dbName || await selectDatabase();
            if (dbName) {
                await calvaBridge.evaluate(`(datalevin-ext.core/disconnect-db! "${dbName}")`);
                databaseTreeProvider.refresh();
                vscode.window.showInformationMessage(`Disconnected from ${dbName}`);
            }
        })
    );

    // Add Database command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.addDatabase', async () => {
            const path = await vscode.window.showInputBox({
                prompt: 'Enter database path',
                placeHolder: '/path/to/database'
            });
            if (path) {
                const name = await vscode.window.showInputBox({
                    prompt: 'Enter database name',
                    placeHolder: 'my-database'
                });
                if (name) {
                    await calvaBridge.evaluate(
                        `(datalevin-ext.core/connect-db! "${name}" "${path}")`
                    );
                    databaseTreeProvider.refresh();
                    vscode.window.showInformationMessage(`Connected to ${name}`);
                }
            }
        })
    );

    // Create Database command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.createDatabase', async () => {
            const path = await vscode.window.showInputBox({
                prompt: 'Enter path for new database',
                placeHolder: '/path/to/new-database'
            });
            if (path) {
                const name = await vscode.window.showInputBox({
                    prompt: 'Enter database name',
                    placeHolder: 'new-database'
                });
                if (name) {
                    await calvaBridge.evaluate(
                        `(datalevin-ext.core/connect-db! "${name}" "${path}" :create? true)`
                    );
                    databaseTreeProvider.refresh();
                    vscode.window.showInformationMessage(`Created database ${name}`);
                }
            }
        })
    );

    // Internal command for running query from CodeLens
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.runQueryAtLine', async (line: number) => {
            await runQueryAtLine(line);
        })
    );

    // Edit Schema command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.editSchema', async (item?: DatabaseTreeItem) => {
            const dbName = item?.dbName || await selectDatabase();
            if (dbName) {
                await showSchemaEditor(context, dbName);
            }
        })
    );

    // Show Transaction Panel command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.showTransactionPanel', async (item?: DatabaseTreeItem) => {
            const dbName = item?.dbName || await selectDatabase();
            if (dbName) {
                await showTransactionPanel(context, dbName);
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
            await executeQuery(queryText);
        })
    );

    // Delete Saved Query command
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.deleteSavedQuery', async (name: string) => {
            await savedQueriesProvider.removeQuery(name);
        })
    );
}

async function checkForDatabases(_context: vscode.ExtensionContext): Promise<void> {
    const settings = new Settings();

    if (!settings.autoJackIn) {
        return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    for (const folder of workspaceFolders) {
        const envPath = vscode.Uri.joinPath(folder.uri, settings.envFile);
        try {
            const envContent = await vscode.workspace.fs.readFile(envPath);
            const envText = Buffer.from(envContent).toString('utf8');
            const parser = new EnvParser(envText);
            const dbPaths = parser.getDatabasePaths();

            if (dbPaths.length > 0) {
                const response = await vscode.window.showInformationMessage(
                    `Found ${dbPaths.length} Datalevin database(s) in .env. Jack in?`,
                    'Yes',
                    'No'
                );

                if (response === 'Yes') {
                    await handleJackIn();
                }
                break;
            }
        } catch {
            // .env file not found, continue
        }
    }
}

async function handleJackIn(): Promise<void> {
    const settings = new Settings();

    // Check if already connected
    const isConnected = await calvaBridge.isConnected();

    if (!isConnected) {
        // Trigger Calva jack-in with datalevin dependency
        vscode.window.showInformationMessage('Starting Calva jack-in with Datalevin...');
        await calvaBridge.jackIn(settings.datalevinVersion);

        // Wait for REPL to be ready
        await waitForRepl();
    }

    // Inject bootstrap code
    await calvaBridge.injectBootstrap();

    // Connect to databases from .env
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        for (const folder of workspaceFolders) {
            const envPath = vscode.Uri.joinPath(folder.uri, settings.envFile);
            try {
                const envContent = await vscode.workspace.fs.readFile(envPath);
                const envText = Buffer.from(envContent).toString('utf8');
                const parser = new EnvParser(envText);
                const dbPaths = parser.getDatabasePaths();

                for (const dbPath of dbPaths) {
                    const dbName = dbPath.split('/').pop() || dbPath;
                    await calvaBridge.evaluate(
                        `(datalevin-ext.core/connect-db! "${dbName}" "${dbPath}")`
                    );
                }
            } catch {
                // .env file not found, continue
            }
        }
    }

    // Refresh tree view
    databaseTreeProvider.refresh();
    vscode.window.showInformationMessage('Levin: Connected to Datalevin');
}

async function waitForRepl(maxWaitMs: number = 60000): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
        if (await calvaBridge.isConnected()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Timeout waiting for REPL connection');
}

async function selectDatabase(): Promise<string | undefined> {
    const result = await calvaBridge.evaluate('(datalevin-ext.core/list-connections)');
    if (!result.success || !result.value) {
        vscode.window.showErrorMessage('No databases connected. Jack in first.');
        return undefined;
    }

    const connections = result.value as Array<{ name: string; path: string }>;
    if (connections.length === 0) {
        vscode.window.showErrorMessage('No databases connected. Jack in first.');
        return undefined;
    }

    if (connections.length === 1) {
        return connections[0].name;
    }

    const items = connections.map(c => ({
        label: c.name,
        description: c.path
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a database'
    });

    return selected?.label;
}

async function createNewQuery(dbName: string): Promise<void> {
    const content = `{:db "${dbName}"
 :query [:find ?e
         :where
         [?e :db/id _]]
 :args []
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

    const queryText = editor.document.getText();
    await executeQuery(queryText);
}

async function runQueryAtLine(_line: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    // For now, run the entire document as a query
    const queryText = editor.document.getText();
    await executeQuery(queryText);
}

async function executeQuery(queryText: string): Promise<void> {
    try {
        // Parse the query to extract components
        const queryMatch = queryText.match(/:db\s+"([^"]+)"/);
        const dbName = queryMatch?.[1];

        if (!dbName) {
            vscode.window.showErrorMessage('Query must specify :db');
            return;
        }

        // Extract the query portion
        const queryPortionMatch = queryText.match(/:query\s+(\[[\s\S]*?\])(?=\s*:|\s*\})/);
        const queryPortion = queryPortionMatch?.[1] || '[:find ?e :where [?e :db/id _]]';

        // Extract limit
        const limitMatch = queryText.match(/:limit\s+(\d+)/);
        const limit = limitMatch ? parseInt(limitMatch[1], 10) : 50;

        // Execute query via REPL
        const escapedQuery = queryPortion.replace(/"/g, '\\"');
        const result = await calvaBridge.evaluate(
            `(datalevin-ext.core/run-query "${dbName}" "${escapedQuery}" :limit ${limit})`
        );

        if (result.success) {
            // Add to history
            queryHistoryProvider.addQuery(queryText);

            // Show results panel
            if (!resultsPanel) {
                resultsPanel = new ResultsPanel(calvaBridge);
            }
            resultsPanel.show(result.value, dbName);
        } else {
            vscode.window.showErrorMessage(`Query error: ${result.error}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to execute query: ${error}`);
    }
}

async function showEntityInspector(
    context: vscode.ExtensionContext,
    dbName: string,
    entityId: number
): Promise<void> {
    if (!entityInspector) {
        entityInspector = new EntityInspector(context, calvaBridge);
    }
    await entityInspector.show(dbName, entityId);
}

async function showSchemaEditor(
    context: vscode.ExtensionContext,
    dbName: string
): Promise<void> {
    if (!schemaEditor) {
        schemaEditor = new SchemaEditor(context, calvaBridge);
    }
    await schemaEditor.show(dbName);
}

async function showTransactionPanel(
    context: vscode.ExtensionContext,
    dbName: string
): Promise<void> {
    if (!transactionPanel) {
        transactionPanel = new TransactionPanel(context, calvaBridge);
    }
    await transactionPanel.show(dbName);
}

export function deactivate(): void {
    console.log('Levin extension deactivated');
}
