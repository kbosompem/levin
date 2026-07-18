/**
 * Utility functions for formatting values for display
 */

import { findEntityPositionVars } from './query-highlighter';

export function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'nil';
    }

    if (typeof value === 'string') {
        return `"${value}"`;
    }

    if (typeof value === 'number') {
        return String(value);
    }

    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }

    if (value instanceof Date) {
        return `#inst "${value.toISOString()}"`;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '[]';
        }
        if (value.length <= 3) {
            return '[' + value.map(formatValue).join(' ') + ']';
        }
        return `[${value.length} items]`;
    }

    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;

        // Check for tagged literal
        if ('_tag' in obj) {
            return `#${obj._tag} ${formatValue(obj.value)}`;
        }

        const keys = Object.keys(obj);
        if (keys.length === 0) {
            return '{}';
        }
        if (keys.length <= 2) {
            const pairs = keys.map(k => `${k} ${formatValue(obj[k])}`);
            return '{' + pairs.join(' ') + '}';
        }
        return `{${keys.length} entries}`;
    }

    return String(value);
}

export function formatAttribute(attr: string): string {
    // Ensure keyword format
    if (!attr.startsWith(':')) {
        return ':' + attr;
    }
    return attr;
}

export function formatEntityId(id: number): string {
    return `Entity ${id}`;
}

export function formatTimestamp(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) { // Less than 1 minute
        return 'just now';
    }

    if (diff < 3600000) { // Less than 1 hour
        const minutes = Math.floor(diff / 60000);
        return `${minutes}m ago`;
    }

    if (diff < 86400000) { // Less than 1 day
        const hours = Math.floor(diff / 3600000);
        return `${hours}h ago`;
    }

    if (diff < 604800000) { // Less than 1 week
        const days = Math.floor(diff / 86400000);
        return `${days}d ago`;
    }

    return date.toLocaleDateString();
}

export function formatBytes(bytes: number): string {
    if (bytes === 0) { return '0 B'; }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);

    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) {
        return str;
    }
    return str.slice(0, maxLength - 3) + '...';
}

export function escapeEdn(str: string): string {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

export function toEdn(data: unknown): string {
    if (data === null || data === undefined) {
        return 'nil';
    }

    if (typeof data === 'string') {
        return `"${escapeEdn(data)}"`;
    }

    if (typeof data === 'number') {
        return String(data);
    }

    if (typeof data === 'boolean') {
        return data ? 'true' : 'false';
    }

    if (data instanceof Date) {
        return `#inst "${data.toISOString()}"`;
    }

    if (Array.isArray(data)) {
        return '[' + data.map(toEdn).join(' ') + ']';
    }

    if (typeof data === 'object') {
        const obj = data as Record<string, unknown>;

        // Check for tagged literal
        if ('_tag' in obj) {
            return `#${obj._tag} ${toEdn(obj.value)}`;
        }

        const entries = Object.entries(obj);
        const pairs = entries.map(([k, v]) => {
            // If key looks like a keyword, format as keyword
            const keyStr = k.startsWith(':') ? k : `:${k}`;
            return `${keyStr} ${toEdn(v)}`;
        });
        return '{' + pairs.join(' ') + '}';
    }

    return String(data);
}

export function parseAttributeParts(attr: string): { namespace: string; name: string } {
    const cleanAttr = attr.startsWith(':') ? attr.slice(1) : attr;
    const parts = cleanAttr.split('/');

    if (parts.length === 2) {
        return { namespace: parts[0], name: parts[1] };
    }

    return { namespace: '', name: cleanAttr };
}

export interface TreeRow {
    depth: number;
    /** Key label for this row (map key or array index); null at the root */
    key: string | null;
    /** Scalar text for leaves, a short summary like "{3}" or "[2]" for containers */
    text: string;
    /** True when this row has children following at greater depths */
    container: boolean;
}

/**
 * Flatten a nested value (pull results, maps, vectors) into display rows
 * for a tree view. Lossless - every leaf appears with its full path.
 */
export function flattenTree(value: unknown, key: string | null = null, depth: number = 0): TreeRow[] {
    const isObject = value !== null && typeof value === 'object' && !(value instanceof Date);

    if (!isObject) {
        return [{ depth, key, text: formatValue(value), container: false }];
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return [{ depth, key, text: '[]', container: false }];
        }
        const rows: TreeRow[] = [{ depth, key, text: `[${value.length}]`, container: true }];
        for (let i = 0; i < value.length; i++) {
            rows.push(...flattenTree(value[i], String(i), depth + 1));
        }
        return rows;
    }

    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) {
        return [{ depth, key, text: '{}', container: false }];
    }
    const rows: TreeRow[] = [{ depth, key, text: `{${keys.length}}`, container: true }];
    for (const k of keys) {
        // parseEdn strips the leading ':' from keywords; show namespaced
        // keys the way they appeared in the query result
        const label = k.includes('/') && !k.startsWith(':') ? `:${k}` : k;
        rows.push(...flattenTree(obj[k], label, depth + 1));
    }
    return rows;
}

