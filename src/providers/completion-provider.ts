import * as vscode from 'vscode';
import { CalvaBridge } from '../calva-bridge';

export class QueryCompletionProvider implements vscode.CompletionItemProvider {
    private attributeCache: Map<string, string[]> = new Map();
    private lastCacheUpdate: number = 0;
    private cacheMaxAge: number = 30000; // 30 seconds

    constructor(private calvaBridge: CalvaBridge) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];

        const linePrefix = document.lineAt(position).text.substring(0, position.character);

        // Get database name from document
        const docText = document.getText();
        const dbMatch = docText.match(/:db\s+"([^"]+)"/);
        const dbName = dbMatch?.[1];

        // Attribute completion (after :)
        if (context.triggerCharacter === ':' || linePrefix.match(/:\w*$/)) {
            items.push(...this.getKeywordCompletions());

            if (dbName) {
                const attributes = await this.getAttributesCached(dbName);
                items.push(...this.getAttributeCompletions(attributes));
            }
        }

        // Logic variable completion (after ?)
        if (context.triggerCharacter === '?' || linePrefix.match(/\?\w*$/)) {
            items.push(...this.getLogicVariableCompletions(docText));
        }

        // Query structure completion (after [)
        if (context.triggerCharacter === '[') {
            items.push(...this.getQueryStructureCompletions());
        }

        return items;
    }

    private getKeywordCompletions(): vscode.CompletionItem[] {
        const keywords = [
            { name: 'find', detail: 'Start the find clause', snippet: 'find $0' },
            { name: 'where', detail: 'Start the where clause', snippet: 'where\n       $0' },
            { name: 'in', detail: 'Input parameters', snippet: 'in $ $0' },
            { name: 'keys', detail: 'Return results as maps', snippet: 'keys $0' },
            { name: 'strs', detail: 'Return results as strings', snippet: 'strs $0' },
            { name: 'syms', detail: 'Return results as symbols', snippet: 'syms $0' },
            { name: 'with', detail: 'Include extra variables', snippet: 'with $0' },
            { name: 'db/id', detail: 'Entity ID attribute', snippet: 'db/id' },
            { name: 'db/ident', detail: 'Ident attribute', snippet: 'db/ident' },
        ];

        return keywords.map(kw => {
            const item = new vscode.CompletionItem(kw.name, vscode.CompletionItemKind.Keyword);
            item.detail = kw.detail;
            item.insertText = new vscode.SnippetString(kw.snippet);
            item.sortText = '0' + kw.name; // Sort keywords first
            return item;
        });
    }

    private getAttributeCompletions(attributes: string[]): vscode.CompletionItem[] {
        return attributes.map(attr => {
            // Remove leading : if present
            const cleanAttr = attr.startsWith(':') ? attr.slice(1) : attr;
            const item = new vscode.CompletionItem(cleanAttr, vscode.CompletionItemKind.Field);
            item.detail = 'Schema attribute';
            item.insertText = cleanAttr;
            item.sortText = '1' + cleanAttr; // Sort after keywords
            return item;
        });
    }

    private getLogicVariableCompletions(docText: string): vscode.CompletionItem[] {
        // Find existing logic variables in the document
        const varPattern = /\?(\w+)/g;
        const existingVars = new Set<string>();
        let match;

        while ((match = varPattern.exec(docText)) !== null) {
            existingVars.add(match[1]);
        }

        const items: vscode.CompletionItem[] = [];

        // Suggest existing variables
        for (const varName of existingVars) {
            const item = new vscode.CompletionItem(varName, vscode.CompletionItemKind.Variable);
            item.detail = 'Existing logic variable';
            item.insertText = varName;
            item.sortText = '0' + varName;
            items.push(item);
        }

        // Suggest common variable names
        const commonVars = ['e', 'v', 'a', 'tx', 'name', 'id', 'value', 'attr'];
        for (const varName of commonVars) {
            if (!existingVars.has(varName)) {
                const item = new vscode.CompletionItem(varName, vscode.CompletionItemKind.Variable);
                item.detail = 'Common logic variable';
                item.insertText = varName;
                item.sortText = '1' + varName;
                items.push(item);
            }
        }

        return items;
    }

    private getQueryStructureCompletions(): vscode.CompletionItem[] {
        const structures = [
            {
                name: 'Find entities',
                snippet: ':find ?e\n        :where\n        [?e $0]',
                detail: 'Basic entity query'
            },
            {
                name: 'Find with attribute',
                snippet: ':find ?e ?${1:value}\n        :where\n        [?e :${2:attr} ?${1:value}]$0',
                detail: 'Query entities and attribute values'
            },
            {
                name: 'Count',
                snippet: ':find (count ?e)\n        :where\n        [?e $0]',
                detail: 'Count matching entities'
            },
            {
                name: 'Pull',
                snippet: ':find (pull ?e [*])\n        :where\n        [?e $0]',
                detail: 'Pull all attributes for entities'
            },
            {
                name: 'Parameterized',
                snippet: ':find ?e\n        :in $ ?${1:param}\n        :where\n        [?e :${2:attr} ?${1:param}]$0',
                detail: 'Query with input parameter'
            }
        ];

        return structures.map(s => {
            const item = new vscode.CompletionItem(s.name, vscode.CompletionItemKind.Snippet);
            item.detail = s.detail;
            item.insertText = new vscode.SnippetString(s.snippet);
            return item;
        });
    }

    private async getAttributesCached(dbName: string): Promise<string[]> {
        const now = Date.now();

        if (!this.attributeCache.has(dbName) || now - this.lastCacheUpdate > this.cacheMaxAge) {
            try {
                const attributes = await this.calvaBridge.getAttributes(dbName);
                this.attributeCache.set(dbName, attributes);
                this.lastCacheUpdate = now;
            } catch {
                return this.attributeCache.get(dbName) || [];
            }
        }

        return this.attributeCache.get(dbName) || [];
    }

    clearCache(): void {
        this.attributeCache.clear();
        this.lastCacheUpdate = 0;
    }
}
