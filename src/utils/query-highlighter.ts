/**
 * Renders a Datalog/EDN query as syntax-highlighted HTML for webviews, and
 * can point at :where clauses whose shape Datalevin rejects (data patterns
 * must be triples), so errors can call out the offending clause.
 *
 * Pure text processing - no vscode imports, so it is unit-testable.
 */

import { scanFormEnd, skipWhitespaceAndComments } from './query-statements';

export interface MarkedRange {
    start: number;
    end: number;
    cssClass: string;
    title?: string;
}

type TokenType = 'ws' | 'comment' | 'string' | 'keyword' | 'variable' | 'number' | 'symbol';

interface Token {
    type: TokenType;
    start: number;
    end: number;
}

const BRACKETS = '()[]{}';

/**
 * Render the query as syntax-highlighted HTML. Marked ranges are wrapped in
 * an extra span (e.g. a wavy underline under a suspicious clause).
 */
export function highlightQueryToHtml(query: string, marks: MarkedRange[] = []): string {
    const tokens = tokenize(query);
    const sorted = [...marks].sort((a, b) => a.start - b.start);

    let html = '';
    let markIndex = 0;
    let activeMark: MarkedRange | null = null;

    for (const token of tokens) {
        if (activeMark && token.start >= activeMark.end) {
            html += '</span>';
            activeMark = null;
        }
        if (!activeMark && markIndex < sorted.length && token.start === sorted[markIndex].start) {
            activeMark = sorted[markIndex];
            markIndex++;
            const title = activeMark.title ? ` title="${escapeAttribute(activeMark.title)}"` : '';
            html += `<span class="${activeMark.cssClass}"${title}>`;
        }
        html += renderToken(query, token);
    }

    if (activeMark) {
        html += '</span>';
    }

    return html;
}

/**
 * Find :where data patterns that are not triples - the shape Datalevin's
 * query engine rejects. Returns [] for non-query text (e.g. tx data).
 */
export function findSuspiciousClauses(query: string): MarkedRange[] {
    const marks: MarkedRange[] = [];

    const start = skipWhitespaceAndComments(query, 0);
    if (query[start] !== '[') {
        return marks;
    }

    // Must be a Datalog query: first element is :find
    const first = skipWhitespaceAndComments(query, start + 1);
    if (!isKeywordAt(query, first, ':find')) {
        return marks;
    }

    const vectorEnd = scanFormEnd(query, start);

    // Walk the query vector's top-level forms to find :where
    let pos = scanFormEnd(query, first);
    while (pos < vectorEnd - 1) {
        pos = skipWhitespaceAndComments(query, pos);
        if (pos >= vectorEnd - 1 || query[pos] === ']') {
            break;
        }

        if (isKeywordAt(query, pos, ':where')) {
            pos = scanFormEnd(query, pos);
            // Every following vector clause should be a [?e :attr ?value] triple
            while (pos < vectorEnd - 1) {
                pos = skipWhitespaceAndComments(query, pos);
                if (pos >= vectorEnd - 1 || query[pos] === ']') {
                    break;
                }
                // A top-level keyword ends the :where section (e.g. :order-by)
                if (query[pos] === ':') {
                    break;
                }
                const clauseEnd = scanFormEnd(query, pos);
                if (query[pos] === '[') {
                    // Function bindings like [(fn ?x) ?out] start with a
                    // bracketed form - only check data-pattern clauses
                    const firstChild = skipWhitespaceAndComments(query, pos + 1);
                    const looksLikeDataPattern = query[firstChild] !== '(' && query[firstChild] !== '[';
                    if (looksLikeDataPattern) {
                        const count = countTopLevelChildren(query, pos, clauseEnd);
                        if (count !== 3) {
                            marks.push({
                                start: pos,
                                end: clauseEnd,
                                cssClass: 'clause-mark',
                                title: `This clause has ${count} element${count === 1 ? '' : 's'}; data patterns look like [?e :attr ?value]`
                            });
                        }
                    }
                }
                pos = clauseEnd;
            }
            break;
        }

        pos = scanFormEnd(query, pos);
    }

    return marks;
}

/**
 * Collect the variables that appear in entity position (first element) of
 * :where data-pattern triples. Only those columns can hold entity ids, so
 * only they should render as entity links - a price of 18 is not entity 18.
 * Returns an empty set for non-query text.
 */
