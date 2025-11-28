import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';

export class QueryHoverProvider implements vscode.HoverProvider {
    constructor(private dtlvBridge: DtlvBridge) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const wordRange = document.getWordRangeAtPosition(position, /:[a-zA-Z][a-zA-Z0-9\-_]*\/[a-zA-Z][a-zA-Z0-9\-_]*/);

        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);

        // Get database path from document
        const docText = document.getText();
        const dbMatch = docText.match(/:db\s+"([^"]+)"/);
        const dbPath = dbMatch?.[1];

        if (!dbPath) {
            return null;
        }

        try {
            // Get schema info for this attribute
            const schema = await this.dtlvBridge.getSchema(dbPath);
            const attrInfo = schema.find(s => s.attribute === word || s.attribute === word.slice(1));

            if (!attrInfo) {
                return null;
            }

            // Get sample values
            const attrName = attrInfo.attribute.startsWith(':') ? attrInfo.attribute.slice(1) : attrInfo.attribute;
            const sampleValues = await this.dtlvBridge.getSampleValues(dbPath, attrName, 5);

            const contents = new vscode.MarkdownString();
            contents.isTrusted = true;

            // Attribute header
            contents.appendMarkdown(`**${attrInfo.attribute}**\n\n`);

            // Properties
            contents.appendMarkdown(`| Property | Value |\n`);
            contents.appendMarkdown(`|----------|-------|\n`);
            contents.appendMarkdown(`| Type | \`${attrInfo.valueType || 'unknown'}\` |\n`);
            contents.appendMarkdown(`| Cardinality | \`${attrInfo.cardinality || 'one'}\` |\n`);

            if (attrInfo.index) {
                contents.appendMarkdown(`| Indexed | Yes |\n`);
            }
            if (attrInfo.unique) {
                contents.appendMarkdown(`| Unique | \`${attrInfo.unique}\` |\n`);
            }
            if (attrInfo.fulltext) {
                contents.appendMarkdown(`| Fulltext | Yes |\n`);
            }
            if (attrInfo.isComponent) {
                contents.appendMarkdown(`| Component | Yes |\n`);
            }

            // Sample values
            if (sampleValues.length > 0) {
                contents.appendMarkdown(`\n**Sample Values:**\n`);
                contents.appendMarkdown('```\n');
                for (const val of sampleValues) {
                    const displayVal = typeof val === 'string' ? `"${val}"` : String(val);
                    contents.appendMarkdown(`${displayVal}\n`);
                }
                contents.appendMarkdown('```\n');
            }

            return new vscode.Hover(contents, wordRange);
        } catch (error) {
            console.error('Error providing hover:', error);
            return null;
        }
    }
}
