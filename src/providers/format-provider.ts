import * as vscode from 'vscode';
import { formatEdn } from '../utils/edn-format';

/**
 * Document formatter for .dtlv.edn files, powered by the structural
 * scanner-based pretty-printer in utils/edn-format.
 */
export class DatalevinQueryFormattingProvider implements vscode.DocumentFormattingEditProvider {

    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        _token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        const text = document.getText();

        try {
            const formatted = formatEdn(text);
            if (formatted === text) {
                return [];
            }

            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(text.length)
            );

            return [vscode.TextEdit.replace(fullRange, formatted)];
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to format: ${error}`);
            return [];
        }
    }
}