export function findEntityPositionVars(query: string): Set<string> {
    const vars = new Set<string>();

    const start = skipWhitespaceAndComments(query, 0);
    if (query[start] !== '[') {
        return vars;
    }

    const first = skipWhitespaceAndComments(query, start + 1);
    if (!isKeywordAt(query, first, ':find')) {
        return vars;
    }

    const vectorEnd = scanFormEnd(query, start);

    let pos = scanFormEnd(query, first);
    while (pos < vectorEnd - 1) {
        pos = skipWhitespaceAndComments(query, pos);
        if (pos >= vectorEnd - 1 || query[pos] === ']') {
            break;
        }

        if (isKeywordAt(query, pos, ':where')) {
            pos = scanFormEnd(query, pos);
            while (pos < vectorEnd - 1) {
                pos = skipWhitespaceAndComments(query, pos);
                if (pos >= vectorEnd - 1 || query[pos] === ']') {
                    break;
                }
                // A top-level keyword ends the :where section (e.g. :order-by)
                if (query[pos] === ':') {
                    break;
                }
                const clauseEnd = scanFormEnd(query, pos);
                if (query[pos] === '[') {
                    // Data patterns only: function calls start with '(',
                    // bindings with '['
                    const firstChild = skipWhitespaceAndComments(query, pos + 1);
                    if (query[firstChild] !== '(' && query[firstChild] !== '[') {
                        const varEnd = scanFormEnd(query, firstChild);
                        const candidate = query.substring(firstChild, varEnd);
                        if (candidate.startsWith('?')) {
                            vars.add(candidate);
                        }
                    }
                }
                pos = clauseEnd;
            }
            break;
        }

        pos = scanFormEnd(query, pos);
    }

    return vars;
}

/** Count the direct child forms of a bracketed form [start, end). */
function countTopLevelChildren(text: string, start: number, end: number): number {
    let count = 0;
    let pos = start + 1;

    while (pos < end - 1) {
        pos = skipWhitespaceAndComments(text, pos);
        if (pos >= end - 1 || text[pos] === ']') {
            break;
        }
        pos = scanFormEnd(text, pos);
        count++;
    }

    return count;
}

/** True if the exact keyword starts at pos (not a prefix of a longer keyword). */
function isKeywordAt(text: string, pos: number, keyword: string): boolean {
    if (!text.startsWith(keyword, pos)) {
        return false;
    }
    const after = text[pos + keyword.length];
    return after === undefined || /[\s,()[\]{}";]/.test(after);
}

/** Split the query into contiguous tokens covering every offset. */
function tokenize(query: string): Token[] {
    const tokens: Token[] = [];
    let pos = 0;

    while (pos < query.length) {
        const c = query[pos];

        if (/\s|,/.test(c)) {
            const end = scanWhile(query, pos, ch => /[\s,]/.test(ch));
            tokens.push({ type: 'ws', start: pos, end });
            pos = end;
        } else if (c === ';') {
            let end = pos;
            while (end < query.length && query[end] !== '\n') {
                end++;
            }
            tokens.push({ type: 'comment', start: pos, end });
            pos = end;
        } else if (c === '"') {
            let end = pos + 1;
            while (end < query.length) {
                if (query[end] === '\\') {
                    end += 2;
                    continue;
                }
                if (query[end] === '"') {
                    end++;
                    break;
                }
                end++;
            }
            tokens.push({ type: 'string', start: pos, end: Math.min(end, query.length) });
            pos = Math.min(end, query.length);
        } else if (BRACKETS.includes(c)) {
            tokens.push({ type: 'symbol', start: pos, end: pos + 1 });
            pos++;
        } else {
            const end = scanWhile(query, pos, ch => !/[\s,()[\]{}";]/.test(ch));
            tokens.push({ type: classifyAtom(query.substring(pos, end)), start: pos, end });
            pos = end;
        }
    }

    return tokens;
}

function scanWhile(text: string, pos: number, pred: (c: string) => boolean): number {
    let end = pos;
    while (end < text.length && pred(text[end])) {
        end++;
    }
    return end > pos ? end : pos + 1;
}

function classifyAtom(atom: string): TokenType {
    if (atom.startsWith(':')) {
        return 'keyword';
    }
    if (atom.startsWith('?') || atom.startsWith('$')) {
        return 'variable';
    }
    if (/^[+-]?(\d|\.\d)/.test(atom)) {
        return 'number';
    }
    return 'symbol';
}

function renderToken(query: string, token: Token): string {
    const text = escapeHtml(query.substring(token.start, token.end));
    if (token.type === 'ws' || token.type === 'symbol') {
        return text;
    }
    return `<span class="tok-${token.type}">${text}</span>`;
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttribute(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
