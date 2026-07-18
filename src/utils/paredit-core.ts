/**
 * Paredit-style structural editing for EDN, built on the query-statements
 * scanner (strings, escapes and comments are respected throughout).
 *
 * Pure text processing - no vscode imports, so it is unit-testable.
 * Every edit returns the new text plus the desired cursor offset; null
 * means "not applicable here" and the caller leaves the buffer alone.
 */

import { scanFormEnd, skipWhitespaceAndComments } from './query-statements';

export interface Span {
    /** Offset of the first character of the form */
    start: number;
    /** Offset one past the last character of the form */
    end: number;
}

export interface EditResult {
    text: string;
    /** Cursor offset after the edit */
    offset: number;
}

const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** Direct child forms of a bracketed span (brackets excluded). */
export function childForms(text: string, span: Span): Span[] {
    const children: Span[] = [];
    let pos = span.start + 1;

    while (pos < span.end - 1) {
        pos = skipWhitespaceAndComments(text, pos);
        if (pos >= span.end - 1 || OPEN_TO_CLOSE[text[span.start]] === text[pos]) {
            break;
        }
        const end = scanFormEnd(text, pos);
        children.push({ start: pos, end });
        pos = end > pos ? end : pos + 1;
    }

    return children;
}

/**
 * The innermost BRACKETED form containing offset, or null when the offset
 * is not inside any bracketed form.
 */
export function enclosingForm(text: string, offset: number): Span | null {
    let pos = 0;

    while (pos < text.length) {
        pos = skipWhitespaceAndComments(text, pos);
        if (pos >= text.length) {
            break;
        }
        const end = scanFormEnd(text, pos);
        if (pos <= offset && offset <= end && OPEN_TO_CLOSE[text[pos]]) {
            return descend(text, { start: pos, end }, offset);
        }
        pos = end > pos ? end : pos + 1;
    }

    return null;
}

function descend(text: string, span: Span, offset: number): Span {
    for (const child of childForms(text, span)) {
        if (child.start <= offset && offset <= child.end && OPEN_TO_CLOSE[text[child.start]]) {
            return descend(text, child, offset);
        }
    }
    return span;
}

/** The form starting at or after offset (skipping whitespace/comments). */
export function formAfter(text: string, offset: number): Span | null {
    const pos = skipWhitespaceAndComments(text, offset);
    if (pos >= text.length) {
        return null;
    }
    const end = scanFormEnd(text, pos);
    return end > pos ? { start: pos, end } : null;
}

/** Offset past the form at/after offset (paredit-forward). */
export function forwardSexp(text: string, offset: number): number {
    const form = formAfter(text, offset);
    return form ? form.end : offset;
}

/** Start of the innermost form containing offset, else previous form start. */
export function backwardSexp(text: string, offset: number): number {
    const enclosing = enclosingForm(text, offset);
    if (enclosing && offset > enclosing.start) {
        return enclosing.start;
    }

    // Walk top-level forms; the start of the last form before offset wins
    let pos = 0;
    let previousStart = -1;
    while (pos < text.length) {
        pos = skipWhitespaceAndComments(text, pos);
        if (pos >= text.length || pos >= offset) {
            break;
        }
        const end = scanFormEnd(text, pos);
        if (end >= offset) {
            break;
        }
        previousStart = pos;
        pos = end > pos ? end : pos + 1;
    }
    return previousStart >= 0 ? previousStart : offset;
}

/** Wrap the form at/after offset with the given bracket pair. */
export function wrapWith(text: string, offset: number, open: string, close: string): EditResult | null {
    const form = formAfter(text, offset);
    if (!form) {
        return null;
    }

    const wrapped = text.substring(0, form.start) + open +
        text.substring(form.start, form.end) + close +
        text.substring(form.end);
    return { text: wrapped, offset: form.start + 1 };
}

/**
 * Slurp forward: pull the next sibling form into the enclosing form by
 * moving its closing bracket past that sibling.
 */
export function slurpForward(text: string, offset: number): EditResult | null {
    const parent = enclosingForm(text, offset);
    if (!parent) {
        return null;
    }
    const next = formAfter(text, parent.end);
    if (!next) {
        return null;
    }

    const closeChar = text[parent.end - 1];
    const newText =
        text.substring(0, parent.end - 1) +
        text.substring(parent.end, next.end) +
        closeChar +
        text.substring(next.end);
    return { text: newText, offset };
}

/**
 * Barf forward: push the last child out of the enclosing form by moving
 * its closing bracket before that child.
 */
export function barfForward(text: string, offset: number): EditResult | null {
    const parent = enclosingForm(text, offset);
    if (!parent) {
        return null;
    }
    const children = childForms(text, parent);
    if (children.length === 0) {
        return null;
    }
    const last = children[children.length - 1];

    const closeChar = text[parent.end - 1];
    const before = text.substring(0, last.start).replace(/[\s,]+$/, '');
    const newText =
        before +
        closeChar + ' ' +
        text.substring(last.start, parent.end - 1) +
        text.substring(parent.end);
    return { text: newText, offset };
}

/** The smallest bracketed form that strictly contains target. */
function bracketedParent(text: string, target: Span): Span | null {
    let pos = 0;
    while (pos < text.length) {
        pos = skipWhitespaceAndComments(text, pos);
        if (pos >= text.length) {
            break;
        }
        const end = scanFormEnd(text, pos);
        if (pos < target.start && end > target.end && OPEN_TO_CLOSE[text[pos]]) {
            return deepestParent(text, { start: pos, end }, target);
        }
        pos = end > pos ? end : pos + 1;
    }
    return null;
}

function deepestParent(text: string, span: Span, target: Span): Span {
    for (const child of childForms(text, span)) {
        if (child.start < target.start && child.end > target.end && OPEN_TO_CLOSE[text[child.start]]) {
            return deepestParent(text, child, target);
        }
    }
    return span;
}

/**
 * Raise (Emacs raise-sexp semantics): replace the parent form with the
 * form at/under the cursor - the child containing the offset, or the
 * enclosing form itself when the cursor sits on its brackets.
 */
export function raiseForm(text: string, offset: number): EditResult | null {
    const inner = enclosingForm(text, offset);
    if (!inner) {
        return null;
    }

    let target: Span = inner;
    for (const child of childForms(text, inner)) {
        if (child.start <= offset && offset <= child.end) {
            target = child;
            break;
        }
    }

    const parent = bracketedParent(text, target);
    if (!parent) {
        return null;
    }

    const newText =
        text.substring(0, parent.start) +
        text.substring(target.start, target.end) +
        text.substring(parent.end);
    return { text: newText, offset: parent.start };
}

/** Splice: remove the brackets of the enclosing form, keeping its children. */
export function spliceForm(text: string, offset: number): EditResult | null {
    const parent = enclosingForm(text, offset);
    if (!parent) {
        return null;
    }

    const newText =
        text.substring(0, parent.start) +
        text.substring(parent.start + 1, parent.end - 1) +
        text.substring(parent.end);
    return { text: newText, offset: Math.max(parent.start, offset - 1) };
}
