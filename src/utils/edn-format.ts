/**
 * Structural formatter for .dtlv.edn files: canonical Lisp-style layout
 * built on the query-statements scanner. Comments are preserved (both
 * between and inside forms), blank lines between top-level forms are
 * collapsed to one, and formatting is idempotent.
 *
 * Layout rules (clojure-mode style):
 *   - a form that fits on one line stays inline
 *   - otherwise children go on their own lines, indented one space past
 *     the opener's column; map values share their key's line
 *   - closing brackets pile up after the last child line
 *
 * Pure text processing - no vscode imports, so it is unit-testable.
 */

import { scanFormEnd } from './query-statements';
import { Span } from './paredit-core';

const MAX_INLINE = 78;
const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

interface Item {
    span?: Span;
    comment?: string;
}

/** Format an entire .dtlv.edn document. */
export function formatEdn(text: string): string {
    const chunks: string[] = [];
    let pos = 0;
    let pendingComments: string[] = [];
    let blankBefore = false;
    let sawForm = false;

    const flush = (formText: string) => {
        const parts = [...pendingComments, formText];
        chunks.push((sawForm && blankBefore ? '\n' : '') + parts.join('\n'));
        pendingComments = [];
        blankBefore = false;
        sawForm = true;
    };

    while (pos < text.length) {
        // Whitespace runs: two or more newlines mean a blank line
        let newlines = 0;
        while (pos < text.length) {
            const c = text[pos];
            if (c === '\n') {
                newlines++;
                pos++;
            } else if (c === ' ' || c === '\t' || c === '\r' || c === ',') {
                pos++;
            } else {
                break;
            }
        }
        if (newlines >= 2 && sawForm) {
            blankBefore = true;
        }
        if (pos >= text.length) {
            break;
        }

        // Comment line: keep it with the following form
        if (text[pos] === ';') {
            const eol = commentEnd(text, pos);
            pendingComments.push(text.substring(pos, eol).trimEnd());
            pos = eol;
            continue;
        }

        const end = scanFormEnd(text, pos);
        flush(prettyForm(text, pos, end, 0));
        pos = end > pos ? end : pos + 1;
    }

    // Trailing comments with no following form
    if (pendingComments.length > 0) {
        chunks.push(pendingComments.join('\n'));
    }

    return chunks.join('\n') + '\n';
}

/** Render one form: inline when it fits at its column, broken otherwise. */
function prettyForm(text: string, start: number, end: number, column: number): string {
    const raw = text.substring(start, end);

    // Sets have a two-character opener
    const isSet = text[start] === '#' && text[start + 1] === '{';
    const opener = isSet ? '#{' : text[start];
    const close = OPEN_TO_CLOSE[isSet ? '{' : opener];

    if (!close) {
        // Atom, string, tagged literal, reader discard - always inline
        return raw;
    }

    if (!raw.includes('\n') && !hasComment(raw) && raw.length + column <= MAX_INLINE) {
        return raw;
    }

    const childSpan: Span = isSet ? { start: start + 1, end } : { start, end };
    const items = childItems(text, childSpan);
    if (items.length === 0) {
        return raw;
    }

    const childPad = ' '.repeat(column + opener.length);
    const lines: string[] = [];

    if (opener === '{' && items.filter(i => i.span).length >= 2) {
        // Map: first pair shares the opener's line, later pairs one per
        // line; comments get their own line
        let line = opener;
        let hasContent = true;
        const pushLine = () => {
            if (hasContent) {
                lines.push(line);
                line = '';
                hasContent = false;
            }
        };
        const append = (s: string) => {
            line = (hasContent ? line : childPad) + s;
            hasContent = true;
        };

        let firstPair = true;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.comment !== undefined) {
                pushLine();
                append(item.comment);
                pushLine();
                continue;
            }
            const key = item.span!;
            const keyText = text.substring(key.start, key.end);
            const next = items[i + 1];
            if (!next || !next.span) {
                if (!firstPair) { pushLine(); }
                append(keyText);
                continue;
            }
            const value = next.span;
            i++; // consume the value
            if (!firstPair) { pushLine(); }
            const valueColumn = (hasContent ? line.length : childPad.length) + keyText.length + 1;
            append(keyText + ' ' + prettyForm(text, value.start, value.end, valueColumn));
            firstPair = false;
        }
        pushLine();
    } else {
        // Vectors/lists/sets: the first child stays on the opener's line,
        // following atoms pack while they fit, and every keyword or
        // bracketed form starts a new line (Datalog convention).
        let line = opener;
        let hasContent = true;
        const pushLine = () => {
            if (hasContent) {
                lines.push(line);
                line = '';
                hasContent = false;
            }
        };
        const append = (s: string) => {
            line = (hasContent ? line : childPad) + s;
            hasContent = true;
        };

        let first = true;
        for (const item of items) {
            if (item.comment !== undefined) {
                pushLine();
                append(item.comment);
                pushLine();
                continue;
            }

            const child = item.span!;
            const childRaw = text.substring(child.start, child.end);
            const isKeyword = childRaw.startsWith(':');
            const isBracketed = OPEN_TO_CLOSE[childRaw[0]] !== undefined ||
                (childRaw[0] === '#' && childRaw[1] === '{');

            if (first) {
                append(prettyForm(text, child.start, child.end, column + opener.length));
                first = false;
                continue;
            }

            if (isKeyword || isBracketed) {
                pushLine();
                append(prettyForm(text, child.start, child.end, column + opener.length));
                continue;
            }

            const childText = prettyForm(text, child.start, child.end, line.length + 1);
            if (hasContent && line.length + 1 + childText.length <= MAX_INLINE && !childText.includes('\n')) {
                line += ' ' + childText;
            } else {
                pushLine();
                append(childText);
            }
        }
        pushLine();
    }

    return lines.join('\n') + close;
}

/** Children of a bracketed span, keeping interior comments as items. */
function childItems(text: string, span: Span): Item[] {
    const items: Item[] = [];
    const closer = OPEN_TO_CLOSE[text[span.start] === '#' ? '{' : text[span.start]];
    let pos = span.start + 1;

    while (pos < span.end - 1) {
        // Whitespace only - comments are meaningful items here
        while (pos < span.end - 1 && /[\s,]/.test(text[pos])) {
            pos++;
        }
        if (pos >= span.end - 1 || text[pos] === closer) {
            break;
        }
        if (text[pos] === ';') {
            const eol = commentEnd(text, pos);
            items.push({ comment: text.substring(pos, eol).trimEnd() });
            pos = eol;
            continue;
        }
        const end = scanFormEnd(text, pos);
        items.push({ span: { start: pos, end } });
        pos = end > pos ? end : pos + 1;
    }

    return items;
}

/** Offset of the end of a ';' comment (start of the next line). */
function commentEnd(text: string, pos: number): number {
    let i = pos;
    while (i < text.length && text[i] !== '\n') {
        i++;
    }
    return i;
}

/** True if the text contains a ';' comment starter outside any string. */
function hasComment(text: string): boolean {
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            if (c === '\\') {
                i++;
            } else if (c === '"') {
                inString = false;
            }
        } else if (c === '"') {
            inString = true;
        } else if (c === ';') {
            return true;
        }
    }
    return false;
}
