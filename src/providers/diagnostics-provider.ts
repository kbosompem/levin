/**
 * Pre-run diagnostics for .dtlv.edn query files: squiggles for unbalanced
 * forms and for suspicious :where clauses, reusing the same analysis the
 * results panel's error view uses (findSuspiciousClauses).
 */
import * as vscode from 'vscode';
import { parseStatements, isRunnable, QueryStatement } from '../utils/query-statements';
import { findSuspiciousClauses, MarkedRange } from '../utils/query-highlighter';

const MATCHING_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/**
 * Convert a character offset in `text` to a zero-based line/character pair.
 * Pure - exported for tests.
 */
export function offsetToPosition(text: string, offset: number): { line: number; character: number } {
    let line = 0;
    let lineStart = 0;
    const end = Math.min(offset, text.length);
    for (let i = 0; i < end; i++) {
        if (text[i] === '\n') {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, character: end - lineStart };
}

/**
 * Map highlighter marks (offsets relative to the query text) to document
 * line/character ranges. Pure - exported for tests.
 */
export function marksToRanges(
    docText: string,
    stmt: QueryStatement,
    marks: MarkedRange[]
): { start: { line: number; character: number }; end: { line: number; character: number } }[] {
    const queryOffsetInDoc = stmt.queryText !== undefined
        ? stmt.start + Math.max(0, stmt.text.indexOf(stmt.queryText))
        : stmt.start;

    return marks.map(mark => {
        const absStart = queryOffsetInDoc + mark.start;
        const absEnd = queryOffsetInDoc + mark.end;
        return {
            start: offsetToPosition(docText, absStart),
            end: offsetToPosition(docText, absEnd)
        };
    });
}

function toRange(r: { start: { line: number; character: number }; end: { line: number; character: number } }): vscode.Range {
    return new vscode.Range(
        new vscode.Position(r.start.line, r.start.character),
        new vscode.Position(r.end.line, r.end.character)
    );
}

function diagnoseDocument(doc: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
    if (doc.languageId !== 'datalevin-query') {
        return;
    }

    const text = doc.getText();
    const diagnostics: vscode.Diagnostic[] = [];
    const statements = parseStatements(text);

    for (const stmt of statements) {
        const opener = stmt.text[0];
        const expectedClose = MATCHING_CLOSE[opener];
        if (expectedClose && !stmt.text.trimEnd().endsWith(expectedClose)) {
            const pos = offsetToPosition(text, stmt.start);
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(pos.line, pos.character, pos.line, pos.character + 1),
                `Unbalanced parens: this form is missing its closing '${expectedClose}'`,
                vscode.DiagnosticSeverity.Error
            ));
            // Once a form is unbalanced, later offsets are unreliable
            break;
        }

        if (isRunnable(stmt) && stmt.queryText) {
            const marks = findSuspiciousClauses(stmt.queryText);
            for (const [i, range] of marksToRanges(text, stmt, marks).entries()) {
                diagnostics.push(new vscode.Diagnostic(
                    toRange(range),
                    marks[i].title ?? 'This clause looks suspicious',
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }
    }

    collection.set(doc.uri, diagnostics);
}

/**
 * Register the diagnostics provider: live squiggles on open/change/close
 * for every datalevin-query document.
 */
export function registerDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
    const collection = vscode.languages.createDiagnosticCollection('levin-query');
    context.subscriptions.push(collection);

    const timers = new Map<string, NodeJS.Timeout>();
    const schedule = (doc: vscode.TextDocument) => {
        const key = doc.uri.toString();
        const existing = timers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            diagnoseDocument(doc, collection);
        }, 300));
    };

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => diagnoseDocument(doc, collection)),
        vscode.workspace.onDidChangeTextDocument(e => schedule(e.document)),
        vscode.workspace.onDidCloseTextDocument(doc => {
            const key = doc.uri.toString();
            const existing = timers.get(key);
            if (existing) {
                clearTimeout(existing);
                timers.delete(key);
            }
            collection.delete(doc.uri);
        })
    );

    for (const doc of vscode.workspace.textDocuments) {
        diagnoseDocument(doc, collection);
    }

    return collection;
}
