import * as vscode from 'vscode';

export class QueryCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];

        // Find query blocks in the document
        const text = document.getText();

        // Look for query definitions (maps with :query key)
        const queryPattern = /\{[^{}]*:query\s*\[/g;
        let match;

        while ((match = queryPattern.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const range = new vscode.Range(startPos, startPos);

            // Run Query lens
            const runLens = new vscode.CodeLens(range, {
                title: '$(play) Run Query',
                command: 'levin.runQueryAtLine',
                arguments: [startPos.line]
            });
            lenses.push(runLens);

            // Copy as Clojure lens
            const copyLens = new vscode.CodeLens(range, {
                title: '$(clippy) Copy as Clojure',
                command: 'levin.copyQueryAsClojure',
                arguments: [startPos.line]
            });
            lenses.push(copyLens);

            // Save Query lens
            const saveLens = new vscode.CodeLens(range, {
                title: '$(star) Save',
                command: 'levin.saveQuery',
                arguments: [startPos.line]
            });
            lenses.push(saveLens);
        }

        // If no query blocks found, provide lens at top of file
        if (lenses.length === 0 && text.includes(':find')) {
            const range = new vscode.Range(0, 0, 0, 0);

            lenses.push(new vscode.CodeLens(range, {
                title: '$(play) Run Query',
                command: 'levin.runQuery',
                arguments: []
            }));

            lenses.push(new vscode.CodeLens(range, {
                title: '$(star) Save Query',
                command: 'levin.saveQuery',
                arguments: []
            }));
        }

        return lenses;
    }

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }
}