/**
 * Compare two result cells for column sorting: numbers numerically, dates
 * chronologically, everything else as text; nil always sorts last.
 */
export function compareCellValues(a: unknown, b: unknown): number {
    if (a === null || a === undefined) {
        return (b === null || b === undefined) ? 0 : 1;
    }
    if (b === null || b === undefined) {
        return -1;
    }

    if (typeof a === 'number' && typeof b === 'number') {
        return a - b;
    }

    if (a instanceof Date && b instanceof Date) {
        return a.getTime() - b.getTime();
    }

    const sa = typeof a === 'object' ? toEdn(a) : String(a);
    const sb = typeof b === 'object' ? toEdn(b) : String(b);
    return sa.localeCompare(sb);
}

/**
 * Extract column names from a Datalog :find clause.
 *
 * Examples:
 *   [:find ?e ?name :where ...] -> ['?e', '?name']
 *   [:find (count ?e) :where ...] -> ['count(?e)']
 *   [:find (pull ?e [:name :age]) :where ...] -> ['pull(?e)']
 *   [:find ?e . :where ...] -> ['?e'] (scalar)
 *   [:find [?e ...] :where ...] -> ['?e'] (collection)
 *   [:find ?e ?name :keys id name :where ...] -> ['id', 'name'] (use :keys)
 */
export function extractFindColumns(query: string): string[] {
    // First check for :keys, :strs, or :syms which override variable names
    const keysMatch = query.match(/:keys\s+([\s\S]*?)(?=\s*:where|\s*:in|\s*\]\s*$)/i);
    if (keysMatch) {
        const keysClause = keysMatch[1].trim();
        // Extract symbols (unquoted words)
        const keys = keysClause.match(/[a-zA-Z_-][a-zA-Z0-9_-]*/g);
        if (keys && keys.length > 0) {
            return keys;
        }
    }

    const strsMatch = query.match(/:strs\s+([\s\S]*?)(?=\s*:where|\s*:in|\s*\]\s*$)/i);
    if (strsMatch) {
        const strsClause = strsMatch[1].trim();
        const strs = strsClause.match(/[a-zA-Z_-][a-zA-Z0-9_-]*/g);
        if (strs && strs.length > 0) {
            return strs;
        }
    }

    const symsMatch = query.match(/:syms\s+([\s\S]*?)(?=\s*:where|\s*:in|\s*\]\s*$)/i);
    if (symsMatch) {
        const symsClause = symsMatch[1].trim();
        const syms = symsClause.match(/[a-zA-Z_-][a-zA-Z0-9_-]*/g);
        if (syms && syms.length > 0) {
            return syms;
        }
    }

    // Extract the :find clause content up to :where, :in, or end of query structure
    const findMatch = query.match(/:find\s+([\s\S]*?)(?=\s*:where|\s*:in|\s*:keys|\s*:strs|\s*:syms|\s*\]\s*$)/i);
    if (!findMatch) {
        return [];
    }

    return tokenizeFindClause(findMatch[1]).map(t => t.text);
}

