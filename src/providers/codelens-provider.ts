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

        // Look for NLQ blocks (maps with :nlq key)
        // Use a simpler approach: find all :nlq occurrences and trace back to the opening brace
        const nlqMatches: number[] = [];
        let nlqSearchIdx = 0;
        while ((nlqSearchIdx = text.indexOf(':nlq ', nlqSearchIdx)) !== -1) {
            // Trace back to find the opening brace of this map
            let braceDepth = 0;
            let blockStart = nlqSearchIdx;
            for (let i = nlqSearchIdx; i >= 0; i--) {
                if (text[i] === '}') braceDepth++;
                else if (text[i] === '{') {
                    if (braceDepth === 0) {
                        blockStart = i;
                        break;
                    }
                    braceDepth--;
                }
            }
            nlqMatches.push(blockStart);
            nlqSearchIdx++;
        }

        for (const blockStart of nlqMatches) {
            const startPos = document.positionAt(blockStart);
            const range = new vscode.Range(startPos, startPos);

            // Find the end of this block to check if :query exists
            let depth = 0;
            let blockEnd = blockStart;
            for (let i = blockStart; i < text.length; i++) {
                if (text[i] === '{') depth++;
                else if (text[i] === '}') depth--;
                if (depth === 0) {
                    blockEnd = i;
                    break;
                }
            }
            const blockText = text.substring(blockStart, blockEnd + 1);
            const hasQuery = blockText.includes(':query');

            if (!hasQuery) {
                // No query yet - show Generate options
                lenses.push(new vscode.CodeLens(range, {
                    title: '$(sparkle) Generate Query',
                    command: 'levin.nlqGenerate',
                    arguments: [startPos.line]
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(play) Generate & Run',
                    command: 'levin.nlqGenerateAndRun',
                    arguments: [startPos.line]
                }));
            } else {
                // Has query - show Run, Regenerate, Save, Copy as Clojure
                lenses.push(new vscode.CodeLens(range, {
                    title: '$(play) Run Query',
                    command: 'levin.runQueryAtLine',
                    arguments: [startPos.line]
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(sparkle) Regenerate',
                    command: 'levin.nlqRegenerate',
                    arguments: [startPos.line]
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(star) Save',
                    command: 'levin.saveQuery',
                    arguments: [startPos.line]
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(clippy) Copy as Clojure',
                    command: 'levin.copyQueryAsClojure',
                    arguments: [startPos.line]
                }));
            }
        }

        // Look for query definitions (maps with :query key but NOT :nlq - those are handled above)
        const queryPattern = /\{[^{}]*:query\s*\[/g;
        let match;

        while ((match = queryPattern.exec(text)) !== null) {
            // Skip if this block is already handled as an NLQ block
            if (nlqMatches.includes(match.index)) {
                continue;
            }
            // Also check if this position is inside an NLQ block
            const matchText = text.substring(match.index);
            const blockEndSearch = matchText.indexOf('}');
            const blockText = blockEndSearch > 0 ? text.substring(match.index, match.index + blockEndSearch + 1) : matchText;

            // Find the full block to check for :nlq
            let depth = 0;
            let blockStart = match.index;
            let blockEnd = match.index;
            for (let i = match.index; i < text.length; i++) {
                if (text[i] === '{') depth++;
                else if (text[i] === '}') depth--;
                if (depth === 0) {
                    blockEnd = i;
                    break;
                }
            }
            const fullBlock = text.substring(blockStart, blockEnd + 1);
            if (fullBlock.includes(':nlq')) {
                continue;  // Skip - already handled by NLQ section
            }

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

        // Look for transaction definitions (maps with :transact key)
        const transactPattern = /\{[^{}]*:transact\s*\[/g;

        while ((match = transactPattern.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const range = new vscode.Range(startPos, startPos);

            // Run Transaction lens
            const runLens = new vscode.CodeLens(range, {
                title: '$(database) Run Transaction',
                command: 'levin.runQueryAtLine',
                arguments: [startPos.line]
            });
            lenses.push(runLens);
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
