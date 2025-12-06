import * as vscode from 'vscode';
import * as edn from 'jsedn';

export class DatalevinQueryFormattingProvider implements vscode.DocumentFormattingEditProvider {

    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        _token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        try {
            const text = document.getText();
            const formatted = this.formatEdn(text);

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

    private formatEdn(text: string): string {
        try {
            // Parse EDN
            const parsed = edn.parse(text);

            // Convert back to string with formatting
            const formatted = this.stringify(parsed, 0);

            return formatted;
        } catch (error) {
            // If parsing fails, return original
            console.error('EDN parse error:', error);
            throw error;
        }
    }

    private stringify(value: any, depth: number): string {
        const indent = '  '.repeat(depth);
        const nextIndent = '  '.repeat(depth + 1);

        if (value === null || value === undefined) {
            return 'nil';
        }

        // Handle jsedn types
        if (value instanceof edn.Symbol) {
            return value.toString();
        }

        if (value instanceof edn.Keyword) {
            return value.toString();
        }

        if (value instanceof edn.Vector) {
            const values = value.val;
            if (values.length === 0) {
                return '[]';
            }

            // Check if this is a query vector (starts with :find, :where, etc.)
            const isQueryClause = values.length > 0 &&
                values[0] instanceof edn.Keyword &&
                [':find', ':where', ':in', ':keys'].includes(values[0].toString());

            if (isQueryClause) {
                // Format query clauses with items on separate lines
                const items = values.map((v: any) => nextIndent + this.stringify(v, depth + 1));
                return '[\n' + items.join('\n') + '\n' + indent + ']';
            } else {
                // Inline format for small vectors
                const items = values.map((v: any) => this.stringify(v, depth));
                return '[' + items.join(' ') + ']';
            }
        }

        if (value instanceof edn.List) {
            const values = value.val;
            const items = values.map((v: any) => this.stringify(v, depth));
            return '(' + items.join(' ') + ')';
        }

        if (value instanceof edn.Map) {
            const entries = value.val;
            if (entries.size === 0) {
                return '{}';
            }

            const pairs: string[] = [];
            entries.forEach((v: any, k: any) => {
                const key = this.stringify(k, depth + 1);
                const val = this.stringify(v, depth + 1);
                pairs.push(`${nextIndent}${key} ${val}`);
            });

            return '{\n' + pairs.join('\n') + '\n' + indent + '}';
        }

        if (value instanceof edn.Set) {
            const values = value.val;
            const items = Array.from(values).map((v: any) => this.stringify(v, depth));
            return '#{' + items.join(' ') + '}';
        }

        if (typeof value === 'string') {
            return JSON.stringify(value);
        }

        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }

        // Fallback
        return String(value);
    }
}
