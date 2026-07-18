/**
 * Status-bar database indicator + per-editor database pinning for
 * .dtlv.edn query files, mirroring how SQL tools pin a connection per
 * editor tab.
 *
 * Resolution order (see resolveDbPath): a statement's own :db wins,
 * then the editor's pin, then the nearest preceding :db in the file.
 */
import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';
import { parseStatements, statementAtLine, resolveDbPath } from '../utils/query-statements';

const PINS_KEY = 'levin.editorPins';
const LANGUAGE_ID = 'datalevin-query';

export class ConnectionStatusProvider implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];
    /** In-memory pins (covers untitled documents); file pins persist to workspaceState */
    private readonly pins: Map<string, string> = new Map();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly bridge: DtlvBridge
    ) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
        this.item.command = 'levin.pinDatabase';
        this.item.name = 'Levin Database';

        const persisted = context.workspaceState.get<Record<string, string>>(PINS_KEY, {});
        for (const [uri, dbPath] of Object.entries(persisted)) {
            this.pins.set(uri, dbPath);
        }

        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
            vscode.window.onDidChangeTextEditorSelection(e => {
                if (e.textEditor === vscode.window.activeTextEditor) {
                    this.refresh();
                }
            }),
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document === vscode.window.activeTextEditor?.document) {
                    this.refresh();
                }
            })
        );

        this.refresh();
        this.item.show();
    }

    /** The database pinned to a document, if any. */
    getPinned(uri: vscode.Uri): string | undefined {
        return this.pins.get(uri.toString());
    }

    /** Prompt to pin a database to the active editor (or clear the pin). */
    async pinDatabase(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== LANGUAGE_ID) {
            vscode.window.showInformationMessage('Open a .dtlv.edn query file to pin a database.');
            return;
        }

        interface PinPick extends vscode.QuickPickItem { dbPath?: string | null }
        const picks: PinPick[] = [
            { label: '$(link) Auto', description: 'inherit :db from the file (default)', dbPath: null },
            ...this.bridge.getOpenDatabases().map(db => ({
                label: `$(database) ${db.name}`,
                description: db.path,
                dbPath: db.path as string | null
            }))
        ];

        const picked = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Database for this query file'
        });
        if (!picked) {
            return;
        }

        const key = editor.document.uri.toString();
        if (picked.dbPath) {
            this.pins.set(key, picked.dbPath);
        } else {
            this.pins.delete(key);
        }
        await this.persist();
        this.refresh();
    }

    /** Forget pins for databases that are no longer open, and refresh. */
    refresh(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== LANGUAGE_ID) {
            this.item.hide();
            return;
        }
        this.item.show();

        const uri = editor.document.uri;
        const pin = this.getPinned(uri);
        const statements = parseStatements(editor.document.getText());
        const stmt = statementAtLine(statements, editor.selection.active.line);
        const resolved = stmt ? resolveDbPath(statements, stmt, pin) : pin ?? null;

        if (resolved) {
            const source = pin
                ? 'pinned to this file'
                : stmt?.db
                    ? 'from :db in this statement'
                    : 'inherited from earlier in the file';
            this.item.text = `$(database) ${displayName(resolved)}`;
            this.item.tooltip = `Levin: ${resolved}\n(${source} - click to pin a different database)`;
        } else {
            this.item.text = '$(database) No database';
            this.item.tooltip = 'Levin: no database resolves here - click to pin one';
        }
    }

    private async persist(): Promise<void> {
        const filePins: Record<string, string> = {};
        for (const [uri, dbPath] of this.pins) {
            if (uri.startsWith('file:')) {
                filePins[uri] = dbPath;
            }
        }
        await this.context.workspaceState.update(PINS_KEY, filePins);
    }

    dispose(): void {
        this.item.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

function displayName(dbPath: string): string {
    const parts = dbPath.split('/').filter(p => p.length > 0);
    return parts[parts.length - 1] ?? dbPath;
}
