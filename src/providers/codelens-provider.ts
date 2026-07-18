import * as vscode from 'vscode';
import { parseStatements, isRunnable } from '../utils/query-statements';

export class QueryCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const statements = parseStatements(document.getText());
        let runnableCount = 0;

        for (const stmt of statements) {
            const startPos = document.positionAt(stmt.start);
            const range = new vscode.Range(startPos, startPos);
            const line = startPos.line;

            if (stmt.kind === 'nlq') {
                if (!isRunnable(stmt)) {
                    // No query yet - show Generate options
                    lenses.push(new vscode.CodeLens(range, {
                        title: '$(sparkle) Generate Query',
                        command: 'levin.nlqGenerate',
                        arguments: [line]
                    }));

                    lenses.push(new vscode.CodeLens(range, {
                        title: '$(play) Generate & Run',
                        command: 'levin.nlqGenerateAndRun',
                        arguments: [line]
                    }));
                } else {
                    // Has query - show Run, Regenerate, Save, Copy as Clojure
                    lenses.push(new vscode.CodeLens(range, {
                        title: '$(play) Run Query',
                        command: 'levin.runQueryAtLine',
                        arguments: [line]
                    }));

                    lenses.push(new vscode.CodeLens(range, {
                        title: '$(sparkle) Regenerate',
                        command: 'levin.nlqRegenerate',
                        arguments: [line]
                    }));

                    lenses.push(new vscode.CodeLens(range, {
                        title: '$(star) Save',
                        command: 'levin.saveQuery',
                        arguments: [line]
                    }));

                    lenses.push(new vscode.CodeLens(range, {
                        title: '$(clippy) Copy as Clojure',
                        command: 'levin.copyQueryAsClojure',
                        arguments: [line]
                    }));

                    runnableCount++;
                }
            } else if (stmt.kind === 'query' || stmt.kind === 'bare-query') {
                lenses.push(new vscode.CodeLens(range, {
                    title: '$(play) Run Query',
                    command: 'levin.runQueryAtLine',
                    arguments: [line]
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(clippy) Copy as Clojure',
                    command: 'levin.copyQueryAsClojure',
                    arguments: [line]
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(star) Save',
                    command: 'levin.saveQuery',
                    arguments: [line]
                }));

                runnableCount++;
            } else if (stmt.kind === 'transact') {
                lenses.push(new vscode.CodeLens(range, {
                    title: '$(database) Run Transaction',
                    command: 'levin.runQueryAtLine',
                    arguments: [line]
                }));

                runnableCount++;
            }
        }

        // Multiple runnable statements - offer Run All at the top of the file
        if (runnableCount > 1) {
            lenses.unshift(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                title: '$(run-all) Run All Queries',
                command: 'levin.runAllQueries',
                arguments: []
            }));
        }

        return lenses;
    }

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }
}