interface FindToken {
    /** 'var' for bare variables (and '_'), 'expr' for aggregates/pulls */
    kind: 'var' | 'expr';
    /** Bare variable for 'var' (?e), formatted expression for 'expr' (count(?e)) */
    text: string;
}

/**
 * Tokenize a :find clause into positional entries. Shared by
 * extractFindColumns and extractFindVars so the two stay aligned.
 */
function tokenizeFindClause(findClause: string): FindToken[] {
    const tokens: FindToken[] = [];
    const clause = findClause.trim();
    let i = 0;

    while (i < clause.length) {
        // Skip whitespace
        while (i < clause.length && /\s/.test(clause[i])) {
            i++;
        }
        if (i >= clause.length) { break; }

        const char = clause[i];

        // Skip result modifiers: . (scalar) or ... (collection marker)
        if (char === '.') {
            i++;
            continue;
        }

        // Handle variable: ?name or _
        if (char === '?' || char === '_') {
            let varName = '';
            while (i < clause.length && /[a-zA-Z0-9_?-]/.test(clause[i])) {
                varName += clause[i];
                i++;
            }
            if (varName) {
                tokens.push({ kind: 'var', text: varName });
            }
            continue;
        }

        // Handle aggregate or pull expression: (count ?e), (pull ?e [...])
        if (char === '(') {
            const startIdx = i;
            let depth = 1;
            i++; // skip opening paren

            while (i < clause.length && depth > 0) {
                if (clause[i] === '(') { depth++; }
                else if (clause[i] === ')') { depth--; }
                i++;
            }

            const expr = clause.slice(startIdx, i).trim();
            const formatted = formatFindExpression(expr);
            if (formatted) {
                tokens.push({ kind: 'expr', text: formatted });
            }
            continue;
        }

        // Handle collection syntax [?e ...]
        if (char === '[') {
            let depth = 1;
            i++; // skip opening bracket
            let innerContent = '';

            while (i < clause.length && depth > 0) {
                if (clause[i] === '[') { depth++; }
                else if (clause[i] === ']') { depth--; }
                if (depth > 0) { innerContent += clause[i]; }
                i++;
            }

            // Extract variable from [?e ...]
            const varMatch = innerContent.match(/(\?[a-zA-Z0-9_-]+)/);
            if (varMatch) {
                tokens.push({ kind: 'var', text: varMatch[1] });
            }
            continue;
        }

        // Skip any other character
        i++;
    }

    return tokens;
}

/**
 * Positional bare variables of the :find clause: element i is the variable
 * when find entry i is a bare variable (?e), otherwise null (aggregates,
 * pulls, _). Aligns with extractFindColumns output, including when
 * :keys/:strs/:syms override the display names.
 */
export function extractFindVars(query: string): (string | null)[] {
    const findMatch = query.match(/:find\s+([\s\S]*?)(?=\s*:where|\s*:in|\s*:keys|\s*:strs|\s*:syms|\s*\]\s*$)/i);
    if (!findMatch) {
        return [];
    }
    return tokenizeFindClause(findMatch[1]).map(t =>
        t.kind === 'var' && t.text.startsWith('?') ? t.text : null
    );
}

/**
 * Per-column flags: true when the column is a bare :find variable that
 * appears in entity position of a :where data pattern - i.e. the column
 * holds entity ids and may be rendered as entity links.
 */
export function computeEntityColumns(query: string): boolean[] {
    const findVars = extractFindVars(query);
    if (findVars.length === 0) {
        return [];
    }
    const entityVars = findEntityPositionVars(query);
    return findVars.map(v => v !== null && entityVars.has(v));
}

/**
 * Format a find expression like (count ?e) or (pull ?e [...]) into a column name
 */
function formatFindExpression(expr: string): string {
    // Remove outer parens
    const inner = expr.slice(1, -1).trim();

    // Match function name and first argument
    const match = inner.match(/^([a-zA-Z_-]+)\s+(\?[a-zA-Z0-9_-]+)/);
    if (match) {
        const [, fnName, varName] = match;
        return `${fnName}(${varName})`;
    }

    // Fallback: just return the expression cleaned up
    return expr.replace(/\s+/g, ' ');
}
