/**
 * Statement parser for .dtlv.edn query files.
 * Splits a document into top-level EDN forms with source spans using a
 * delimiter-aware scanner (strings, escapes and comments are respected),
 * so nested maps (e.g. pull syntax) never break detection.
 *
 * Pure text processing - no vscode imports, so it is unit-testable.
 */

export type StatementKind = 'query' | 'transact' | 'solve' | 'nlq' | 'bare-query' | 'other';

export interface QueryStatement {
    kind: StatementKind;
    /** Offset of the first character of the form */
    start: number;
    /** Offset one past the last character of the form */
    end: number;
    startLine: number;
    endLine: number;
    /** Raw text of the whole form */
    text: string;
    /** Value of :db (unquoted), if present */
    db?: string;
    /** Raw text of the :query vector (or the whole form for bare queries) */
    queryText?: string;
    /** Raw text of the :transact vector */
    transactText?: string;
    /** Value of :limit, if present and numeric */
    limit?: number;
    /** Raw text of :rules (:all or a vector of rule-name strings) */
    rulesText?: string;
    /** Raw text of the :args vector */
    argsText?: string;
    /** Raw text of the :chart map (notebook chart output) */
    chartText?: string;
    /** Raw text of the :solve query vector (pick-under-constraints statement) */
    solveText?: string;
    /** Raw text of :pick (how many rows to choose) */
    pickText?: string;
    /** Raw text of the :such-that constraint vector */
    suchThatText?: string;
}

interface MapEntry {
    key: string;
    valueStart: number;
    valueEnd: number;
}

const MATCHING: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const OPENERS = '([{';
const CLOSERS = ')]}';

/**
 * Split document text into top-level EDN forms and classify each one.
 */
export function parseStatements(text: string): QueryStatement[] {
    const statements: QueryStatement[] = [];
    const lineIndex = buildLineIndex(text);

    let pos = 0;
    while (pos < text.length) {
        pos = skipWhitespaceAndComments(text, pos);
        if (pos >= text.length) {
            break;
        }

        // Reader discard #_ - skip the following form entirely
        if (text[pos] === '#' && text[pos + 1] === '_') {
            const formStart = skipWhitespaceAndComments(text, pos + 2);
            pos = scanFormEnd(text, formStart);
            continue;
        }

        const start = pos;
        const end = scanFormEnd(text, start);
        statements.push(classifyForm(text, start, end, lineIndex));
        pos = end > start ? end : start + 1;
    }

    return statements;
}

/**
 * Whether the statement can be executed (has a query or transaction body).
 */
export function isRunnable(stmt: QueryStatement): boolean {
    return stmt.queryText !== undefined || stmt.transactText !== undefined || stmt.solveText !== undefined;
}

/**
 * Find the statement for a line: the one containing it, otherwise the nearest
 * preceding statement, otherwise the next one (SQL-tool style behaviour).
 */
export function statementAtLine(statements: QueryStatement[], line: number): QueryStatement | null {
    const containing = statements.find(s => line >= s.startLine && line <= s.endLine);
    if (containing) {
        return containing;
    }

    let preceding: QueryStatement | null = null;
    for (const stmt of statements) {
        if (stmt.endLine < line) {
            preceding = stmt;
        } else {
            break;
        }
    }
    if (preceding) {
        return preceding;
    }

    return statements.find(s => s.startLine > line) ?? null;
}

/**
 * Resolve the database path for a statement: its own :db, otherwise an
 * explicit editor pin, otherwise the :db of the nearest preceding statement
 * in the file (file-level connection).
 */
export function resolveDbPath(
    statements: QueryStatement[],
    stmt: QueryStatement,
    pinned?: string | null
): string | null {
    if (stmt.db) {
        return stmt.db;
    }

    if (pinned) {
        return pinned;
    }

    for (let i = statements.length - 1; i >= 0; i--) {
        const candidate = statements[i];
        if (candidate.start >= stmt.start) {
            continue;
        }
        if (candidate.db) {
            return candidate.db;
        }
    }

    return null;
}

/**
 * Parse a :rules value: :all, or a vector of rule-name strings.
 * Returns undefined when the value is neither.
 */
