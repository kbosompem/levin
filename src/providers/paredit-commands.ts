/**
 * Paredit-style structural editing commands for .dtlv.edn files.
 * Thin vscode glue over the pure functions in utils/paredit-core.
 */
import * as vscode from 'vscode';
import {
    EditResult, forwardSexp, backwardSexp, wrapWith,
    slurpForward, barfForward, raiseForm, spliceForm
} from '../utils/paredit-core';

const LANGUAGE_ID = 'datalevin-query';

function queryEditor(): vscode.TextEditor | undefined {
    const editor = vscode.window.activeTextEditor;
    return editor && editor.document.languageId === LANGUAGE_ID ? editor : undefined;
}

/** Apply a structural edit to the whole document and place the cursor. */
async function applyStructuralEdit(
    compute: (text: string, offset: number) => EditResult | null
): Promise<void> {
    const editor = queryEditor();
    if (!editor) {
        return;
    }

    const document = editor.document;
    const text = document.getText();
    const offset = document.offsetAt(editor.selection.active);
    const result = compute(text, offset);
    if (!result || result.text === text) {
        return;
    }

    await editor.edit(editBuilder => {
        editBuilder.replace(
            new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
            result.text
        );
    });

    const pos = document.positionAt(result.offset);
    editor.selection = new vscode.Selection(pos, pos);
}

/** Move the cursor to a computed offset. */
function moveCursor(compute: (text: string, offset: number) => number): void {
    const editor = queryEditor();
    if (!editor) {
        return;
    }

    const document = editor.document;
    const target = compute(document.getText(), document.offsetAt(editor.selection.active));
    const pos = document.positionAt(target);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.Default);
}

export function registerPareditCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('levin.paredit.forwardSexp', () =>
            moveCursor(forwardSexp)),
        vscode.commands.registerCommand('levin.paredit.backwardSexp', () =>
            moveCursor(backwardSexp)),
        vscode.commands.registerCommand('levin.paredit.wrapRound', () =>
            applyStructuralEdit((text, offset) => wrapWith(text, offset, '(', ')'))),
        vscode.commands.registerCommand('levin.paredit.wrapSquare', () =>
            applyStructuralEdit((text, offset) => wrapWith(text, offset, '[', ']'))),
        vscode.commands.registerCommand('levin.paredit.slurpForward', () =>
            applyStructuralEdit(slurpForward)),
        vscode.commands.registerCommand('levin.paredit.barfForward', () =>
            applyStructuralEdit(barfForward)),
        vscode.commands.registerCommand('levin.paredit.raise', () =>
            applyStructuralEdit(raiseForm)),
        vscode.commands.registerCommand('levin.paredit.splice', () =>
            applyStructuralEdit(spliceForm))
    );
}