export function parseRulesSpec(rulesText: string): string[] | 'all' | undefined {
    const trimmed = rulesText.trim();
    if (trimmed === ':all') {
        return 'all';
    }
    if (!trimmed.startsWith('[')) {
        return undefined;
    }
    const names: string[] = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(trimmed)) !== null) {
        names.push(unescapeString(match[1]));
    }
    return names.length > 0 ? names : undefined;
}

/**
 * Split a [...] EDN form into its top-level element strings, e.g.
 * `[["Chai" 10.0] ["Tofu" 20.0]]` → ['["Chai" 10.0]', '["Tofu" 20.0]'].
 * Used to pass :args values verbatim into generated Clojure code.
 */
export function splitEdnVector(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed.startsWith('[')) {
        return [];
    }

    const elements: string[] = [];
    let pos = 1;
    while (pos < trimmed.length) {
        pos = skipWhitespaceAndComments(trimmed, pos);
        if (pos >= trimmed.length || trimmed[pos] === ']') {
            break;
        }
        const end = scanFormEnd(trimmed, pos);
        elements.push(trimmed.substring(pos, end));
        pos = end > pos ? end : pos + 1;
    }
    return elements;
}

/**
 * Classify a top-level form and extract the pieces needed to run it.
 */
function classifyForm(text: string, start: number, end: number, lineIndex: number[]): QueryStatement {
    const stmt: QueryStatement = {
        kind: 'other',
        start,
        end,
        startLine: lineAt(lineIndex, start),
        endLine: lineAt(lineIndex, Math.max(start, end - 1)),
        text: text.substring(start, end)
    };

    const opener = text[start];

    if (opener === '{') {
        const entries = mapEntries(text, start, end);
        const keys = new Set(entries.map(e => e.key));

        for (const entry of entries) {
            const raw = text.substring(entry.valueStart, entry.valueEnd);
            switch (entry.key) {
                case ':db':
                    if (raw.startsWith('"')) {
                        stmt.db = unescapeString(raw.slice(1, -1));
                    }
                    break;
                case ':query':
                    stmt.queryText = raw;
                    break;
                case ':transact':
                    stmt.transactText = raw;
                    break;
                case ':limit': {
                    const limit = parseInt(raw, 10);
                    if (!isNaN(limit)) {
                        stmt.limit = limit;
                    }
                    break;
                }
                case ':rules':
                    stmt.rulesText = raw;
                    break;
                case ':args':
                    stmt.argsText = raw;
                    break;
                case ':chart':
                    stmt.chartText = raw;
                    break;
                case ':solve':
                    stmt.solveText = raw;
                    break;
                case ':pick':
                    stmt.pickText = raw;
                    break;
                case ':such-that':
                    stmt.suchThatText = raw;
                    break;
            }
        }

        if (keys.has(':nlq')) {
            stmt.kind = 'nlq';
        } else if (keys.has(':query')) {
            stmt.kind = 'query';
        } else if (keys.has(':transact')) {
            stmt.kind = 'transact';
        } else if (keys.has(':solve')) {
            stmt.kind = 'solve';
        }
    } else if (opener === '[') {
        // Bare query vector, e.g. [:find ?e :where ...]
        const i = skipWhitespaceAndComments(text, start + 1);
        if (text.startsWith(':find', i)) {
            const after = text[i + 5];
            if (after === undefined || /\s|,|\[|\]/.test(after)) {
                stmt.kind = 'bare-query';
                stmt.queryText = stmt.text;
            }
        }
    }

    return stmt;
}

/**
 * Extract top-level key/value spans from a map form [start, end).
 */
function mapEntries(text: string, start: number, end: number): MapEntry[] {
    const entries: MapEntry[] = [];
    let pos = start + 1;

    while (pos < end - 1) {
        pos = skipWhitespaceAndComments(text, pos);
        if (pos >= end - 1 || text[pos] === '}') {
            break;
        }

        // Reader discard inside a map: skip the discarded form
        if (text[pos] === '#' && text[pos + 1] === '_') {
            const formStart = skipWhitespaceAndComments(text, pos + 2);
            pos = scanFormEnd(text, formStart);
            continue;
        }

        const keyStart = pos;
        const keyEnd = scanFormEnd(text, keyStart);
        const key = text.substring(keyStart, keyEnd);

        pos = skipWhitespaceAndComments(text, keyEnd);
        if (pos >= end - 1 || text[pos] === '}') {
            break;
        }

        const valueStart = pos;
        const valueEnd = scanFormEnd(text, valueStart);
        entries.push({ key, valueStart, valueEnd });
        pos = valueEnd;
    }

    return entries;
}

/**
 * Return the offset one past the end of the form starting at pos.
 * Handles bracketed forms, strings (with escapes), comments and atoms.
 */
export function scanFormEnd(text: string, pos: number): number {
    const c = text[pos];

    if (OPENERS.includes(c)) {
        return scanBalanced(text, pos);
    }

    if (c === '"') {
        return skipString(text, pos);
    }

    if (c === '#') {
        const next = text[pos + 1];
        if (next === '{') {
            return scanBalanced(text, pos + 1);
        }
        if (next === '"') {
            // Regex literal #"..."
            return skipString(text, pos + 1);
        }
        // Tagged literal #inst "..." - consume tag then the following form
        let i = pos + 1;
        while (i < text.length && isAtomChar(text[i])) {
            i++;
        }
        const formStart = skipWhitespaceAndComments(text, i);
        return scanFormEnd(text, formStart);
    }

    // Atom: keyword, symbol or number
    let i = pos;
    while (i < text.length && isAtomChar(text[i])) {
        i++;
    }
    return i > pos ? i : pos + 1;
}

/**
 * Scan a bracketed form starting at pos (text[pos] is the opener),
 * tracking nesting, strings and comments. Lenient about mismatched closers.
 */
function scanBalanced(text: string, pos: number): number {
    const stack: string[] = [MATCHING[text[pos]]];
    let i = pos + 1;

    while (i < text.length && stack.length > 0) {
        const c = text[i];

        if (c === '"') {
            i = skipString(text, i);
            continue;
        }
        if (c === ';') {
            i = skipComment(text, i);
            continue;
        }
        if (OPENERS.includes(c)) {
            stack.push(MATCHING[c]);
            i++;
            continue;
        }
        if (CLOSERS.includes(c)) {
            if (c === stack[stack.length - 1]) {
                stack.pop();
            }
            i++;
            continue;
        }
        i++;
    }

    return i;
}

/** Skip a string literal starting at pos (text[pos] === '"'). Returns offset past the closing quote. */
function skipString(text: string, pos: number): number {
    let i = pos + 1;
    while (i < text.length) {
        if (text[i] === '\\') {
            i += 2;
            continue;
        }
        if (text[i] === '"') {
            return i + 1;
        }
        i++;
    }
    return i;
}

/** Skip a ; comment starting at pos. Returns offset of the next line's start. */
function skipComment(text: string, pos: number): number {
    let i = pos;
    while (i < text.length && text[i] !== '\n') {
        i++;
    }
    return i;
}

/** Skip whitespace, commas and comments. */
export function skipWhitespaceAndComments(text: string, pos: number): number {
    let i = pos;
    while (i < text.length) {
        const c = text[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',') {
            i++;
        } else if (c === ';') {
            i = skipComment(text, i);
        } else {
            break;
        }
    }
    return i;
}

function isAtomChar(c: string): boolean {
    return !/\s|,/.test(c) && !OPENERS.includes(c) && !CLOSERS.includes(c) && c !== '"' && c !== ';';
}

/** Unescape an EDN string body (the text between the quotes). */
function unescapeString(body: string): string {
    let result = '';
    let i = 0;
    while (i < body.length) {
        if (body[i] === '\\' && i + 1 < body.length) {
            const escaped = body[i + 1];
            switch (escaped) {
                case 'n': result += '\n'; break;
                case 't': result += '\t'; break;
                case 'r': result += '\r'; break;
                case '"': result += '"'; break;
                case '\\': result += '\\'; break;
                default: result += escaped;
            }
            i += 2;
        } else {
            result += body[i];
            i++;
        }
    }
    return result;
}

/** Build a sorted array of newline offsets for line lookups. */
function buildLineIndex(text: string): number[] {
    const index: number[] = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            index.push(i);
        }
    }
    return index;
}

/** Zero-based line number of an offset, via binary search on newline offsets. */
function lineAt(lineIndex: number[], offset: number): number {
    let lo = 0;
    let hi = lineIndex.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (lineIndex[mid] < offset) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}
